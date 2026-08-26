        // ============================================
        // HISTORIAL DE COTIZACIONES (Back4App, en la nube)
        // ============================================
        const CLASE_COTIZACIONES = 'Cotizaciones';

        // ============================================
        // CORRELATIVO (Cotización y Orden de Compra tienen numeración independiente;
        // Despacho no tiene numeración propia, toma prestado el número de una de las dos —
        // ver CORRELATIVO_ASOCIADO_DESPACHO más abajo)
        // ============================================
        // IMPORTANTE: antes de usar esto, crea en Back4App la clase "Contadores" con las filas:
        //   { tipo: "cotizacion",   siguienteNumero: 449 }
        //   { tipo: "orden_compra", siguienteNumero: 449 }
        // (449 porque el primer número que se entrega es siguienteNumero + 1, o sea 450)
        // Si no las creas tú, el código las crea solo la primera vez que se necesiten.
        const CLASE_CONTADORES = 'Contadores';
        const CLASE_PRODUCTOS = 'Productos';
        const NUMERO_INICIAL_CORRELATIVO = 450;

        // Traduce el valor del selector "tipoDocumento" al nombre de la secuencia de numeración.
        // Los 3 tipos tienen numeración independiente entre sí.
        function obtenerTipoContador(tipodoc) {
            if (tipodoc === 'ORDEN DE COMPRA') return 'orden_compra';
            if (tipodoc === 'DESPACHO') return 'despacho';
            return 'cotizacion';
        }

        // ██████████████████████████████████████████████████████████████████
        // ██  CONFIGURACIÓN: ¿A QUÉ CORRELATIVO SE ASOCIA LA GUÍA DE DESPACHO?  ██
        // ██████████████████████████████████████████████████████████████████
        // La Guía de Despacho NO tiene numeración propia: en la papeleta impresa se
        // muestra el MISMO número que la Cotización o la Orden de Compra (según cuál
        // corresponda). Cambia el valor de la siguiente línea según cómo trabajen en la
        // práctica en tu equipo:
        //
        //   'orden_compra' → el despacho muestra el mismo N° que la Orden de Compra
        //                     (recomendado: es el documento que confirma el depósito real)
        //   'cotizacion'   → el despacho muestra el mismo N° que la Cotización
        //
        const CORRELATIVO_ASOCIADO_DESPACHO = 'orden_compra';
        // ██████████████████████████████████████████████████████████████████

        // Formatea un correlativo con su sufijo de despacho, si tiene (ej: "N° 000500" o "N° 000500-B").
        // El sufijo solo aplica a despachos: cuando una misma Orden de Compra necesita más de un
        // despacho (caso típico: se olvidó despachar algo y hay que mandarlo aparte), el segundo
        // despacho de esa OC se marca "-B", el tercero "-C", y así sucesivamente — todos comparten el
        // N° de la OC, pero quedan identificados individualmente.
        function formatearCorrelativo(numero, sufijo) {
            if (numero === null || numero === undefined) return 'N° —';
            return `N° ${String(numero).padStart(6, '0')}${sufijo ? '-' + sufijo : ''}`;
        }

        // Calcula qué sufijo le corresponde al PRÓXIMO despacho de una OC, contando cuántos despachos
        // activos ya existen para ella en el servidor (consulta en vivo, no usa historialCache, porque
        // ese caché puede no estar cargado o estar desactualizado si el usuario nunca abrió la pestaña
        // Historial en esta sesión). 0 despachos previos → sin sufijo (es el primero). 1 previo → "B".
        // 2 previos → "C". Etc.
        async function calcularSufijoDespacho(ocObjectId) {
            if (!ocObjectId) return '';
            try {
                const where = encodeURIComponent(JSON.stringify({ tipoDocumento: 'despacho', ordenCompraAsociada: ocObjectId, activo: true }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}?where=${where}&count=1&limit=0`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return '';
                const data = await resp.json();
                const cantidadExistente = data.count || 0;
                return cantidadExistente === 0 ? '' : String.fromCharCode(65 + cantidadExistente); // 1→B, 2→C, 3→D...
            } catch (e) {
                console.warn('No se pudo calcular el sufijo del despacho:', e);
                return '';
            }
        }

        // Incrementa el contador de forma atómica en el servidor y devuelve el número ya asignado.
        // ⚠️ CORRECCIÓN (ver más abajo, en asegurarCorrelativo): a diferencia de lo que decía este
        // comentario antes, la respuesta de Parse a un PUT con Increment NO trae de vuelta el valor
        // ya incrementado (Parse solo devuelve "updatedAt" en un PUT normal), así que la rama
        // "releer" de más abajo se ejecuta prácticamente SIEMPRE, no como caso de respaldo raro.
        // Eso abre una ventana real (aunque angosta) entre el incremento y la relectura en la que
        // dos guardados simultáneos pueden terminar leyendo el mismo número ya actualizado — esto
        // es lo que causaba los correlativos duplicados detectados en el historial. Se corrigió
        // agregando una verificación anti-colisión en asegurarCorrelativo(). Además, sigue existiendo
        // la ventana ya documentada de la primerísima vez que se usa un "tipo" de documento (cuando
        // su fila de contador todavía no existe): si dos personas piden el primer número de ese tipo
        // en el mismo instante, ambas podrían no encontrar fila y crear una cada una. Para minimizar
        // esto:
        //   1) La búsqueda se ordena por createdAt ascendente y toma SIEMPRE la más antigua, así,
        //      si llegaran a crearse dos filas por la carrera, todos los clientes convergen en usar
        //      la misma fila "oficial" a partir de ahí (no se siguen repartiendo entre las dos).
        //   2) Si la creación falla, se vuelve a buscar antes de rendirse (por si alguien más ya la
        //      creó justo en ese instante).
        // El cierre 100% infalible de esta ventana requiere un índice ÚNICO sobre el campo "tipo" en
        // la clase Contadores desde el dashboard de Back4App (Database Browser → Contadores →
        // Schema/Indexes → agregar índice único en "tipo"); sin eso, la garantía es "muy poco
        // probable" en vez de "imposible", ya que la creación en sí no es atómica desde el cliente.
        async function obtenerYAvanzarNumeroDocumento(tipo, numeroInicial = NUMERO_INICIAL_CORRELATIVO) {
            const where = encodeURIComponent(JSON.stringify({ tipo }));
            const urlBuscar = `${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTADORES}?where=${where}&order=createdAt&limit=1`;
            const buscar = await fetch(urlBuscar, {
                headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
            });
            const dataBuscar = await buscar.json();
            let fila = (dataBuscar.results || [])[0];

            if (!fila) {
                try {
                    const crear = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTADORES}`, {
                        method: 'POST',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify({ tipo, siguienteNumero: numeroInicial - 1 })
                    });
                    if (!crear.ok) throw new Error('No se pudo crear el contador de numeración');
                    const dataCrear = await crear.json();
                    fila = { objectId: dataCrear.objectId };
                } catch (errorCrear) {
                    // Puede que otro usuario haya creado el contador de este mismo "tipo" justo en
                    // este instante. En vez de fallar de una, se vuelve a buscar: si ya existe, se
                    // usa esa fila en lugar de intentar duplicarla.
                    const reintentarBusqueda = await fetch(urlBuscar, {
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                    });
                    const dataReintento = await reintentarBusqueda.json();
                    fila = (dataReintento.results || [])[0];
                    if (!fila) throw errorCrear; // de verdad no se pudo ni crear ni encontrar
                }
            }

            const incrementar = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTADORES}/${fila.objectId}`, {
                method: 'PUT',
                headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                body: JSON.stringify({ siguienteNumero: { __op: 'Increment', amount: 1 } })
            });
            if (!incrementar.ok) throw new Error('No se pudo generar el número de documento');
            const dataIncrementar = await incrementar.json();

            if (typeof dataIncrementar.siguienteNumero === 'number') {
                return dataIncrementar.siguienteNumero;
            }
            // Respaldo (poco probable): si el servidor no devolvió el valor, se relee
            const releer = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTADORES}/${fila.objectId}`, {
                headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
            });
            const dataReleer = await releer.json();
            return dataReleer.siguienteNumero;
        }


        // ============================================
        // RECUPERAR HISTORIAL DE UN NAVEGADOR/ARCHIVO ANTIGUO (CASO PUNTUAL)
        // ============================================
        // Cambia esto a "false" para ocultar ambos botones (exportar/importar) una vez
        // que ya no se necesiten. No afecta ninguna otra parte de la app.
        const HABILITAR_RECUPERAR_HISTORIAL_LOCAL = false;

        function aplicarVisibilidadRecuperarHistorial() {
            const btnExportar = document.getElementById('btnExportarHistorialLocal');
            const btnImportar = document.getElementById('btnImportarHistorial');
            const visible = HABILITAR_RECUPERAR_HISTORIAL_LOCAL ? 'inline-block' : 'none';
            if (btnExportar) btnExportar.style.display = visible;
            if (btnImportar) btnImportar.style.display = visible;
        }

        // Para la persona que todavía usa el archivo HTML local (no la web): exporta lo que
        // tiene guardado en su navegador a un archivo .json que luego se sube con "Importar".
        function exportarHistorialLocal() {
            let historialLocal = [];
            try { historialLocal = JSON.parse(localStorage.getItem('historial_lh') || '[]'); } catch (e) { historialLocal = []; }

            if (historialLocal.length === 0) {
                mostrarNotificacion('Este navegador no tiene cotizaciones locales guardadas para exportar', 'info');
                return;
            }

            const blob = new Blob([JSON.stringify(historialLocal, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `historial_local_backup_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            mostrarNotificacion(`Se exportaron ${historialLocal.length} cotización(es). Envía ese archivo para importarlo.`, 'success');
        }

        // Sube al usuario actualmente logueado el contenido de un archivo .json exportado con el botón de arriba
        async function importarHistorialDesdeArchivo(event) {
            const archivo = event.target.files[0];
            if (!archivo) return;

            try {
                const texto = await archivo.text();
                const entradas = JSON.parse(texto);
                if (!Array.isArray(entradas) || entradas.length === 0) {
                    mostrarNotificacion('El archivo no tiene cotizaciones válidas', 'warning');
                    return;
                }

                if (!confirm(`¿Importar ${entradas.length} cotización(es) a la cuenta de ${usuarioActual.nombre}?`)) return;

                mostrarNotificacion(`Importando ${entradas.length} cotización(es)...`, 'info');
                let importadas = 0;
                for (const entry of entradas) {
                    try {
                        const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}`, {
                            method: 'POST',
                            headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual.sessionToken }),
                            body: JSON.stringify({
                                cliente: entry.cliente || 'Sin nombre',
                                empresaCliente: entry.empresa || entry.empresaCliente || '',
                                ruc: entry.ruc || '',
                                telefono: entry.telefono || '',
                                email: entry.email || '',
                                direccion: entry.direccion || '',
                                notas: entry.notas || '',
                                productos: entry.productos || [],
                                sucursal: entry.sucursal || null,
                                globalDescPct: entry.globalDescPct || 0,
                                total: entry.total || 0,
                                mostrarConIGV: !!entry.mostrarConIGV,
                                forzarPorMayor: !!entry.forzarPorMayor,
                                activo: true,
                                usuario: usuarioActual.username,
                                usuarioNombre: usuarioActual.nombre
                            })
                        });
                        if (resp.ok) importadas++;
                    } catch (e) {
                        console.error('Error importando una cotización:', e);
                    }
                }

                mostrarNotificacion(`${importadas} de ${entradas.length} cotización(es) importadas`, 'success');
                renderHistorial();
            } catch (e) {
                console.error('Error al leer el archivo de importación:', e);
                mostrarNotificacion('El archivo no tiene un formato válido', 'warning');
            } finally {
                event.target.value = ''; // permite volver a elegir el mismo archivo si hace falta
            }
        }

        function switchTabById(tab) {
            tabActual = tab;
            document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll(`[data-tab="${tab}"]`).forEach(t => t.classList.add('active'));
            const tabEl = document.getElementById(`tab-${tab}`);
            if (tabEl) tabEl.classList.add('active');
            const esSecundaria = TABS_DENTRO_DE_MAS.includes(tab);
            document.querySelectorAll('.tabs-more, .tabs-mobile-more').forEach(el => {
                el.classList.toggle('trigger-active', esSecundaria);
                el.classList.remove('open');
            });
            if (tab === 'cotizar') actualizarPanelCorrelativo();
        }

