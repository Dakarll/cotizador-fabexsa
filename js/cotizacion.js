        // ============================================
        // ESTADO DE LA APLICACIÓN
        // ============================================

        let productosEnTabla = [];
        // FIX (clientes duplicados al corregir un dato mal escrito): recuerda el objectId exacto
        // del registro de la clase "Clientes" que corresponde al cliente que se está editando en
        // el formulario ahora mismo. Mientras este valor esté presente, guardar la cotización
        // ACTUALIZA ese mismo registro en la nube en vez de volver a buscarlo por nombre+empresa —
        // así, si el nombre tenía un typo y se corrige antes de terminar, no se crea un cliente
        // nuevo dejando el mal escrito como basura. Se pone en null al iniciar una cotización
        // nueva, y se rellena de nuevo al elegir un cliente del buscador o al cargar una cotización
        // ya guardada que tenga ese vínculo.
        let clienteDBObjectIdEnCurso = null;
        // Guarda, por tipo de documento, el correlativo y el objectId del registro que se está
        // armando ahora mismo — así, si se regenera la misma cotización, se reutiliza el mismo
        // número y se actualiza el mismo registro en vez de crear uno nuevo.
        let registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
        // FIX (contaminación cruzada entre tipos de documento): registroEnCurso guarda a la vez el
        // objectId/correlativo "en curso" de los 3 tipos de documento, y antes solo se limpiaba por
        // completo con "Nueva Solicitud". Si el usuario cargaba una Orden de Compra y luego, sin
        // limpiar, cambiaba el selector a "Cotización" para un cliente distinto, un objectId viejo
        // de sesiones anteriores podía seguir ahí y el guardado terminaba pisando ese registro ajeno.
        // Esta variable indica CUÁL tipo de documento corresponde de verdad a lo que hay ahora mismo
        // en pantalla (productos/cliente): solo el que se acaba de cargar explícitamente desde el
        // historial (cargarDesdeHistorial/crearDespachoDesdeOC) o el que se acaba de guardar. Cualquier
        // cambio MANUAL del selector a otro tipo distinto de este se trata como "documento nuevo" y
        // limpia el registroEnCurso de ese tipo, para no reutilizar por error un objectId antiguo.
        let tipoContadorCargadoExplicitamente = null;

        // ============================================
        // 🧪 MODO DESARROLLADOR / PRUEBA
        // ============================================
        // Permite generar Cotización, Orden de Compra y Despacho "de prueba" para verificar que todo
        // funciona (PDF, cálculos, flujo) SIN tocar nada real: cada tipo de documento usa, mientras
        // este modo está activo, su propio contador de correlativo aparte ("cotizacion_prueba",
        // "orden_compra_prueba", "despacho_prueba" — filas nuevas e independientes en la clase de
        // Contadores) y se guarda con tipoDocumento = "..._prueba", así que automáticamente:
        //   • NUNCA coincide con el contador real (el guard "existeCorrelativoEnUso" ni se cruza).
        //   • NUNCA entra al bloque que ajusta el Kardex, porque ese bloque solo se activa cuando
        //     tipoContador === 'orden_compra' exactamente (no 'orden_compra_prueba').
        //   • NUNCA aparece en el historial normal ni en sus filtros/reportes (se filtra en
        //     cargarHistorialDesdeNube), salvo mientras este modo sigue activo, para poder revisar
        //     que la prueba se guardó bien.
        //   • El Despacho de prueba es siempre independiente (no toma prestado el número de ninguna
        //     Orden de Compra, real ni de prueba), para no poder tocar el estado de ninguna OC real.
        // Solo lo puede activar un usuario "master", y queda guardado por usuario (no se comparte
        // entre cuentas) con un banner bien visible mientras está encendido para que nunca quede
        // prendido sin que alguien se dé cuenta.
        //
        // ⚙️ INTERRUPTOR: para deshabilitar por completo el Modo Prueba (que nadie, ni un master,
        // pueda activarlo), cambia esta constante a "false". Con eso el botón "🧪 Prueba" queda
        // oculto para todos y toggleModoDesarrollador() no hace nada, sin necesidad de tocar ni
        // borrar el resto del código de esta sección.
        const MODO_DESARROLLADOR_HABILITADO = false;

        let modoDesarrollador = false;

        function claveModoDesarrollador() {
            return 'modo_prueba_lh_' + (usuarioActual?.username || 'anon');
        }

        function toggleModoDesarrollador() {
            if (!MODO_DESARROLLADOR_HABILITADO) return;
            if (usuarioActual?.nivel !== 'master') return;
            modoDesarrollador = !modoDesarrollador;
            try { localStorage.setItem(claveModoDesarrollador(), modoDesarrollador ? '1' : '0'); } catch (e) {}
            aplicarVisibilidadModoDesarrollador();
            actualizarPanelCorrelativo();
            mostrarNotificacion(modoDesarrollador
                ? '🧪 Modo prueba activado: los documentos que generes ahora no afectan el correlativo real ni el Kardex'
                : 'Modo prueba desactivado', modoDesarrollador ? 'warning' : 'info');
        }

        function aplicarVisibilidadModoDesarrollador() {
            const btn = document.getElementById('btnToggleModoPrueba');
            const banner = document.getElementById('bannerModoPrueba');
            const esMaster = usuarioActual?.nivel === 'master';
            if (btn) {
                btn.style.display = (MODO_DESARROLLADOR_HABILITADO && esMaster) ? 'inline-block' : 'none';
                btn.textContent = modoDesarrollador ? '🧪 Prueba: ON' : '🧪 Prueba';
            }
            if (banner) banner.style.display = (MODO_DESARROLLADOR_HABILITADO && esMaster && modoDesarrollador) ? 'block' : 'none';
        }

        let productoSeleccionado = null;
        let sucursalSeleccionada = null;
        let tabActual = 'cotizar';
        let tipoFiltro = 'all';
        let productoEditandoIndex = -1;
        let sucursalEditandoIndex = -1;

        // ============================================
        // SISTEMA DE IGV Y FORZAR POR MAYOR
        // ============================================
        
        const IGV_RATE = 0.18; // 18% IGV en Perú
        let mostrarConIGV = false;
        let forzarPorMayor = false;

        // Calcular precio con IGV
        function calcularPrecioConIGV(precioBase) {
            return precioBase * (1 + IGV_RATE);
        }

        // Calcular solo el IGV
        function calcularIGV(precioBase) {
            return precioBase * IGV_RATE;
        }

        // Obtener precio correcto según configuración (soporta 3 niveles: Und / 1-4 Docena / Mayor)
        function obtenerPrecio(producto, cantidad) {
            if (forzarPorMayor) {
                return producto.precioMayor; // Siempre por mayor
            }
            if (producto.escalonado) {
                const qMayor = producto.cantidadMayor || 12;
                const qCuarto = producto.cantidadCuarto || 3;
                if (cantidad >= qMayor) return producto.precioMayor;
                if (producto.precioCuarto !== null && producto.precioCuarto !== undefined && cantidad >= qCuarto) return producto.precioCuarto;
                return producto.precioUnd;
            }
            // Productos sin escalonado (comportamiento anterior, umbral de 6 unidades)
            return cantidad >= 6 ? producto.precioMayor : producto.precioUnd;
        }

        // Etiqueta legible del nivel de precio aplicado (para mostrar en tabla/PDF)
        function obtenerEtiquetaTipoPrecio(producto, cantidad) {
            if (forzarPorMayor) {
                return producto.tipoMayor === 'paquete' ? 'Por Paquete (Forzado)' : 'Por Mayor (Forzado)';
            }
            if (producto.escalonado) {
                const qMayor = producto.cantidadMayor || 12;
                const qCuarto = producto.cantidadCuarto || 3;
                const etiquetaMayor = producto.tipoMayor === 'paquete' ? `Por Paquete (${qMayor})` : `Por Mayor (Docena)`;
                if (cantidad >= qMayor) return etiquetaMayor;
                if (producto.precioCuarto !== null && producto.precioCuarto !== undefined && cantidad >= qCuarto) return '1/4 Docena';
                return 'Por Unidad';
            }
            return cantidad >= 6 ? 'Por Mayor' : 'Por Menor';
        }

        // Cargar preferencias guardadas (IGV y Forzar Por Mayor quedaron desactivados; la barra se eliminó)
        function cargarPreferencias() {
            // mostrarConIGV y forzarPorMayor permanecen en false (sin controles visibles en la interfaz)
        }

        // ============================================
        // PERSISTENCIA (localStorage)
        // ============================================

        // Migra productos guardados en localStorage con el esquema anterior (menor/mayor)
        // al nuevo esquema (precioUnd/precioCuarto/precioMayor + escalonado)
        function migrarProductoLegacy(p) {
            if (!p) return p;
            if (p.precioUnd === undefined && p.menor !== undefined) {
                p.precioUnd = p.menor;
            }
            if (p.precioMayor === undefined && p.mayor !== undefined) {
                p.precioMayor = p.mayor;
            }
            if (p.precioUnd === undefined) p.precioUnd = 0;
            if (p.precioMayor === undefined) p.precioMayor = p.precioUnd;
            if (p.precioCuarto === undefined) p.precioCuarto = null;
            if (p.escalonado === undefined) p.escalonado = false;
            if (p.tipoMayor === undefined) p.tipoMayor = 'docena';
            if (p.cantidadCuarto === undefined) p.cantidadCuarto = 3;
            if (p.cantidadMayor === undefined) p.cantidadMayor = p.tipoMayor === 'paquete' ? CANTIDAD_PAQUETE_DEFAULT : 12;
            return p;
        }

        // FIX (contaminación entre usuarios en un equipo compartido): antes esto se guardaba bajo una
        // única clave fija en localStorage, igual para cualquier usuario que iniciara sesión en ese
        // navegador. Si un vendedor dejaba una cotización/OC a medias sin usar "Nueva Solicitud" y
        // otro vendedor iniciaba sesión después en la MISMA compu/tablet, heredaba automáticamente el
        // carrito (y el objectId "en curso") del primero, y al guardar terminaba sobrescribiendo el
        // registro del primer vendedor con sus propios datos. Ahora la clave incluye el usuario, así
        // cada quien tiene su propio "borrador" aislado en el mismo dispositivo.
        function claveEstadoLocal() {
            return 'cotizacion_linea_hotelera_' + (usuarioActual?.username || 'anon');
        }

        function guardarEstado() {
            const estado = {
                productos: productosEnTabla,
                sucursal: sucursalSeleccionada,
                productosDB: productosDB,
                // sucursalesDB ya NO se persiste acá: el catálogo Shalom viene solo de la nube
                // (ver js/sucursales-nube.js) y las sucursales manuales tienen su propia clave.
                registroEnCurso: registroEnCurso,
                // Datos del cliente: antes no se guardaban aquí, solo los productos. Esto causaba
                // que al reabrir el cotizador (celular/PC) los productos volvieran a aparecer pero
                // el cliente quedara vacío, y si en ese momento se le daba "Guardar" de nuevo, se
                // actualizaba (PUT) el mismo registro en la nube borrando los datos de cliente que
                // sí tenía guardados. Ahora se persiste también el cliente, igual que el resto.
                cliente: getClienteData(),
                fecha: new Date().toISOString()
            };
            try {
                localStorage.setItem(claveEstadoLocal(), JSON.stringify(estado));
            } catch (e) {
                console.error('Error al guardar estado:', e);
            }
        }

        function cargarEstado() {
            try {
                const stored = localStorage.getItem(claveEstadoLocal());
                if (stored) {
                    const estado = JSON.parse(stored);
                    const fecha = new Date(estado.fecha);
                    const ahora = new Date();
                    const diferencia = (ahora - fecha) / (1000 * 60 * 60);
                    
                    if (diferencia < 24) {
                        productosEnTabla = (estado.productos || []).map(migrarProductoLegacy);
                        sucursalSeleccionada = estado.sucursal || null;
                        registroEnCurso = Object.assign({ cotizacion: null, orden_compra: null, despacho: null }, estado.registroEnCurso || {});
                        if (estado.productosDB) {
                            productosDB = estado.productosDB.map(migrarProductoLegacy);
                        }
                        // estado.sucursalesDB (de versiones viejas) se ignora a propósito:
                        // el catálogo Shalom lo repuebla cargarSucursalesDesdeNube().
                        // Restaurar los datos del cliente guardados junto con la cotización. Si el
                        // registro guardado es de antes de este cambio, estado.cliente no existirá
                        // y simplemente se deja el formulario como estaba (sin romper nada).
                        if (estado.cliente) {
                            document.getElementById('clienteNombre').value = estado.cliente.nombre || '';
                            document.getElementById('clienteEmpresa').value = estado.cliente.empresa || '';
                            document.getElementById('clienteRUC').value = estado.cliente.ruc || '';
                            document.getElementById('clienteTelefono').value = estado.cliente.telefono || '';
                            document.getElementById('clienteEmail').value = estado.cliente.email || '';
                            document.getElementById('clienteDireccion').value = estado.cliente.direccion || '';
                            document.getElementById('clienteNotas').value = estado.cliente.notas || '';
                            olvidarAutocompletadoRUCDNI();
                            actualizarResumenCliente();
                        }
                        renderTable();
                        renderProductList();
                        renderSucursalList();
                        if (sucursalSeleccionada) {
                            mostrarSucursalSeleccionada();
                        }
                        const hayClienteRecuperado = estado.cliente && Object.values(estado.cliente).some(v => v);
                        if (productosEnTabla.length > 0 || sucursalSeleccionada || hayClienteRecuperado) {
                            mostrarNotificacion('Se recuperó tu cotización anterior', 'success');
                        }
                    }
                }
            } catch (e) {
                console.error('Error al cargar estado:', e);
            }
        }


        // ============================================
        // AUTOCOMPLETADO DE PRODUCTOS
        // ============================================

        const searchInput = document.getElementById('searchInput');
        const autocompleteDropdown = document.getElementById('autocompleteDropdown');
        const btnAdd = document.getElementById('btnAdd');

        // Quita acentos y pasa a minúsculas, para comparar texto sin importar tildes/mayúsculas
        function normalizarTexto(texto) {
            return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }

        // Oculta y limpia el modo "creando producto nuevo" (campo de precio + aviso), volviendo al
        // botón normal de agregar. Se llama al seleccionar un producto EXISTENTE, o al vaciar/cambiar
        // la búsqueda, para no dejar rastros del modo anterior.
        function salirModoNuevoProducto() {
            document.getElementById('nuevoProductoPrecioField').style.display = 'none';
            document.getElementById('nuevoProductoAviso').style.display = 'none';
            document.getElementById('inputNuevoProductoPrecio').value = '';
            btnAdd.textContent = 'Agregar a la Cotización';
        }

        // Activa el modo "creando producto nuevo": el nombre ya viene de lo que el usuario escribió
        // en el buscador (no hace falta retipearlo). Se muestra el campo de precio (obligatorio) y el
        // resto de la fila de extras (color/cantidad) igual que con cualquier producto existente.
        function iniciarCreacionProductoNuevo(nombreTentativo) {
            productoSeleccionado = { __nuevo: true, nombre: nombreTentativo };
            autocompleteDropdown.style.display = 'none';
            btnAdd.disabled = false;
            btnAdd.textContent = '✨ Crear y Agregar a la Cotización';
            document.getElementById('addExtrasRow').classList.add('visible');
            document.getElementById('nuevoProductoPrecioField').style.display = 'flex';
            document.getElementById('nuevoProductoAviso').style.display = 'block';
            document.getElementById('inputColor').value = '';
            document.getElementById('colorChips').innerHTML = '';
            document.getElementById('inputNuevoProductoPrecio').value = '';
            document.getElementById('inputNuevoProductoPrecio').focus();
        }

        searchInput.addEventListener('input', function() {
            const query = normalizarTexto(this.value.trim());

            if (query.length < 2) {
                autocompleteDropdown.style.display = 'none';
                productoSeleccionado = null;
                btnAdd.disabled = true;
                document.getElementById('addExtrasRow').classList.remove('visible');
                salirModoNuevoProducto();
                return;
            }

            // Búsqueda inteligente: separa lo escrito en palabras y exige que TODAS calcen en
            // algún lugar del producto (nombre, código, o algún color que tenga en el Kardex),
            // sin importar el orden ni mayúsculas/acentos. Ej: "toalla verde" encuentra toallas
            // que tengan un color verde disponible, aunque "verde" no esté en el nombre.
            const palabras = query.split(/\s+/).filter(Boolean);
            const resultados = productosDB.filter(producto => {
                const nombreNorm = normalizarTexto(producto.nombre);
                const codigoNorm = normalizarTexto(producto.codigo);
                const coloresNorm = (coloresPorProducto[producto.codigo] || []).map(c => normalizarTexto(c.color));
                return palabras.every(palabra =>
                    nombreNorm.includes(palabra) ||
                    codigoNorm.includes(palabra) ||
                    coloresNorm.some(c => c.includes(palabra))
                );
            });

            if (resultados.length > 0) {
                autocompleteDropdown.innerHTML = resultados.map(producto => `
                    <div class="autocomplete-item" data-codigo="${producto.codigo}">
                        <div class="product-name">${producto.nombre}</div>
                        <div class="product-prices">
                            <span class="price-tag price-menor">Und: ${mostrarConIGV ? `S/ ${calcularPrecioConIGV(producto.precioUnd).toFixed(2)}` : `S/ ${producto.precioUnd.toFixed(2)}`}</span>
                            ${producto.escalonado && producto.precioCuarto !== null ? `<span class="price-tag price-cuarto">1/4: ${mostrarConIGV ? `S/ ${calcularPrecioConIGV(producto.precioCuarto).toFixed(2)}` : `S/ ${producto.precioCuarto.toFixed(2)}`}</span>` : ''}
                            <span class="price-tag price-mayor">${producto.tipoMayor === 'paquete' ? 'Paquete' : 'Mayor'}: ${mostrarConIGV ? `S/ ${calcularPrecioConIGV(producto.precioMayor).toFixed(2)}` : `S/ ${producto.precioMayor.toFixed(2)}`}</span>
                            <span style="margin-left: 10px; color: #a0aec0;">${producto.codigo}</span>
                        </div>
                        ${(coloresPorProducto[producto.codigo]?.length) ? `<div style="margin-top:5px;">${generarCirculosColor(producto.codigo, 14)}</div>` : ''}
                    </div>
                `).join('');
                autocompleteDropdown.style.display = 'block';

                document.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', function() {
                        const codigo = this.dataset.codigo;
                        productoSeleccionado = productosDB.find(p => p.codigo === codigo);
                        searchInput.value = productoSeleccionado.nombre;
                        autocompleteDropdown.style.display = 'none';
                        btnAdd.disabled = false;
                        salirModoNuevoProducto();
                        // Mostrar fila de extras
                        document.getElementById('addExtrasRow').classList.add('visible');
                        document.getElementById('inputColor').value = '';
                        renderChipsColorAgregar(codigo);
                        document.getElementById('inputColor').focus();
                    });
                });
            } else {
                // Sin resultados: se ofrece crear un producto nuevo con el texto ya escrito, en vez
                // de obligar a ir a Ajustes → Productos. Útil para variantes puntuales de un pedido
                // (ej. "Sábanas Hoteleras con Lienzo" a partir de "Sábanas Hoteleras").
                const textoEscrito = this.value.trim();
                autocompleteDropdown.innerHTML = `
                    <div style="padding: 12px 15px; text-align: center; color: #718096;">No se encontraron productos</div>
                    <div class="autocomplete-item" id="btnCrearProductoNuevo" style="background:#fff7ed;border-top:1.5px dashed #fdba74;">
                        <div class="product-name" style="color:#9a3412;">➕ Crear producto nuevo: "${textoEscrito}"</div>
                        <div style="font-size:0.8em;color:#9a3412;opacity:0.85;margin-top:2px;">Se guardará en la nube con un código genérico (NP-####)</div>
                    </div>
                `;
                autocompleteDropdown.style.display = 'block';
                document.getElementById('btnCrearProductoNuevo').addEventListener('click', function() {
                    iniciarCreacionProductoNuevo(textoEscrito);
                });
            }
        });

        document.addEventListener('click', function(e) {
            if (!searchInput.contains(e.target) && !autocompleteDropdown.contains(e.target)) {
                autocompleteDropdown.style.display = 'none';
            }
        });

        // ============================================
        // AGREGAR PRODUCTO A COTIZACIÓN
        // ============================================

        btnAdd.addEventListener('click', async function() {
            if (!productoSeleccionado) return;

            const colorIngresado = document.getElementById('inputColor').value.trim();
            const cantidadInicial = parseInt(document.getElementById('inputCantidadInicial').value) || 1;

            // Si es un producto nuevo (creado desde el buscador), primero hay que generarle su
            // código genérico y guardarlo en la nube antes de poder agregarlo a la tabla.
            if (productoSeleccionado.__nuevo) {
                const precioIngresado = parseFloat(document.getElementById('inputNuevoProductoPrecio').value);
                if (!precioIngresado || precioIngresado <= 0) {
                    mostrarNotificacion('Ingresa el precio del producto nuevo', 'warning');
                    document.getElementById('inputNuevoProductoPrecio').focus();
                    return;
                }
                btnAdd.disabled = true;
                const textoOriginal = btnAdd.textContent;
                btnAdd.textContent = 'Creando producto...';
                try {
                    productoSeleccionado = await crearYGuardarProductoGenerico(productoSeleccionado.nombre, precioIngresado);
                } catch (e) {
                    console.error('Error creando producto nuevo:', e);
                    mostrarNotificacion('No se pudo crear el producto: ' + e.message, 'warning');
                    btnAdd.disabled = false;
                    btnAdd.textContent = textoOriginal;
                    return;
                }
                salirModoNuevoProducto();
            }

            // Permitir mismo producto si tiene color diferente
            const existe = productosEnTabla.find(p => 
                p.codigo === productoSeleccionado.codigo && 
                (p.color || '') === colorIngresado
            );
            if (existe) {
                mostrarNotificacion('Este producto con el mismo color ya está en la cotización', 'warning');
                btnAdd.disabled = false;
                return;
            }

            productosEnTabla.push({
                ...productoSeleccionado,
                cantidad: cantidadInicial,
                color: colorIngresado || ''
            });

            renderTable();
            renderProductList();
            renderProductosVistaRapida();
            searchInput.value = '';
            document.getElementById('inputColor').value = '';
            document.getElementById('inputCantidadInicial').value = '1';
            document.getElementById('addExtrasRow').classList.remove('visible');
            productoSeleccionado = null;
            btnAdd.disabled = true;
            guardarEstado();
        });

        // ============================================
        // RENDERIZAR TABLA COTIZACIÓN
        // ============================================

        function renderTable() {
            const tableBody = document.getElementById('tableBody');
            
            if (productosEnTabla.length === 0) {
                tableBody.innerHTML = '<tr class="empty-state"><td colspan="6">📋 No hay productos agregados</td></tr>';
                document.getElementById('btnGenerateImage').disabled = true;
                document.getElementById('btnCopyImage').disabled = true;
                document.getElementById('btnGuardarHistorial').disabled = true;
            } else {
                tableBody.innerHTML = productosEnTabla.map((producto, index) => {
                    const cantidad = producto.cantidad;
                    const precioBase = obtenerPrecio(producto, cantidad);
                    const precioUnitario = producto.precioOverride !== undefined ? producto.precioOverride : precioBase;
                    const descPct = producto.descuento || 0;
                    const precioConDesc = precioUnitario * (1 - descPct / 100);
                    const total = cantidad * precioConDesc;
                    const hasOverride = producto.precioOverride !== undefined;
                    const hasDesc = descPct > 0;
                    let tipoPrecio = hasOverride ? 'Personalizado' : obtenerEtiquetaTipoPrecio(producto, cantidad);

                    const colorTag = producto.color ? `<div><span class="color-tag">🎨 ${producto.color}</span></div>` : '';

                    const precioDisplay = mostrarConIGV ? `
                        <div>
                            ${hasDesc ? `<span class="precio-original">S/ ${calcularPrecioConIGV(precioUnitario).toFixed(2)}</span>` : ''}
                            <span class="precio-con-igv">S/ ${calcularPrecioConIGV(precioConDesc).toFixed(2)}</span>
                            ${hasOverride ? '<span class="precio-override-badge">✏️</span>' : ''}
                        </div>
                    ` : `<div>
                            ${hasDesc ? `<span class="precio-original">S/ ${precioUnitario.toFixed(2)}</span>` : ''}
                            S/ ${precioConDesc.toFixed(2)}
                            ${hasOverride ? '<span class="precio-override-badge">✏️</span>' : ''}
                        </div>`;

                    const totalDisplay = mostrarConIGV ?
                        `S/ ${calcularPrecioConIGV(total).toFixed(2)}` :
                        `S/ ${total.toFixed(2)}`;

                    return `
                        <tr>
                            <td class="codigo-cell">${producto.codigo}</td>
                            <td class="producto-cell">
                                ${producto.nombre}
                                ${colorTag}
                            </td>
                            <td>
                                <input type="number" class="cantidad-input" value="${cantidad}" min="1"
                                    onchange="updateCantidad(${index}, this.value)">
                            </td>
                            <td class="precio-cell">
                                <div style="display:flex;align-items:center;gap:4px;">
                                    ${precioDisplay}
                                    <button class="precio-edit-btn" title="Editar precio" onclick="togglePrecioEdit(${index})">✏️</button>
                                </div>
                                <span class="precio-aplicado">${tipoPrecio}</span>
                                <div class="precio-inline-edit" id="precioEdit_${index}">
                                    <span style="font-size:0.85em;color:#718096;">S/</span>
                                    <input class="precio-inline-input" type="number" step="0.01" min="0"
                                        id="precioInput_${index}" value="${precioUnitario.toFixed(2)}">
                                    <button class="precio-inline-save" onclick="guardarPrecioOverride(${index})">✔</button>
                                    <button class="precio-inline-cancel" onclick="cancelarPrecioEdit(${index})">✕</button>
                                    ${hasOverride ? `<button class="precio-inline-cancel" title="Restaurar" onclick="restaurarPrecio(${index})" style="color:#e53e3e;">↩</button>` : ''}
                                </div>
                            </td>
                            <td class="total-cell">${totalDisplay}</td>
                            <td>
                                <button class="btn-remove" onclick="removeProduct(${index})">✕</button>
                            </td>
                        </tr>
                    `;
                }).join('');
                document.getElementById('btnGenerateImage').disabled = false;
                document.getElementById('btnCopyImage').disabled = false;
                document.getElementById('btnGuardarHistorial').disabled = false;
            }

            updateTotal();
        }

        function updateCantidad(index, nuevaCantidad) {
            const cantidad = parseInt(nuevaCantidad) || 1;
            productosEnTabla[index].cantidad = cantidad < 1 ? 1 : cantidad;
            renderTable();
            guardarEstado();
        }

        function removeProduct(index) {
            if (confirm('¿Eliminar este producto de la cotización?')) {
                productosEnTabla.splice(index, 1);
                renderTable();
                guardarEstado();
            }
        }

        function updateTotal() {
            let totalBruto = 0;
            let totalUnidades = 0;
            let itemsMayor = 0;
            let itemsMenor = 0;

            productosEnTabla.forEach(producto => {
                const cantidad = producto.cantidad;
                const precioBase = obtenerPrecio(producto, cantidad);
                const precioUnitario = producto.precioOverride !== undefined ? producto.precioOverride : precioBase;
                const descPct = producto.descuento || 0;
                const precioConDesc = precioUnitario * (1 - descPct / 100);
                totalBruto += cantidad * precioConDesc;
                totalUnidades += cantidad;
                const esMayor = forzarPorMayor || (producto.escalonado ? cantidad >= (producto.cantidadMayor || 12) : cantidad >= 6);
                if (esMayor) itemsMayor++;
                else itemsMenor++;
            });

            // Descuento global
            const globalDescPct = parseFloat(document.getElementById('globalDiscount')?.value) || 0;
            const descGlobalMonto = totalBruto * globalDescPct / 100;
            const totalFinal = totalBruto - descGlobalMonto;

            // Subtotal rows
            const subtotalEl = document.getElementById('subtotalRows');
            if (globalDescPct > 0) {
                const subtotalDisplay = mostrarConIGV ? calcularPrecioConIGV(totalBruto) : totalBruto;
                const descDisplay = mostrarConIGV ? calcularPrecioConIGV(descGlobalMonto) : descGlobalMonto;
                subtotalEl.innerHTML = `
                    <div class="subtotal-row"><span>Subtotal:</span><span>S/ ${subtotalDisplay.toFixed(2)}</span></div>
                    <div class="subtotal-row"><span>Desc. global (${globalDescPct}%):</span><span>-S/ ${descDisplay.toFixed(2)}</span></div>
                `;
            } else {
                subtotalEl.innerHTML = '';
            }

            const totalElement = document.getElementById('totalAmount');
            if (mostrarConIGV) {
                const totalConIGV = calcularPrecioConIGV(totalFinal);
                const soloIGV = calcularIGV(totalFinal);
                totalElement.innerHTML = `
                    <div style="text-align: right;">
                        <div style="font-size: 0.6em; color: rgba(255,255,255,0.7);">Sin IGV: S/ ${totalFinal.toFixed(2)}</div>
                        <div>S/ ${totalConIGV.toFixed(2)} <span class="igv-indicator">+IGV</span></div>
                        <div style="font-size: 0.5em; color: rgba(255,255,255,0.7); margin-top: 5px;">IGV (18%): S/ ${soloIGV.toFixed(2)}</div>
                    </div>
                `;
            } else {
                totalElement.textContent = `S/ ${totalFinal.toFixed(2)}`;
            }

            document.getElementById('totalInfo').textContent = 
                `${productosEnTabla.length} producto${productosEnTabla.length !== 1 ? 's' : ''} (${totalUnidades} unidades)`;
            
            let breakdown = '';
            if (forzarPorMayor) {
                breakdown = `${productosEnTabla.length} forzados a por mayor`;
            } else {
                if (itemsMayor > 0) breakdown += `${itemsMayor} al por mayor`;
                if (itemsMayor > 0 && itemsMenor > 0) breakdown += ' • ';
                if (itemsMenor > 0) breakdown += `${itemsMenor} al por menor`;
            }
            document.getElementById('itemsBreakdown').textContent = breakdown;

            if (sucursalSeleccionada) {
                document.getElementById('envioInfo').innerHTML = 
                    `<span class="badge badge-success">📦 Envío a: ${sucursalSeleccionada.nombre} - ${sucursalSeleccionada.ciudad}</span>`;
            } else {
                document.getElementById('envioInfo').innerHTML = '';
            }
        }

        // ============================================
        // FORMA DE PAGO / ADELANTO
        // ============================================

        function actualizarPago() {
            const adelanto = parseFloat(document.getElementById('montoAdelanto').value) || 0;
            const saldoEl = document.getElementById('saldoPendienteLabel');
            const resumenEl = document.getElementById('pagoResumen');

            if (adelanto <= 0) {
                saldoEl.textContent = '';
                resumenEl.textContent = '';
                return;
            }

            let totalBruto = 0;
            productosEnTabla.forEach(p => {
                const precio = p.precioOverride !== undefined ? p.precioOverride : obtenerPrecio(p, p.cantidad);
                const desc = p.descuento || 0;
                totalBruto += p.cantidad * precio * (1 - desc / 100);
            });
            const globalDescPct = parseFloat(document.getElementById('globalDiscount')?.value) || 0;
            const totalFinal = mostrarConIGV
                ? calcularPrecioConIGV(totalBruto * (1 - globalDescPct / 100))
                : totalBruto * (1 - globalDescPct / 100);

            const saldo = Math.max(0, totalFinal - adelanto);
            saldoEl.innerHTML = `&nbsp;·&nbsp; <span style="color:#fbbf24;font-weight:700;">Saldo: S/ ${saldo.toFixed(2)}</span>`;
            resumenEl.textContent = `Adelanto S/ ${adelanto.toFixed(2)} sobre total S/ ${totalFinal.toFixed(2)}`;
        }

        // Bloquea el selector "tipoDocumento" cuando el documento en curso es un Despacho vinculado
        // a una Orden de Compra puntual (creado con "📦 Crear Despacho"), para que no se pueda
        // cambiar el tipo por accidente a mitad de camino y terminar pisando esa OC por error.
        // Se desbloquea solo (o directamente no se bloquea) en cualquier otro caso.
        function actualizarBloqueoSelectorTipoDocumento() {
            const selector = document.getElementById('tipoDocumento');
            if (!selector) return;
            const vinculado = !!registroEnCurso.despacho?.ordenCompraAsociada && selector.value === 'DESPACHO';
            selector.disabled = vinculado;
            selector.title = vinculado
                ? `🔒 ${formatearCorrelativo(registroEnCurso.despacho.correlativo, registroEnCurso.despacho.sufijoDespacho)} — vinculado a Orden de Compra. Usa "Nueva Solicitud" para desvincularlo y volver a elegir tipo.`
                : '';
        }

        function clearAll() {
            const cliente = getClienteData();
            const hayCliente = Object.values(cliente).some(v => v);
            if (productosEnTabla.length === 0 && !sucursalSeleccionada && !hayCliente) return;
            if (confirm('¿Limpiar la cotización? Esto también borrará los datos del cliente.')) {
                productosEnTabla = [];
                sucursalSeleccionada = null;
                if (document.getElementById('globalDiscount')) document.getElementById('globalDiscount').value = '';
                document.getElementById('montoAdelanto').value = '';
                document.getElementById('saldoPendienteLabel').textContent = '';
                document.getElementById('pagoResumen').textContent = '';
                // Limpiar también los datos del cliente
                ['clienteNombre', 'clienteEmpresa', 'clienteRUC', 'clienteTelefono', 'clienteEmail', 'clienteDireccion', 'clienteNotas'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                olvidarAutocompletadoRUCDNI();
                actualizarResumenCliente();
                clienteDBObjectIdEnCurso = null; // nueva transacción: se olvida cualquier vínculo con un cliente anterior
                // "Limpiar" siempre marca el inicio de una transacción nueva: la próxima vez que se
                // genere CUALQUIER documento (Cotización, Orden de Compra o Despacho) se pedirá un
                // número correlativo nuevo, sin importar cuál esté seleccionado en el momento.
                registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
                tipoContadorCargadoExplicitamente = null;
                actualizarBloqueoSelectorTipoDocumento(); // desbloquea el selector si estaba fijado en DESPACHO
                actualizarPanelCorrelativo(); // vuelve a mostrar la vista previa del próximo N°
                renderTable();
                const sucSel = document.getElementById('sucursalSeleccionada');
                if (sucSel) sucSel.style.display = 'none';
                guardarEstado();
                renderSucursales();
            }
        }


        // ============================================
        // SISTEMA DE SUCURSALES PARA COTIZACIÓN
        // ============================================
        // filterByTipo / renderSucursales / seleccionarSucursal /
        // mostrarSucursalSeleccionada / updateSucursalStats se movieron a
        // js/sucursales-nube.js (junto con la carga desde la nube, el estado de
        // error/caché y el panel de "Sucursal de envío" de la pestaña Cotizar).


        // ============================================
        // PREPARAR COTIZACIÓN PARA IMPRESIÓN
        // ============================================

        async function prepararCotizacion() {
            const fecha = new Date();
            const opciones = { year: 'numeric', month: 'long', day: 'numeric' };
            const fechaStr = fecha.toLocaleDateString('es-PE', opciones);

            // EMPRESA (logo, contacto, banco, footer)
            aplicarEmpresaAlPrint();

            // TIPO DE DOCUMENTO
            const tipodoc = document.getElementById('tipoDocumento').value;
            const tipoContador = obtenerTipoContador(tipodoc);
            const esDespacho = tipodoc === 'DESPACHO';
            const tituloDoc = tipodoc === 'ORDEN DE COMPRA' ? 'ORDEN DE COMPRA' : (esDespacho ? 'GUÍA DE DESPACHO' : 'COTIZACIÓN');
            document.getElementById('printTipoDoc').textContent = tituloDoc;
            document.getElementById('printDate').textContent = `Fecha: ${fechaStr}`;

            let numeroCorrelativo;
            try {
                numeroCorrelativo = await asegurarCorrelativoParaDocumento(tipodoc);
            } catch (e) {
                console.error('No se pudo obtener el número correlativo:', e);
                // Antes esto se atrapaba y se seguía adelante igual, imprimiendo "N° (sin conexión)"
                // en el PDF/Imagen — un documento sin número real que se podía llegar a enviar al
                // cliente sin que nadie lo notara. Ahora se corta aquí: NUNCA se genera un documento
                // sin un correlativo asignado de verdad. copiarImagen()/generarImagen() ya tienen su
                // propio try/catch que atrapa esto y avisa al usuario con este mismo mensaje.
                throw new Error('No se pudo generar el número correlativo (revisa tu conexión e inténtalo de nuevo). El documento NO se generó ni se guardó, para evitar una cotización sin número.');
            }
            const numDoc = formatearCorrelativo(numeroCorrelativo, esDespacho ? registroEnCurso.despacho?.sufijoDespacho : null);
            document.getElementById('printNumeroCot').textContent = numDoc;
            // "Válido 7 días" solo en cotización
            const validezEl = document.getElementById('printValidezBadge');
            if (validezEl) validezEl.style.display = (tipodoc === 'cotizacion') ? 'inline-block' : 'none';

            // DESPACHO: se omiten precios, totales y datos bancarios (solo cliente, sucursal y productos/cantidad)
            const colPrecio = document.getElementById('thPrecioUnitCol');
            const colTotal = document.getElementById('thTotalCol');
            if (colPrecio) colPrecio.style.display = esDespacho ? 'none' : '';
            if (colTotal) colTotal.style.display = esDespacho ? 'none' : '';
            const bloqueTotalesBanco = document.getElementById('printTotalesBancoGrid');
            if (bloqueTotalesBanco) bloqueTotalesBanco.style.display = esDespacho ? 'none' : 'grid';

            // CLIENTE en bloque compacto
            const cliente = getClienteData();
            const clientePrintEl = document.getElementById('clientePrintBox');
            const bloqueCompacto = document.getElementById('infoBloqueCompacto');
            const gridInner = bloqueCompacto ? bloqueCompacto.querySelector('div') : null;
            let hayCliente = false, hayEnvio = false;

            if (cliente.nombre || cliente.empresa) {
                hayCliente = true;
                let html = `<div style="font-size:0.75em;font-weight:700;color:#5568d3;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">👤 Cliente</div>`;
                if (cliente.nombre) html += `<div style="font-weight:700;font-size:0.88em;color:#2d3748;">${cliente.nombre}</div>`;
                if (cliente.empresa) html += `<div style="font-size:0.8em;color:#718096;">${cliente.empresa}</div>`;
                const detalles = [
                    cliente.ruc ? `📄 ${cliente.ruc}` : null,
                    cliente.telefono ? `📞 ${cliente.telefono}` : null,
                    cliente.email ? `✉️ ${cliente.email}` : null,
                    cliente.direccion ? `📍 ${cliente.direccion}` : null
                ].filter(Boolean);
                if (detalles.length) html += `<div style="font-size:0.78em;color:#718096;margin-top:5px;line-height:1.7;">${detalles.join('<br>')}</div>`;
                if (cliente.notas) html += `<div style="font-size:0.75em;color:#92400e;background:#fef3c7;padding:4px 7px;border-radius:4px;margin-top:5px;">📝 ${cliente.notas}</div>`;
                clientePrintEl.innerHTML = html;
                clientePrintEl.style.display = 'block';
            } else {
                clientePrintEl.style.display = 'none';
            }

            // ENVÍO en bloque compacto
            const envioPrintEl = document.getElementById('envioInfoPrint');
            if (sucursalSeleccionada) {
                hayEnvio = true;
                envioPrintEl.innerHTML = `
                    <div style="font-size:0.75em;font-weight:700;color:#234e52;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">📦 Envío Shalom</div>
                    <div style="font-weight:700;font-size:0.88em;color:#2d3748;">${sucursalSeleccionada.nombre}</div>
                    <div style="font-size:0.78em;color:#718096;line-height:1.7;margin-top:5px;">
                        📍 ${sucursalSeleccionada.direccion}<br>
                        🏙️ ${sucursalSeleccionada.ciudad}, ${sucursalSeleccionada.provincia}<br>
                        🏢 Tipo: ${sucursalSeleccionada.tipo}
                    </div>`;
                envioPrintEl.style.display = 'block';
            } else {
                envioPrintEl.style.display = 'none';
            }

            // Bloque compacto: solo si hay datos de cliente O envío
            if (bloqueCompacto) {
                if (hayCliente || hayEnvio) {
                    bloqueCompacto.style.display = 'block';
                    // Si solo hay uno de los dos, el existente ocupa ancho completo
                    if (gridInner) {
                        if (hayCliente && hayEnvio) {
                            gridInner.style.gridTemplateColumns = '1fr 1fr';
                        } else {
                            gridInner.style.gridTemplateColumns = '1fr';
                        }
                    }
                } else {
                    // Sin cliente ni envío: ocultar bloque compacto completamente
                    bloqueCompacto.style.display = 'none';
                }
            }

            // TABLA DE PRODUCTOS
            const printTableBody = document.getElementById('printTableBody');
            let totalSinIGV = 0;
            const globalDescPct = parseFloat(document.getElementById('globalDiscount')?.value) || 0;

            printTableBody.innerHTML = productosEnTabla.map(producto => {
                const cantidad = producto.cantidad;
                const precioBase = obtenerPrecio(producto, cantidad);
                const precioUnitario = producto.precioOverride !== undefined ? producto.precioOverride : precioBase;
                const descPct = producto.descuento || 0;
                const precioConDesc = precioUnitario * (1 - descPct / 100);
                const subtotal = cantidad * precioConDesc;
                totalSinIGV += subtotal;
                let tipoPrecio = producto.precioOverride !== undefined ? 'Personalizado' : obtenerEtiquetaTipoPrecio(producto, cantidad);

                const precioMostrar = mostrarConIGV ? calcularPrecioConIGV(precioConDesc) : precioConDesc;
                const subtotalMostrar = mostrarConIGV ? calcularPrecioConIGV(subtotal) : subtotal;
                const colorInfo = producto.color ? ` <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;font-size:0.75em;font-weight:600;margin-left:3px;white-space:nowrap;display:inline-block;line-height:1.4;">● ${producto.color}</span>` : '';
                const descInfo = descPct > 0 ? ` <span style="background:#fed7aa;color:#9a3412;padding:1px 5px;border-radius:4px;font-size:0.75em;">-${descPct}%</span>` : '';

                return `
                    <tr>
                        <td style="font-size:0.82em;color:#718096;font-family:monospace;">${producto.codigo}</td>
                        <td style="font-size:0.88em;">${producto.nombre}${colorInfo}</td>
                        <td style="text-align:center;font-size:0.88em;">${cantidad}</td>
                        ${esDespacho ? '' : `<td style="text-align:right;font-size:0.85em;">S/ ${precioMostrar.toFixed(2)}${descInfo}<br><span style="font-size:0.8em;color:#a0aec0;">${tipoPrecio}</span></td>`}
                        ${esDespacho ? '' : `<td style="text-align:right;font-weight:700;font-size:0.9em;">S/ ${subtotalMostrar.toFixed(2)}</td>`}
                    </tr>
                `;
            }).join('');

            // TOTALES
            const descGlobalMonto = totalSinIGV * globalDescPct / 100;
            const totalFinalSinIGV = totalSinIGV - descGlobalMonto;
            const totalMostrar = mostrarConIGV ? calcularPrecioConIGV(totalFinalSinIGV) : totalFinalSinIGV;
            document.getElementById('printTotal').textContent = `S/ ${totalMostrar.toFixed(2)}`;

            // Detalle de totales
            let detalleHTML = '';
            if (globalDescPct > 0) {
                const subtotalDisp = mostrarConIGV ? calcularPrecioConIGV(totalSinIGV) : totalSinIGV;
                const descDisp = mostrarConIGV ? calcularPrecioConIGV(descGlobalMonto) : descGlobalMonto;
                detalleHTML += `<div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>S/ ${subtotalDisp.toFixed(2)}</span></div>`;
                detalleHTML += `<div style="display:flex;justify-content:space-between;"><span>Desc. global (${globalDescPct}%):</span><span>-S/ ${descDisp.toFixed(2)}</span></div>`;
            }
            if (mostrarConIGV) {
                const soloIGV = calcularIGV(totalFinalSinIGV);
                detalleHTML += `<div style="display:flex;justify-content:space-between;"><span>Base imponible:</span><span>S/ ${totalFinalSinIGV.toFixed(2)}</span></div>`;
                detalleHTML += `<div style="display:flex;justify-content:space-between;"><span>IGV (18%):</span><span>S/ ${soloIGV.toFixed(2)}</span></div>`;
            }
            document.getElementById('printTotalesDetalle').innerHTML = detalleHTML;

            let infoText = `${productosEnTabla.length} producto${productosEnTabla.length !== 1 ? 's' : ''}`;
            if (forzarPorMayor) infoText += ` · Precio por mayor`;
            document.getElementById('printTotalInfo').textContent = infoText;

            // ADELANTO / PAGO
            const adelanto = parseFloat(document.getElementById('montoAdelanto').value) || 0;
            const pagoPrint = document.getElementById('printPagoSection');
            if (adelanto > 0) {
                const saldo = Math.max(0, totalMostrar - adelanto);
                pagoPrint.style.display = 'block';
                document.getElementById('printAdelanto').textContent = `S/ ${adelanto.toFixed(2)}`;
                document.getElementById('printSaldo').textContent = `S/ ${saldo.toFixed(2)}`;
            } else {
                pagoPrint.style.display = 'none';
            }
        }


        // ============================================
        // FUNCIONES PANEL CLIENTE
        // ============================================

        function toggleClientePanel() {
            const body = document.getElementById('clientePanelBody');
            const icon = document.getElementById('clienteToggleIcon');
            body.classList.toggle('open');
            icon.classList.toggle('open');
        }

        function toggleAgregarProductoPanel() {
            const body = document.getElementById('agregarProductoPanelBody');
            const icon = document.getElementById('agregarProductoToggleIcon');
            body.classList.toggle('open');
            icon.classList.toggle('open');
        }

        function cambiarAjustesSubTab(sub) {
            document.querySelectorAll('.ajustes-subtab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('ajustesSubBtn_' + sub).classList.add('active');
            document.querySelectorAll('.ajustes-subtab-content').forEach(c => c.style.display = 'none');
            document.getElementById('ajustesSub-' + sub).style.display = 'block';
            if (sub === 'productos') renderProductList();
            if (sub === 'sucursales') renderSucursalList();
        }

        function actualizarResumenCliente() {
            const nombre = document.getElementById('clienteNombre').value.trim();
            const empresa = document.getElementById('clienteEmpresa').value.trim();
            const tel = document.getElementById('clienteTelefono').value.trim();
            const ruc = document.getElementById('clienteRUC').value.trim();

            const resumen = document.getElementById('clienteResumen');
            const badge = document.getElementById('clienteBadge');
            
            let parts = [];
            if (nombre) parts.push(`👤 ${nombre}`);
            if (empresa) parts.push(`🏢 ${empresa}`);
            if (tel) parts.push(`📞 ${tel}`);
            if (ruc) parts.push(`📄 ${ruc}`);

            guardarEstado();

            if (parts.length > 0) {
                resumen.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
                badge.style.display = 'inline-block';
            } else {
                resumen.innerHTML = '';
                badge.style.display = 'none';
            }
        }

        function getClienteData() {
            return {
                nombre: document.getElementById('clienteNombre').value.trim(),
                empresa: document.getElementById('clienteEmpresa').value.trim(),
                ruc: document.getElementById('clienteRUC').value.trim(),
                telefono: document.getElementById('clienteTelefono').value.trim(),
                email: document.getElementById('clienteEmail').value.trim(),
                direccion: document.getElementById('clienteDireccion').value.trim(),
                notas: document.getElementById('clienteNotas').value.trim()
            };
        }

        // ============================================
        // COLOR CHIPS
        // ============================================

        function setColor(color) {
            document.getElementById('inputColor').value = color;
            document.querySelectorAll('.color-circulo-chip').forEach(chip => {
                chip.classList.toggle('seleccionado', chip.dataset.color === color);
            });
            actualizarDisponibleColorSeleccionado(color);
        }

        // ============================================
        // PRECIO OVERRIDE (edición inline)
        // ============================================

        function togglePrecioEdit(index) {
            const editDiv = document.getElementById(`precioEdit_${index}`);
            editDiv.classList.toggle('visible');
            if (editDiv.classList.contains('visible')) {
                document.getElementById(`precioInput_${index}`).focus();
                document.getElementById(`precioInput_${index}`).select();
            }
        }

        function guardarPrecioOverride(index) {
            const val = parseFloat(document.getElementById(`precioInput_${index}`).value);
            if (isNaN(val) || val < 0) {
                mostrarNotificacion('Ingresa un precio válido', 'warning');
                return;
            }
            productosEnTabla[index].precioOverride = val;
            guardarEstado();
            renderTable();
            mostrarNotificacion(`Precio actualizado a S/ ${val.toFixed(2)}`, 'success');
        }

        function cancelarPrecioEdit(index) {
            const editDiv = document.getElementById(`precioEdit_${index}`);
            if (editDiv) editDiv.classList.remove('visible');
        }

        function restaurarPrecio(index) {
            delete productosEnTabla[index].precioOverride;
            guardarEstado();
            renderTable();
            mostrarNotificacion('Precio restaurado al original', 'info');
        }

        // ============================================
        // DESCUENTOS POR LÍNEA
        // ============================================

        function toggleDescuento(index) {
            const div = document.getElementById(`descEdit_${index}`);
            div.classList.toggle('visible');
            if (div.classList.contains('visible')) {
                document.getElementById(`descInput_${index}`).focus();
                document.getElementById(`descInput_${index}`).select();
            }
        }

        function guardarDescuento(index) {
            const val = parseFloat(document.getElementById(`descInput_${index}`).value) || 0;
            if (val < 0 || val > 100) { mostrarNotificacion('Descuento entre 0 y 100%', 'warning'); return; }
            productosEnTabla[index].descuento = val;
            guardarEstado();
            renderTable();
            if (val > 0) mostrarNotificacion(`Descuento de ${val}% aplicado`, 'success');
        }

        function cerrarDescuento(index) {
            const div = document.getElementById(`descEdit_${index}`);
            if (div) div.classList.remove('visible');
        }

        // ============================================
        // WHATSAPP
        // ============================================

        function enviarWhatsApp() {
            if (productosEnTabla.length === 0) { mostrarNotificacion('Agrega productos primero', 'warning'); return; }

            const cliente = getClienteData();
            const fecha = new Date().toLocaleDateString('es-PE', { year:'numeric', month:'long', day:'numeric' });
            const globalDescPct = parseFloat(document.getElementById('globalDiscount')?.value) || 0;

            let msg = `🏨 *Confort Line / Fabexsa*\n`;
            msg += `📋 *COTIZACIÓN — ${fecha}*\n`;
            if (cliente.nombre) msg += `👤 Cliente: *${cliente.nombre}*\n`;
            if (cliente.empresa) msg += `🏢 ${cliente.empresa}\n`;
            msg += `\n`;

            let subtotal = 0;
            productosEnTabla.forEach((p, i) => {
                const precioBase = obtenerPrecio(p, p.cantidad);
                const precio = p.precioOverride !== undefined ? p.precioOverride : precioBase;
                const descPct = p.descuento || 0;
                const precioFinal = precio * (1 - descPct / 100);
                const total = p.cantidad * precioFinal;
                subtotal += total;
                const colorStr = p.color ? ` (${p.color})` : '';
                const descStr = descPct > 0 ? ` -${descPct}%` : '';
                msg += `• ${p.nombre}${colorStr}\n`;
                msg += `  ${p.cantidad} unid. × S/ ${precioFinal.toFixed(2)}${descStr} = *S/ ${total.toFixed(2)}*\n`;
            });

            msg += `\n`;

            if (globalDescPct > 0) {
                const descMonto = subtotal * globalDescPct / 100;
                msg += `💰 Subtotal: S/ ${subtotal.toFixed(2)}\n`;
                msg += `🏷️ Descuento global (${globalDescPct}%): -S/ ${descMonto.toFixed(2)}\n`;
                subtotal -= descMonto;
            }

            const totalFinal = mostrarConIGV ? calcularPrecioConIGV(subtotal) : subtotal;
            const igvLabel = mostrarConIGV ? ' (incl. IGV 18%)' : '';
            msg += `✅ *TOTAL: S/ ${totalFinal.toFixed(2)}*${igvLabel}\n`;

            if (sucursalSeleccionada) {
                msg += `\n📦 Envío: ${sucursalSeleccionada.nombre} - ${sucursalSeleccionada.ciudad}\n`;
            }

            msg += `\n_Válido por 7 días _`;

            const tel = cliente.telefono ? cliente.telefono.replace(/\D/g,'') : '';
            const url = `https://wa.me/${tel ? '51' + tel : ''}?text=${encodeURIComponent(msg)}`;
            window.open(url, '_blank');
        }


        // ============================================
        // PANEL DE CORRELATIVO EN VIVO (parte derecha)
        // ============================================
        // Mientras se arma una Cotización u Orden de Compra NUEVA (todavía sin correlativo asignado),
        // se muestra en pantalla el N° que se usaría si se guardara AHORA MISMO. Es solo informativo:
        // se obtiene con una lectura simple del contador (sin incrementarlo), así que NO consume
        // ningún número por el solo hecho de mostrarse — el número real y definitivo recién se fija,
        // de forma atómica, cuando se presiona Guardar/Generar PDF/Generar Imagen. Como otro usuario
        // podría guardar un documento del mismo tipo mientras este panel está en pantalla, se refresca
        // solo cada cierto tiempo y en varios momentos clave (cambiar tipo de documento, volver a la
        // pestaña, etc.) para que el número mostrado no quede desactualizado.
        let intervaloPreviewCorrelativo = null;

        async function obtenerProximoNumeroPreview(tipo) {
            try {
                const where = encodeURIComponent(JSON.stringify({ tipo }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTADORES}?where=${where}&limit=1`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                const fila = (data.results || [])[0];
                // Si aún no existe fila para este tipo, el primer número que se asignará es el inicial.
                return fila ? (fila.siguienteNumero + 1) : NUMERO_INICIAL_CORRELATIVO;
            } catch (e) {
                console.warn('No se pudo previsualizar el correlativo:', e);
                return null;
            }
        }

        // Se ejecuta SOLO cuando el usuario cambia el selector de tipo de documento con la mano
        // (no cuando cargarDesdeHistorial/crearDespachoDesdeOC lo fijan por código, porque esos
        // asignan .value directamente y eso no dispara "change"). Si el usuario pasa a un tipo que
        // NO es el que acaba de cargar/guardar explícitamente, se asume que quiere empezar un
        // documento nuevo de ese tipo y se limpia cualquier objectId/correlativo viejo que hubiera
        // quedado ahí de una edición anterior en la misma sesión — así el próximo "Guardar" crea un
        // registro nuevo en vez de sobrescribir uno ajeno.
        function alCambiarTipoDocumentoManualmente() {
            const tipodoc = document.getElementById('tipoDocumento')?.value;
            let tipoContador = obtenerTipoContador(tipodoc);
            if (modoDesarrollador) {
                tipoContador = tipodoc === 'DESPACHO' ? 'despacho_prueba' : tipoContador + '_prueba';
            }
            if (tipoContador && tipoContador !== tipoContadorCargadoExplicitamente && registroEnCurso[tipoContador]) {
                console.warn(`Se limpió un registro en curso de "${tipoContador}" que no correspondía al documento cargado, para evitar sobrescribirlo por error.`);
                registroEnCurso[tipoContador] = null;
                guardarEstado();
            }
            actualizarPanelCorrelativo();
        }

        function badgeCorrelativoHTML(numero, sufijo, asignado, etiqueta, extra) {
            if (numero === null || numero === undefined) return '';
            const texto = formatearCorrelativo(numero, sufijo);
            return `
                <div style="text-align:right;line-height:1.2;">
                    <div style="font-size:1.4em;font-weight:800;letter-spacing:0.02em;color:${asignado ? '#9ae6b4' : '#ffffff'};">${texto}</div>
                    <div style="font-size:0.68em;opacity:0.85;margin-top:2px;">${asignado ? '✅' : '🔄'} ${etiqueta}${extra ? ' · ' + extra : ''}</div>
                </div>`;
        }

        async function actualizarPanelCorrelativo() {
            const cont = document.getElementById('correlativoPreview');
            if (!cont) return;
            const tipodoc = document.getElementById('tipoDocumento')?.value;
            if (!tipodoc) { cont.innerHTML = ''; return; }

            // 🧪 MODO DESARROLLADOR: muestra el N° del contador de PRUEBA (nunca el real), bien
            // etiquetado, para que el panel nunca sugiera un número que en realidad no se va a usar.
            if (modoDesarrollador) {
                const tipoPrueba = tipodoc === 'DESPACHO' ? 'despacho_prueba' : obtenerTipoContador(tipodoc) + '_prueba';
                if (registroEnCurso[tipoPrueba]?.correlativo) {
                    cont.innerHTML = badgeCorrelativoHTML(registroEnCurso[tipoPrueba].correlativo, null, true, 'N° asignado', '🧪 PRUEBA');
                    return;
                }
                iniciarPollingCorrelativo();
                const preview = await obtenerProximoNumeroPreview(tipoPrueba);
                cont.innerHTML = badgeCorrelativoHTML(preview, null, false, 'próximo N°', '🧪 PRUEBA · no afecta lo real');
                return;
            }

            if (tipodoc === 'DESPACHO') {
                if (registroEnCurso.despacho?.correlativo) {
                    cont.innerHTML = badgeCorrelativoHTML(registroEnCurso.despacho.correlativo, registroEnCurso.despacho.sufijoDespacho, true, 'N° asignado', registroEnCurso.despacho.ordenCompraAsociada ? '🔗 vinculado a OC' : null);
                    return;
                }
                if (registroEnCurso.orden_compra?.correlativo) {
                    cont.innerHTML = badgeCorrelativoHTML(registroEnCurso.orden_compra.correlativo, null, true, 'se usará', '📦 tu OC actual');
                    return;
                }
                iniciarPollingCorrelativo();
                const preview = await obtenerProximoNumeroPreview(CORRELATIVO_ASOCIADO_DESPACHO);
                cont.innerHTML = badgeCorrelativoHTML(preview, null, false, 'estimado', 'se fija al guardar la OC');
                return;
            }

            const tipoContador = obtenerTipoContador(tipodoc);
            if (registroEnCurso[tipoContador]?.correlativo) {
                cont.innerHTML = badgeCorrelativoHTML(registroEnCurso[tipoContador].correlativo, null, true, 'N° asignado');
                return;
            }
            iniciarPollingCorrelativo();
            const preview = await obtenerProximoNumeroPreview(tipoContador);
            cont.innerHTML = badgeCorrelativoHTML(preview, null, false, 'próximo N°', 'se confirma al guardar');
        }

        // El polling corre en segundo plano durante toda la sesión (no cuesta nada mientras el N° ya
        // está "asignado", porque actualizarPanelCorrelativo() corta antes de consultar el servidor);
        // solo hace trabajo real mientras se está mostrando una vista previa sin confirmar.
        function iniciarPollingCorrelativo() {
            if (intervaloPreviewCorrelativo) return;
            intervaloPreviewCorrelativo = setInterval(() => {
                if (!document.hidden && tabActual === 'cotizar') {
                    actualizarPanelCorrelativo();
                }
            }, 5000);
        }

        let historialCache = [];
        let verTodasLasCotizaciones = false; // solo aplica si el usuario es "master"

        async function guardarEnHistorial() {
            if (productosEnTabla.length === 0) { mostrarNotificacion('Agrega productos primero', 'warning'); return; }
            const cliente = getClienteData();
            const globalDescPct = parseFloat(document.getElementById('globalDiscount')?.value) || 0;
            let subtotal = 0;
            productosEnTabla.forEach(p => {
                const precio = p.precioOverride !== undefined ? p.precioOverride : obtenerPrecio(p, p.cantidad);
                const desc = p.descuento || 0;
                subtotal += p.cantidad * precio * (1 - desc/100);
            });
            const descMonto = subtotal * globalDescPct / 100;
            const totalFinal = mostrarConIGV ? calcularPrecioConIGV(subtotal - descMonto) : (subtotal - descMonto);

            const tipodoc = document.getElementById('tipoDocumento').value;
            let tipoContador = obtenerTipoContador(tipodoc);
            // 🧪 MODO DESARROLLADOR: a partir de aquí, tipoContador pasa a ser "cotizacion_prueba" /
            // "orden_compra_prueba" / "despacho_prueba". Como todos los bloques de abajo (Kardex,
            // adelanto, vínculo con OC, chequeo de despacho duplicado) comparan tipoContador contra
            // los valores EXACTOS 'cotizacion' / 'orden_compra' / 'despacho', ninguno de ellos se
            // activa para un documento de prueba — quedan automáticamente excluidos sin necesidad de
            // duplicar esa lógica. El documento de prueba se guarda igual (mismo Parse, misma clase),
            // pero con su propio tipoDocumento y su propio contador, sin tocar nada real.
            if (modoDesarrollador) {
                tipoContador = tipodoc === 'DESPACHO' ? 'despacho_prueba' : tipoContador + '_prueba';
            }

            // Un despacho se considera "vinculado a una OC" en dos casos:
            //  1) Vino del botón "📦 Crear Despacho" desde el historial (ya trae ordenCompraAsociada).
            //  2) Flujo manual en la misma sesión: Cotizar → cambiar a "ORDEN DE COMPRA" → Guardar →
            //     cambiar a "DESPACHO" → Guardar, sin limpiar entre medio. En ese caso ya existe una
            //     Orden de Compra real guardada en registroEnCurso.orden_compra (y el despacho ya
            //     toma su mismo correlativo prestado), así que también cuenta como vinculado.
            const ordenCompraVinculada = registroEnCurso.despacho?.ordenCompraAsociada || registroEnCurso.orden_compra?.objectId || null;

            // Aviso preventivo (🟢 baja prioridad): solo se pregunta si de verdad no hay ninguna OC de
            // por medio (ni por el botón, ni por haberla guardado antes en esta misma sesión).
            if (tipoContador === 'despacho' && !registroEnCurso.despacho?.objectId && !ordenCompraVinculada) {
                if (!confirm('⚠️ Este despacho no está vinculado a ninguna Orden de Compra.\n\n¿Seguro que deseas guardarlo así?')) {
                    return;
                }
            }

            // CAMBIO DE COMPORTAMIENTO (a pedido): antes esto BLOQUEABA el guardado si la OC ya tenía
            // un despacho generado. Ahora, en vez de bloquear, se ADOPTA ese despacho existente (mismo
            // objectId, mismo N°/sufijo) para que el guardado de más abajo lo ACTUALICE con los datos
            // actuales en pantalla — así, si se corrigió la Orden de Compra y se vuelve a guardar como
            // Despacho (flujo manual: Cotizar → Orden de Compra → Guardar → Despacho → Guardar), el
            // despacho ya emitido queda al día en vez de bloquear la acción o duplicarlo. Cubre el
            // mismo caso que crearDespachoDesdeOC(), pero para quien no usa ese botón.
            if (tipoContador === 'despacho' && !registroEnCurso.despacho?.objectId && ordenCompraVinculada) {
                const despachoExistente = await buscarDespachoActivoParaOC(ordenCompraVinculada);
                if (despachoExistente) {
                    registroEnCurso.despacho = {
                        objectId: despachoExistente.objectId,
                        correlativo: despachoExistente.correlativo || null,
                        ordenCompraAsociada: ordenCompraVinculada,
                        sufijoDespacho: despachoExistente.sufijoDespacho || '',
                        productosDescontados: despachoExistente.productosDescontados || despachoExistente.productos || [],
                        updatedAt: despachoExistente.updatedAt || null
                    };
                    guardarEstado();
                    mostrarNotificacion('Esta Orden de Compra ya tenía un Despacho generado — se actualizará con los datos actuales de la OC.', 'info');
                }
            }

            let correlativo;
            try {
                correlativo = await asegurarCorrelativoParaDocumento(tipodoc);
            } catch (e) {
                console.error('No se pudo obtener el correlativo:', e);
                mostrarNotificacion('No se pudo generar el número correlativo: ' + e.message, 'warning');
                return;
            }

            const registroExistente = registroEnCurso[tipoContador];
            const esPrimerGuardado = !registroExistente?.objectId; // false = ya existía, es una regeneración/edición

            // Sufijo del despacho (B, C...) cuando la OC vinculada ya tenía uno o más despachos antes
            // de este. En una regeneración/edición de un despacho ya guardado se respeta el sufijo que
            // ya tenía (no se vuelve a calcular). En un despacho nuevo por el flujo manual (sin pasar
            // por el botón "📦 Crear Despacho", que ya lo calcula por su cuenta) se calcula aquí mismo.
            let sufijoDespacho = registroEnCurso.despacho?.sufijoDespacho;
            if (tipoContador === 'despacho' && esPrimerGuardado && sufijoDespacho === undefined) {
                sufijoDespacho = ordenCompraVinculada ? await calcularSufijoDespacho(ordenCompraVinculada) : '';
            }
            sufijoDespacho = sufijoDespacho || '';

            // Guarda/actualiza al cliente DIRECTAMENTE en la nube (clase "Clientes") antes de
            // guardar la cotización, para poder incluir su objectId dentro de la cotización misma
            // (entrada.clienteObjectId, más abajo). Ese vínculo es lo que permite que, si más tarde
            // se corrige un nombre mal escrito en esta misma cotización, se actualice este mismo
            // cliente en vez de crear uno nuevo por no coincidir el nombre. (La función ya se
            // encarga de actualizar clienteDBObjectIdEnCurso internamente, y de ponerse en cola si
            // hay otro guardado de cliente en curso al mismo tiempo.)
            const clienteObjectIdGuardado = await guardarClienteDBSilencioso(cliente);

            const entrada = {
                cliente: cliente.nombre || 'Sin nombre',
                empresaCliente: cliente.empresa || '',
                ruc: cliente.ruc || '',
                telefono: cliente.telefono || '',
                email: cliente.email || '',
                direccion: cliente.direccion || '',
                notas: cliente.notas || '',
                clienteObjectId: clienteObjectIdGuardado || null,
                productos: JSON.parse(JSON.stringify(productosEnTabla)),
                sucursal: sucursalSeleccionada ? { ...sucursalSeleccionada } : null,
                globalDescPct,
                total: totalFinal,
                mostrarConIGV,
                forzarPorMayor,
                tipoDocumento: tipoContador,
                correlativo,
                activo: true,
                // Marca explícita adicional (además de que tipoDocumento ya termina en "_prueba")
                // para poder filtrar fácilmente los documentos de prueba desde el panel de Back4App.
                esPrueba: modoDesarrollador,
                // Quién hizo el último cambio, para trazabilidad (siempre se actualiza).
                ultimaEdicionPor: usuarioActual?.username || '',
                ultimaEdicionPorNombre: usuarioActual?.nombre || ''
            };
            // El "dueño" (usuario/usuarioNombre) SOLO se fija al crear el registro. En una edición
            // no se incluye en el PUT, así Parse deja el valor original intacto — la cotización
            // sigue apareciendo en el panel de quien la creó, aunque otro usuario la haya editado.
            if (esPrimerGuardado) {
                entrada.usuario = usuarioActual?.username || '';
                entrada.usuarioNombre = usuarioActual?.nombre || '';
            }
            // Trazabilidad: se guarda el objectId de la OC vinculada (venga del botón "📦 Crear
            // Despacho" o del flujo manual en la misma sesión) y el sufijo (si es el 2do despacho o
            // siguiente de esa OC). Permite en el futuro armar reportes como "Órdenes sin despacho".
            if (tipoContador === 'despacho') {
                if (ordenCompraVinculada) entrada.ordenCompraAsociada = ordenCompraVinculada;
                if (sufijoDespacho) entrada.sufijoDespacho = sufijoDespacho;
            }
            // Estado de pago: solo aplica a la Orden de Compra (es donde entra el dinero — la
            // Cotización es una simple consulta y el Despacho es solo movimiento de stock, sin
            // precios). Antes este monto no se guardaba en ningún lado — se mostraba en pantalla y
            // se imprimía en el PDF, pero se perdía al recargar o para cualquier otro usuario. Ahora
            // queda persistido, y con eso se puede calcular si falta cobrar saldo (ver
            // calcularEstadoPago más abajo).
            if (tipoContador === 'orden_compra' || tipoContador === 'orden_compra_prueba') {
                entrada.montoAdelanto = parseFloat(document.getElementById('montoAdelanto').value) || 0;
            }

            // FIX (A3 — edición simultánea / "last write wins"): antes de sobrescribir un registro que
            // YA existía, se compara su updatedAt actual en el servidor contra el que tenía en el
            // momento en que se cargó en esta pantalla. Si no coinciden, significa que alguien más
            // (otro usuario, u otro dispositivo con la misma sesión) lo modificó mientras tanto, y
            // guardar ahora sin avisar borraría esos cambios sin que nadie se dé cuenta. Se pide
            // confirmación explícita antes de continuar. Si la verificación no se puede hacer (sin
            // conexión, o el registro es de antes de este fix y no tiene updatedAt guardado), se
            // continúa igual — no se bloquea el guardado por una comprobación que no se pudo hacer.
            if (registroExistente?.objectId && registroExistente.updatedAt) {
                try {
                    const respCheck = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${registroExistente.objectId}?keys=updatedAt`, {
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                    });
                    if (respCheck.ok) {
                        const dataCheck = await respCheck.json();
                        if (dataCheck.updatedAt && dataCheck.updatedAt !== registroExistente.updatedAt) {
                            const seguir = confirm('⚠️ Este documento fue modificado por otra persona (u otro dispositivo) después de que lo cargaste aquí.\n\nSi guardas ahora, tus cambios reemplazarán esa otra edición.\n\n¿Deseas guardar de todas formas?');
                            if (!seguir) {
                                mostrarNotificacion('Guardado cancelado. Vuelve a cargar el documento desde el historial para ver los cambios más recientes.', 'info');
                                return;
                            }
                        }
                    }
                } catch (eCheck) {
                    console.warn('No se pudo verificar si el documento fue modificado por otra persona (se continúa igual):', eCheck);
                }
            }

            try {
                let resp;
                if (registroExistente?.objectId) {
                    // Ya existe un registro para esta misma cotización: se actualiza en vez de duplicar
                    resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${registroExistente.objectId}`, {
                        method: 'PUT',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(entrada)
                    });
                } else {
                    resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}`, {
                        method: 'POST',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(entrada)
                    });
                }
                if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }
                const data = await resp.json();
                const objectId = registroExistente?.objectId || data.objectId;

                registroEnCurso[tipoContador] = {
                    objectId,
                    correlativo,
                    productosDescontados: registroExistente?.productosDescontados || [],
                    // Se guarda el updatedAt que acaba de devolver el servidor (en un PUT, Parse
                    // devuelve el updatedAt nuevo; en un POST devuelve createdAt) para que la próxima
                    // vez que se guarde en esta misma sesión, la verificación de concurrencia de más
                    // arriba compare contra ESTE guardado y no contra uno desactualizado.
                    updatedAt: data.updatedAt || data.createdAt || null,
                    ...(tipoContador === 'despacho' ? { ordenCompraAsociada: ordenCompraVinculada, sufijoDespacho } : {})
                };
                tipoContadorCargadoExplicitamente = tipoContador;
                actualizarBloqueoSelectorTipoDocumento();
                actualizarPanelCorrelativo();
                guardarEstado();
                renderHistorial();
                const etiquetaDoc = (tipoContador === 'orden_compra' || tipoContador === 'orden_compra_prueba') ? 'Orden de Compra'
                    : (tipoContador === 'despacho' || tipoContador === 'despacho_prueba') ? 'Despacho' : 'Cotización';
                mostrarNotificacion(`${modoDesarrollador ? '🧪 [PRUEBA] ' : ''}${etiquetaDoc} ${formatearCorrelativo(correlativo, sufijoDespacho)} guardada en la nube`, modoDesarrollador ? 'warning' : 'success');

                // Ajuste de stock en el Kardex: se compara lo que YA se había descontado (snapshot
                // guardado la última vez) contra lo que hay AHORA en la tabla, y solo se toca el
                // Kardex por la diferencia. Así, si se agrega un producto nuevo en una edición, solo
                // se descuenta ESE producto (no se vuelve a descontar lo que ya estaba), y si se quita
                // o se reduce algo, esa diferencia se DEVUELVE al Kardex.
                if (tipoContador === 'orden_compra') {
                    try {
                        const productosActuales = productosEnTabla.map(p => ({ codigo: p.codigo, cantidad: p.cantidad, color: p.color || '' }));
                        const productosAnteriores = esPrimerGuardado ? [] : (registroExistente?.productosDescontados || []);
                        const deltas = calcularDiferenciaProductos(productosAnteriores, productosActuales);

                        if (deltas.length > 0) {
                            await ajustarStockKardexDropbox(deltas);
                            const huboAumentos = deltas.some(d => d.cantidad > 0);
                            const huboDevoluciones = deltas.some(d => d.cantidad < 0);
                            let msg = '📉 Stock descontado en el Kardex';
                            if (huboAumentos && huboDevoluciones) msg = '📉↩️ Kardex ajustado (productos añadidos y removidos/reducidos)';
                            else if (huboDevoluciones) msg = '↩️ Kardex actualizado: se devolvió stock de lo removido/reducido';
                            mostrarNotificacion(msg, 'success');
                            cargarKardex(false); // refresca los badges de stock con el nuevo saldo
                        }

                        // Actualiza el snapshot de "lo que ya está descontado" para la próxima edición.
                        await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${objectId}`, {
                            method: 'PUT',
                            headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                            body: JSON.stringify({ productosDescontados: productosActuales })
                        });
                        registroEnCurso[tipoContador].productosDescontados = productosActuales;
                    } catch (eKardex) {
                        console.error('Error al ajustar stock del Kardex:', eKardex);
                        mostrarNotificacion('La orden se guardó, pero no se pudo ajustar el Kardex: ' + eKardex.message, 'warning');
                    }
                }
            } catch (e) {
                console.error('Error al guardar en historial:', e);
                mostrarNotificacion('No se pudo guardar en la nube: ' + e.message, 'warning');
            }
        }

        async function cargarHistorialDesdeNube() {
            const esMaster = usuarioActual?.nivel === 'master';
            const where = (esMaster && verTodasLasCotizaciones)
                ? { activo: true }
                : { activo: true, usuario: usuarioActual?.username || '' };
            const url = `${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}?where=${encodeURIComponent(JSON.stringify(where))}&order=-createdAt&limit=200`;
            const resp = await fetch(url, { headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }) });
            if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }
            const data = await resp.json();
            // 🧪 MODO DESARROLLADOR: los documentos de prueba (esPrueba / tipoDocumento terminado en
            // "_prueba") quedan SIEMPRE fuera de la vista normal del historial — nunca se mezclan con
            // los datos reales del negocio. Solo se dejan ver mientras el modo prueba sigue activo en
            // este momento (para poder revisar que la prueba se guardó bien); apenas se apaga, dejan
            // de aparecer aunque sigan existiendo en la base de datos.
            historialCache = (data.results || []).filter(e =>
                modoDesarrollador || (!e.esPrueba && !String(e.tipoDocumento || '').endsWith('_prueba'))
            );
        }

        let usuarioSeleccionadoHistorial = null; // username filtrado dentro de la vista "Ver todas" (master)
        let filtroTipoHistorial = 'todas'; // 'todas' | 'cotizacion' | 'orden_compra' | 'despacho' | 'pendientes'

        // Chips de filtro por tipo de documento, arriba de la lista del historial.
        // El filtro "pendientes" (Pendientes de despacho) quedó desactivado a pedido — se deja la
        // lógica de filtrarPorTipoDocumento() intacta por si se reactiva más adelante, solo se quitó
        // de esta lista para que no aparezca como opción.
        function renderFiltrosTipoHistorial() {
            const filtros = [
                { valor: 'todas', etiqueta: 'Todas' },
                { valor: 'cotizacion', etiqueta: '📋 Cotizaciones' },
                { valor: 'orden_compra', etiqueta: '📦 Órdenes de Compra' },
                { valor: 'despacho', etiqueta: '🚚 Despachos' },
                { valor: 'pago_pendiente', etiqueta: '💰 Pago pendiente' }
            ];
            return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
                ${filtros.map(f => `<button type="button" class="chip-filtro-historial${filtroTipoHistorial === f.valor ? ' active' : ''}" onclick="aplicarFiltroTipoHistorial('${f.valor}')">${f.etiqueta}</button>`).join('')}
            </div>`;
        }

        function aplicarFiltroTipoHistorial(tipo) {
            filtroTipoHistorial = tipo;
            const filtrosEl = document.getElementById('historialFiltrosArea');
            if (filtrosEl) filtrosEl.innerHTML = renderFiltrosTipoHistorial();
            pintarResultadosHistorial();
        }

        // Aplica el filtro de tipo de documento sobre una lista. "pendientes" es especial: muestra
        // solo Órdenes de Compra activas que NO tengan ningún Despacho activo vinculado todavía — es
        // la lista de "qué me falta enviar". Se calcula sobre historialCache completo (no solo sobre
        // la lista que se está mostrando) para que la detección de vínculo sea siempre correcta.
        function filtrarPorTipoDocumento(lista) {
            if (filtroTipoHistorial === 'todas') return lista;
            if (filtroTipoHistorial === 'pendientes') {
                const idsConDespacho = new Set(
                    historialCache.filter(e => e.tipoDocumento === 'despacho' && e.ordenCompraAsociada).map(e => e.ordenCompraAsociada)
                );
                return lista.filter(e => e.tipoDocumento === 'orden_compra' && !idsConDespacho.has(e.objectId));
            }
            if (filtroTipoHistorial === 'pago_pendiente') {
                return lista.filter(e => e.tipoDocumento === 'orden_compra' && calcularEstadoPago(e).pendiente);
            }
            return lista.filter(e => e.tipoDocumento === filtroTipoHistorial);
        }

        // Devuelve todos los despachos activos vinculados a una OC puntual (puede haber más de uno:
        // el original y sus sucesivos "B", "C"... si se olvidó despachar algo y se hizo aparte).
        function obtenerDespachosDeOC(ocObjectId) {
            return historialCache.filter(e => e.tipoDocumento === 'despacho' && e.ordenCompraAsociada === ocObjectId);
        }

        // FIX: antes esta función solo devolvía true/false para BLOQUEAR la creación de un segundo
        // despacho. Ahora devuelve el despacho activo más reciente de la OC (o null si no tiene
        // ninguno), consultado en vivo contra el servidor (no solo el caché local, que puede estar
        // desactualizado si otra persona lo generó hace un momento en otro dispositivo). Con esto,
        // en vez de bloquear, se puede CARGAR ese despacho existente y actualizarlo con los datos
        // más recientes de la OC (ver crearDespachoDesdeOC).
        async function buscarDespachoActivoParaOC(ocObjectId) {
            try {
                const where = encodeURIComponent(JSON.stringify({ tipoDocumento: 'despacho', ordenCompraAsociada: ocObjectId, activo: true }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}?where=${where}&order=-createdAt&limit=1`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return obtenerDespachosDeOC(ocObjectId)[0] || null; // si falla la red, se recurre al caché como respaldo
                const data = await resp.json();
                return (data.results || [])[0] || null;
            } catch (e) {
                console.warn('No se pudo verificar en vivo si la OC ya tiene despacho, se usa el caché local:', e);
                return obtenerDespachosDeOC(ocObjectId)[0] || null;
            }
        }

        // Calcula el estado de pago de una Orden de Compra: se considera "pago pendiente" cuando se
        // registró un adelanto mayor que 0 pero menor al total (falta cobrar el saldo). Si no se
        // registró ningún adelanto, o el adelanto cubre el total, se considera pagada — el caso "no
        // se registró nada" se trata como pagada porque así lo pidió el negocio (el seguimiento es
        // solo para adelantos parciales conocidos, no para cotizaciones antiguas sin ese dato).
        function calcularEstadoPago(entry) {
            const total = entry.total || 0;
            const adelanto = entry.montoAdelanto || 0;
            const saldoPendiente = Math.max(0, total - adelanto);
            const pendiente = adelanto > 0 && saldoPendiente > 0.005; // margen por redondeo de centavos
            return { pendiente, adelanto, saldoPendiente, total };
        }

        async function renderHistorial() {
            const listEl = document.getElementById('historialList');
            if (!listEl) return;

            const btnMaster = document.getElementById('btnToggleMaster');
            if (btnMaster) {
                btnMaster.style.display = usuarioActual?.nivel === 'master' ? 'inline-block' : 'none';
                btnMaster.textContent = verTodasLasCotizaciones ? '👤 Ver solo mis cotizaciones' : '👥 Ver todas';
            }

            listEl.innerHTML = `<div class="historial-empty">⏳ Cargando cotizaciones...</div>`;

            try {
                await cargarHistorialDesdeNube();
                migrarClientesDesdeHistorialSiHaceFalta();
            } catch (e) {
                console.error('Error al cargar historial:', e);
                listEl.innerHTML = `<div class="historial-empty">⚠️ No se pudo cargar el historial: ${e.message}</div>`;
                return;
            }

            const countEl = document.getElementById('historialCount');
            if (countEl) countEl.textContent = historialCache.length;

            // Estructura fija: el input de búsqueda se crea UNA sola vez aquí y nunca se vuelve a
            // recrear al escribir (si se recreara en cada tecla, el cursor perdería el foco).
            // Solo el contenido de #historialResultsArea se redibuja en cada búsqueda.
            const placeholder = (usuarioActual?.nivel === 'master' && verTodasLasCotizaciones && !usuarioSeleccionadoHistorial)
                ? '🔍 Buscar por N°, cliente, empresa, teléfono o vendedor...'
                : '🔍 Buscar por N°, cliente, empresa o teléfono...';

            listEl.innerHTML = `
                <div id="historialFiltrosArea">${renderFiltrosTipoHistorial()}</div>
                <div style="margin-bottom:14px;">
                    <input type="text" class="form-input" id="historialSearchInput" placeholder="${placeholder}" oninput="pintarResultadosHistorial()">
                </div>
                <div id="historialResultsArea"></div>
            `;

            pintarResultadosHistorial();
        }

        // Filtra cotizaciones por número correlativo, cliente, empresa o teléfono
        function filtrarCotizaciones(lista, filtro) {
            if (!filtro) return lista;
            return lista.filter(entry => {
                const correlativoTxt = entry.correlativo ? String(entry.correlativo) : '';
                return (
                    correlativoTxt.includes(filtro) ||
                    (entry.cliente || '').toLowerCase().includes(filtro) ||
                    (entry.empresaCliente || '').toLowerCase().includes(filtro) ||
                    (entry.telefono || '').toLowerCase().includes(filtro) ||
                    (entry.usuarioNombre || '').toLowerCase().includes(filtro)
                );
            });
        }

        // FIX (correlativos "que no aparecen" pero sí están en la base de datos): el buscador antes
        // solo filtraba historialCache, que trae como máximo los últimos 200 documentos (ver
        // cargarHistorialDesdeNube). Si el correlativo buscado es más viejo que eso, o pertenece a un
        // registro que quedó fuera de ese límite, la búsqueda local no lo iba a encontrar aunque sí
        // exista en la nube. Esta función consulta el servidor EN VIVO, sin el límite de 200 ni la
        // dependencia del caché, respetando el mismo alcance de permisos que el historial normal
        // (solo mis documentos, salvo que sea master con "Ver todas" activado).
        async function buscarEnNubePorFiltro(filtro) {
            const texto = (filtro || '').trim();
            if (!texto) return [];
            try {
                const esMaster = usuarioActual?.nivel === 'master';
                const escapado = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escapa caracteres especiales de regex
                const condiciones = [
                    { cliente: { $regex: escapado, $options: 'i' } },
                    { empresaCliente: { $regex: escapado, $options: 'i' } },
                    { telefono: { $regex: escapado, $options: 'i' } },
                    { ruc: { $regex: escapado, $options: 'i' } }
                ];
                // Si lo que se escribió es un número, se agrega también una búsqueda EXACTA por
                // correlativo (correlativo se guarda como número, no como texto).
                if (/^\d+$/.test(texto)) {
                    condiciones.push({ correlativo: parseInt(texto, 10) });
                }
                const where = { activo: true, $or: condiciones };
                if (!(esMaster && verTodasLasCotizaciones)) {
                    where.usuario = usuarioActual?.username || '';
                }
                const url = `${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}?where=${encodeURIComponent(JSON.stringify(where))}&order=-createdAt&limit=50`;
                const resp = await fetch(url, { headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }) });
                if (!resp.ok) return [];
                const data = await resp.json();
                // Los documentos de prueba (Modo Desarrollador) nunca deben aparecer en esta búsqueda,
                // salvo que el modo prueba siga activo en este momento (mismo criterio que el resto
                // del historial).
                return (data.results || []).filter(e => modoDesarrollador || (!e.esPrueba && !String(e.tipoDocumento || '').endsWith('_prueba')));
            } catch (e) {
                console.warn('No se pudo buscar en la nube:', e);
                return [];
            }
        }

        // Redibuja solo el área de resultados a partir de lo que ya está en memoria (historialCache).
        // No toca la red ni recrea el input de búsqueda, así no se pierde el foco al escribir.
        function pintarResultadosHistorial() {
            const resultsEl = document.getElementById('historialResultsArea');
            if (!resultsEl) return;
            const filtro = (document.getElementById('historialSearchInput')?.value || '').toLowerCase().trim();

            if (historialCache.length === 0) {
                resultsEl.innerHTML = `<div class="historial-empty">No hay cotizaciones guardadas aún.<br><br>Arma una cotización y haz clic en <strong>"💾 Guardar"</strong>.</div>`;
                return;
            }

            const mostrandoTodas = usuarioActual?.nivel === 'master' && verTodasLasCotizaciones;
            const hayFiltroTipo = filtroTipoHistorial !== 'todas';

            // Vista master, nivel 1: agrupado por usuario — a menos que haya una búsqueda activa o un
            // filtro de tipo de documento activo, en cuyo caso se muestran directo las cotizaciones de
            // TODOS los usuarios que calcen (así se puede ubicar algo puntual, o ver p. ej. todas las
            // "Órdenes de Compra" de todos, sin tener que entrar primero a cada persona).
            if (mostrandoTodas && !usuarioSeleccionadoHistorial && !filtro && !hayFiltroTipo) {
                renderUsuariosHistorial(resultsEl);
                return;
            }

            if (mostrandoTodas && !usuarioSeleccionadoHistorial) {
                renderListaCotizaciones(resultsEl, filtrarPorTipoDocumento(historialCache), true, filtro);
                return;
            }

            // Vista normal, o vista master nivel 2: cotizaciones de un usuario puntual
            const lista = mostrandoTodas
                ? historialCache.filter(e => (e.usuario || '') === usuarioSeleccionadoHistorial)
                : historialCache;

            renderListaCotizaciones(resultsEl, filtrarPorTipoDocumento(lista), mostrandoTodas, filtro);
        }

        // Vista master — agrupa las cotizaciones por usuario y muestra una tarjeta por persona
        function renderUsuariosHistorial(container) {
            const ahora = new Date();
            const mesActual = ahora.getMonth();
            const anioActual = ahora.getFullYear();

            const porUsuario = {};
            historialCache.forEach(entry => {
                const key = entry.usuario || '(sin usuario)';
                if (!porUsuario[key]) {
                    porUsuario[key] = { usuario: key, nombre: entry.usuarioNombre || key, cantidad: 0, ultimaFecha: entry.createdAt, totalAcumulado: 0, totalOCMes: 0 };
                }
                porUsuario[key].cantidad++;
                porUsuario[key].totalAcumulado += entry.total || 0;
                if (new Date(entry.createdAt) > new Date(porUsuario[key].ultimaFecha)) {
                    porUsuario[key].ultimaFecha = entry.createdAt;
                }
                // Monto de Órdenes de Compra del mes en curso (solo ese tipo de documento y solo
                // las creadas dentro del mes/año actual).
                const fechaEntry = new Date(entry.createdAt);
                if (entry.tipoDocumento === 'orden_compra' && fechaEntry.getMonth() === mesActual && fechaEntry.getFullYear() === anioActual) {
                    porUsuario[key].totalOCMes += entry.total || 0;
                }
            });

            const usuarios = Object.values(porUsuario).sort((a, b) => new Date(b.ultimaFecha) - new Date(a.ultimaFecha));
            const nombreMesActual = ahora.toLocaleDateString('es-PE', { month: 'long' });

            container.innerHTML = `
                <div style="margin-bottom:12px;color:var(--gray-500);font-size:0.85em;">Selecciona un usuario para ver sus cotizaciones, o escribe arriba para buscar en todas a la vez</div>
                <div class="historial-list">
                    ${usuarios.map(u => {
                        const fecha = new Date(u.ultimaFecha).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' });
                        return `
                        <div class="historial-card historial-card-clickable" onclick="verHistorialDeUsuario('${u.usuario}')">
                            <p class="historial-card-title">${u.nombre}</p>
                            <div class="historial-card-meta">
                                <span>${u.cantidad} cotización${u.cantidad !== 1 ? 'es' : ''}</span>
                                <span>Última: ${fecha}</span>
                            </div>
                            <div class="historial-card-info-secundaria">OC de ${nombreMesActual}: S/ ${u.totalOCMes.toFixed(2)}</div>
                            <div class="historial-card-footer">
                                <span class="historial-card-link">Ver cotizaciones →</span>
                                <div class="historial-card-total">S/ ${u.totalAcumulado.toFixed(2)}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        }

        function verHistorialDeUsuario(username) {
            usuarioSeleccionadoHistorial = username;
            const input = document.getElementById('historialSearchInput');
            if (input) input.value = '';
            pintarResultadosHistorial();
        }

        function volverAUsuariosHistorial() {
            usuarioSeleccionadoHistorial = null;
            filtroTipoHistorial = 'todas'; // vuelve limpio a la vista agrupada por usuario
            const filtrosEl = document.getElementById('historialFiltrosArea');
            if (filtrosEl) filtrosEl.innerHTML = renderFiltrosTipoHistorial();
            const input = document.getElementById('historialSearchInput');
            if (input) input.value = '';
            pintarResultadosHistorial();
        }

        // Renderiza una lista plana de tarjetas de cotización (propia, de un usuario puntual,
        // o de todos los usuarios cuando el master está buscando desde la vista agrupada)
        // Genera el HTML de una tarjeta individual del historial (una Cotización/OC/Despacho).
        // Extraído de renderListaCotizaciones para poder reutilizarlo también con resultados que
        // vienen de la búsqueda en vivo en la nube (ver buscarEnNubePorFiltro), no solo del caché local.
        function renderTarjetaHistorialHTML(entry, mostrarVendedorPorTarjeta) {
            const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
            const numProductos = entry.productos.length;
            const totalUnid = entry.productos.reduce((a, p) => a + p.cantidad, 0);
            // Antes cada tipo de documento tenía su propio color de fondo (naranja/verde/índigo).
            // Ahora es solo texto — el color ya no distingue el tipo, así que puede reservarse
            // para lo que sí necesita atención (despachado, pago pendiente).
            const etiquetaTipoDoc = {
                orden_compra: '📦 Orden de compra',
                despacho:     '🚚 Despacho',
                cotizacion:   '📋 Cotización',
                // 🧪 MODO DESARROLLADOR: los documentos de prueba usan su propio tipoDocumento
                // (ver guardarEnHistorial), así que quedan etiquetados aparte y bien visibles acá,
                // para que nunca se confundan con un documento real aunque aparezcan mezclados
                // mientras el modo prueba sigue activo.
                orden_compra_prueba: '🧪📦 Orden de compra (PRUEBA)',
                despacho_prueba:     '🧪🚚 Despacho (PRUEBA)',
                cotizacion_prueba:   '🧪📋 Cotización (PRUEBA)'
            }[entry.tipoDocumento] || '📋 Cotización';
            const correlativoTexto = formatearCorrelativo(entry.correlativo, entry.tipoDocumento === 'despacho' ? entry.sufijoDespacho : null);
            const editadoPorOtro = entry.ultimaEdicionPor && entry.usuario && entry.ultimaEdicionPor !== entry.usuario;
            // Si es un Despacho con OC de origen guardada, busca su correlativo en caché para
            // mostrar el vínculo (si esa OC no está en la caché actual, igual se marca como
            // vinculado, solo que sin poder mostrar su número).
            const ocVinculada = entry.tipoDocumento === 'despacho' && entry.ordenCompraAsociada
                ? historialCache.find(e => e.objectId === entry.ordenCompraAsociada)
                : null;
            const textoVinculo = entry.tipoDocumento === 'despacho' && entry.ordenCompraAsociada
                ? `Vinculado a OC ${ocVinculada ? formatearCorrelativo(ocVinculada.correlativo, null) : ''}`
                : '';
            // Vendedor, vínculo y "editado por otro" ya no son 3 chips de color separados —
            // se fusionan en una sola línea de texto gris, porque son datos de contexto, no
            // alertas que requieran destacarse.
            const infoSecundariaTexto = [
                textoVinculo,
                mostrarVendedorPorTarjeta ? `Vendedor: ${entry.usuarioNombre || entry.usuario || 'Desconocido'}` : '',
                editadoPorOtro ? `Editado por ${entry.ultimaEdicionPorNombre || entry.ultimaEdicionPor}` : ''
            ].filter(Boolean).join(' · ');
            // Estado de despacho, solo para tarjetas de Orden de Compra: muestra si ya se generó
            // uno o más despachos para esta OC puntual. El indicador "Pendiente de despacho"
            // (para cuando no tiene ninguno) quedó desactivado a pedido — solo se muestra el
            // chip "Despachado" cuando sí existe. Es el único color de "estado" que queda aquí.
            const despachosDeEstaOC = entry.tipoDocumento === 'orden_compra' ? obtenerDespachosDeOC(entry.objectId) : [];
            const estadoDespachoHTML = (entry.tipoDocumento === 'orden_compra' && despachosDeEstaOC.length > 0)
                ? `<div class="historial-card-despacho-row">
                     <span class="historial-card-chip-success">Despachado${despachosDeEstaOC.length > 1 ? ' ×' + despachosDeEstaOC.length : ''}</span>
                     ${despachosDeEstaOC.map(d => `<button class="btn-historial-ver" onclick="verCotizacionDesdeHistorial('${d.objectId}')">${formatearCorrelativo(d.correlativo, d.sufijoDespacho)}</button>`).join('')}
                   </div>`
                : '';
            // Estado de pago, solo para OC: si hay un adelanto registrado que no cubre el total,
            // se resalta para dar seguimiento hasta cobrar el saldo completo. Es la única alerta
            // ámbar de la tarjeta — el color se reserva para esto, no para decorar.
            const estadoPago = entry.tipoDocumento === 'orden_compra' ? calcularEstadoPago(entry) : null;
            const estadoPagoHTML = estadoPago && estadoPago.pendiente
                ? `<div class="historial-card-alert" title="Adelanto: S/ ${estadoPago.adelanto.toFixed(2)} de S/ ${estadoPago.total.toFixed(2)}">Falta S/ ${estadoPago.saldoPendiente.toFixed(2)} por cobrar</div>`
                : '';
            return `
                <div class="historial-card">
                    <div class="historial-card-top">
                        <span class="historial-card-doctype">${etiquetaTipoDoc}</span>
                        <span class="historial-card-correlativo">${correlativoTexto}</span>
                    </div>
                    <p class="historial-card-title">${entry.cliente}</p>
                    ${entry.empresaCliente ? `<p class="historial-card-subtitle">${entry.empresaCliente}</p>` : ''}
                    <div class="historial-card-meta">
                        <span>${fecha}</span>
                        <span>${numProductos} producto${numProductos!==1?'s':''} · ${totalUnid} unid.</span>
                        ${entry.sucursal ? `<span>${entry.sucursal.nombre}</span>` : ''}
                        ${entry.globalDescPct > 0 ? `<span>Desc. ${entry.globalDescPct}%</span>` : ''}
                    </div>
                    ${infoSecundariaTexto ? `<div class="historial-card-info-secundaria">${infoSecundariaTexto}</div>` : ''}
                    ${estadoDespachoHTML}
                    ${estadoPagoHTML}
                    <div class="historial-card-footer">
                        <div class="historial-card-actions">
                            <button class="btn-historial-ver" onclick="verCotizacionDesdeHistorial('${entry.objectId}')">Ver</button>
                            <!-- Los botones "Crear Despacho" y "Pago" quedaron desactivados a pedido:
                                 ambas acciones se hacen ahora cargando la OC con "Cargar" y continuando
                                 el flujo normal (cambiar a Despacho y Guardar, o actualizar el adelanto y
                                 Guardar). Las funciones crearDespachoDesdeOC() y abrirModalActualizarPago()
                                 se dejaron intactas en el código por si se quieren reactivar más adelante. -->
                            <button class="btn-historial-load" onclick="cargarDesdeHistorial('${entry.objectId}')">Cargar</button>
                            <button class="btn-historial-del" onclick="eliminarDeHistorial('${entry.objectId}')" aria-label="Eliminar">🗑️</button>
                        </div>
                        <div class="historial-card-total">S/ ${entry.total.toFixed(2)}</div>
                    </div>
                </div>`;
        }

        // Contador de "carrera": cada búsqueda en la nube dispara una petición asíncrona; si el
        // usuario sigue escribiendo, un resultado viejo que llega tarde NO debe pisar la pantalla con
        // datos de una búsqueda anterior ya abandonada.
        let tokenBusquedaNube = 0;

        function renderListaCotizaciones(container, listaCompleta, mostrandoTodas, filtro) {
            const lista = filtrarCotizaciones(listaCompleta, filtro || '');
            // Se invalida cualquier búsqueda en la nube que hubiera quedado pendiente de una llamada
            // anterior a esta función — así, si el usuario ya cambió lo que buscaba (o si esta vez sí
            // hubo resultados locales), un resultado tardío de una búsqueda vieja nunca sobrescribe
            // esta pantalla más nueva.
            const miToken = ++tokenBusquedaNube;

            const nombreUsuarioActivo = mostrandoTodas && usuarioSeleccionadoHistorial
                ? (listaCompleta[0]?.usuarioNombre || usuarioSeleccionadoHistorial)
                : null;

            const mostrarVendedorPorTarjeta = mostrandoTodas && !nombreUsuarioActivo;

            const encabezado = nombreUsuarioActivo
                ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                        <button class="btn btn-small" onclick="volverAUsuariosHistorial()" style="background:#edf2f7;color:var(--primary);font-size:0.8em;">← Volver a usuarios</button>
                        <strong style="color:var(--primary);">🧑‍💼 Cotizaciones de ${nombreUsuarioActivo}</strong>
                   </div>`
                : '';

            if (lista.length === 0) {
                if (!filtro) {
                    container.innerHTML = `${encabezado}<div class="historial-empty">No hay cotizaciones visibles.</div>`;
                    return;
                }
                // FIX: antes, si no aparecía nada en los últimos 200 registros cargados, se mostraba
                // directo "sin resultados" — aunque el documento SÍ existiera en la base de datos
                // (por ejemplo, un correlativo viejo). Ahora se fuerza una búsqueda en vivo contra
                // toda la base antes de darlo por perdido.
                container.innerHTML = `${encabezado}<div class="historial-empty">🔎 Buscando "${filtro}" en toda la base de datos...</div>`;
                buscarEnNubePorFiltro(filtro).then(encontrados => {
                    if (miToken !== tokenBusquedaNube) return; // el usuario ya cambió la búsqueda; este resultado quedó viejo
                    if (encontrados.length === 0) {
                        container.innerHTML = `${encabezado}<div class="historial-empty">Sin resultados para "${filtro}" — se buscó también en toda la base de datos, no solo en los últimos 200 registros.</div>`;
                        return;
                    }
                    // Se agregan al caché local (sin duplicar) para que "Ver", "Cargar" y "Eliminar"
                    // funcionen igual que con cualquier otro resultado del historial.
                    encontrados.forEach(e => {
                        if (!historialCache.some(h => h.objectId === e.objectId)) historialCache.push(e);
                    });
                    const notaNube = `<div style="font-size:0.8em;color:#744210;background:#fefcbf;padding:6px 10px;border-radius:6px;margin-bottom:10px;">🔎 Encontrado buscando en toda la base de datos (no estaba entre los últimos 200 registros recientes)</div>`;
                    container.innerHTML = `${encabezado}${notaNube}<div class="historial-list">${encontrados.map(e => renderTarjetaHistorialHTML(e, mostrarVendedorPorTarjeta)).join('')}</div>`;
                });
                return;
            }

            container.innerHTML = `${encabezado}<div class="historial-list">${lista.map(entry => renderTarjetaHistorialHTML(entry, mostrarVendedorPorTarjeta)).join('')}</div>`;
        }

        function toggleVerTodasCotizaciones() {
            verTodasLasCotizaciones = !verTodasLasCotizaciones;
            usuarioSeleccionadoHistorial = null; // siempre arranca en la lista de usuarios al alternar
            renderHistorial();
        }

        function cargarDesdeHistorial(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            if (!entry) return;
            if (!confirm(`¿Cargar cotización de "${entry.cliente}"? Se reemplazará la cotización actual.`)) return;
            productosEnTabla = JSON.parse(JSON.stringify(entry.productos)).map(migrarProductoLegacy);
            sucursalSeleccionada = entry.sucursal || null;
            if (document.getElementById('globalDiscount')) document.getElementById('globalDiscount').value = entry.globalDescPct || '';
            // Cargar datos del cliente
            document.getElementById('clienteNombre').value = entry.cliente === 'Sin nombre' ? '' : entry.cliente;
            document.getElementById('clienteEmpresa').value = entry.empresaCliente || '';
            document.getElementById('clienteRUC').value = entry.ruc || '';
            document.getElementById('clienteTelefono').value = entry.telefono || '';
            document.getElementById('clienteEmail').value = entry.email || '';
            document.getElementById('clienteDireccion').value = entry.direccion || '';
            document.getElementById('clienteNotas').value = entry.notas || '';
            olvidarAutocompletadoRUCDNI();
            // Recupera el vínculo exacto con la base de clientes (si esta cotización se guardó ya
            // con este fix activo). Si es un registro viejo que no lo tiene, queda en null y
            // cualquier corrección volverá a buscar por nombre+empresa como respaldo.
            clienteDBObjectIdEnCurso = entry.clienteObjectId || null;
            // Restaurar el monto adelantado (solo aplica a Órdenes de Compra; en cualquier otro tipo
            // se deja limpio, ya que ese campo no se guarda para Cotización/Despacho).
            document.getElementById('montoAdelanto').value = entry.tipoDocumento === 'orden_compra' ? (entry.montoAdelanto || '') : '';
            actualizarPago();

            // Restaurar tipo de documento y continuar con el MISMO correlativo (no se pide uno nuevo)
            const tipoContador = entry.tipoDocumento === 'orden_compra' ? 'orden_compra' : (entry.tipoDocumento === 'despacho' ? 'despacho' : 'cotizacion');
            const valorSelect = tipoContador === 'orden_compra' ? 'ORDEN DE COMPRA' : (tipoContador === 'despacho' ? 'DESPACHO' : 'cotizacion');
            document.getElementById('tipoDocumento').value = valorSelect;
            // productosDescontados = snapshot de lo que YA se descontó del Kardex la última vez.
            // Si el registro es de antes de este cambio (no tiene ese campo todavía), se asume que
            // todo lo que tiene "productos" ya fue descontado (mejor suposición posible para no
            // duplicar ni perder el ajuste en la primera edición de un registro viejo).
            // FIX (contaminación cruzada): al cargar un documento puntual del historial, cualquier
            // objectId "en curso" que hubiera quedado guardado en los OTROS dos tipos (de una edición
            // anterior en la misma sesión que no se cerró con "Nueva Solicitud") se descarta. Así, si
            // después el usuario cambia de tipo de documento, nunca puede terminar sobrescribiendo por
            // error un registro ajeno que ya no tiene relación con lo que se acaba de cargar.
            registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
            registroEnCurso[tipoContador] = {
                objectId: entry.objectId,
                correlativo: entry.correlativo || null,
                productosDescontados: entry.productosDescontados || entry.productos || [],
                ordenCompraAsociada: entry.ordenCompraAsociada || null,
                sufijoDespacho: entry.sufijoDespacho || '',
                // FIX (control de concurrencia, ver guardarEnHistorial): se guarda la "huella"
                // updatedAt tal como estaba en el momento de cargar, para poder detectar más adelante
                // si alguien más lo modificó mientras tanto.
                updatedAt: entry.updatedAt || null
            };
            tipoContadorCargadoExplicitamente = tipoContador;

            actualizarResumenCliente();
            renderTable();
            actualizarBloqueoSelectorTipoDocumento();
            guardarEstado();
            if (sucursalSeleccionada) mostrarSucursalSeleccionada();
            renderSucursales();
            switchTabById('cotizar');
            mostrarNotificacion(`Cotización ${formatearCorrelativo(entry.correlativo, entry.sufijoDespacho)} cargada`, 'success');
        }

        // 📦 Crea (o ACTUALIZA) el Despacho a partir de una Orden de Compra puntual del historial:
        // carga sus productos/cliente/sucursal, fija el tipo de documento en DESPACHO (y lo bloquea
        // para que no se pueda cambiar por error a mitad de camino) y hace que el despacho tome el
        // MISMO N° que esa OC específica. Guarda la referencia a la OC de origen (ordenCompraAsociada)
        // para trazabilidad.
        //
        // CAMBIO DE COMPORTAMIENTO (a pedido): antes, si la OC ya tenía un despacho generado, este
        // botón quedaba BLOQUEADO ("no se puede crear otro"). Ahora, si ya existe uno, en vez de
        // bloquear se CARGA ese despacho existente con los datos actuales de la OC — así, al
        // presionar "Guardar", se ACTUALIZA el despacho ya emitido (mismo objectId, mismo N°) en vez
        // de crear uno duplicado. Cubre el caso de "edité la OC después de despachar, hay que
        // reflejar el cambio en la guía". La lógica de sufijos (B, C...) para despachos adicionales
        // realmente separados se deja intacta en el código por si se quiere usar más adelante.
        async function crearDespachoDesdeOC(objectId) {
            const oc = historialCache.find(e => e.objectId === objectId);
            if (!oc || oc.tipoDocumento !== 'orden_compra') { mostrarNotificacion('No se encontró la Orden de Compra', 'warning'); return; }

            // Se verifica en vivo contra el servidor (no solo el caché) para cubrir el caso de que
            // otra persona haya generado o editado el despacho de esta misma OC hace un momento.
            const despachoExistente = await buscarDespachoActivoParaOC(oc.objectId);

            const correlativoTexto = formatearCorrelativo(oc.correlativo, null);
            const mensajeConfirm = despachoExistente
                ? `Esta Orden de Compra ya tiene un Despacho generado (${formatearCorrelativo(despachoExistente.correlativo, despachoExistente.sufijoDespacho)}).\n\n¿Actualizarlo con los datos actuales de la OC ${correlativoTexto} de "${oc.cliente}"?\n\nSe reemplazará la cotización actual.`
                : `¿Crear un Despacho a partir de la Orden de Compra ${correlativoTexto} de "${oc.cliente}"?\n\nSe reemplazará la cotización actual.`;
            if (!confirm(mensajeConfirm)) return;

            productosEnTabla = JSON.parse(JSON.stringify(oc.productos)).map(migrarProductoLegacy);
            sucursalSeleccionada = oc.sucursal || null;
            if (document.getElementById('globalDiscount')) document.getElementById('globalDiscount').value = oc.globalDescPct || '';
            document.getElementById('clienteNombre').value = oc.cliente === 'Sin nombre' ? '' : oc.cliente;
            document.getElementById('clienteEmpresa').value = oc.empresaCliente || '';
            document.getElementById('clienteRUC').value = oc.ruc || '';
            document.getElementById('clienteTelefono').value = oc.telefono || '';
            document.getElementById('clienteEmail').value = oc.email || '';
            document.getElementById('clienteDireccion').value = oc.direccion || '';
            document.getElementById('clienteNotas').value = oc.notas || '';
            olvidarAutocompletadoRUCDNI();
            clienteDBObjectIdEnCurso = oc.clienteObjectId || null;

            // Fija el tipo de documento en DESPACHO. El bloqueo del selector se aplica después, con
            // actualizarBloqueoSelectorTipoDocumento(), una vez que registroEnCurso.despacho ya tiene
            // el vínculo guardado (para que la función detecte correctamente que debe bloquear).
            document.getElementById('tipoDocumento').value = 'DESPACHO';

            // FIX (contaminación cruzada): igual que en cargarDesdeHistorial, se descarta cualquier
            // objectId "en curso" que hubiera quedado de una cotización/OC anterior en la misma sesión
            // — este despacho solo debe quedar vinculado a ESTA OC de origen, no arrastrar nada de antes.
            registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
            registroEnCurso.despacho = despachoExistente
                ? {
                    // Ya existía: se reutiliza su objectId y su N°/sufijo tal cual — el próximo
                    // "Guardar" hará un PUT sobre ESE registro (actualización), no uno nuevo.
                    objectId: despachoExistente.objectId,
                    correlativo: despachoExistente.correlativo || oc.correlativo || null,
                    productosDescontados: despachoExistente.productosDescontados || despachoExistente.productos || [],
                    ordenCompraAsociada: oc.objectId,
                    sufijoDespacho: despachoExistente.sufijoDespacho || '',
                    updatedAt: despachoExistente.updatedAt || null
                }
                : {
                    objectId: null,
                    correlativo: oc.correlativo || null,
                    ordenCompraAsociada: oc.objectId,
                    sufijoDespacho: ''
                };
            tipoContadorCargadoExplicitamente = 'despacho';

            actualizarResumenCliente();
            renderTable();
            actualizarBloqueoSelectorTipoDocumento();
            actualizarPanelCorrelativo();
            guardarEstado();
            if (sucursalSeleccionada) mostrarSucursalSeleccionada();
            renderSucursales();
            switchTabById('cotizar');
            mostrarNotificacion(despachoExistente
                ? `Despacho ${formatearCorrelativo(despachoExistente.correlativo, despachoExistente.sufijoDespacho)} cargado con los datos actuales de la OC — presiona "Guardar" para actualizarlo`
                : `Despacho ${formatearCorrelativo(oc.correlativo, '')} vinculado a OC ${correlativoTexto} — revisa y presiona "Guardar" cuando esté listo`, 'success');
        }


        // Muestra en un modal de solo lectura el contenido completo de una cotización, orden de
        // compra o guía de despacho guardada en el historial, sin cargarla a la cotización activa
        // ni tocar contadores/red. El diseño se adapta a pantallas de PC y de celular (grid de
        // cliente/envío en 2 columnas en PC y apilado en móvil, tabla con scroll horizontal si
        // no entra en pantallas angostas).
        function verCotizacionDesdeHistorial(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            if (!entry) { mostrarNotificacion('No se encontró la cotización', 'warning'); return; }

            const infoTipoDoc = {
                orden_compra: { color: '#9a3412', fondo: '#fed7aa', etiqueta: '📦 ORDEN DE COMPRA' },
                despacho:     { color: '#276749', fondo: '#c6f6d5', etiqueta: '🚚 GUÍA DE DESPACHO' },
                cotizacion:   { color: '#3730a3', fondo: '#e0e7ff', etiqueta: '📋 COTIZACIÓN' }
            }[entry.tipoDocumento] || { color: '#3730a3', fondo: '#e0e7ff', etiqueta: '📋 COTIZACIÓN' };

            const esDespacho = entry.tipoDocumento === 'despacho';
            const correlativoTexto = formatearCorrelativo(entry.correlativo, esDespacho ? entry.sufijoDespacho : null);
            const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });

            // obtenerPrecio()/obtenerEtiquetaTipoPrecio() leen la variable global "forzarPorMayor".
            // La ponemos un instante en el valor que tenía ESTA cotización para que el precio
            // mostrado coincida con lo que se generó en su momento, y la restauramos de inmediato
            // (todo el cálculo de abajo es síncrono, no hay ningún await entre medio).
            const forzarPorMayorOriginal = forzarPorMayor;
            forzarPorMayor = !!entry.forzarPorMayor;

            let totalSinIGV = 0;
            const filasHTML = (entry.productos || []).map(producto => {
                const cantidad = producto.cantidad;
                const precioBase = obtenerPrecio(producto, cantidad);
                const precioUnitario = producto.precioOverride !== undefined ? producto.precioOverride : precioBase;
                const descPct = producto.descuento || 0;
                const precioConDesc = precioUnitario * (1 - descPct / 100);
                const subtotal = cantidad * precioConDesc;
                totalSinIGV += subtotal;
                const tipoPrecio = producto.precioOverride !== undefined ? 'Personalizado' : obtenerEtiquetaTipoPrecio(producto, cantidad);
                const precioMostrar = entry.mostrarConIGV ? calcularPrecioConIGV(precioConDesc) : precioConDesc;
                const subtotalMostrar = entry.mostrarConIGV ? calcularPrecioConIGV(subtotal) : subtotal;
                const colorInfo = producto.color ? ` <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;font-size:0.75em;font-weight:600;margin-left:3px;white-space:nowrap;display:inline-block;">● ${producto.color}</span>` : '';
                const descInfo = descPct > 0 ? ` <span style="background:#fed7aa;color:#9a3412;padding:1px 5px;border-radius:4px;font-size:0.75em;">-${descPct}%</span>` : '';

                return `
                    <tr>
                        <td style="font-size:0.82em;color:#718096;font-family:monospace;">${producto.codigo}</td>
                        <td style="font-size:0.88em;">${producto.nombre}${colorInfo}</td>
                        <td style="text-align:center;font-size:0.88em;">${cantidad}</td>
                        ${esDespacho ? '' : `<td style="text-align:right;font-size:0.85em;">S/ ${precioMostrar.toFixed(2)}${descInfo}<br><span style="font-size:0.8em;color:#a0aec0;">${tipoPrecio}</span></td>`}
                        ${esDespacho ? '' : `<td style="text-align:right;font-weight:700;font-size:0.9em;">S/ ${subtotalMostrar.toFixed(2)}</td>`}
                    </tr>`;
            }).join('');

            forzarPorMayor = forzarPorMayorOriginal; // restaurar de inmediato

            const descGlobalMonto = totalSinIGV * (entry.globalDescPct || 0) / 100;
            const totalFinalSinIGV = totalSinIGV - descGlobalMonto;
            const totalMostrar = entry.mostrarConIGV ? calcularPrecioConIGV(totalFinalSinIGV) : totalFinalSinIGV;

            let detalleTotalesHTML = '';
            if (entry.globalDescPct > 0) {
                const subtotalDisp = entry.mostrarConIGV ? calcularPrecioConIGV(totalSinIGV) : totalSinIGV;
                const descDisp = entry.mostrarConIGV ? calcularPrecioConIGV(descGlobalMonto) : descGlobalMonto;
                detalleTotalesHTML += `<div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>S/ ${subtotalDisp.toFixed(2)}</span></div>`;
                detalleTotalesHTML += `<div style="display:flex;justify-content:space-between;"><span>Desc. global (${entry.globalDescPct}%):</span><span>-S/ ${descDisp.toFixed(2)}</span></div>`;
            }
            if (entry.mostrarConIGV) {
                const soloIGV = calcularIGV(totalFinalSinIGV);
                detalleTotalesHTML += `<div style="display:flex;justify-content:space-between;"><span>Base imponible:</span><span>S/ ${totalFinalSinIGV.toFixed(2)}</span></div>`;
                detalleTotalesHTML += `<div style="display:flex;justify-content:space-between;"><span>IGV (18%):</span><span>S/ ${soloIGV.toFixed(2)}</span></div>`;
            }

            let clienteHTML = '';
            if (entry.cliente || entry.empresaCliente) {
                clienteHTML = `
                    <div style="background:#f8faff;border:1.5px solid #c7d2fe;border-radius:7px;padding:11px 14px;">
                        <div style="font-size:0.75em;font-weight:700;color:#5568d3;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">👤 Cliente</div>
                        ${entry.cliente ? `<div style="font-weight:700;font-size:0.9em;color:#2d3748;">${entry.cliente}</div>` : ''}
                        ${entry.empresaCliente ? `<div style="font-size:0.82em;color:#718096;">${entry.empresaCliente}</div>` : ''}
                        ${entry.ruc ? `<div style="font-size:0.8em;color:#718096;margin-top:5px;">🪪 RUC/DNI: ${entry.ruc}</div>` : ''}
                        ${entry.telefono ? `<div style="font-size:0.8em;color:#718096;margin-top:5px;">📞 ${entry.telefono}</div>` : ''}
                        ${entry.email ? `<div style="font-size:0.8em;color:#718096;margin-top:5px;">✉️ ${entry.email}</div>` : ''}
                        ${entry.direccion ? `<div style="font-size:0.8em;color:#718096;margin-top:5px;">📍 ${entry.direccion}</div>` : ''}
                        ${entry.notas ? `<div style="font-size:0.8em;color:#718096;margin-top:5px;font-style:italic;">📝 ${entry.notas}</div>` : ''}
                    </div>`;
            }

            let envioHTML = '';
            if (entry.sucursal) {
                envioHTML = `
                    <div style="background:#e6fffa;border:1.5px solid #81e6d9;border-radius:7px;padding:11px 14px;">
                        <div style="font-size:0.75em;font-weight:700;color:#234e52;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">📦 Envío Shalom</div>
                        <div style="font-weight:700;font-size:0.9em;color:#2d3748;">${entry.sucursal.nombre || ''}</div>
                        <div style="font-size:0.8em;color:#718096;line-height:1.6;margin-top:5px;">
                            📍 ${entry.sucursal.direccion || ''}<br>
                            🏙️ ${entry.sucursal.ciudad || ''}${entry.sucursal.provincia ? ', ' + entry.sucursal.provincia : ''}
                        </div>
                    </div>`;
            }

            const bloqueInfoHTML = (clienteHTML || envioHTML)
                ? `<div class="ver-doc-info-grid">${clienteHTML}${envioHTML}</div>`
                : '';

            const numProductos = (entry.productos || []).length;
            const totalUnid = (entry.productos || []).reduce((a, p) => a + (p.cantidad || 0), 0);

            const ocVinculada = entry.tipoDocumento === 'despacho' && entry.ordenCompraAsociada
                ? historialCache.find(e => e.objectId === entry.ordenCompraAsociada)
                : null;
            const vinculoHTML = entry.tipoDocumento === 'despacho' && entry.ordenCompraAsociada
                ? `<div style="font-size:0.8em;color:#9a3412;background:#fed7aa;display:inline-block;padding:3px 9px;border-radius:6px;margin-top:6px;font-weight:700;">🔗 Vinculado a OC ${ocVinculada ? formatearCorrelativo(ocVinculada.correlativo, null) : '(fuera de rango de historial cargado)'}</div>`
                : '';
            // Si es una Orden de Compra, se listan aquí sus despachos generados, para poder saltar
            // directamente a verlos sin volver a la lista del historial. El indicador "⏳ Pendiente de
            // despacho" (para cuando no tiene ninguno) quedó desactivado a pedido — no se muestra nada
            // en ese caso, solo el badge "✅ Despachado" cuando sí existe.
            const despachosDeEstaOC = entry.tipoDocumento === 'orden_compra' ? obtenerDespachosDeOC(entry.objectId) : [];
            const despachosHTML = (entry.tipoDocumento === 'orden_compra' && despachosDeEstaOC.length > 0)
                ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                     <span style="font-size:0.8em;font-weight:700;padding:3px 9px;border-radius:6px;color:#276749;background:#c6f6d5;">✅ Despachado${despachosDeEstaOC.length > 1 ? ' ×' + despachosDeEstaOC.length : ''}</span>
                     ${despachosDeEstaOC.map(d => `<button class="btn-historial-ver" style="padding:2px 9px;font-size:0.78em;" onclick="verCotizacionDesdeHistorial('${d.objectId}')">👁️ ${formatearCorrelativo(d.correlativo, d.sufijoDespacho)}</button>`).join('')}
                   </div>`
                : '';

            document.getElementById('verCotizacionTitulo').textContent = `${infoTipoDoc.etiqueta} ${correlativoTexto}`;
            document.getElementById('verCotizacionBody').innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px;">
                    <div>
                        <span style="font-weight:800;font-size:1em;padding:3px 10px;border-radius:6px;background:${infoTipoDoc.fondo};color:${infoTipoDoc.color};">${correlativoTexto}</span>
                        <div style="font-size:0.8em;color:#718096;margin-top:6px;">📅 ${fecha}</div>
                        <div style="font-size:0.8em;color:#718096;">🧑‍💼 ${entry.usuarioNombre || entry.usuario || '—'}</div>
                        ${vinculoHTML}
                        ${despachosHTML}
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.78em;color:#718096;">${numProductos} producto${numProductos!==1?'s':''} · ${totalUnid} unid.</div>
                        ${!esDespacho ? `<div style="font-size:1.3em;font-weight:800;color:var(--primary);margin-top:4px;">S/ ${totalMostrar.toFixed(2)}</div>` : ''}
                    </div>
                </div>
                ${bloqueInfoHTML}
                <div class="ver-doc-table-wrap">
                    <table class="print-table">
                        <thead>
                            <tr>
                                <th style="width:80px;">Código</th>
                                <th>Producto</th>
                                <th style="width:60px;text-align:center;">Cant.</th>
                                ${esDespacho ? '' : '<th style="text-align:right;">P. Unit.</th>'}
                                ${esDespacho ? '' : '<th style="text-align:right;">Subtotal</th>'}
                            </tr>
                        </thead>
                        <tbody>${filasHTML}</tbody>
                    </table>
                </div>
                ${!esDespacho ? `
                <div style="margin-top:14px;padding-top:12px;border-top:2px solid #e2e8f0;">
                    ${detalleTotalesHTML ? `<div style="font-size:0.85em;color:#4a5568;display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">${detalleTotalesHTML}</div>` : ''}
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <strong style="color:var(--primary);">TOTAL</strong>
                        <strong style="font-size:1.2em;color:var(--primary);">S/ ${totalMostrar.toFixed(2)}</strong>
                    </div>
                </div>` : ''}
            `;

            document.getElementById('verCotizacionModal').classList.add('active');
        }

        function cerrarVerCotizacionModal() {
            document.getElementById('verCotizacionModal').classList.remove('active');
        }

        // 💰 Actualizar Pago: edición aislada del monto adelantado de una OC, sin pasar por
        // guardarEnHistorial() — así no se toca ni el kardex ni los productos, solo ese campo puntual.
        function abrirModalActualizarPago(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            if (!entry || entry.tipoDocumento !== 'orden_compra') { mostrarNotificacion('No se encontró la Orden de Compra', 'warning'); return; }
            document.getElementById('actualizarPagoObjectId').value = objectId;
            document.getElementById('actualizarPagoCorrelativo').textContent = `${formatearCorrelativo(entry.correlativo, null)} — Orden de Compra`;
            document.getElementById('actualizarPagoCliente').textContent = `${entry.cliente || ''}${entry.empresaCliente ? ' — ' + entry.empresaCliente : ''}`;
            document.getElementById('actualizarPagoTotal').textContent = `S/ ${(entry.total || 0).toFixed(2)}`;
            document.getElementById('inputActualizarPagoAdelanto').value = entry.montoAdelanto || '';
            actualizarSaldoModalPago();
            document.getElementById('actualizarPagoModal').classList.add('active');
        }

        function actualizarSaldoModalPago() {
            const total = parseFloat(document.getElementById('actualizarPagoTotal').textContent.replace('S/', '').trim()) || 0;
            const adelanto = parseFloat(document.getElementById('inputActualizarPagoAdelanto').value) || 0;
            const saldo = Math.max(0, total - adelanto);
            const label = document.getElementById('actualizarPagoSaldoLabel');
            if (saldo > 0.005) {
                label.textContent = `💰 Saldo pendiente: S/ ${saldo.toFixed(2)}`;
                label.style.color = '#9c4221';
            } else {
                label.textContent = '✅ Pago completo';
                label.style.color = 'var(--success)';
            }
        }

        function cerrarModalActualizarPago() {
            document.getElementById('actualizarPagoModal').classList.remove('active');
        }

        async function guardarActualizacionPago() {
            const objectId = document.getElementById('actualizarPagoObjectId').value;
            const nuevoAdelanto = parseFloat(document.getElementById('inputActualizarPagoAdelanto').value) || 0;
            const btn = document.getElementById('btnGuardarActualizarPago');
            btn.disabled = true;
            btn.textContent = 'Guardando...';
            try {
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${objectId}`, {
                    method: 'PUT',
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                    body: JSON.stringify({ montoAdelanto: nuevoAdelanto })
                });
                if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }

                // Refleja el cambio en la caché local sin tener que recargar todo el historial
                const entry = historialCache.find(e => e.objectId === objectId);
                if (entry) entry.montoAdelanto = nuevoAdelanto;

                // Si esta OC es la que está actualmente en curso en la pantalla de Cotizar, refresca
                // también el campo visible ahí para que no quede desincronizado.
                if (registroEnCurso.orden_compra?.objectId === objectId) {
                    document.getElementById('montoAdelanto').value = nuevoAdelanto || '';
                    actualizarPago();
                }

                cerrarModalActualizarPago();
                pintarResultadosHistorial();
                mostrarNotificacion('Pago actualizado', 'success');
            } catch (e) {
                console.error('Error actualizando pago:', e);
                mostrarNotificacion('No se pudo actualizar el pago: ' + e.message, 'warning');
            } finally {
                btn.disabled = false;
                btn.textContent = '💾 Guardar';
            }
        }

        // "Eliminar" no borra el registro de la base de datos: solo lo oculta (activo: true -> false)
        //
        // FIX (Kardex no se revertía): antes, ocultar una Orden de Compra dejaba el stock que esa OC
        // había descontado permanentemente perdido del Kardex (nunca se devolvía). Ahora, si la OC
        // tenía productos descontados, antes de ocultarla se intenta devolver ese stock al Kardex
        // (misma lógica de ajustarStockKardexDropbox que usa el guardado, con las cantidades en
        // negativo para sumar en vez de restar). Si el Kardex no responde, la OC se oculta igual (no
        // se bloquea la acción del usuario) pero se avisa claramente para que se revise a mano.
        async function eliminarDeHistorial(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            const productosADevolver = (entry && entry.tipoDocumento === 'orden_compra')
                ? (entry.productosDescontados || []).filter(p => !p.sinKardex && (parseFloat(p.cantidad) || 0) > 0)
                : [];

            const mensaje = productosADevolver.length > 0
                ? '¿Ocultar esta Orden de Compra del historial? Esto también devolverá al Kardex el stock que había descontado.'
                : '¿Ocultar esta cotización del historial?';
            if (!confirm(mensaje)) return;

            try {
                if (productosADevolver.length > 0) {
                    try {
                        const devolucion = productosADevolver.map(p => ({
                            codigo: p.codigo,
                            color: p.color || '',
                            cantidad: -(parseFloat(p.cantidad) || 0) // negativo = se SUMA al stock
                        }));
                        await ajustarStockKardexDropbox(devolucion);
                        cargarKardex(false);
                    } catch (eKardex) {
                        console.error('Error al devolver stock del Kardex:', eKardex);
                        mostrarNotificacion('La Orden se ocultó, pero no se pudo devolver el stock al Kardex: ' + eKardex.message + '. Revísalo manualmente.', 'warning');
                    }
                }

                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${objectId}`, {
                    method: 'PUT',
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                    body: JSON.stringify({ activo: false })
                });
                if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }
                renderHistorial();
                mostrarNotificacion('Cotización ocultada del historial', 'info');
            } catch (e) {
                console.error('Error al ocultar cotización:', e);
                mostrarNotificacion('No se pudo ocultar: ' + e.message, 'warning');
            }
        }

        // Oculta (no borra) todas las cotizaciones visibles en la vista actual
        async function limpiarHistorial() {
            if (historialCache.length === 0) { mostrarNotificacion('No hay cotizaciones para ocultar', 'info'); return; }
            if (!confirm(`¿Ocultar las ${historialCache.length} cotizaciones de esta lista? No se borran, solo dejan de mostrarse.`)) return;
            try {
                await Promise.all(historialCache.map(entry =>
                    fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${entry.objectId}`, {
                        method: 'PUT',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify({ activo: false })
                    })
                ));
                renderHistorial();
                mostrarNotificacion('Historial ocultado', 'info');
            } catch (e) {
                console.error('Error al ocultar historial:', e);
                mostrarNotificacion('No se pudo completar la operación', 'warning');
            }
        }

        // SWITCH: controla si al iniciar sesión se ejecuta la migración de cotizaciones que hayan
        // quedado guardadas en este navegador desde la versión antigua de la app (antes de usar
        // Back4App con login). Déjalo en "true" mientras todavía pueda haber usuarios con
        // cotizaciones locales pendientes de subir; una vez que confirmes que ya nadie las tiene
        // (o que ya se subieron todas), cambia esto a "false" y súbelo — así el proceso deja de
        // ejecutarse por completo en cada inicio de sesión, en cualquier dispositivo.
        const MIGRAR_HISTORIAL_LOCAL_A_NUBE = false;

        // Migra cotizaciones que ya existían en este navegador (localStorage, versión anterior sin login)
        // a la nube, ligadas al usuario que acaba de iniciar sesión. Se ejecuta una sola vez por usuario.
        async function migrarHistorialLocalSiExiste() {
            if (!MIGRAR_HISTORIAL_LOCAL_A_NUBE) return;

            const yaMigrado = localStorage.getItem('historialMigrado_' + usuarioActual.username);
            if (yaMigrado) return;

            let historialLocal = [];
            try { historialLocal = JSON.parse(localStorage.getItem('historial_lh') || '[]'); } catch (e) { historialLocal = []; }

            if (historialLocal.length === 0) {
                localStorage.setItem('historialMigrado_' + usuarioActual.username, '1');
                return;
            }

            mostrarNotificacion(`Migrando ${historialLocal.length} cotización(es) anteriores a la nube...`, 'info');
            let migradas = 0;
            for (const entry of historialLocal) {
                try {
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}`, {
                        method: 'POST',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual.sessionToken }),
                        body: JSON.stringify({
                            cliente: entry.cliente || 'Sin nombre',
                            empresaCliente: entry.empresa || '',
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
                    if (resp.ok) migradas++;
                } catch (e) {
                    console.error('Error migrando una cotización local:', e);
                }
            }

            localStorage.setItem('historialMigrado_' + usuarioActual.username, '1');
            mostrarNotificacion(`${migradas} de ${historialLocal.length} cotización(es) migradas a la nube`, 'success');
        }

