        // ============================================
        // NOMBRE DE ARCHIVO Y DESCARGA CON CARPETA A ELECCIÓN
        // ============================================

        // Genera el nombre según: tipo de documento + empresa + fecha + hora
        // Ej: cotizacion_fabexsa_15-07-2026_14-30.png
        function generarNombreArchivo(extension) {
            const tipoDocSelect = document.getElementById('tipoDocumento');
            const tipoDoc = obtenerTipoContador(tipoDocSelect ? tipoDocSelect.value : '');
            const empresaNombre = (typeof empresaActiva !== 'undefined' && empresaActiva === 'confortline') ? 'confortline' : 'fabexsa';

            const ahora = new Date();
            const fecha = `${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${ahora.getFullYear()}`;
            const hora = `${String(ahora.getHours()).padStart(2, '0')}-${String(ahora.getMinutes()).padStart(2, '0')}`;

            return `${tipoDoc}_${empresaNombre}_${fecha}_${hora}.${extension}`;
        }

        // Descarga un archivo (Blob). En Chrome/Edge permite elegir la carpeta de destino;
        // en navegadores que no lo soportan (Firefox/Safari), usa la descarga estándar.
        // ============================================
        // CARPETA FIJA DE DESCARGAS (solo Cotización / Orden de Compra)
        // ============================================
        // Guarda el "handle" de la carpeta elegida en IndexedDB (no en localStorage, porque
        // localStorage no puede guardar este tipo de objeto). Así el navegador la recuerda
        // entre visitas y no hay que volver a elegirla cada vez.
        const DB_CARPETA_NOMBRE = 'cotizador_carpeta_descarga';
        const DB_CARPETA_STORE = 'handles';

        function abrirDBCarpeta() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_CARPETA_NOMBRE, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(DB_CARPETA_STORE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function guardarCarpetaHandle(handle) {
            const db = await abrirDBCarpeta();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(DB_CARPETA_STORE, 'readwrite');
                tx.objectStore(DB_CARPETA_STORE).put(handle, 'carpetaDescargas');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }

        async function leerCarpetaHandle() {
            const db = await abrirDBCarpeta();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(DB_CARPETA_STORE, 'readonly');
                const req = tx.objectStore(DB_CARPETA_STORE).get('carpetaDescargas');
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        }

        async function borrarCarpetaHandle() {
            const db = await abrirDBCarpeta();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(DB_CARPETA_STORE, 'readwrite');
                tx.objectStore(DB_CARPETA_STORE).delete('carpetaDescargas');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }

        let carpetaDescargaFija = null;           // Handle activo (con permiso confirmado) en memoria
        let carpetaFijaRecordadaPendiente = null;  // Handle recordado, pendiente de reconfirmar permiso

        async function elegirCarpetaFija() {
            if (!window.showDirectoryPicker) {
                mostrarNotificacion('Tu navegador no soporta elegir una carpeta fija (usa Chrome o Edge). Se seguirá preguntando la carpeta en cada descarga.', 'warning');
                return;
            }
            try {
                const handle = await window.showDirectoryPicker();
                const permiso = await handle.requestPermission({ mode: 'readwrite' });
                if (permiso !== 'granted') { mostrarNotificacion('No se otorgó permiso sobre la carpeta', 'warning'); return; }
                carpetaDescargaFija = handle;
                carpetaFijaRecordadaPendiente = null;
                await guardarCarpetaHandle(handle);
                actualizarEtiquetaCarpetaFija();
                mostrarNotificacion(`Carpeta fija activada: ${handle.name}`, 'success');
            } catch (e) {
                if (e.name !== 'AbortError') { console.error('Error al elegir carpeta:', e); mostrarNotificacion('No se pudo activar la carpeta fija', 'warning'); }
            }
        }

        async function quitarCarpetaFija() {
            carpetaDescargaFija = null;
            carpetaFijaRecordadaPendiente = null;
            await borrarCarpetaHandle();
            actualizarEtiquetaCarpetaFija();
            mostrarNotificacion('Carpeta fija desactivada. Se volverá a preguntar en cada descarga.', 'info');
        }

        // Al cargar la página, intenta recuperar la carpeta ya elegida antes (sin volver a preguntar cuál es).
        // Por seguridad, los navegadores piden reconfirmar el PERMISO una vez por sesión: si eso pasa,
        // se deja la carpeta "recordada" para reactivarla con un solo clic (no hay que elegirla de nuevo).
        async function intentarRecuperarCarpetaFija() {
            if (!window.showDirectoryPicker) return;
            try {
                const handle = await leerCarpetaHandle();
                if (!handle) return;
                const permiso = await handle.queryPermission({ mode: 'readwrite' });
                if (permiso === 'granted') {
                    carpetaDescargaFija = handle;
                } else {
                    carpetaFijaRecordadaPendiente = handle;
                }
            } catch (e) {
                console.warn('No se pudo recuperar la carpeta fija guardada:', e);
            }
            actualizarEtiquetaCarpetaFija();
        }

        async function reactivarCarpetaFijaPendiente() {
            if (!carpetaFijaRecordadaPendiente) { elegirCarpetaFija(); return; }
            try {
                const permiso = await carpetaFijaRecordadaPendiente.requestPermission({ mode: 'readwrite' });
                if (permiso === 'granted') {
                    carpetaDescargaFija = carpetaFijaRecordadaPendiente;
                    carpetaFijaRecordadaPendiente = null;
                    actualizarEtiquetaCarpetaFija();
                    mostrarNotificacion(`Carpeta fija reactivada: ${carpetaDescargaFija.name}`, 'success');
                }
            } catch (e) {
                console.error('No se pudo reactivar la carpeta:', e);
            }
        }

        function actualizarEtiquetaCarpetaFija() {
            const el = document.getElementById('carpetaFijaLabel');
            const btn = document.getElementById('btnCarpetaFija');
            const btnQuitar = document.getElementById('btnQuitarCarpetaFija');
            if (!el || !btn) return;

            if (carpetaDescargaFija) {
                el.textContent = `📁 Guardando en: ${carpetaDescargaFija.name}`;
                btn.textContent = '🔄 Cambiar carpeta';
                btn.onclick = elegirCarpetaFija;
                if (btnQuitar) btnQuitar.style.display = 'inline-block';
            } else if (carpetaFijaRecordadaPendiente) {
                el.textContent = `📁 Carpeta recordada: ${carpetaFijaRecordadaPendiente.name} (confirma el permiso)`;
                btn.textContent = '✅ Reactivar carpeta';
                btn.onclick = reactivarCarpetaFijaPendiente;
                if (btnQuitar) btnQuitar.style.display = 'inline-block';
            } else {
                el.textContent = 'Se preguntará la carpeta en cada descarga';
                btn.textContent = '📁 Elegir carpeta fija';
                btn.onclick = elegirCarpetaFija;
                if (btnQuitar) btnQuitar.style.display = 'none';
            }
        }

        async function descargarArchivo(blob, nombreArchivo, tipoMime) {
            // 1) Si hay una carpeta fija activa (con permiso ya confirmado), escribir directo ahí sin preguntar nada
            if (carpetaDescargaFija) {
                try {
                    const fileHandle = await carpetaDescargaFija.getFileHandle(nombreArchivo, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    return;
                } catch (e) {
                    console.warn('No se pudo escribir en la carpeta fija, se usa la descarga estándar:', e);
                }
            }

            // 2) Sin carpeta fija: descarga estándar directa (misma forma que en celulares y navegadores
            // sin File System Access API; no se abre ningún selector de carpeta por cada descarga)
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nombreArchivo;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }


        async function generarImagen() {
            if (productosEnTabla.length === 0) {
                mostrarNotificacion('Agrega productos primero', 'warning');
                return;
            }

            showLoading(true);
            
            try {
                await prepararCotizacion();
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const element = document.getElementById('cotizacionPrint');
                
                const canvas = await html2canvas(element, {
                    scale: 2,
                    backgroundColor: '#ffffff',
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: 900,
                    height: element.scrollHeight
                });

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                await descargarArchivo(blob, generarNombreArchivo('png'), 'image/png');

                showLoading(false);
                mostrarNotificacion('Imagen generada exitosamente', 'success');
                await guardarEnHistorial();
            } catch (error) {
                console.error('Error al generar imagen:', error);
                showLoading(false);
                mostrarNotificacion(error.message || 'Error al generar imagen', 'error');
            }
        }

        // ============================================
        // COPIAR IMAGEN AL PORTAPAPELES
        // ============================================

        async function copiarImagen() {
            if (productosEnTabla.length === 0) {
                mostrarNotificacion('Agrega productos primero', 'warning');
                return;
            }

            if (!navigator.clipboard || !window.ClipboardItem) {
                mostrarNotificacion('Tu navegador no permite copiar imágenes al portapapeles', 'error');
                return;
            }

            showLoading(true);

            try {
                await prepararCotizacion();
                await new Promise(resolve => setTimeout(resolve, 800));

                const element = document.getElementById('cotizacionPrint');

                const canvas = await html2canvas(element, {
                    scale: 2,
                    backgroundColor: '#ffffff',
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: 900,
                    height: element.scrollHeight
                });

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);

                showLoading(false);
                mostrarNotificacion('Imagen copiada al portapapeles', 'success');
                await guardarEnHistorial();
            } catch (error) {
                console.error('Error al copiar imagen:', error);
                showLoading(false);
                mostrarNotificacion(error.message || 'Error al copiar imagen', 'error');
            }
        }

