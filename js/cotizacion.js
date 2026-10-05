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
            colorFijadoAgregar = null;
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
                        colorFijadoAgregar = null;
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
            colorFijadoAgregar = null;
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

        async function removeProduct(index) {
            const producto = productosEnTabla[index];
            if (await confirmarAccion({
                titulo: 'Quitar producto',
                mensaje: producto ? `¿Quitar "${producto.nombre}" de la cotización?` : '¿Quitar este producto de la cotización?',
                confirmarTexto: 'Quitar',
                destructivo: true
            })) {
                // Se ubica por referencia (no por el index de antes del diálogo, que pudo cambiar)
                const posicion = productosEnTabla.indexOf(producto);
                if (posicion === -1) return;
                productosEnTabla.splice(posicion, 1);
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

        async function clearAll() {
            const cliente = getClienteData();
            const hayCliente = Object.values(cliente).some(v => v);
            if (productosEnTabla.length === 0 && !sucursalSeleccionada && !hayCliente) return;
            if (await confirmarAccion({
                titulo: 'Nueva solicitud',
                mensaje: 'Se limpiará la cotización actual, incluidos los datos del cliente.',
                confirmarTexto: 'Limpiar',
                destructivo: true
            })) {
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
                const selectorTipoDoc = document.getElementById('tipoDocumento');
                if (selectorTipoDoc) selectorTipoDoc.value = 'cotizacion'; // "Nueva Solicitud" siempre vuelve a Cotización
                actualizarBloqueoSelectorTipoDocumento(); // desbloquea el selector si estaba fijado en DESPACHO
                actualizarPanelCorrelativo(); // vuelve a mostrar la vista previa del próximo N°
                renderTable();
                const sucSel = document.getElementById('sucursalSeleccionada');
                if (sucSel) sucSel.style.display = 'none';
                if (typeof actualizarPanelEnvioCotizar === 'function') actualizarPanelEnvioCotizar(); // limpia el resumen/badge del panel colapsable de envío
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
            colorFijadoAgregar = color;
            document.getElementById('inputColor').value = color;
            if (productoSeleccionado) renderChipsColorAgregar(productoSeleccionado.codigo);
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

        // Compara la versión anterior de un despacho (documento completo, tal como está en el
        // servidor) contra lo que se está por guardar ("entrada": productos y sucursal ya armados
        // por guardarEnHistorial) y arma una lista de frases legibles para el historial de cambios
        // (punto 6 del rediseño de Historial). Deliberadamente NO reutiliza calcularDiferenciaProductos()
        // (js/kardex.js): esa función es específica del Kardex (excluye productos "sinKardex", agrupa
        // solo para saber cuánto stock ajustar) y no debe tocarse ni mezclarse con este propósito.
        function calcularCambiosDespacho(anterior, nuevo) {
            if (!anterior) return [];
            const cambios = [];

            const clave = p => `${String(p.codigo).trim()}||${String(p.color || '').trim().toLowerCase()}`;
            const agrupar = lista => {
                const mapa = {};
                (lista || []).forEach(p => {
                    const k = clave(p);
                    mapa[k] = { ...p, cantidad: (mapa[k]?.cantidad || 0) + (parseFloat(p.cantidad) || 0) };
                });
                return mapa;
            };
            const mapaAnt = agrupar(anterior.productos);
            const mapaNuevo = agrupar(nuevo.productos);
            const todasLasClaves = new Set([...Object.keys(mapaAnt), ...Object.keys(mapaNuevo)]);
            todasLasClaves.forEach(k => {
                const ant = mapaAnt[k];
                const nue = mapaNuevo[k];
                const nombre = (nue || ant)?.nombre || (nue || ant)?.codigo || k;
                if (!ant) {
                    cambios.push(`+ Se agregó "${nombre}" (${nue.cantidad} unid.)`);
                } else if (!nue) {
                    cambios.push(`− Se quitó "${nombre}" (tenía ${ant.cantidad} unid.)`);
                } else if (ant.cantidad !== nue.cantidad) {
                    cambios.push(`"${nombre}": ${ant.cantidad} → ${nue.cantidad} unid.`);
                }
            });

            const sucAnt = anterior.sucursal || null;
            const sucNuevo = nuevo.sucursal || null;
            const idSucursal = s => s ? `${s.nombre || ''}|${s.ciudad || ''}|${s.provincia || ''}` : '';
            if (idSucursal(sucAnt) !== idSucursal(sucNuevo)) {
                if (!sucAnt && sucNuevo) cambios.push(`Se asignó destino: ${sucNuevo.nombre || ''}${sucNuevo.ciudad ? ' — ' + sucNuevo.ciudad : ''}`);
                else if (sucAnt && !sucNuevo) cambios.push(`Se quitó el destino (antes: ${sucAnt.nombre || ''})`);
                else cambios.push(`Destino: ${sucAnt.nombre || ''} → ${sucNuevo.nombre || ''}${sucNuevo.ciudad ? ' (' + sucNuevo.ciudad + ')' : ''}`);
            }

            return cambios;
        }

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
                if (!await confirmarAccion({
                    titulo: 'Despacho sin Orden de Compra',
                    mensaje: 'Este despacho no está vinculado a ninguna Orden de Compra.\n\n¿Seguro que deseas guardarlo así?',
                    tipo: 'warning',
                    confirmarTexto: 'Guardar así'
                })) {
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
                mostrarAlerta({
                    titulo: 'No se pudo generar el número correlativo',
                    mensaje: 'El documento NO se guardó, para evitar que quede sin número. Revisa tu conexión e inténtalo de nuevo.',
                    tipo: 'error',
                    detalle: e.message
                });
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

            // Historial de cambios de un despacho (punto 6 del rediseño de Historial): antes de
            // sobrescribir un despacho que YA existía, se trae su versión actual del servidor (no el
            // caché local, que puede estar desactualizado) para poder comparar productos/sucursal más
            // abajo y armar el resumen de qué cambió. Es una lectura APARTE y aditiva — no toca la
            // verificación de concurrencia de más abajo ni ninguna otra parte del guardado, y solo se
            // dispara para despachos reales (nunca para "_prueba", porque tipoContador ahí es
            // "despacho_prueba", no "despacho").
            let despachoAnteriorParaHistorial = null;
            if (tipoContador === 'despacho' && registroExistente?.objectId) {
                try {
                    const respAnterior = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}/${registroExistente.objectId}`, {
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                    });
                    if (respAnterior.ok) despachoAnteriorParaHistorial = await respAnterior.json();
                } catch (eAnterior) {
                    console.warn('No se pudo leer la versión anterior del despacho para el historial de cambios (se omite el registro de esta versión):', eAnterior);
                }
            }

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
            // Historial de cambios (punto 6 del rediseño de Historial): campo NUEVO y OPCIONAL
            // "historialCambios" — se compara la versión anterior (leída arriba) contra "entrada"
            // (productos y sucursal/destino) y se arma un resumen legible. El sufijo -B/-C sigue
            // usándose SOLO para envíos adicionales (ver crearEnvioAdicionalDesdeOC): una corrección
            // como esta NUNCA genera un N° nuevo. Si no hay cambios reales (ej. se volvió a guardar
            // solo para imprimir la guía, ver imprimirGuiaDespacho), no se toca historialCambios — así
            // no se ensucia con versiones vacías. Un despacho sin este campo se interpreta como
            // "Versión 1 · creado desde la OC" (ver renderHistorialCambiosHTML).
            if (tipoContador === 'despacho' && despachoAnteriorParaHistorial) {
                const cambiosDetectados = calcularCambiosDespacho(despachoAnteriorParaHistorial, entrada);
                if (cambiosDetectados.length > 0) {
                    const historialPrevio = Array.isArray(despachoAnteriorParaHistorial.historialCambios) ? despachoAnteriorParaHistorial.historialCambios : [];
                    entrada.historialCambios = [...historialPrevio, {
                        version: historialPrevio.length + 2, // v1 es implícita (la creación original, sin entrada propia)
                        fecha: new Date().toISOString(),
                        usuario: usuarioActual?.nombre || usuarioActual?.username || '',
                        cambios: cambiosDetectados
                    }];
                }
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
                            const seguir = await confirmarAccion({
                                titulo: 'Documento modificado por otra persona',
                                mensaje: 'Este documento fue modificado por otra persona (u otro dispositivo) después de que lo cargaste aquí.\n\nSi guardas ahora, tus cambios reemplazarán esa otra edición.',
                                tipo: 'warning',
                                confirmarTexto: 'Guardar de todas formas',
                                destructivo: true
                            });
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
                if (tipoContador === 'orden_compra' && DESCUENTO_KARDEX_POR_OC) {
                    try {
                        const productosActuales = productosEnTabla.map(p => ({ codigo: p.codigo, cantidad: p.cantidad, color: p.color || '' }));
                        const productosAnteriores = esPrimerGuardado ? [] : (registroExistente?.productosDescontados || []);
                        const deltas = calcularDiferenciaProductos(productosAnteriores, productosActuales);

                        if (deltas.length > 0) {
                            // Las salidas quedan anotadas en la columna del DÍA del Kardex (varias OC el mismo día se
                            // suman como términos) y registradas en el historial de movimientos.
                            const resKardex = await registrarSalidasOCKardex(deltas, { referencia: formatearCorrelativo(correlativo), ocObjectId: objectId });
                            if (resKardex.noAplicadas.length) {
                                mostrarNotificacion(`No se pudo ajustar en el Kardex: ${resKardex.noAplicadas.map(n => `${n.item.descripcion || n.item.codigo} (${n.motivo})`).join('; ')}`, 'warning');
                            }
                            if (resKardex.advertenciaMes) mostrarNotificacion(resKardex.advertenciaMes, 'warning');
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
                        mostrarAlerta({
                            titulo: 'Orden guardada, pero el Kardex no se actualizó',
                            mensaje: 'La Orden de Compra sí quedó guardada en la nube, pero no se pudo descontar su stock del Kardex de Dropbox. Revisa el Kardex y ajusta el stock manualmente si hace falta.',
                            tipo: 'error',
                            detalle: eKardex.message
                        });
                    }
                }
            } catch (e) {
                console.error('Error al guardar en historial:', e);
                mostrarNotificacion('No se pudo guardar en la nube: ' + e.message, 'error');
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

        // Descuento automático de stock del Kardex al guardar una Orden de Compra: DESHABILITADO a pedido.
        // Poner en true para reactivarlo (el resto de la lógica sigue intacta en guardarEnHistorial).
        const DESCUENTO_KARDEX_POR_OC = false;

        let usuarioSeleccionadoHistorial = null; // username filtrado dentro de la vista "Ver todas" (master)

        // El historial se divide en 2 apartados fijos — separa las dos etapas del flujo comercial
        // (la consulta vs. la venta confirmada) para que nunca se mezclen en una sola lista larga.
        // Los Despachos ya NO tienen su propio apartado: al estar siempre atados a una OC (mismo N°),
        // se muestran directamente DENTRO de la tarjeta de su Orden de Compra (ver
        // renderTarjetaHistorialHTML) — así se elimina la necesidad de ir a buscarlos aparte.
        let seccionHistorial = 'cotizacion'; // 'cotizacion' | 'orden_compra'
        let filtroTipoHistorial = 'todas'; // 'todas' | 'pendientes' | 'pago_pendiente' | 'sin_guia_shalom' — solo aplica dentro de la sección "orden_compra"

        function cambiarSeccionHistorial(seccion) {
            if (seccionHistorial === seccion) return;
            seccionHistorial = seccion;
            filtroTipoHistorial = 'todas'; // cada apartado arranca limpio de filtros secundarios
            document.querySelectorAll('#historialSeccionesArea .hx-tab').forEach(b => {
                b.setAttribute('aria-selected', b.dataset.seccion === seccion ? 'true' : 'false');
            });
            const filtrosEl = document.getElementById('historialFiltrosArea');
            if (filtrosEl) filtrosEl.innerHTML = renderFiltrosTipoHistorial();
            const input = document.getElementById('historialSearchInput');
            if (input) { input.value = ''; input.placeholder = placeholderBusquedaHistorial(); }
            actualizarClearBtnHistorial();
            pintarResultadosHistorial();
        }

        function placeholderBusquedaHistorial() {
            return seccionHistorial === 'orden_compra'
                ? 'Buscar N° de OC o despacho (000501-B), cliente o destino'
                : 'Buscar N° de cotización, cliente o empresa';
        }

        // Cuenta, sobre TODAS las OC en memoria (no solo las visibles), cuántas caen en cada filtro
        // rápido — para los contadores de los chips. "sin_despacho"/"pago_pendiente" reutilizan
        // exactamente el mismo criterio que aplicará filtrarPorTipoDocumento() más abajo.
        function contarFiltrosOC() {
            const ocs = historialCache.filter(e => e.tipoDocumento === 'orden_compra');
            const idsConDespacho = new Set(
                historialCache.filter(e => e.tipoDocumento === 'despacho' && e.ordenCompraAsociada).map(e => e.ordenCompraAsociada)
            );
            let sinDespacho = 0, pagoPendiente = 0, sinGuia = 0, montoPendiente = 0;
            ocs.forEach(oc => {
                if (!idsConDespacho.has(oc.objectId)) sinDespacho++;
                const estadoPago = calcularEstadoPago(oc);
                if (estadoPago.pendiente) { pagoPendiente++; montoPendiente += estadoPago.saldoPendiente; }
                if (estadoEnvioShalomDeOC(oc).estado === 'sin_guia') sinGuia++;
            });
            return { todas: ocs.length, pendientes: sinDespacho, pago_pendiente: pagoPendiente, sin_guia_shalom: sinGuia, monto_pago_pendiente: montoPendiente };
        }

        // Chips de filtro rápido (mockup-historial.html, referencia visual obligatoria) — solo
        // tienen sentido dentro del apartado "Órdenes de Compra". Son TOGGLES, no una lista con
        // "Todas" aparte: tocar un chip ya activo lo apaga (mismo comportamiento que el mockup:
        // "state.qf = state.qf === v ? null : v"). "Pago pendiente" muestra el MONTO total
        // adeudado (no un conteo) — así lo pide el mockup.
        function renderFiltrosTipoHistorial() {
            if (seccionHistorial !== 'orden_compra') return '';
            const conteos = contarFiltrosOC();
            const filtros = [
                { valor: 'pago_pendiente', etiqueta: 'Pago pendiente', dot: 'var(--warning)', valorMostrado: moneyHx(conteos.monto_pago_pendiente) },
                { valor: 'pendientes', etiqueta: 'Sin despacho', dot: 'var(--gray-500)', valorMostrado: String(conteos.pendientes) },
                { valor: 'sin_guia_shalom', etiqueta: 'Sin guía Shalom', dot: 'var(--gray-400)', valorMostrado: String(conteos.sin_guia_shalom) }
            ];
            return `<div class="hx-chips">
                ${filtros.map(f => `<button type="button" class="hx-chip" aria-pressed="${filtroTipoHistorial === f.valor}" onclick="aplicarFiltroTipoHistorial('${f.valor}')"><span class="dot" style="background:${f.dot}"></span>${escaparHtml(f.etiqueta)} <b>${escaparHtml(f.valorMostrado)}</b></button>`).join('')}
            </div>`;
        }

        function aplicarFiltroTipoHistorial(tipo) {
            filtroTipoHistorial = filtroTipoHistorial === tipo ? 'todas' : tipo;
            const filtrosEl = document.getElementById('historialFiltrosArea');
            if (filtrosEl) filtrosEl.innerHTML = renderFiltrosTipoHistorial();
            pintarResultadosHistorial();
        }

        // Aplica primero el apartado activo (Cotizaciones / Órdenes de Compra) y luego, si corresponde,
        // el chip secundario. "pendientes" (Sin despacho) muestra solo OC activas que NO tengan ningún
        // Despacho activo vinculado todavía. "pago_pendiente" muestra solo OC con saldo por cobrar.
        // "sin_guia_shalom" muestra OC que SÍ tienen despacho pero cuyo envío Shalom todavía no tiene
        // guía+código registrados (ver estadoEnvioShalomDeOC). Los 3 se calculan sobre historialCache
        // completo (no solo sobre la lista que se está mostrando) para que la detección sea siempre
        // correcta, y coinciden exactamente con contarFiltrosOC() de arriba.
        function filtrarPorTipoDocumento(lista) {
            const base = seccionHistorial === 'cotizacion'
                ? lista.filter(e => e.tipoDocumento === 'cotizacion')
                // Además de las OC, se incluyen los Despachos "huérfanos" (guardados sin vincular a
                // ninguna OC) — caso raro pero posible — para que no queden sin ningún lugar donde
                // mostrarse. Los Despachos SÍ vinculados no aparecen aquí como tarjeta propia: se
                // muestran dentro de la tarjeta de su OC.
                : lista.filter(e => e.tipoDocumento === 'orden_compra' || (e.tipoDocumento === 'despacho' && !e.ordenCompraAsociada));

            if (seccionHistorial === 'orden_compra') {
                if (filtroTipoHistorial === 'pendientes') {
                    const idsConDespacho = new Set(
                        historialCache.filter(e => e.tipoDocumento === 'despacho' && e.ordenCompraAsociada).map(e => e.ordenCompraAsociada)
                    );
                    return base.filter(e => e.tipoDocumento === 'orden_compra' && !idsConDespacho.has(e.objectId));
                }
                if (filtroTipoHistorial === 'pago_pendiente') {
                    return base.filter(e => e.tipoDocumento === 'orden_compra' && calcularEstadoPago(e).pendiente);
                }
                if (filtroTipoHistorial === 'sin_guia_shalom') {
                    return base.filter(e => e.tipoDocumento === 'orden_compra' && estadoEnvioShalomDeOC(e).estado === 'sin_guia');
                }
            }
            return base;
        }

        // Índice ocObjectId -> [despachos], para no recorrer TODO historialCache por cada OC. Antes,
        // obtenerDespachosDeOC() hacía un historialCache.filter() completo en cada llamada — con el
        // rediseño de Historial esta función se invoca una vez POR FILA en cada búsqueda/filtro (ver
        // textoBusquedaHistorial, contarFiltrosOC), así que con historiales grandes eso se volvía
        // O(n²) y el buscador llegaba a colgarse (detectado con tests/stress-historial.html, 5.000
        // OC). Se reconstruye solo cuando "historialCache" cambia de referencia — cada recarga real
        // (cargarHistorialDesdeNube) SÍ reasigna esa variable, así que alcanza con comparar por
        // identidad; el único caso que solo EMPUJA resultados sin reasignar (la búsqueda en vivo en
        // la nube, ver renderListaCotizaciones) invalida el índice a mano justo después del push.
        let _indiceDespachosPorOC = null;
        let _indiceDespachosPorOCFuente = null;
        function invalidarIndiceDespachosPorOC() { _indiceDespachosPorOCFuente = null; }
        function obtenerDespachosDeOCIndice() {
            if (_indiceDespachosPorOCFuente !== historialCache) {
                const indice = new Map();
                historialCache.forEach(e => {
                    if (e.tipoDocumento === 'despacho' && e.ordenCompraAsociada) {
                        const lista = indice.get(e.ordenCompraAsociada);
                        if (lista) lista.push(e); else indice.set(e.ordenCompraAsociada, [e]);
                    }
                });
                _indiceDespachosPorOC = indice;
                _indiceDespachosPorOCFuente = historialCache;
            }
            return _indiceDespachosPorOC;
        }

        // Devuelve todos los despachos activos vinculados a una OC puntual (puede haber más de uno:
        // el original y sus sucesivos "B", "C"... si se olvidó despachar algo y se hizo aparte).
        function obtenerDespachosDeOC(ocObjectId) {
            return obtenerDespachosDeOCIndice().get(ocObjectId) || [];
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

        // ============================================
        // REDISEÑO DE HISTORIAL — helpers de texto/HTML
        // ============================================
        // Iconos SVG portados literalmente de mockup-historial.html (referencia visual obligatoria,
        // en la raíz del proyecto) — mismo trazo/tamaño, para que el Historial real se vea igual que
        // la referencia en vez de usar emoji. Son markup fijo, sin datos variables adentro, así que
        // no hace falta escaparlos.
        const HX_ICON = {
            search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
            x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
            wallet: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/></svg>',
            pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
            eye: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
            plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
            truck: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h12v10H2z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
            edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
            print: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>'
        };
        const PASOS_ENVIO_HX = ['En origen', 'En tránsito', 'En destino', 'Entregado'];

        // Mismo formato que money() en mockup-historial.html (con separador de miles). Se usa SOLO
        // en las plantillas de este rediseño (fila de OC/Cotización, chips, panel de despacho); el
        // resto de la app sigue con su "S/ X.XX" de siempre (toFixed), sin separador — no se toca.
        function moneyHx(n) {
            return 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Escapa texto dinámico antes de insertarlo en innerHTML. No existía un escapador genérico
        // en el proyecto — solo escaparAtributo() (js/kardex.js), pensado únicamente para meter texto
        // dentro de un atributo, no para nodos de texto/HTML completos.
        function escaparHtml(texto) {
            return String(texto ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Quita tildes/diacríticos y pasa a minúsculas, para que el buscador del historial ignore
        // mayúsculas y acentos (mismo patrón que normalizarPapeleta() en js/envios/papeleta.js, pero
        // sin duplicar esa función porque vive en otro módulo con otro propósito).
        function normalizarBusquedaHistorial(texto) {
            return String(texto ?? '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '');
        }

        // Arma el texto "buscable" completo de una fila del historial (OC o Cotización): su propio
        // N°, cliente, empresa, y — solo para OC — el N° (con sufijo) de cada despacho vinculado más
        // la ciudad/destino ya conocida por la sucursal de ese despacho. Se recalcula en cada
        // búsqueda (no hay estado que cachear entre tecla y tecla), pero el debounce de ~150ms
        // (onBuscarHistorialInput) evita que se dispare en cada pulsación.
        function textoBusquedaHistorial(entry) {
            const partes = [
                formatearCorrelativo(entry.correlativo, entry.tipoDocumento === 'despacho' ? entry.sufijoDespacho : null),
                entry.correlativo,
                entry.cliente,
                entry.empresaCliente,
                entry.sucursal?.ciudad,
                entry.sucursal?.nombre,
                entry.sucursal?.provincia
            ];
            // Nota de rendimiento: a propósito NO se incluye acá el envío Shalom (estadoEnvioShalomDeOC
            // hace un buscarEnvioPorOC(), que recorre shalomEnviosCache linealmente — bien para una
            // sola tarjeta, pero demasiado si se llama por cada fila en cada tecla del buscador). La
            // "ciudad de destino" que pide la búsqueda ya queda cubierta con la sucursal del despacho,
            // sin ese costo extra.
            if (entry.tipoDocumento === 'orden_compra') {
                obtenerDespachosDeOC(entry.objectId).forEach(d => {
                    partes.push(formatearCorrelativo(d.correlativo, d.sufijoDespacho));
                    if (d.sucursal) partes.push(d.sucursal.ciudad, d.sucursal.nombre, d.sucursal.provincia);
                });
            }
            return normalizarBusquedaHistorial(partes.filter(Boolean).join(' '));
        }

        // Resuelve, para una OC puntual, en cuál de los 3 estados de envío está (sin usar ningún
        // campo nuevo — se apoya solo en obtenerDespachosDeOC() y en buscarEnvioPorOC(), ya
        // existentes en js/envios/shalom.js, que este archivo no modifica):
        //   'sin_despacho' → todavía no se generó ningún despacho para esta OC.
        //   'sin_guia'     → ya hay despacho, pero nadie registró la guía en Seguimiento Shalom
        //                    (o es un envío tipo "lima", que no usa guía/código de Shalom).
        //   'con_guia'     → hay despacho Y un envío Shalom registrado con guía+código (o es tipo
        //                    "lima", que no los necesita).
        function estadoEnvioShalomDeOC(entry) {
            const despachos = obtenerDespachosDeOC(entry.objectId);
            if (despachos.length === 0) return { estado: 'sin_despacho', despachos, envio: null };
            const envio = (typeof buscarEnvioPorOC === 'function')
                ? buscarEnvioPorOC(formatearCorrelativo(entry.correlativo, null), entry.objectId)
                : null;
            const registrado = envio && (envio.tipo === 'lima' || (envio.guia && envio.codigo));
            if (!registrado) return { estado: 'sin_guia', despachos, envio: null };
            return { estado: 'con_guia', despachos, envio };
        }

        // Determina el paso 1-4 de un envío para los dos visuales de progreso del rediseño (mini
        // barra en la fila de OC, stepper grande en el panel de despacho). Reutiliza
        // determinarPasoActual() (js/envios/papeleta.js) sin tocar ese archivo; para envíos tipo
        // "lima" (sin guía/código de Shalom, no le aplica esa lógica) usa el mismo criterio simple
        // que ya tenía este rediseño: entregado → paso 4, si no, 1.
        function pasoEnvioHX(envio) {
            if (envio.tipo === 'lima' || typeof determinarPasoActual !== 'function') {
                return envio.estado === 'entregado' ? 4 : 1;
            }
            return determinarPasoActual(envio);
        }

        // Mini barra de 4 pilas (".hx-mini-steps" del mockup) — la que va en el bloque "Destino
        // Shalom" de la fila de OC, junto al texto "Ciudad · Etapa" (ver renderDestinoShalomHTML).
        function renderMiniPasosHX(paso) {
            const colorListo = paso === 4 ? 'var(--success)' : 'var(--secondary)';
            return `<div class="hx-mini-steps" role="img" aria-label="Envío: paso ${paso} de 4 — ${escaparHtml(PASOS_ENVIO_HX[paso - 1] || '')}">
                ${[1, 2, 3, 4].map(n => `<i style="${n <= paso ? 'background:' + colorListo : ''}"></i>`).join('')}
            </div>`;
        }

        // Stepper grande (".hx-steps" del mockup) — el que va dentro del panel de despacho, con
        // círculos numerados/✓ conectados por una línea y las 4 etiquetas debajo.
        function renderStepsHX(paso) {
            return `<div class="hx-steps">
                ${PASOS_ENVIO_HX.map((etiqueta, i) => {
                    const n = i + 1;
                    const done = n < paso || (n === 4 && paso === 4);
                    const cur = n === paso && paso < 4;
                    const clases = [done ? 'done' : cur ? 'cur' : '', n === paso ? 'now' : ''].filter(Boolean).join(' ');
                    const linea = i > 0 ? `<div class="ln ${n <= paso ? 'on' : ''}"></div>` : '';
                    return `${linea}<div class="st ${clases}"><span class="dt">${done ? '✓' : n}</span><span>${escaparHtml(etiqueta)}</span></div>`;
                }).join('')}
            </div>`;
        }

        // Actualiza los contadores de cada pestaña del selector de apartados (📋 Cotizaciones /
        // 📦 Órdenes de Compra), para que se pueda ver de un vistazo cuánto hay en cada uno sin
        // tener que entrar. Cuenta lo mismo que filtrarPorTipoDocumento() mostraría con el chip
        // "Todas" activo (las OC incluyen los despachos huérfanos, ver esa función).
        function actualizarContadoresSeccion() {
            const totalCot = historialCache.filter(e => e.tipoDocumento === 'cotizacion').length;
            const totalOC = historialCache.filter(e => e.tipoDocumento === 'orden_compra' || (e.tipoDocumento === 'despacho' && !e.ordenCompraAsociada)).length;
            const elCot = document.getElementById('historialCountCotizaciones');
            const elOC = document.getElementById('historialCountOrdenes');
            if (elCot) elCot.textContent = totalCot;
            if (elOC) elOC.textContent = totalOC;
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
            actualizarContadoresSeccion();

            // Estructura fija: el input de búsqueda se crea UNA sola vez aquí y nunca se vuelve a
            // recrear al escribir (si se recreara en cada tecla, el cursor perdería el foco).
            // Solo el contenido de #historialResultsArea se redibuja en cada búsqueda. Estructura
            // ".hx-toolbar"/".hx-search" 1:1 con mockup-historial.html (buscador + chips en la misma
            // fila en escritorio).
            const placeholder = placeholderBusquedaHistorial();

            listEl.innerHTML = `
                <div class="hx-toolbar">
                    <label class="hx-search">${HX_ICON.search}
                        <input type="text" id="historialSearchInput" placeholder="${escaparHtml(placeholder)}" oninput="onBuscarHistorialInput()">
                        <button type="button" class="hx-clear" id="historialSearchClear" style="display:none;" onclick="limpiarBusquedaHistorial()" aria-label="Borrar búsqueda">${HX_ICON.x}</button>
                    </label>
                    <div id="historialFiltrosArea">${renderFiltrosTipoHistorial()}</div>
                </div>
                <div id="historialResultsArea"></div>
            `;

            pintarResultadosHistorial();
        }

        // Muestra/oculta el botón "×" del buscador según si tiene texto — igual que
        // "${state.q ? clear-button : ''}" en el mockup.
        function actualizarClearBtnHistorial() {
            const input = document.getElementById('historialSearchInput');
            const btn = document.getElementById('historialSearchClear');
            if (input && btn) btn.style.display = input.value ? 'flex' : 'none';
        }

        function limpiarBusquedaHistorial() {
            const input = document.getElementById('historialSearchInput');
            if (input) { input.value = ''; input.focus(); }
            actualizarClearBtnHistorial();
            pintarResultadosHistorial();
        }

        // Debounce (~150ms) del buscador único del historial: mientras el usuario sigue tecleando no
        // se vuelve a filtrar/pintar en cada letra (con miles de filas eso sí se nota), solo cuando se
        // queda quieto un instante. pintarResultadosHistorial() siempre relee el valor actual del
        // input, así que retrasar la LLAMADA es suficiente — no hace falta pasar el texto a mano.
        let historialBusquedaDebounceTimer = null;
        function onBuscarHistorialInput() {
            actualizarClearBtnHistorial();
            clearTimeout(historialBusquedaDebounceTimer);
            historialBusquedaDebounceTimer = setTimeout(pintarResultadosHistorial, 150);
        }

        // Filtra por N° de OC, N° de despacho (con o sin sufijo, ej. "000501-B" o solo "501"),
        // cliente, empresa, teléfono, vendedor o ciudad/destino (sucursal del despacho, o el
        // "destino" del envío Shalom si ya está registrado) — ver textoBusquedaHistorial(). Ignora
        // mayúsculas y tildes en ambos lados de la comparación.
        // Fecha del documento como dd/mm/aa y dd/mm/aaaa (hora local), para buscar escribiéndola.
        function fechasTextoEntry(entry) {
            const f = new Date(entry.createdAt);
            if (isNaN(f)) return [];
            const dd = String(f.getDate()).padStart(2, '0'), mm = String(f.getMonth() + 1).padStart(2, '0');
            const aaaa = String(f.getFullYear());
            return [`${dd}/${mm}/${aaaa.slice(2)}`, `${dd}/${mm}/${aaaa}`];
        }

        function filtrarCotizaciones(lista, filtroNormalizado) {
            if (!filtroNormalizado) return lista;
            const esFecha = /^\d{1,2}\/(\d{1,2}(\/\d{0,4})?)?$/.test(filtroNormalizado);
            // "5/10/26" -> "05/10/26" para que calce con el formato dd/mm/aa
            const filtroFecha = esFecha ? filtroNormalizado.replace(/\b(\d)(?=\/)/g, '0$1') : '';
            return lista.filter(entry => {
                if (esFecha && fechasTextoEntry(entry).some(t => t.includes(filtroFecha))) return true;
                const telefonoNorm = normalizarBusquedaHistorial(entry.telefono || '');
                const vendedorNorm = normalizarBusquedaHistorial(entry.usuarioNombre || '');
                return (
                    textoBusquedaHistorial(entry).includes(filtroNormalizado) ||
                    telefonoNorm.includes(filtroNormalizado) ||
                    vendedorNorm.includes(filtroNormalizado)
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
                // Fecha completa dd/mm/aa o dd/mm/aaaa: se busca por el día de creación.
                const mf = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
                if (mf) {
                    const anio = mf[3].length === 2 ? 2000 + parseInt(mf[3], 10) : parseInt(mf[3], 10);
                    const ini = new Date(anio, parseInt(mf[2], 10) - 1, parseInt(mf[1], 10));
                    const fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 1);
                    if (!isNaN(ini)) condiciones.push({ createdAt: { $gte: { __type: 'Date', iso: ini.toISOString() }, $lt: { __type: 'Date', iso: fin.toISOString() } } });
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
            const filtro = (document.getElementById('historialSearchInput')?.value || '').trim();

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
        // ============================================
        // PAGINACIÓN REAL DEL HISTORIAL
        // ============================================
        // ANTES: renderListaCotizaciones() armaba el HTML de TODAS las filas que calzaban con el
        // filtro (hasta miles), y un script aparte en index.html las escondía con display:none
        // dejando ver solo 10 — el costo de construir/parsear esas filas de más ya estaba pagado
        // igual (ver tests/stress-historial.html, check 1: 5.000 OC tardaban ~1.1s en vez de <500ms).
        // AHORA: se corta ANTES de construir el HTML — solo se arma la página actual. El script de
        // index.html ya no observa el DOM ni esconde nada: dibujarPaginadorHistorial() solo dibuja
        // los botones "‹ Anterior / Siguiente ›" que llaman de vuelta a irAPaginaHistorial().
        const HISTORIAL_PAGINA_TAM = 10;
        let paginaHistorialActual = 1;
        let historialPaginacionEstado = null; // { items, container, renderItem, encabezadoHTML }

        // Punto único de entrada: guarda QUÉ hay que paginar (la lista ya filtrada, dónde pintarla y
        // cómo convertir cada elemento en HTML) y dibuja la página 1. Lo usan renderListaCotizaciones()
        // (filas de Cotización/OC), su rama de búsqueda en la nube, y renderUsuariosHistorial() (la
        // vista agrupada por usuario del master) — los 3 lugares que antes armaban un
        // `<div class="historial-list">...</div>` con todo de una vez.
        function iniciarPaginacionHistorial(container, items, renderItem, encabezadoHTML) {
            historialPaginacionEstado = { items, container, renderItem, encabezadoHTML: encabezadoHTML || '' };
            paginaHistorialActual = 1;
            pintarPaginaHistorial();
        }

        // Redibuja SOLO la página actual a partir del último estado guardado — no vuelve a filtrar
        // ni a tocar la red, así que cambiar de página es prácticamente instantáneo sin importar
        // cuántos resultados haya en total.
        function pintarPaginaHistorial() {
            const estado = historialPaginacionEstado;
            if (!estado) return;
            const totalPaginas = Math.max(1, Math.ceil(estado.items.length / HISTORIAL_PAGINA_TAM));
            if (paginaHistorialActual > totalPaginas) paginaHistorialActual = totalPaginas;
            if (paginaHistorialActual < 1) paginaHistorialActual = 1;
            const desde = (paginaHistorialActual - 1) * HISTORIAL_PAGINA_TAM;
            const itemsDeEstaPagina = estado.items.slice(desde, desde + HISTORIAL_PAGINA_TAM);

            estado.container.innerHTML = `${estado.encabezadoHTML}<div class="historial-list">${itemsDeEstaPagina.map(estado.renderItem).join('')}</div>`;

            // dibujarPaginadorHistorial() vive en index.html (dibuja los botones reutilizando las
            // mismas clases .historial-paginador/.historial-pagina-btn de siempre). Se protege con
            // typeof porque tests/stress-historial.html carga js/cotizacion.js solo, sin ese script.
            if (typeof dibujarPaginadorHistorial === 'function') {
                const listaEl = estado.container.querySelector('.historial-list');
                dibujarPaginadorHistorial(listaEl, paginaHistorialActual, totalPaginas);
            }
        }

        // Llamado por los botones "‹ Anterior/Siguiente ›" (ver dibujarPaginadorHistorial en
        // index.html).
        function irAPaginaHistorial(numero) {
            if (!historialPaginacionEstado) return;
            paginaHistorialActual = numero;
            pintarPaginaHistorial();
            const listaEl = historialPaginacionEstado.container.querySelector('.historial-list');
            if (listaEl) listaEl.scrollIntoView({ block: 'nearest' });
        }

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

            const encabezado = `<div style="margin-bottom:12px;color:var(--gray-500);font-size:0.85em;">Selecciona un usuario para ver sus cotizaciones, o escribe arriba para buscar en todas a la vez</div>`;
            iniciarPaginacionHistorial(container, usuarios, u => {
                const fecha = new Date(u.ultimaFecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
                return `
                        <div class="historial-card historial-card-clickable" onclick="verHistorialDeUsuario('${u.usuario}')">
                            <p class="historial-card-title">${escaparHtml(u.nombre)}</p>
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
            }, encabezado);
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
        // Una Cotización "vence" a los 7 días — mismo criterio que ya usa prepararCotizacion() para
        // el badge impreso "Válido 7 días" (js/cotizacion.js, printValidezBadge). Es puramente
        // calculado a partir de createdAt: no hace falta ningún campo nuevo en Back4App.
        const DIAS_VALIDEZ_COTIZACION = 7;
        function cotizacionVencida(entry) {
            const limite = new Date(entry.createdAt).getTime() + DIAS_VALIDEZ_COTIZACION * 24 * 60 * 60 * 1000;
            return Date.now() > limite;
        }

        // Línea gris de contexto (vendedor / "editado por otro") — no está en el mockup (esa vista
        // no modela el modo master de varios vendedores), pero sigue haciendo falta en la app real;
        // se agrega como línea suelta bajo el nombre del cliente, sin romper la estructura del mockup.
        function renderInfoSecundariaHTML(entry, mostrarVendedorPorTarjeta) {
            const editadoPorOtro = entry.ultimaEdicionPor && entry.usuario && entry.ultimaEdicionPor !== entry.usuario;
            const texto = [
                mostrarVendedorPorTarjeta ? `Vendedor: ${entry.usuarioNombre || entry.usuario || 'Desconocido'}` : '',
                editadoPorOtro ? `Editado por ${entry.ultimaEdicionPorNombre || entry.ultimaEdicionPor}` : ''
            ].filter(Boolean).join(' · ');
            return texto ? `<div class="historial-card-info-secundaria">${escaparHtml(texto)}</div>` : '';
        }

        // Contenido del bloque "Pago" (".hx-info" del mockup) — el ícono/label van fijos, el texto y
        // la barra según calcularEstadoPago(). Se calcula 100% con lo que la OC YA guarda
        // (montoAdelanto/total), sin agregar ningún módulo de abonos nuevo. Dos estados, como pide
        // el punto de "Reglas de datos": "Pagado completo" o "Falta S/ X" — el mockup usa un tercer
        // color (rojo) para "sin ningún adelanto registrado", pero esta app ya tenía la regla de
        // negocio de tratar "sin adelanto" como pagada (calcularEstadoPago), así que no se agrega
        // ese tercer estado.
        function renderInfoPagoHX(estadoPago) {
            const color = estadoPago.pendiente ? 'var(--chip-warning-text)' : 'var(--chip-success-text)';
            const barColor = estadoPago.pendiente ? 'var(--warning)' : 'var(--success)';
            const texto = estadoPago.pendiente ? `Falta ${moneyHx(estadoPago.saldoPendiente)}` : 'Pagado completo';
            const pct = estadoPago.total > 0 ? Math.min(100, Math.max(0, (estadoPago.adelanto / estadoPago.total) * 100)) : 100;
            return `${HX_ICON.wallet}
                <div class="hx-info-txt"><div class="hx-info-lbl">Pago</div><div class="hx-info-val" style="color:${color}">${escaparHtml(texto)}</div></div>
                <div class="hx-bar"><i style="width:${pct.toFixed(0)}%;background:${barColor}"></i></div>`;
        }

        // Contenido del bloque "Destino Shalom" (".hx-info" del mockup) — los 3 estados que pide el
        // rediseño, usando solo datos que YA existen (sucursal del despacho, o el envío Shalom
        // vinculado). No agrega ningún campo/input nuevo: ver estadoEnvioShalomDeOC().
        function renderInfoDestinoHX(entry) {
            const info = estadoEnvioShalomDeOC(entry);
            let destTxt, destColor, barsHTML = '';
            if (info.estado === 'sin_despacho') {
                destTxt = 'Sin despacho aún'; destColor = 'var(--gray-500)';
            } else if (info.estado === 'sin_guia') {
                destTxt = info.despachos[0]?.sucursal?.ciudad || 'Sin sucursal Shalom asignada';
                destColor = 'var(--primary)';
            } else {
                const paso = pasoEnvioHX(info.envio);
                const ciudad = info.envio.destino || info.despachos[0]?.sucursal?.ciudad || 'Destino registrado';
                destTxt = `${ciudad} · ${PASOS_ENVIO_HX[paso - 1]}`;
                destColor = ['var(--gray-700)', 'var(--chip-info-text)', 'var(--chip-warning-text)', 'var(--chip-success-text)'][paso - 1];
                barsHTML = renderMiniPasosHX(paso);
            }
            return `${HX_ICON.pin}
                <div class="hx-info-txt"><div class="hx-info-lbl">Destino Shalom</div><div class="hx-info-val" style="color:${destColor}">${escaparHtml(destTxt)}</div></div>
                ${barsHTML}`;
        }

        // Punto de entrada: reparte cada fila del historial según su tipo real (ignorando el sufijo
        // "_prueba" del Modo Desarrollador solo para decidir la plantilla — el dato en sí no se toca).
        // Los despachos "huérfanos" (sin OC vinculada) y CUALQUIER documento "_prueba" usan la fila
        // genérica simple (fuera del alcance de mockup-historial.html): no tiene sentido armarles el
        // panel de despacho/barra de pago de una OC real, y así se evita que un documento de prueba
        // quede invisible (antes de este rediseño ya aparecía como fila suelta con su propia
        // etiqueta "🧪…(PRUEBA)"; con el filtro por apartado de dos secciones, un tipoDocumento como
        // "cotizacion_prueba" no calzaba con ningún apartado y desaparecía del todo — se corrige acá,
        // sin tocar guardarEnHistorial() ni el propio dato).
        function renderTarjetaHistorialHTML(entry, mostrarVendedorPorTarjeta) {
            const tipoBase = String(entry.tipoDocumento || '').replace(/_prueba$/, '');
            if (tipoBase === 'cotizacion') return renderFilaCotizacionHTML(entry, mostrarVendedorPorTarjeta);
            if (tipoBase === 'orden_compra') return renderFilaOrdenCompraHTML(entry, mostrarVendedorPorTarjeta);
            return renderFilaGenericaHTML(entry, mostrarVendedorPorTarjeta);
        }

        // Fila de Cotización — ".hx-cot-card" del mockup: N°/cliente, total, estado
        // (Abierta/Vencida) y sus botones actuales (Ver, Cargar, Convertir en OC — ya existía como
        // "Crear Orden de Compra"). El mockup también muestra "Pasó a OC N° X"; se deja fuera a
        // pedido (no hay campo de vínculo Cotización→OC — ver conversación previa).
        function renderFilaCotizacionHTML(entry, mostrarVendedorPorTarjeta) {
            const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
            const correlativoTexto = formatearCorrelativo(entry.correlativo, null);
            const vencida = cotizacionVencida(entry);
            const estadoHTML = vencida
                ? `<span class="hx-status-chip hx-status-chip--bad">Vencida</span>`
                : `<span class="hx-status-chip hx-status-chip--neu">Abierta</span>`;
            const validezTexto = vencida ? '' : `Vence en ${Math.max(0, DIAS_VALIDEZ_COTIZACION - Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / 86400000))} día(s)`;

            return `
                <article class="hx-cot-card">
                    <div class="hx-oc-main">
                        <div class="hx-oc-num"><span class="hx-tag hx-tag-cot">COT</span><strong class="num">${escaparHtml(correlativoTexto)}</strong></div>
                        <div class="hx-oc-cliente">${escaparHtml(entry.cliente)}</div>
                        <div class="hx-oc-sub">${escaparHtml(entry.empresaCliente || 'Cliente particular')} · ${escaparHtml(fecha)}</div>
                        ${renderInfoSecundariaHTML(entry, mostrarVendedorPorTarjeta)}
                    </div>
                    <div class="hx-oc-total num">${moneyHx(entry.total)}</div>
                    <div class="hx-cot-estado">${estadoHTML}<span class="num" style="color:${vencida ? 'var(--chip-danger-text)' : 'var(--gray-600)'}">${escaparHtml(validezTexto)}</span></div>
                    <div class="hx-cot-actions">
                        <button class="hx-btn hx-btn-outline" onclick="verCotizacionDesdeHistorial('${entry.objectId}')">Ver</button>
                        <button class="hx-btn hx-btn-outline hx-only-web" onclick="cargarDesdeHistorial('${entry.objectId}')">Cargar</button>
                        <button class="hx-btn hx-btn-crear" style="border-style:solid;border-color:transparent" onclick="crearOCDesdeCotizacion('${entry.objectId}')">Convertir en OC</button>
                    </div>
                </article>`;
        }

        // Fila de Orden de Compra — ".hx-oc-card"/".hx-oc-row" del mockup: el corazón de este
        // rediseño. Todo lo que antes obligaba a cambiar de filtro o de pestaña (pago pendiente,
        // despacho, guía Shalom) queda visible y accionable en la misma fila.
        function renderFilaOrdenCompraHTML(entry, mostrarVendedorPorTarjeta) {
            const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
            const correlativoTexto = formatearCorrelativo(entry.correlativo, null);
            const estadoPago = calcularEstadoPago(entry);
            const despachosDeEstaOC = obtenerDespachosDeOC(entry.objectId);
            const tieneDespacho = despachosDeEstaOC.length > 0;
            const despSub = tieneDespacho
                ? (despachosDeEstaOC.length > 1 ? `· ${despachosDeEstaOC.length} envíos` : formatearCorrelativo(despachosDeEstaOC[0].correlativo, despachosDeEstaOC[0].sufijoDespacho))
                : '';
            const despBtn = tieneDespacho
                ? `<button class="hx-btn hx-btn-desp" aria-expanded="false" aria-controls="despachoPanel-${entry.objectId}" onclick="toggleDespachoPanel('${entry.objectId}')">${HX_ICON.truck}<span class="t"><b>Ver / editar</b><span class="num">Despacho ${escaparHtml(despSub)}</span></span></button>`
                : `<button class="hx-btn hx-btn-crear" onclick="crearDespachoDesdeOC('${entry.objectId}')">${HX_ICON.plus}Crear despacho</button>`;

            return `
                <article class="hx-oc-card" data-oc-id="${entry.objectId}">
                    <div class="hx-oc-row">
                        <div class="hx-oc-head">
                            <div class="hx-oc-main">
                                <div class="hx-oc-num"><span class="hx-tag hx-tag-oc">OC</span><strong class="num">${escaparHtml(correlativoTexto)}</strong></div>
                                <div class="hx-oc-cliente">${escaparHtml(entry.cliente)}</div>
                                <div class="hx-oc-sub">${escaparHtml(entry.empresaCliente || 'Cliente particular')} · ${escaparHtml(fecha)}</div>
                                ${renderInfoSecundariaHTML(entry, mostrarVendedorPorTarjeta)}
                            </div>
                            <div class="hx-oc-total num">${moneyHx(entry.total)}</div>
                        </div>
                        <div class="hx-oc-info">
                            <button type="button" class="hx-info hx-info-btn" onclick="abrirModalActualizarPago('${entry.objectId}')" title="Adelanto: ${moneyHx(estadoPago.adelanto)} de ${moneyHx(estadoPago.total)} — clic para actualizar">${renderInfoPagoHX(estadoPago)}</button>
                            <div class="hx-info">${renderInfoDestinoHX(entry)}</div>
                        </div>
                        <div class="hx-oc-actions">
                            <button class="hx-btn hx-btn-outline" onclick="verCotizacionDesdeHistorial('${entry.objectId}')">${HX_ICON.eye}Ver OC</button>
                            <button class="hx-btn hx-btn-outline" onclick="cargarDesdeHistorial('${entry.objectId}')" title="Cargar la OC en Cotizar para editarla (mantiene su mismo N°)">${HX_ICON.edit}Editar</button>
                            ${despBtn}
                        </div>
                    </div>
                    ${tieneDespacho ? `<div class="hx-desp" id="despachoPanel-${entry.objectId}" hidden></div>` : ''}
                </article>`;
        }

        // Fila genérica simple — despachos huérfanos (sin OC vinculada) y documentos "_prueba" del
        // Modo Desarrollador. Fuera del alcance de mockup-historial.html (esa referencia no cubre
        // este caso): reutiliza el estilo de tarjeta suelta de siempre (.historial-card-*), no el
        // ".hx-*" del mockup — sin panel ni barra de pago, son casos fuera del flujo normal de una OC.
        function renderFilaGenericaHTML(entry, mostrarVendedorPorTarjeta) {
            const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
            const numProductos = (entry.productos || []).length;
            const totalUnid = (entry.productos || []).reduce((a, p) => a + (parseFloat(p.cantidad) || 0), 0);
            const etiquetaTipoDoc = {
                orden_compra_prueba: '🧪📦 Orden de compra (PRUEBA)',
                despacho_prueba:     '🧪🚚 Despacho (PRUEBA)',
                cotizacion_prueba:   '🧪📋 Cotización (PRUEBA)',
                despacho:            '🚚 Despacho (sin OC vinculada)'
            }[entry.tipoDocumento] || '📋 Documento';
            const correlativoTexto = formatearCorrelativo(entry.correlativo, String(entry.tipoDocumento).startsWith('despacho') ? entry.sufijoDespacho : null);

            return `
                <div class="historial-card hx-generica-row">
                    <div>
                        <div class="historial-card-top">
                            <span class="historial-card-doctype">${escaparHtml(etiquetaTipoDoc)}</span>
                            <span class="historial-card-correlativo">${escaparHtml(correlativoTexto)}</span>
                        </div>
                        <p class="historial-card-title">${escaparHtml(entry.cliente)}</p>
                        ${entry.empresaCliente ? `<p class="historial-card-subtitle">${escaparHtml(entry.empresaCliente)}</p>` : ''}
                        <div class="historial-card-meta">
                            <span>${escaparHtml(fecha)}</span>
                            <span>${numProductos} producto${numProductos!==1?'s':''} · ${totalUnid} unid.</span>
                        </div>
                        ${renderInfoSecundariaHTML(entry, mostrarVendedorPorTarjeta)}
                    </div>
                    <div class="hx-generica-lateral">
                        <div class="historial-card-total">S/ ${entry.total.toFixed(2)}</div>
                        <div class="historial-card-actions">
                            <button class="btn-historial-ver" onclick="verCotizacionDesdeHistorial('${entry.objectId}')">Ver</button>
                            <button class="btn-historial-load" onclick="cargarDesdeHistorial('${entry.objectId}')">Cargar</button>
                            <button class="btn-historial-del" onclick="eliminarDeHistorial('${entry.objectId}')" aria-label="Eliminar">🗑️</button>
                        </div>
                    </div>
                </div>`;
        }

        // Contador de "carrera": cada búsqueda en la nube dispara una petición asíncrona; si el
        // usuario sigue escribiendo, un resultado viejo que llega tarde NO debe pisar la pantalla con
        // datos de una búsqueda anterior ya abandonada.
        let tokenBusquedaNube = 0;

        function renderListaCotizaciones(container, listaCompleta, mostrandoTodas, filtro) {
            // "filtro" llega tal cual lo escribió el usuario (para mostrarlo de vuelta y para
            // buscarEnNubePorFiltro, que arma su propio $regex contra el servidor); el filtrado local
            // usa la versión normalizada (sin tildes, en minúsculas) para que "PERU" == "Perú".
            const filtroNormalizado = normalizarBusquedaHistorial(filtro || '');
            const filtroEscapado = escaparHtml(filtro || '');
            const lista = filtrarCotizaciones(listaCompleta, filtroNormalizado);
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

            const etiquetaSeccionVacia = seccionHistorial === 'cotizacion' ? 'cotizaciones' : 'Órdenes de Compra';

            if (lista.length === 0) {
                historialPaginacionEstado = null; // no queda ninguna página vigente que redibujar
                if (!filtro) {
                    container.innerHTML = `${encabezado}<div class="historial-empty">No hay ${etiquetaSeccionVacia} visibles en este apartado.</div>`;
                    return;
                }
                // FIX: antes, si no aparecía nada en los últimos 200 registros cargados, se mostraba
                // directo "sin resultados" — aunque el documento SÍ existiera en la base de datos
                // (por ejemplo, un correlativo viejo). Ahora se fuerza una búsqueda en vivo contra
                // toda la base antes de darlo por perdido.
                container.innerHTML = `${encabezado}<div class="historial-empty">🔎 Buscando "${filtroEscapado}" en toda la base de datos...</div>`;
                buscarEnNubePorFiltro(filtro).then(encontradosCrudo => {
                    if (miToken !== tokenBusquedaNube) return; // el usuario ya cambió la búsqueda; este resultado quedó viejo
                    // Se agregan al caché local (sin duplicar) para que "Ver", "Cargar" y "Eliminar"
                    // funcionen igual que con cualquier otro resultado del historial, y para que
                    // filtrarPorTipoDocumento() pueda resolver correctamente los vínculos OC↔Despacho.
                    encontradosCrudo.forEach(e => {
                        if (!historialCache.some(h => h.objectId === e.objectId)) historialCache.push(e);
                    });
                    // historialCache.push() no reasigna la variable — invalida a mano el índice de
                    // obtenerDespachosDeOC() (ver más arriba), que solo se reconstruye cuando detecta
                    // un cambio de REFERENCIA.
                    invalidarIndiceDespachosPorOC();
                    // La búsqueda en la nube no distingue apartado: se filtra aquí para que un
                    // resultado de Orden de Compra no aparezca mientras se busca en "Cotizaciones" (y
                    // viceversa) — mantiene la separación de los 2 apartados también en este camino.
                    const encontrados = filtrarPorTipoDocumento(encontradosCrudo);
                    if (encontrados.length === 0) {
                        container.innerHTML = `${encabezado}<div class="historial-empty">Sin resultados para "${filtroEscapado}" en ${etiquetaSeccionVacia} — se buscó también en toda la base de datos, no solo en los últimos 200 registros.</div>`;
                        return;
                    }
                    const notaNube = `<div style="font-size:0.8em;color:#744210;background:#fefcbf;padding:6px 10px;border-radius:6px;margin-bottom:10px;">🔎 Encontrado buscando en toda la base de datos (no estaba entre los últimos 200 registros recientes)</div>`;
                    iniciarPaginacionHistorial(container, encontrados, e => renderTarjetaHistorialHTML(e, mostrarVendedorPorTarjeta), encabezado + notaNube);
                });
                return;
            }

            iniciarPaginacionHistorial(container, lista, entry => renderTarjetaHistorialHTML(entry, mostrarVendedorPorTarjeta), encabezado);
        }

        function toggleVerTodasCotizaciones() {
            verTodasLasCotizaciones = !verTodasLasCotizaciones;
            usuarioSeleccionadoHistorial = null; // siempre arranca en la lista de usuarios al alternar
            renderHistorial();
        }

        async function cargarDesdeHistorial(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            if (!entry) return;
            if (!await confirmarAccion({
                titulo: 'Cargar cotización',
                mensaje: `¿Cargar la cotización de "${entry.cliente}"? Se reemplazará la cotización actual.`,
                confirmarTexto: 'Cargar'
            })) return;
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
            if (!await confirmarAccion({
                titulo: despachoExistente ? 'Actualizar despacho' : 'Crear despacho',
                mensaje: mensajeConfirm,
                confirmarTexto: despachoExistente ? 'Actualizar' : 'Crear despacho'
            })) return;

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

        // ============================================
        // PANEL "VER / EDITAR DESPACHO" — inline dentro de la tarjeta de OC (sin modal)
        // ============================================
        // Qué pestaña de despacho está activa por cada OC (ocObjectId -> despachoObjectId), para que
        // no se pierda la selección al reabrir el panel.
        let despachoPanelTabActiva = {};

        // Abre/cierra el panel de una OC. Construye su contenido recién al abrir (no en cada render
        // de la lista) y lo VACÍA al cerrar — con miles de filas en pantalla, mantener 5000 paneles
        // armados en el DOM (aunque estén "hidden") sería el desperdicio de memoria/tiempo que el
        // test de estrés justamente vigila (punto 6: abrir/cerrar 500 veces sin dejar nada colgado).
        function toggleDespachoPanel(ocObjectId) {
            const panel = document.getElementById(`despachoPanel-${ocObjectId}`);
            if (!panel) return;
            const card = document.querySelector(`.hx-oc-card[data-oc-id="${CSS.escape(ocObjectId)}"]`);
            const btn = card ? card.querySelector('.hx-btn-desp') : null;

            if (!panel.hidden) {
                panel.hidden = true;
                panel.innerHTML = '';
                if (card) card.classList.remove('is-open');
                if (btn) { btn.setAttribute('aria-expanded', 'false'); actualizarTextoBtnDespHX(btn, false); }
                return;
            }

            const oc = historialCache.find(e => e.objectId === ocObjectId);
            const despachos = obtenerDespachosDeOC(ocObjectId);
            if (!oc || despachos.length === 0) return;
            if (!despachoPanelTabActiva[ocObjectId] || !despachos.some(d => d.objectId === despachoPanelTabActiva[ocObjectId])) {
                despachoPanelTabActiva[ocObjectId] = despachos[0].objectId; // el más reciente por defecto
            }
            panel.innerHTML = renderDespachoPanelContenidoHTML(oc, despachos);
            panel.hidden = false;
            if (card) card.classList.add('is-open');
            if (btn) { btn.setAttribute('aria-expanded', 'true'); actualizarTextoBtnDespHX(btn, true); }
        }

        // Swap de texto "Ver / editar" ↔ "Ocultar despacho" del botón (mismo comportamiento que
        // state.open en el mockup) sin reconstruir toda la fila — solo el <b> interno.
        function actualizarTextoBtnDespHX(btn, abierto) {
            const bEl = btn.querySelector('.t b');
            if (bEl) bEl.textContent = abierto ? 'Ocultar despacho' : 'Ver / editar';
        }

        // Cambia de pestaña sin cerrar el panel — solo redibuja su contenido interno.
        function seleccionarTabDespacho(ocObjectId, despachoObjectId) {
            despachoPanelTabActiva[ocObjectId] = despachoObjectId;
            const panel = document.getElementById(`despachoPanel-${ocObjectId}`);
            const oc = historialCache.find(e => e.objectId === ocObjectId);
            const despachos = obtenerDespachosDeOC(ocObjectId);
            if (!panel || !oc || despachos.length === 0) return;
            panel.innerHTML = renderDespachoPanelContenidoHTML(oc, despachos);
        }

        function formatearFechaHistorialCambios(iso) {
            if (!iso) return '';
            return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        // Punto 6 del rediseño: un despacho sin historialCambios (todos los guardados desde antes de
        // este cambio, campo opcional y aditivo) se muestra como "Versión 1 · creado desde la OC".
        // Estructura de línea de tiempo del mockup (.hx-tl-item/.hx-tl-rail/.hx-tl-body): más nueva
        // primero, con la más reciente resaltada ("last" — mismo nombre de clase que usa el mockup).
        function renderHistorialCambiosHTML(despacho) {
            const guardados = Array.isArray(despacho.historialCambios) ? despacho.historialCambios : [];
            const todos = [
                { titulo: 'Versión 1 · creado desde la OC', fecha: despacho.createdAt, usuario: '', cambios: [] },
                ...guardados.map(c => ({
                    titulo: `Versión ${c.version} · corrección`,
                    fecha: c.fecha,
                    usuario: c.usuario || '',
                    cambios: Array.isArray(c.cambios) ? c.cambios : []
                }))
            ];
            const paraMostrar = [...todos].reverse(); // más nueva primero
            return paraMostrar.map((h, i) => `
                <div class="hx-tl-item ${i === 0 ? 'last' : ''}">
                    <div class="hx-tl-rail"><i></i>${i < paraMostrar.length - 1 ? '<u></u>' : ''}</div>
                    <div class="hx-tl-body">
                        <b>${escaparHtml(h.titulo)}</b>
                        <small>${escaparHtml(formatearFechaHistorialCambios(h.fecha))}${h.usuario ? ' · ' + escaparHtml(h.usuario) : ''}</small>
                        ${h.cambios.map(c => `<p>• ${escaparHtml(c)}</p>`).join('')}
                    </div>
                </div>`).join('');
        }

        // Arma el contenido completo del panel para la OC dada: pestañas (si hay más de un despacho),
        // destino/agencia/guía+pasos, productos despachados vs. cantidad de la OC, historial de
        // cambios y los 3 botones de acción — estructura ".hx-desp" 1:1 con mockup-historial.html.
        function renderDespachoPanelContenidoHTML(oc, despachos) {
            const ordenados = [...despachos].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const activoId = despachoPanelTabActiva[oc.objectId] || ordenados[0].objectId;
            const activo = ordenados.find(d => d.objectId === activoId) || ordenados[0];
            const masReciente = despachos[0]; // obtenerDespachosDeOC() viene en orden -createdAt

            const tabsHTML = ordenados.map(d => {
                const etiqueta = d.sufijoDespacho ? 'Envío adicional' : 'Principal';
                return `<button type="button" role="tab" class="hx-desp-tab" aria-selected="${d.objectId === activo.objectId}" onclick="seleccionarTabDespacho('${oc.objectId}', '${d.objectId}')"><b>${escaparHtml(formatearCorrelativo(d.correlativo, d.sufijoDespacho))}</b><span>${etiqueta}</span></button>`;
            }).join('');

            // El seguimiento Shalom se registra por OC, no por despacho individual (así lo guarda hoy
            // js/envios/shalom.js — numeroOrdenCompra/ordenCompraObjectId, sin distinguir sufijo). Se
            // usa el mismo para cualquier pestaña; si hay más de un despacho, el pie de la guía lo aclara.
            const infoEnvio = estadoEnvioShalomDeOC(oc);
            const ciudad = activo.sucursal?.ciudad || 'Sin destino asignado';
            const stepsHTML = infoEnvio.envio
                ? `<div class="hx-dest-sub" style="margin-top:8px">Guía ${escaparHtml(infoEnvio.envio.guia || '—')}${infoEnvio.envio.codigo ? ' · Código ' + escaparHtml(infoEnvio.envio.codigo) : ''}</div>${renderStepsHX(pasoEnvioHX(infoEnvio.envio))}`
                : `<div class="hx-dest-sub" style="margin-top:8px">Sin guía Shalom registrada todavía — se registra desde "Seguimiento Shalom".</div>`;
            const notaSeguimientoCompartido = (infoEnvio.envio && ordenados.length > 1)
                ? `<div class="hx-dest-sub" style="margin-top:6px;font-style:italic;">Seguimiento de la OC, compartido entre sus envíos.</div>` : '';

            // Productos despachados (del despacho activo) frente a la cantidad de la OC, por
            // código+color — mismo criterio de agrupación que calcularDiferenciaProductos() (Kardex),
            // sin usar esa función (es específica del Kardex y no debe tocarse ni reutilizarse fuera
            // de su contexto).
            const agrupar = lista => {
                const mapa = {};
                (lista || []).forEach(p => {
                    const k = `${p.codigo}||${(p.color || '').toLowerCase()}`;
                    mapa[k] = { nombre: p.nombre || p.codigo, cantidad: (mapa[k]?.cantidad || 0) + (parseFloat(p.cantidad) || 0) };
                });
                return mapa;
            };
            const mapaOC = agrupar(oc.productos);
            const mapaDespacho = agrupar(activo.productos);
            const claves = Array.from(new Set([...Object.keys(mapaOC), ...Object.keys(mapaDespacho)]));
            const filasProductosHTML = claves.map(k => {
                const enOC = mapaOC[k], enDespacho = mapaDespacho[k];
                const nombre = (enDespacho || enOC).nombre;
                return `<div class="hx-tbl-r"><span>${escaparHtml(nombre)}</span><span>${enOC ? enOC.cantidad : 0}</span><span>${enDespacho ? enDespacho.cantidad : 0}</span></div>`;
            }).join('');

            const notaSiNoEsElVigente = activo.objectId !== masReciente.objectId
                ? `<div class="hx-tbl-nota">"Editar despacho" e "Imprimir guía" siempre usan el despacho VIGENTE (el más reciente de la OC), no necesariamente esta pestaña.</div>`
                : '';
            // Preview local del próximo sufijo (B, C…) — el que de verdad se asigna al guardar sigue
            // siendo calcularSufijoDespacho(), sin tocar esa función; esto es solo una vista previa.
            const proximoSufijoPreview = String.fromCharCode(65 + ordenados.length);
            const proximoNumeroTexto = formatearCorrelativo(oc.correlativo, proximoSufijoPreview);

            return `
                <div class="hx-desp-top" role="tablist" aria-label="Despachos de esta OC">
                    <h3>Despachos de esta OC</h3>${tabsHTML}
                    <button class="hx-desp-close" onclick="toggleDespachoPanel('${oc.objectId}')" aria-label="Cerrar despacho">${HX_ICON.x}</button>
                </div>
                <div class="hx-desp-grid">
                    <div class="hx-box">
                        <div class="hx-box-lbl">Destino Shalom</div>
                        <div class="hx-dest-city">${escaparHtml(ciudad)}</div>
                        ${activo.sucursal?.nombre ? `<div class="hx-dest-sub">${escaparHtml(activo.sucursal.nombre)}</div>` : ''}
                        ${stepsHTML}
                        ${notaSeguimientoCompartido}
                    </div>
                    <div class="hx-box hx-tbl">
                        <div class="hx-tbl-h"><span>Productos despachados</span><span>En la OC</span><span>Despachado</span></div>
                        ${filasProductosHTML}
                        ${notaSiNoEsElVigente}
                    </div>
                    <div class="hx-box">
                        <div class="hx-box-lbl" style="margin-bottom:10px">Historial de cambios</div>
                        ${renderHistorialCambiosHTML(activo)}
                    </div>
                </div>
                <div class="hx-desp-foot">
                    <button class="hx-btn hx-btn-link" onclick="crearEnvioAdicionalDesdeOC('${oc.objectId}')">${HX_ICON.plus}Envío adicional (${escaparHtml(proximoNumeroTexto)})</button>
                    <span class="sp"></span>
                    <button class="hx-btn hx-btn-outline" onclick="crearDespachoDesdeOC('${oc.objectId}')">${HX_ICON.edit}Editar despacho</button>
                    <button class="hx-btn hx-btn-primary" onclick="imprimirGuiaDespacho('${masReciente.objectId}')">${HX_ICON.print}Imprimir guía<span class="hx-only-web" style="margin-left:-4px">&nbsp;${escaparHtml(formatearCorrelativo(masReciente.correlativo, masReciente.sufijoDespacho))}</span></button>
                </div>`;
        }

        // 🖨️ Imprime la guía de un despacho ya guardado con el diálogo de impresión NATIVO del
        // sistema (window.print(): Windows, Linux/CUPS, macOS, iOS/iPadOS) — ya no descarga una
        // imagen. Reutiliza la guía que el sistema ya genera: carga el despacho como "Cargar"
        // (cargarDesdeHistorial, sin tocar) y arma #cotizacionPrint con prepararCotizacion(); el CSS
        // @media print (css/cotizacion.css) deja visible solo ese bloque. A diferencia de
        // generarImagen(), imprimir NO guarda el documento, así que no toca historialCambios.
        async function imprimirGuiaDespacho(despachoObjectId) {
            await cargarDesdeHistorial(despachoObjectId);
            if (typeof productosEnTabla === 'undefined' || productosEnTabla.length === 0) return;
            try {
                await prepararCotizacion();
                const imgs = Array.from(document.querySelectorAll('#cotizacionPrint img'));
                await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
                window.print();
            } catch (e) {
                console.error('Error al imprimir la guía:', e);
                mostrarNotificacion(e.message || 'No se pudo abrir la impresión', 'error');
            }
        }

        // 📦 Envío adicional: a diferencia de crearDespachoDesdeOC() (que SIEMPRE adopta/actualiza el
        // despacho activo más reciente de la OC), esta función fuerza la creación de un despacho
        // NUEVO e independiente para la misma OC — mismo N°, con el sufijo siguiente (B, C…) que
        // calcula calcularSufijoDespacho() tal como ya existía (no se toca esa función ni
        // guardarEnHistorial() para esto: simplemente se deja sufijoDespacho en "undefined" para que
        // guardarEnHistorial lo calcule solo, igual que ya hacía en el flujo manual documentado ahí).
        // Cubre el caso real de "se olvidó despachar algo y hay que mandarlo aparte".
        async function crearEnvioAdicionalDesdeOC(objectId) {
            const oc = historialCache.find(e => e.objectId === objectId);
            if (!oc || oc.tipoDocumento !== 'orden_compra') { mostrarNotificacion('No se encontró la Orden de Compra', 'warning'); return; }

            if (!await confirmarAccion({
                titulo: 'Envío adicional',
                mensaje: `¿Crear un envío adicional para la Orden de Compra ${formatearCorrelativo(oc.correlativo, null)} de "${oc.cliente}"?\n\nSe generará un despacho NUEVO e independiente del ya emitido (mismo N°, con su propio sufijo B/C…) y se reemplazará la cotización actual en pantalla — ajusta ahí los productos que corresponden a este envío antes de guardar.`,
                confirmarTexto: 'Crear envío adicional'
            })) return;

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

            document.getElementById('tipoDocumento').value = 'DESPACHO';

            registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
            registroEnCurso.despacho = {
                objectId: null,
                correlativo: oc.correlativo || null,
                ordenCompraAsociada: oc.objectId,
                sufijoDespacho: undefined // se calcula solo al guardar — ver guardarEnHistorial()
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
            mostrarNotificacion(`Envío adicional vinculado a OC ${formatearCorrelativo(oc.correlativo, null)} — ajusta los productos que corresponden a este envío y presiona "Guardar"`, 'success');
        }

        // 📦 Crea una Orden de Compra NUEVA a partir de una Cotización ya guardada: carga sus
        // productos, cliente y sucursal, y deja el tipo de documento en ORDEN DE COMPRA para que al
        // presionar "Guardar" se genere una OC con su propio N° (correlativo independiente del de la
        // Cotización). Es el botón rápido de la tarjeta de Cotización — el paso siguiente natural del
        // flujo comercial — para no tener que volver a tipear todos los datos del cliente.
        //
        // A diferencia de crearDespachoDesdeOC(), aquí NO se guarda ningún vínculo hacia la
        // Cotización de origen: no existe un campo equivalente a "ordenCompraAsociada" para
        // Cotización→OC, ya que una misma cotización puede terminar en varias OC (o ninguna) sin que
        // eso deba quedar registrado — es solo un atajo de captura de datos, no una relación real
        // entre documentos como la que sí existe entre Despacho y OC.
        async function crearOCDesdeCotizacion(objectId) {
            const cot = historialCache.find(e => e.objectId === objectId);
            if (!cot || cot.tipoDocumento !== 'cotizacion') { mostrarNotificacion('No se encontró la cotización', 'warning'); return; }

            if (!await confirmarAccion({
                titulo: 'Crear Orden de Compra',
                mensaje: `¿Crear una Orden de Compra a partir de la cotización de "${cot.cliente}"?\n\nSe reemplazará la cotización actual en pantalla y se generará un N° de Orden de Compra nuevo al guardar.`,
                confirmarTexto: 'Crear OC'
            })) return;

            productosEnTabla = JSON.parse(JSON.stringify(cot.productos)).map(migrarProductoLegacy);
            sucursalSeleccionada = cot.sucursal || null;
            if (document.getElementById('globalDiscount')) document.getElementById('globalDiscount').value = cot.globalDescPct || '';
            document.getElementById('clienteNombre').value = cot.cliente === 'Sin nombre' ? '' : cot.cliente;
            document.getElementById('clienteEmpresa').value = cot.empresaCliente || '';
            document.getElementById('clienteRUC').value = cot.ruc || '';
            document.getElementById('clienteTelefono').value = cot.telefono || '';
            document.getElementById('clienteEmail').value = cot.email || '';
            document.getElementById('clienteDireccion').value = cot.direccion || '';
            document.getElementById('clienteNotas').value = cot.notas || '';
            olvidarAutocompletadoRUCDNI();
            clienteDBObjectIdEnCurso = cot.clienteObjectId || null;
            document.getElementById('montoAdelanto').value = '';

            document.getElementById('tipoDocumento').value = 'ORDEN DE COMPRA';

            // Es un documento NUEVO (no una edición de la cotización de origen): se limpia
            // registroEnCurso para que el próximo "Guardar" haga un POST con un correlativo de Orden
            // de Compra recién asignado, sin arrastrar ningún objectId de los otros tipos.
            registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
            tipoContadorCargadoExplicitamente = 'orden_compra';

            actualizarResumenCliente();
            renderTable();
            actualizarPago();
            actualizarBloqueoSelectorTipoDocumento();
            actualizarPanelCorrelativo();
            guardarEstado();
            if (sucursalSeleccionada) mostrarSucursalSeleccionada();
            renderSucursales();
            switchTabById('cotizar');
            mostrarNotificacion(`Cotización de "${cot.cliente}" cargada como nueva Orden de Compra — revisa y presiona "Guardar" cuando esté listo`, 'success');
        }


        // Muestra en un modal de solo lectura el contenido completo de una cotización, orden de
        // compra o guía de despacho guardada en el historial, sin cargarla a la cotización activa
        // ni tocar contadores/red. Maquetado con clases ".vd-*" (css/cotizacion.css): en PC la
        // tabla de productos es una tabla normal; en celular cada producto pasa a ser una
        // tarjeta (sin scroll horizontal). Colores por tokens, así respeta el modo oscuro.
        function verCotizacionDesdeHistorial(objectId) {
            const entry = historialCache.find(e => e.objectId === objectId);
            if (!entry) { mostrarNotificacion('No se encontró la cotización', 'warning'); return; }

            const infoTipoDoc = {
                orden_compra: { clase: 'vd-badge--oc', etiqueta: '📦 ORDEN DE COMPRA' },
                despacho:     { clase: 'vd-badge--desp', etiqueta: '🚚 GUÍA DE DESPACHO' },
                cotizacion:   { clase: 'vd-badge--cot', etiqueta: '📋 COTIZACIÓN' }
            }[entry.tipoDocumento] || { clase: 'vd-badge--cot', etiqueta: '📋 COTIZACIÓN' };

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
                const colorInfo = producto.color ? ` <span class="vd-color">● ${escaparHtml(producto.color)}</span>` : '';
                const descInfo = descPct > 0 ? ` <span class="vd-desc">-${escaparHtml(descPct)}%</span>` : '';

                return `
                    <tr>
                        <td class="vd-cod">${escaparHtml(producto.codigo)}</td>
                        <td class="vd-prod">${escaparHtml(producto.nombre)}${colorInfo}</td>
                        <td class="vd-cant" data-label="Cant.">${escaparHtml(cantidad)}</td>
                        ${esDespacho ? '' : `<td class="vd-pu" data-label="P. Unit.">S/ ${precioMostrar.toFixed(2)}${descInfo}<small>${escaparHtml(tipoPrecio)}</small></td>`}
                        ${esDespacho ? '' : `<td class="vd-sub" data-label="Subtotal">S/ ${subtotalMostrar.toFixed(2)}</td>`}
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
                detalleTotalesHTML += `<div><span>Subtotal:</span><span>S/ ${subtotalDisp.toFixed(2)}</span></div>`;
                detalleTotalesHTML += `<div><span>Desc. global (${escaparHtml(entry.globalDescPct)}%):</span><span>-S/ ${descDisp.toFixed(2)}</span></div>`;
            }
            if (entry.mostrarConIGV) {
                const soloIGV = calcularIGV(totalFinalSinIGV);
                detalleTotalesHTML += `<div><span>Base imponible:</span><span>S/ ${totalFinalSinIGV.toFixed(2)}</span></div>`;
                detalleTotalesHTML += `<div><span>IGV (18%):</span><span>S/ ${soloIGV.toFixed(2)}</span></div>`;
            }

            let clienteHTML = '';
            if (entry.cliente || entry.empresaCliente) {
                const linea = (icono, valor, extra = '') => valor ? `<div class="vd-line${extra}">${icono} ${escaparHtml(valor)}</div>` : '';
                clienteHTML = `
                    <div class="vd-box vd-box--cliente">
                        <div class="vd-box-lbl">👤 Cliente</div>
                        ${entry.cliente ? `<div class="vd-box-title">${escaparHtml(entry.cliente)}</div>` : ''}
                        ${entry.empresaCliente ? `<div class="vd-line">${escaparHtml(entry.empresaCliente)}</div>` : ''}
                        ${linea('🪪 RUC/DNI:', entry.ruc)}
                        ${linea('📞', entry.telefono)}
                        ${linea('✉️', entry.email)}
                        ${linea('📍', entry.direccion)}
                        ${linea('📝', entry.notas, ' vd-line--nota')}
                    </div>`;
            }

            let envioHTML = '';
            if (entry.sucursal) {
                envioHTML = `
                    <div class="vd-box vd-box--envio">
                        <div class="vd-box-lbl">📦 Envío Shalom</div>
                        <div class="vd-box-title">${escaparHtml(entry.sucursal.nombre || '')}</div>
                        ${entry.sucursal.direccion ? `<div class="vd-line">📍 ${escaparHtml(entry.sucursal.direccion)}</div>` : ''}
                        <div class="vd-line">🏙️ ${escaparHtml(entry.sucursal.ciudad || '')}${entry.sucursal.provincia ? ', ' + escaparHtml(entry.sucursal.provincia) : ''}</div>
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
                ? `<span class="vd-chip vd-chip--oc">🔗 Vinculado a OC ${ocVinculada ? escaparHtml(formatearCorrelativo(ocVinculada.correlativo, null)) : '(fuera de rango de historial cargado)'}</span>`
                : '';
            // Si es una Orden de Compra, se listan aquí sus despachos generados, para poder saltar
            // directamente a verlos sin volver a la lista del historial. El indicador "⏳ Pendiente de
            // despacho" (para cuando no tiene ninguno) quedó desactivado a pedido — no se muestra nada
            // en ese caso, solo el badge "✅ Despachado" cuando sí existe.
            const despachosDeEstaOC = entry.tipoDocumento === 'orden_compra' ? obtenerDespachosDeOC(entry.objectId) : [];
            const despachosHTML = (entry.tipoDocumento === 'orden_compra' && despachosDeEstaOC.length > 0)
                ? `<span class="vd-chip vd-chip--desp">✅ Despachado${despachosDeEstaOC.length > 1 ? ' ×' + despachosDeEstaOC.length : ''}</span>
                   ${despachosDeEstaOC.map(d => `<button type="button" class="vd-chip vd-chip-btn" onclick="verCotizacionDesdeHistorial('${d.objectId}')">👁️ ${escaparHtml(formatearCorrelativo(d.correlativo, d.sufijoDespacho))}</button>`).join('')}`
                : '';

            document.getElementById('verCotizacionTitulo').textContent = `${infoTipoDoc.etiqueta} ${correlativoTexto}`;
            document.getElementById('verCotizacionBody').innerHTML = `
                <div class="vd-head">
                    <div class="vd-head-main">
                        <span class="vd-badge ${infoTipoDoc.clase}">${escaparHtml(correlativoTexto)}</span>
                        <div class="vd-meta">📅 ${escaparHtml(fecha)}</div>
                        <div class="vd-meta">🧑‍💼 ${escaparHtml(entry.usuarioNombre || entry.usuario || '—')}</div>
                        ${(vinculoHTML || despachosHTML) ? `<div class="vd-chips">${vinculoHTML}${despachosHTML}</div>` : ''}
                    </div>
                    <div class="vd-head-total">
                        <div class="vd-meta">${numProductos} producto${numProductos!==1?'s':''} · ${totalUnid} unid.</div>
                        ${!esDespacho ? `<div class="vd-total">S/ ${totalMostrar.toFixed(2)}</div>` : ''}
                    </div>
                </div>
                ${bloqueInfoHTML}
                <div class="ver-doc-table-wrap">
                    <table class="print-table vd-table${esDespacho ? ' vd-table--desp' : ''}">
                        <thead>
                            <tr>
                                <th class="vd-cod">Código</th>
                                <th class="vd-prod">Producto</th>
                                <th class="vd-cant">Cant.</th>
                                ${esDespacho ? '' : '<th class="vd-pu">P. Unit.</th>'}
                                ${esDespacho ? '' : '<th class="vd-sub">Subtotal</th>'}
                            </tr>
                        </thead>
                        <tbody>${filasHTML}</tbody>
                    </table>
                </div>
                ${!esDespacho ? `
                <div class="vd-totales">
                    ${detalleTotalesHTML ? `<div class="vd-totales-det">${detalleTotalesHTML}</div>` : ''}
                    <div class="vd-totales-final">
                        <strong>TOTAL</strong>
                        <strong class="vd-total">S/ ${totalMostrar.toFixed(2)}</strong>
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
                // El cambio de adelanto puede mover el contador del chip "💰 Pago pendiente" — se
                // refresca junto con la lista para que no quede desactualizado hasta el próximo reload.
                const filtrosEl = document.getElementById('historialFiltrosArea');
                if (filtrosEl) filtrosEl.innerHTML = renderFiltrosTipoHistorial();
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
            if (!await confirmarAccion({
                titulo: entry && entry.tipoDocumento === 'orden_compra' ? 'Ocultar Orden de Compra' : 'Ocultar cotización',
                mensaje: mensaje,
                confirmarTexto: 'Ocultar',
                destructivo: true
            })) return;

            try {
                if (productosADevolver.length > 0) {
                    try {
                        const devolucion = productosADevolver.map(p => ({
                            codigo: p.codigo,
                            color: p.color || '',
                            cantidad: -(parseFloat(p.cantidad) || 0) // negativo = se SUMA al stock
                        }));
                        const resKardex = await registrarSalidasOCKardex(devolucion, { referencia: entry && entry.correlativo != null ? formatearCorrelativo(entry.correlativo) : '', ocObjectId: objectId });
                        if (resKardex.noAplicadas.length) {
                            mostrarNotificacion(`No se pudo devolver en el Kardex: ${resKardex.noAplicadas.map(n => `${n.item.descripcion || n.item.codigo} (${n.motivo})`).join('; ')}`, 'warning');
                        }
                        if (resKardex.advertenciaMes) mostrarNotificacion(resKardex.advertenciaMes, 'warning');
                        cargarKardex(false);
                    } catch (eKardex) {
                        console.error('Error al devolver stock del Kardex:', eKardex);
                        mostrarAlerta({
                            titulo: 'Orden ocultada, pero el stock no volvió al Kardex',
                            mensaje: 'La Orden de Compra se ocultó del historial, pero no se pudo devolver su stock al Kardex de Dropbox. Revísalo manualmente.',
                            tipo: 'error',
                            detalle: eKardex.message
                        });
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
            if (!await confirmarAccion({
                titulo: 'Ocultar cotizaciones',
                mensaje: `¿Ocultar las ${historialCache.length} cotizaciones de esta lista? No se borran, solo dejan de mostrarse.`,
                confirmarTexto: 'Ocultar todas',
                destructivo: true
            })) return;
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

