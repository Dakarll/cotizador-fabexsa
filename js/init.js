        // ============================================
        // SISTEMA DE TABS
        // ============================================

        // Pestañas que viven dentro de "Más" (desktop) / la hoja inferior (móvil) — se usa para
        // encender el botón "Más" cuando la pestaña activa es una de estas, aunque el panel
        // esté cerrado, así el usuario sabe en qué sección está.
        const TABS_DENTRO_DE_MAS = ['kardex', 'productos', 'controldiario', 'movstock', 'fichas', 'ajustes'];

        function switchTab(tab) {
            tabActual = tab;
            document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Se marca como activa en AMBAS barras (escritorio y móvil) a la vez, aunque solo una
            // esté visible según el ancho de pantalla — así el estado no se pierde si la persona
            // gira el teléfono o cambia de tamaño de ventana a mitad de sesión.
            document.querySelectorAll(`[data-tab="${tab}"]`).forEach(t => t.classList.add('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');

            const esSecundaria = TABS_DENTRO_DE_MAS.includes(tab);
            document.querySelectorAll('.tabs-more').forEach(el => {
                el.classList.toggle('trigger-active', esSecundaria);
                el.classList.remove('open');
            });
            document.querySelectorAll('.tabs-mobile-more').forEach(el => {
                el.classList.toggle('trigger-active', esSecundaria);
                el.classList.remove('open');
            });

            if (tab === 'sucursales') {
                renderSucursales();
                updateSucursalStats();
            } else if (tab === 'productos') {
                renderProductosVistaRapida();
            } else if (tab === 'ajustes') {
                renderProductList();
                renderSucursalList();
            } else if (tab === 'historial') {
                renderHistorial();
            } else if (tab === 'kardex') {
                renderKardexTabCompleta();
            } else if (tab === 'controldiario') {
                cargarMovimientosControlDiario();
            } else if (tab === 'movstock') {
                inicializarFechasMovimientoStock();
            } else if (tab === 'fichas') {
                if (productosFicha[categoriaFichaActiva] === null) {
                    cargarProductosFicha(categoriaFichaActiva);
                } else {
                    renderPickerFicha();
                }
            } else if (tab === 'cotizar') {
                actualizarPanelCorrelativo();
            }
        }

        // Abre/cierra el desplegable "Más" del menú de escritorio.
        function toggleTabsMore(evt) {
            evt.stopPropagation();
            document.getElementById('tabsMore').classList.toggle('open');
        }

        // Abre/cierra la hoja "Más" del menú móvil (el fondo oscuro también llama a esta función
        // para poder cerrarla tocando fuera).
        function toggleTabsMobileMore(evt) {
            evt.stopPropagation();
            document.getElementById('tabsMobileMore').classList.toggle('open');
        }

        // Cierra el desplegable de escritorio si se hace click fuera de él (la hoja móvil ya se
        // cierra con su propio overlay, que cubre toda la pantalla).
        document.addEventListener('click', function(e) {
            const tabsMore = document.getElementById('tabsMore');
            if (tabsMore && tabsMore.classList.contains('open') && !tabsMore.contains(e.target)) {
                tabsMore.classList.remove('open');
            }
        });


        // ============================================
        // UTILIDADES
        // ============================================

        function showLoading(show) {
            document.getElementById('loadingOverlay').classList.toggle('active', show);
        }

        // Un solo icono por tipo, puesto automáticamente por la función — antes cada llamada a
        // mostrarNotificacion() escribía su propio emoji a mano (✅/⚠️/🎉/👍...), lo que generaba
        // inconsistencia. El color de fondo ya indica el estado; el icono solo lo refuerza.
        const ICONOS_NOTIFICACION = { success: '✓', warning: '!', error: '✕', info: 'i' };

        function mostrarNotificacion(mensaje, tipo) {
            const div = document.createElement('div');
            div.className = `notification ${tipo}`;

            const icono = document.createElement('span');
            icono.className = 'notification-icon';
            icono.textContent = ICONOS_NOTIFICACION[tipo] || '';

            const texto = document.createElement('span');
            texto.textContent = mensaje;

            div.appendChild(icono);
            div.appendChild(texto);
            document.body.appendChild(div);

            setTimeout(() => {
                div.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => div.remove(), 300);
            }, 3000);
        }


        // ============================================
        // INITIALIZATION

        let appYaInicializada = false;

        // Se ejecuta una sola vez, después de que el login (o la sesión guardada) se confirma
        function inicializarAppPostLogin() {
            if (appYaInicializada) return;
            appYaInicializada = true;

            cargarEstado();
            // Restaura el Modo Prueba tal como quedó la última vez para este usuario (solo aplica si
            // sigue siendo "master" Y el interruptor MODO_DESARROLLADOR_HABILITADO sigue en true; si
            // se deshabilitó el interruptor, se ignora cualquier valor guardado y queda apagado).
            try { modoDesarrollador = MODO_DESARROLLADOR_HABILITADO && usuarioActual?.nivel === 'master' && localStorage.getItem(claveModoDesarrollador()) === '1'; } catch (e) { modoDesarrollador = false; }
            aplicarVisibilidadModoDesarrollador();
            cargarPreferencias(); // Cargar preferencias de IGV y Forzar Por Mayor
            renderSucursales();
            renderProductList();
            renderProductosVistaRapida();
            // Los productos agregados por el equipo (Ajustes o buscador) viven en la nube; se suman
            // al catálogo en memoria y se refrescan las listas ya renderizadas apenas terminan de
            // llegar (no bloquea el resto de la carga de la app mientras tanto).
            cargarProductosDesdeNube().then(() => {
                renderProductList();
                renderProductosVistaRapida();
            });
            renderSucursalList();
            const empresaSelect = document.getElementById('empresaActivaSelect');
            if (empresaSelect) empresaSelect.value = empresaActiva;
            cargarKardexDesdeCache();
            cargarKardex(false); // actualización automática y silenciosa en segundo plano
            cargarClientesDesdeNube(); // trae la base de datos de clientes de la nube para el buscador de "Cotizar"
            aplicarPermisosPorNivel(); // restringe pestañas si el usuario es de la categoría 'control_diario'
            inicializarFechasMovimientoStock(); // fecha de hoy por defecto en Ingreso/Egreso rápido
            const fichaCatBtn = document.getElementById('fichaCatBtn_' + categoriaFichaActiva);
            if (fichaCatBtn) { document.querySelectorAll('.ficha-cat-btn').forEach(b => b.classList.remove('active')); fichaCatBtn.classList.add('active'); }
            renderPickerFicha();
            migrarHistorialLocalSiExiste();
            aplicarVisibilidadRecuperarHistorial();
            intentarRecuperarCarpetaFija();
            iniciarRevisionDeVersion();
            actualizarPanelCorrelativo(); // muestra el N° previsto apenas se abre la app (pestaña "Cotizar" por defecto)
            console.log('✅ Cotizador cargado correctamente');
            console.log(`📦 ${productosDB.length} productos disponibles`);
            console.log(`🚚 ${sucursalesDB.length} sucursales disponibles`);
        }

        window.onload = function() {
            verificarSesionGuardada(); // Muestra login, o entra directo si la sesión sigue vigente
        };

        // Si el usuario minimiza/cambia de pestaña del navegador y vuelve, se refresca el panel de
        // correlativo de una vez (sin esperar al siguiente tick del polling) — cubre el caso típico
        // de dejar la cotización abierta, ir a hacer otra cosa, y volver bastante después.
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden && tabActual === 'cotizar' && typeof actualizarPanelCorrelativo === 'function') {
                actualizarPanelCorrelativo();
            }
        });

        // Cerrar modales al hacer click fuera
        document.getElementById('editProductoModal').addEventListener('click', function(e) {
            if (e.target === this) closeEditProductoModal();
        });
        
        document.getElementById('editSucursalModal').addEventListener('click', function(e) {
            if (e.target === this) closeEditSucursalModal();
        });

        document.getElementById('editEmpresaModal').addEventListener('click', function(e) {
            if (e.target === this) closeEditEmpresaModal();
        });


