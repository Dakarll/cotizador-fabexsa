// ============================================
// FICHA TÉCNICA — Productos consultados desde Back4App
// ============================================
// Si el picker no carga imágenes, ve a:
// Dashboard de tu app > ⚙️ App Settings > Security & Keys > copia el valor
// exacto de "REST API Key" y reemplázalo en restApiKey abajo.
const BACK4APP_CONFIG = {
    appId: 'FUvQmIkpBQRslJOaONps84g4RfBOVrwotiZTJx1r',
    restApiKey: '3amPib5iqXdsAEplcXEaB7PnMWrbvtSXC1GFHXHv',
    serverUrl: 'https://parseapi.back4app.com',
    clase: 'productos'
};

let productosFicha = { toallas: null, telas: null, vestimenta: null, catalogo: null }; // null = aún no consultada a Back4App
let categoriaFichaActiva = localStorage.getItem('fichaCategoriaActiva') || 'toallas';
let fichaProductoSeleccionadoId = null;
let fichaImagenSeleccionada = '';

function cambiarCategoriaFicha(categoria) {
    categoriaFichaActiva = categoria;
    localStorage.setItem('fichaCategoriaActiva', categoria);
    document.querySelectorAll('.ficha-cat-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('fichaCatBtn_' + categoria);
    if (btn) btn.classList.add('active');

    if (productosFicha[categoria] === null) {
        cargarProductosFicha(categoria);
    } else {
        renderPickerFicha();
    }
}

// Consulta a Back4App los productos (imágenes) registrados en esa categoría
async function cargarProductosFicha(categoria) {
    const cont = document.getElementById('fichaProductoGrid');
    if (cont) cont.innerHTML = '<div style="text-align:center;color:#a0aec0;padding:30px;grid-column:1/-1;">⏳ Consultando base de datos...</div>';
    try {
        const where = encodeURIComponent(JSON.stringify({ categoria }));
        const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${BACK4APP_CONFIG.clase}?where=${where}&order=orden`, {
            headers: {
                'X-Parse-Application-Id': BACK4APP_CONFIG.appId,
                'X-Parse-REST-API-Key': BACK4APP_CONFIG.restApiKey
            }
        });
        if (!resp.ok) {
            const errorBody = await resp.json().catch(() => ({}));
            throw new Error(errorBody.error || ('HTTP ' + resp.status));
        }
        const data = await resp.json();
        productosFicha[categoria] = data.results || [];
        renderPickerFicha();
    } catch (e) {
        console.error('Error al consultar productos de ' + categoria, e);
        productosFicha[categoria] = [];
        if (cont) cont.innerHTML = `<div style="text-align:center;color:#c53030;padding:30px;grid-column:1/-1;">⚠️ No se pudo consultar la base de datos: ${e.message}</div>`;
    }
}

function renderPickerFicha() {
    const cont = document.getElementById('fichaProductoGrid');
    if (!cont) return;

    const filtro = (document.getElementById('fichaBuscarProducto')?.value || '').toLowerCase().trim();
    const items = productosFicha[categoriaFichaActiva] || [];
    const filtrados = items.filter(it => !filtro || (it.nombre || '').toLowerCase().includes(filtro));

    if (filtrados.length === 0) {
        cont.innerHTML = `<div style="text-align:center;color:#a0aec0;padding:30px;grid-column:1/-1;">${items.length === 0 ? 'Aún no hay productos registrados en esta categoría.' : 'Sin resultados para tu búsqueda.'}</div>`;
        return;
    }

    cont.innerHTML = filtrados.map(item => `
        <div class="galeria-item ficha-producto-card ${fichaProductoSeleccionadoId === item.objectId ? 'seleccionado' : ''}" onclick="seleccionarProductoFicha('${item.objectId}')">
            <img src="${(item.imagen && item.imagen.url) || ''}" alt="${item.nombre || ''}" loading="lazy">
            <div class="galeria-item-nombre">${item.nombre || ''}</div>
        </div>
    `).join('');
}

let fichaNombreSeleccionado = '';

function seleccionarProductoFicha(objectId) {
    const item = (productosFicha[categoriaFichaActiva] || []).find(it => it.objectId === objectId);
    if (!item) return;

    fichaProductoSeleccionadoId = objectId;
    fichaImagenSeleccionada = (item.imagen && item.imagen.url) || '';
    fichaNombreSeleccionado = item.nombre || 'imagen';
    renderPickerFicha(); // resalta la card elegida
    renderPreviewFicha();
}

function renderPreviewFicha() {
    const panel = document.getElementById('fichaPreviewPanel');
    if (!panel) return;
    if (!fichaImagenSeleccionada) {
        panel.innerHTML = '<div style="text-align:center;color:#a0aec0;padding:40px 16px;">Selecciona un producto para ver su imagen aquí.</div>';
        return;
    }
    panel.innerHTML = `
        <img src="${fichaImagenSeleccionada}" alt="${fichaNombreSeleccionado}">
        <div style="font-weight:700;color:#2d3748;margin-bottom:14px;text-align:center;">${fichaNombreSeleccionado}</div>
        <button type="button" class="btn btn-success" style="width:100%;margin-bottom:8px;" onclick="copiarImagenSeleccionada()">📋 Copiar Imagen</button>
        <button type="button" class="btn" style="width:100%;background:#edf2f7;color:#2d3748;margin-bottom:8px;" onclick="descargarImagenSeleccionada()">⬇️ Descargar</button>
        <button type="button" class="btn" style="width:100%;background:#2d3748;color:white;margin-bottom:8px;" onclick="abrirModoPresentacion()">🔍 Modo Presentación</button>
        <button type="button" class="btn" style="width:100%;background:white;color:#4299e1;border:1.5px solid #4299e1;" onclick="abrirFichaTecnicaDesdeImagen()">📝 Crear Ficha Técnica</button>
    `;
}

// Muestra la imagen a pantalla completa, ajustada automáticamente al tamaño de la
// pantalla (monitor o celular). Se cierra tocando afuera, la X, o la tecla Escape.
function abrirModoPresentacion() {
    if (!fichaImagenSeleccionada) return;
    if (document.getElementById('modoPresentacionOverlay')) return; // ya está abierto

    const overlay = document.createElement('div');
    overlay.id = 'modoPresentacionOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,20,28,0.96);display:flex;align-items:center;justify-content:center;flex-direction:column;padding:16px;cursor:zoom-out;';
    overlay.innerHTML = `
        <button type="button" onclick="cerrarModoPresentacion()" title="Cerrar" style="position:absolute;top:14px;right:16px;background:rgba(255,255,255,0.12);color:white;border:none;width:40px;height:40px;border-radius:50%;font-size:1.3em;cursor:pointer;">✕</button>
        <img src="${fichaImagenSeleccionada}" alt="${fichaNombreSeleccionado}" style="max-width:96vw;max-height:88vh;width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,0.5);cursor:default;" onclick="event.stopPropagation()">
        <div style="color:white;margin-top:16px;font-weight:600;font-size:1.05em;text-align:center;padding:0 20px;">${fichaNombreSeleccionado}</div>
    `;
    overlay.onclick = cerrarModoPresentacion;
    document.addEventListener('keydown', cerrarModoPresentacionConEsc);
    document.body.appendChild(overlay);
}

function cerrarModoPresentacion() {
    const overlay = document.getElementById('modoPresentacionOverlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', cerrarModoPresentacionConEsc);
}

function cerrarModoPresentacionConEsc(e) {
    if (e.key === 'Escape') cerrarModoPresentacion();
}

// Copia la imagen seleccionada al portapapeles (funciona además con clic derecho > Copiar imagen sobre la foto)
// Back4App (parsefiles.back4app.com) no envía cabeceras CORS, así que el navegador
// bloquea leer los bytes de la imagen directo. Usamos un proxy de imágenes que sí las agrega,
// solo para copiar/descargar (la vista previa sigue cargando directo desde Back4App).
function obtenerUrlProxyCors(url) {
    const sinProtocolo = url.replace(/^https?:\/\//, '');
    return `https://images.weserv.nl/?url=${encodeURIComponent(sinProtocolo)}`;
}

async function copiarImagenSeleccionada() {
    if (!fichaImagenSeleccionada) return;
    try {
        const resp = await fetch(obtenerUrlProxyCors(fichaImagenSeleccionada));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch (errFormato) {
            // Algunos navegadores solo aceptan PNG en el portapapeles: convertimos como respaldo
            const pngBlob = await convertirImagenAPng(blob);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        }
        mostrarNotificacion('Imagen copiada al portapapeles', 'success');
    } catch (e) {
        console.error('Error al copiar imagen:', e);
        mostrarNotificacion('No se pudo copiar automáticamente. Prueba clic derecho sobre la imagen > Copiar imagen', 'warning');
    }
}

function convertirImagenAPng(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo convertir la imagen')), 'image/png');
            URL.revokeObjectURL(img.src);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
    });
}

// Descarga la imagen seleccionada al dispositivo
async function descargarImagenSeleccionada() {
    if (!fichaImagenSeleccionada) return;
    try {
        const resp = await fetch(obtenerUrlProxyCors(fichaImagenSeleccionada));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(fichaNombreSeleccionado || 'imagen').replace(/[^a-zA-Z0-9._-]/g, '_')}.${extension}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Error al descargar imagen:', e);
        window.open(fichaImagenSeleccionada, '_blank'); // respaldo: abre la imagen en otra pestaña
    }
}

// Abre el formulario de ficha técnica solo si el usuario lo pide explícitamente
function abrirFichaTecnicaDesdeImagen() {
    document.getElementById('fichaNombre').value = fichaNombreSeleccionado;
    document.getElementById('fichaCodigo').value = '';
    document.getElementById('fichaMarca').value = 'Línea Hotelera';
    document.getElementById('fichaPais').value = 'Perú';
    document.getElementById('fichaFormSection').style.display = 'block';
    document.getElementById('fichaFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('fichaCodigo').focus();
}

function mostrarVistaPrevia() {
    const preview = document.getElementById('fichaPreview');
    const html = generarHTMLFicha();
    preview.innerHTML = html;
}

function generarHTMLFicha() {
    const data = {
        codigo: document.getElementById('fichaCodigo').value,
        nombre: document.getElementById('fichaNombre').value,
        marca: document.getElementById('fichaMarca').value || 'Línea Hotelera',
        pais: document.getElementById('fichaPais').value || 'Perú',
        composicion: document.getElementById('fichaComposicion').value,
        gramaje: document.getElementById('fichaGramaje').value,
        dimensiones: document.getElementById('fichaDimensiones').value,
        peso: document.getElementById('fichaPeso').value,
        color: document.getElementById('fichaColor').value,
        acabado: document.getElementById('fichaAcabado').value,
        caracteristicas: document.getElementById('fichaCaracteristicas').value,
        lavado: document.getElementById('fichaLavado').value,
        uso: document.getElementById('fichaUso').value,
        garantia: document.getElementById('fichaGarantia').value,
        certificaciones: document.getElementById('fichaCertificaciones').value,
        notas: document.getElementById('fichaNotas').value
    };

    return `
        ${fichaImagenSeleccionada ? `
        <div class="ficha-section" style="text-align:center;">
            <img src="${fichaImagenSeleccionada}" alt="${data.nombre}" style="max-width:280px;max-height:280px;border-radius:10px;border:1.5px solid #e2e8f0;object-fit:cover;">
        </div>
        ` : ''}
        <div class="ficha-section">
            <h3>📋 Información General</h3>
            <div class="ficha-grid">
                <div class="ficha-item">
                    <div class="ficha-item-label">Código</div>
                    <div class="ficha-item-value">${data.codigo || '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Marca</div>
                    <div class="ficha-item-value">${data.marca || '-'}</div>
                </div>
                <div class="ficha-item" style="grid-column: 1/-1;">
                    <div class="ficha-item-label">Producto</div>
                    <div class="ficha-item-value" style="font-size: 1.2em; font-weight: 600;">${data.nombre || '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">País de Origen</div>
                    <div class="ficha-item-value">${data.pais || '-'}</div>
                </div>
            </div>
        </div>

        <div class="ficha-section">
            <h3>🔧 Especificaciones Técnicas</h3>
            <div class="ficha-grid">
                <div class="ficha-item">
                    <div class="ficha-item-label">Composición</div>
                    <div class="ficha-item-value">${data.composicion || '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Gramaje</div>
                    <div class="ficha-item-value">${data.gramaje ? data.gramaje + ' gr/m²' : '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Dimensiones</div>
                    <div class="ficha-item-value">${data.dimensiones || '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Peso</div>
                    <div class="ficha-item-value">${data.peso ? data.peso + ' kg' : '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Color(es)</div>
                    <div class="ficha-item-value">${data.color || '-'}</div>
                </div>
                <div class="ficha-item">
                    <div class="ficha-item-label">Acabado</div>
                    <div class="ficha-item-value">${data.acabado || '-'}</div>
                </div>
            </div>
        </div>

        ${data.caracteristicas ? `
        <div class="ficha-section">
            <h3>⭐ Características</h3>
            <div class="ficha-item">
                <div style="white-space: pre-line; line-height: 1.8;">${data.caracteristicas}</div>
            </div>
        </div>
        ` : ''}

        ${data.lavado ? `
        <div class="ficha-section">
            <h3>🧼 Instrucciones de Cuidado</h3>
            <div class="ficha-item">
                <div style="white-space: pre-line; line-height: 1.8;">${data.lavado}</div>
            </div>
        </div>
        ` : ''}

        ${data.uso ? `
        <div class="ficha-section">
            <h3>🏨 Uso y Aplicaciones</h3>
            <div class="ficha-item">
                <div style="white-space: pre-line; line-height: 1.8;">${data.uso}</div>
            </div>
        </div>
        ` : ''}

        <div class="ficha-section">
            <h3>📋 Información Adicional</h3>
            <div class="ficha-grid">
                ${data.garantia ? `
                <div class="ficha-item">
                    <div class="ficha-item-label">Garantía</div>
                    <div class="ficha-item-value">${data.garantia}</div>
                </div>
                ` : ''}
                ${data.certificaciones ? `
                <div class="ficha-item">
                    <div class="ficha-item-label">Certificaciones</div>
                    <div class="ficha-item-value">${data.certificaciones}</div>
                </div>
                ` : ''}
                ${data.notas ? `
                <div class="ficha-item" style="grid-column: 1/-1;">
                    <div class="ficha-item-label">Notas</div>
                    <div class="ficha-item-value" style="white-space: pre-line;">${data.notas}</div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

async function generarFichaPDF() {
    const codigo = document.getElementById('fichaCodigo').value;
    const nombre = document.getElementById('fichaNombre').value;
    
    if (!codigo || !nombre) {
        mostrarNotificacion('Selecciona un producto primero', 'warning');
        return;
    }

    showLoading(true);

    try {
        // Preparar fecha
        const fecha = new Date();
        const opciones = { year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('fichaPrintFecha').textContent = fecha.toLocaleDateString('es-PE', opciones);

        // Generar contenido
        document.getElementById('fichaPrintContent').innerHTML = generarHTMLFicha();

        await new Promise(resolve => setTimeout(resolve, 500));

        const element = document.getElementById('fichaPrint');

        const canvas = await html2canvas(element, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: true,
            width: 900,
            height: element.scrollHeight
        });

        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        pdf.save(`FichaTecnica_${codigo}_${Date.now()}.pdf`);

        showLoading(false);
        mostrarNotificacion('Ficha técnica generada exitosamente', 'success');
    } catch (error) {
        console.error('Error:', error);
        showLoading(false);
        mostrarNotificacion('Error al generar ficha técnica', 'error');
    }
}

        const CANTIDAD_PAQUETE_DEFAULT = 32; // Ajustable a futuro (Fernando lo modifica aquí o por producto)

        function crearProducto(p) {
            // Normaliza un producto y crea alias de compatibilidad (precioUnd/precioMayor)
            return {
                codigo: p.codigo,
                nombre: p.nombre,
                marca: p.marca || '',
                precioUnd: p.precioUnd,
                precioCuarto: p.precioCuarto !== undefined ? p.precioCuarto : null,
                precioMayor: p.precioMayor !== undefined ? p.precioMayor : p.precioUnd,
                escalonado: p.escalonado || false,
                tipoMayor: p.tipoMayor || 'docena',
                cantidadCuarto: p.cantidadCuarto || 3,
                cantidadMayor: p.cantidadMayor || (p.tipoMayor === 'paquete' ? CANTIDAD_PAQUETE_DEFAULT : 12),
                nota: p.nota || '',
                // Productos creados sobre la marcha desde el buscador (código "NP-####") quedan
                // exentos del control de Kardex por defecto — ver crearYGuardarProductoGenerico().
                sinKardex: !!p.sinKardex
            };
        }

        let productosDB = [
            // ===================================================================
            // PRODUCTOS EXISTENTES (precios propios de Fabexsa/Confort Line)
            // ===================================================================
            crearProducto({ codigo: "7015", nombre: "Toalla Belleza Baño 150x75cm - San Jacinto 380gr", precioUnd: 25, precioCuarto: 22, precioMayor: 18, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7016", nombre: "Toalla Belleza Mano 75x40cm - San Jacinto 380gr", precioUnd: 10, precioCuarto: 8, precioMayor: 6, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7018", nombre: "Toalla Belleza Mediana 120x60cm - San Jacinto 380gr", precioUnd: 16, precioCuarto: 14, precioMayor: 12, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7041", nombre: "Toalla Touch Baño 140x70cm - San Jacinto 450gr", precioUnd: 28, precioCuarto: 25, precioMayor: 20, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7042", nombre: "Toalla Touch Mano 60x40cm - San Jacinto 450gr", precioUnd: 10, precioCuarto: 8, precioMayor: 6.5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7043", nombre: "Toalla Touch Mediana 120x60cm - San Jacinto 450gr", precioUnd: 20, precioCuarto: 18, precioMayor: 15, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7066", nombre: "Toalla Class Dorada Baño 145x75cm - San Jacinto 650gr", precioUnd: 45, precioCuarto: 40, precioMayor: 38, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7067", nombre: "Toalla Class Dorada Mano 70x45cm - San Jacinto 650gr", precioUnd: 18, precioCuarto: 16, precioMayor: 14, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "7069", nombre: "Toalla Class Dorada Extrabaño 180x80cm - San Jacinto 650gr", precioUnd: 65, precioCuarto: 60, precioMayor: 57, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "BEL-001", nombre: "Toalla Belén Baño 140x70cm - La Bellota 400gr", precioUnd: 30, precioCuarto: 27, precioMayor: 24, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "BEL-002", nombre: "Toalla Belén Mediana 120x60cm - La Bellota 400gr", precioUnd: 20, precioCuarto: 18, precioMayor: 15.5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "BEL-003", nombre: "Toalla Belén Mano 40x60cm - La Bellota 400gr", precioUnd: 10, precioCuarto: 8, precioMayor: 6.5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "BEL-004", nombre: "Toalla Belén Facial 30x30cm - La Bellota 400gr", precioUnd: 6, precioCuarto: 4, precioMayor: 3.5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "BEL-005", nombre: "Toalla Belén Super 30x50cm - La Bellota 400gr", precioUnd: 8, precioCuarto: 6, precioMayor: 5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "SIL-001", nombre: "Toalla Silver Hotel Extrabaño 170x90cm - La Bellota 560gr", precioUnd: 60, precioCuarto: 56, precioMayor: 52, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "SIL-002", nombre: "Toalla Silver Hotel Baño 140x75cm - La Bellota 560gr", precioUnd: 45, precioCuarto: 40, precioMayor: 35, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "SIL-003", nombre: "Toalla Silver Hotel Mano 70x40cm - La Bellota 560gr", precioUnd: 16, precioCuarto: 14, precioMayor: 11, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "SIL-004", nombre: "Toalla Silver Hotel Facial 33x33cm - La Bellota 560gr", precioUnd: 8, precioCuarto: 6, precioMayor: 5, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "GL-001", nombre: "Toalla Gold Label Extrabaño 170x90cm - La Bellota 560gr", precioUnd: 60, precioCuarto: 56, precioMayor: 52, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "GL-002", nombre: "Toalla Gold Label Baño 140x75cm - La Bellota 560gr", precioUnd: 45, precioCuarto: 40, precioMayor: 35, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
crearProducto({ codigo: "GL-003", nombre: "Toalla Gold Label Mano 70x40cm - La Bellota 560gr", precioUnd: 16, precioCuarto: 14, precioMayor: 11, escalonado: true, tipoMayor: 'docena', cantidadMayor: 12 }),
            crearProducto({ codigo: "SAB-001", nombre: "Juego Sábanas 144 Hilos - 1.5 Plz", precioUnd: 63.00, precioMayor: 63.00 }),
            crearProducto({ codigo: "SAB-002", nombre: "Juego Sábanas 144 Hilos - 2 Plz", precioUnd: 75.00, precioMayor: 75.00 }),
            crearProducto({ codigo: "SAB-003", nombre: "Juego Sábanas 144 Hilos - Queen", precioUnd: 88.00, precioMayor: 88.00 }),
            crearProducto({ codigo: "SAB-004", nombre: "Juego Sábanas 144 Hilos - King", precioUnd: 107.00, precioMayor: 107.00 }),
            crearProducto({ codigo: "SAB-005", nombre: "Juego Sábanas 200 Hilos - 1.5 Plz", precioUnd: 94.00, precioMayor: 94.00 }),
            crearProducto({ codigo: "SAB-006", nombre: "Juego Sábanas 200 Hilos - 2 Plz", precioUnd: 112.00, precioMayor: 112.00 }),
            crearProducto({ codigo: "SAB-007", nombre: "Juego Sábanas 200 Hilos - Queen", precioUnd: 125.00, precioMayor: 125.00 }),
            crearProducto({ codigo: "SAB-008", nombre: "Juego Sábanas 200 Hilos - King", precioUnd: 157.00, precioMayor: 157.00 }),
            crearProducto({ codigo: "DUV-001", nombre: "Duvet 144 Hilos - 1.5 Plz", precioUnd: 72.50, precioMayor: 72.50 }),
            crearProducto({ codigo: "DUV-002", nombre: "Duvet 144 Hilos - 2 Plz", precioUnd: 85.00, precioMayor: 85.00 }),
            crearProducto({ codigo: "DUV-003", nombre: "Duvet 144 Hilos - Queen", precioUnd: 94.00, precioMayor: 94.33 }),
            crearProducto({ codigo: "DUV-004", nombre: "Duvet 144 Hilos - King", precioUnd: 106.00, precioMayor: 106.00 }),
            crearProducto({ codigo: "DUV-005", nombre: "Duvet 200 Hilos - 1.5 Plz", precioUnd: 91.00, precioMayor: 91.00 }),
            crearProducto({ codigo: "DUV-006", nombre: "Duvet 200 Hilos - 2 Plz", precioUnd: 106.00, precioMayor: 106.00 }),
            crearProducto({ codigo: "DUV-007", nombre: "Duvet 200 Hilos - Queen", precioUnd: 119.00, precioMayor: 119.00 }),
            crearProducto({ codigo: "DUV-008", nombre: "Duvet 200 Hilos - King", precioUnd: 131.00, precioMayor: 131.00 }),
            crearProducto({ codigo: "PRO-001", nombre: "Protector Colchón - 1.5 Plz", precioUnd: 81.00, precioMayor: 81.00 }),
            crearProducto({ codigo: "PRO-002", nombre: "Protector Colchón - 2 Plz", precioUnd: 93.00, precioMayor: 93.00 }),
            crearProducto({ codigo: "PRO-003", nombre: "Protector Colchón - Queen", precioUnd: 108.00, precioMayor: 108.00 }),
            crearProducto({ codigo: "PRO-004", nombre: "Protector Colchón - King", precioUnd: 119.00, precioMayor: 119.00 }),
            crearProducto({ codigo: "ALM-001", nombre: "Almohada 60x40 cm", precioUnd: 19.00, precioMayor: 19.00 }),
            crearProducto({ codigo: "FUN-001", nombre: "Funda Almohada 144 Hilos", precioUnd: 9.00, precioMayor: 9.00 }),
            crearProducto({ codigo: "FUN-002", nombre: "Funda Almohada 200 Hilos", precioUnd: 11.00, precioMayor: 11.00 }),
            crearProducto({ codigo: "BAT-001", nombre: "Bata Manga 3/4 - S y M", precioUnd: 64.00, precioMayor: 64.00 }),
            crearProducto({ codigo: "BAT-002", nombre: "Bata Manga 3/4 - L y XL", precioUnd: 74.00, precioMayor: 74.00 }),
            crearProducto({ codigo: "PIS-001", nombre: "Piso para Ducha 50x75 - 560gr", precioUnd: 31.00, precioMayor: 31.00 }),
            crearProducto({ codigo: "MAN-001", nombre: "Manta Felpa Polar - 1.5 Plz", precioUnd: 55.00, precioMayor: 50.00 }),
            crearProducto({ codigo: "MAN-002", nombre: "Manta Felpa Polar - 2.0 Plz", precioUnd: 59.00, precioMayor: 62.50 }),
            crearProducto({ codigo: "MAN-003", nombre: "Frazada de Polar - 1.5 Plz", precioUnd: 50.00, precioMayor: 50.00 }),
            crearProducto({ codigo: "MAN-004", nombre: "Frazada de Polar - 2.0 Plz", precioUnd: 56.00, precioMayor: 56.00 }),
            crearProducto({ codigo: "MAN-005", nombre: "Frazada de Polar - Queen Plz", precioUnd: 63.00, precioMayor: 63.00 }),
            crearProducto({ codigo: "MAN-006", nombre: "Frazada de Polar - King Plz", precioUnd: 75.00, precioMayor: 75.00 }),
            crearProducto({ codigo: "FRA-001", nombre: "Frazada Bandera - 1.5 Plz", precioUnd: 39.00, precioMayor: 23.00 }),
            crearProducto({ codigo: "FRA-002", nombre: "Frazada Bandera - 2.0 Plz", precioUnd: 45.00, precioMayor: 24.00 }),
            crearProducto({ codigo: "P000-76", nombre: "Cubreduvet - Queen - hilos 200", precioUnd: 166.00, precioMayor: 156.00 }),
            crearProducto({ codigo: "P000-51", nombre: "Cubreduvet - King - hilos 200", precioUnd: 178.00, precioMayor: 168.00 }),
            crearProducto({ codigo: "P000-49", nombre: "Cubreduvet - 2.0 Plz - hilos 200", precioUnd: 152.00, precioMayor: 142.00 }),
            crearProducto({ codigo: "P000-48", nombre: "Cubreduvet - 1.5 Plz - hilos 200", precioUnd: 139.00, precioMayor: 129.00 }),
            crearProducto({ codigo: "BOR-001", nombre: "Bordado", precioUnd: 3, precioMayor: 3 }),
            crearProducto({ codigo: "PRM-001", nombre: "Frazada polar + Juegos de sabanas 1.5 plz", precioUnd: 85, precioMayor: 85 }),
            crearProducto({ codigo: "PRM-002", nombre: "Frazada polar + Juegos de sabanas 2 plz", precioUnd: 100, precioMayor: 100 }),
            crearProducto({ codigo: "PRM-003", nombre: "Frazada polar + Juegos de sabanas Queen plz", precioUnd: 115, precioMayor: 115 }),
            crearProducto({ codigo: "PRM-004", nombre: "Frazada polar + Juegos de sabanas King", precioUnd: 140, precioMayor: 140 }),
            crearProducto({ codigo: "PRM-005", nombre: "Frazada polar + Juegos de sabanas 1.5 plz 200 H", precioUnd: 144, precioMayor: 144 }),
            crearProducto({ codigo: "PRM-006", nombre: "Frazada polar + Juegos de sabanas 2 plz 200 H", precioUnd: 109, precioMayor: 109 }),
            crearProducto({ codigo: "PRM-007", nombre: "Frazada poLar + Juegos de sabanas Queen 200 H", precioUnd: 139, precioMayor: 139 }),
            crearProducto({ codigo: "PRM-008", nombre: "Frazada polar + Juegos de sabanas King 200 H", precioUnd: 159, precioMayor: 159 }),
            crearProducto({ codigo: "PRM-009", nombre: "Frazada polar + Juegos de sabanas 2 plz 300 HILOS", precioUnd: 347.5, precioMayor: 347.5 }),
            crearProducto({ codigo: "PRM-010", nombre: "Frazada polar + Juegos de sabanas Queen 300 HILOS", precioUnd: 350, precioMayor: 350 }),

            // ===================================================================
            // PRECIOS DEL CATÁLOGO FABEXSA 2026 (PDF) — con 3 niveles: Und / 1-4 Docena / Docena
            // NOTA: en el PDF algunos productos muestran la 1ra columna como "PAQUETE" (20/30/50 und)
            // en vez de "UNIDAD". Se transcribió el precio en el mismo orden del PDF (Und > Cuarto > Mayor).
            // Verifica/ajusta "cantidadMayor" y "tipoMayor" por producto si corresponde usar "paquete" en vez de "docena".
            // ===================================================================

            // SAN JACINTO - Línea BELLEZA (380gr)
            crearProducto({ codigo: "CAT-SJ-BEL-BAN", nombre: "Toalla Belleza Baño 150x75cm - San Jacinto 380gr", marca: "San Jacinto", precioUnd: 25, precioCuarto: 22, precioMayor: 18, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 20 und' }),
            crearProducto({ codigo: "CAT-SJ-BEL-MED", nombre: "Toalla Belleza Mediana 120x60cm - San Jacinto 380gr", marca: "San Jacinto", precioUnd: 16, precioCuarto: 14, precioMayor: 12, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 30 und' }),
            crearProducto({ codigo: "CAT-SJ-BEL-MAN", nombre: "Toalla Belleza Mano 75x40cm - San Jacinto 380gr", marca: "San Jacinto", precioUnd: 10, precioCuarto: 8, precioMayor: 6, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 50 und' }),

            // SAN JACINTO - Línea TOUCH (450gr)
            crearProducto({ codigo: "CAT-SJ-TOU-BAN", nombre: "Toalla Touch Baño 140x70cm - San Jacinto 450gr", marca: "San Jacinto", precioUnd: 28, precioCuarto: 25, precioMayor: 20, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 20 und' }),
            crearProducto({ codigo: "CAT-SJ-TOU-MED", nombre: "Toalla Touch Mediana 120x60cm - San Jacinto 450gr", marca: "San Jacinto", precioUnd: 20, precioCuarto: 18, precioMayor: 15, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 30 und' }),
            crearProducto({ codigo: "CAT-SJ-TOU-MAN", nombre: "Toalla Touch Mano 60x40cm - San Jacinto 450gr", marca: "San Jacinto", precioUnd: 10, precioCuarto: 8, precioMayor: 6.5, escalonado: true, tipoMayor: 'docena', nota: 'PDF indica paquete de 50 und' }),

            // SAN JACINTO - Línea CLASS DORADA (650gr)
            crearProducto({ codigo: "CAT-SJ-CD-EXTRA", nombre: "Toalla Class Dorada Extrabaño 180x80cm - San Jacinto 650gr", marca: "San Jacinto", precioUnd: 65, precioCuarto: 60, precioMayor: 57, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SJ-CD-BANO", nombre: "Toalla Class Dorada Baño 145x75cm - San Jacinto 650gr", marca: "San Jacinto", precioUnd: 45, precioCuarto: 40, precioMayor: 38, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SJ-CD-MANO", nombre: "Toalla Class Dorada Mano 80x45cm - San Jacinto 650gr", marca: "San Jacinto", precioUnd: 18, precioCuarto: 16, precioMayor: 14, escalonado: true, tipoMayor: 'docena' }),

            // LA BELLOTA - Línea BELÉN (400gr)
            crearProducto({ codigo: "CAT-LB-BLN-BAN", nombre: "Toalla Belén Baño 140x70cm - La Bellota 400gr", marca: "La Bellota", precioUnd: 30, precioCuarto: 27, precioMayor: 24, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-BLN-MED", nombre: "Toalla Belén Mediana 120x60cm - La Bellota 400gr", marca: "La Bellota", precioUnd: 20, precioCuarto: 18, precioMayor: 15.5, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-BLN-MAN", nombre: "Toalla Belén Mano 40x60cm - La Bellota 400gr", marca: "La Bellota", precioUnd: 10, precioCuarto: 8, precioMayor: 6.5, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-BLN-FAC", nombre: "Toalla Belén Facial 30x30cm - La Bellota 400gr", marca: "La Bellota", precioUnd: 6, precioCuarto: 4, precioMayor: 3.5, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-BLN-SUP", nombre: "Toalla Belén Super 30x50cm - La Bellota 400gr", marca: "La Bellota", precioUnd: 8, precioCuarto: 6, precioMayor: 5, escalonado: true, tipoMayor: 'docena' }),

            // LA BELLOTA - Línea SILVER HOTEL (560gr)
            crearProducto({ codigo: "CAT-LB-SIL-EXTRA", nombre: "Toalla Silver Hotel Extrabaño 170x90cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 60, precioCuarto: 56, precioMayor: 52, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-SIL-BANO", nombre: "Toalla Silver Hotel Baño 140x75cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 45, precioCuarto: 40, precioMayor: 35, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-SIL-MANO", nombre: "Toalla Silver Hotel Mano 70x40cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 16, precioCuarto: 14, precioMayor: 11, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-SIL-FAC", nombre: "Toalla Silver Hotel Facial 33x33cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 8, precioCuarto: 6, precioMayor: 5, escalonado: true, tipoMayor: 'docena' }),

            // LA BELLOTA - Línea GOLD LABEL (560gr)
            crearProducto({ codigo: "CAT-LB-GL-EXTRA", nombre: "Toalla Gold Label Extrabaño 170x90cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 60, precioCuarto: 56, precioMayor: 52, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-GL-BANO", nombre: "Toalla Gold Label Baño 140x75cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 45, precioCuarto: 40, precioMayor: 35, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-LB-GL-MANO", nombre: "Toalla Gold Label Mano 70x40cm - La Bellota 560gr", marca: "La Bellota", precioUnd: 16, precioCuarto: 14, precioMayor: 11, escalonado: true, tipoMayor: 'docena' }),

            // PISO DE BAÑO
            crearProducto({ codigo: "CAT-PIS-BANO", nombre: "Piso de Baño 400gr", precioUnd: 25, precioCuarto: 23, precioMayor: 20, escalonado: true, tipoMayor: 'docena' }),

            // SALIDAS DE BAÑO (Terciopelo 420gr) - precio único todas las tallas
            crearProducto({ codigo: "CAT-SAL-S", nombre: "Salida de Baño Talla S - Terciopelo 420gr", precioUnd: 45, precioMayor: 45, escalonado: false }),
            crearProducto({ codigo: "CAT-SAL-M", nombre: "Salida de Baño Talla M - Terciopelo 420gr", precioUnd: 45, precioMayor: 45, escalonado: false }),
            crearProducto({ codigo: "CAT-SAL-L", nombre: "Salida de Baño Talla L - Terciopelo 420gr", precioUnd: 45, precioMayor: 45, escalonado: false }),
            crearProducto({ codigo: "CAT-SAL-XL", nombre: "Salida de Baño Talla XL - Terciopelo 420gr", precioUnd: 45, precioMayor: 45, escalonado: false }),

            // SET DESCANSO (Sábanas + Frazada Polar 300gr) - precio único
            crearProducto({ codigo: "CAT-SET-1.5", nombre: "Set Descanso 1.5 Plz (Sábanas + Frazada Polar 300gr)", precioUnd: 85, precioMayor: 85, escalonado: false }),
            crearProducto({ codigo: "CAT-SET-2", nombre: "Set Descanso 2 Plz (Sábanas + Frazada Polar 300gr)", precioUnd: 100, precioMayor: 100, escalonado: false }),
            crearProducto({ codigo: "CAT-SET-Q", nombre: "Set Descanso Queen (Sábanas + Frazada Polar 300gr)", precioUnd: 115, precioMayor: 115, escalonado: false }),
            crearProducto({ codigo: "CAT-SET-K", nombre: "Set Descanso King (Sábanas + Frazada Polar 300gr)", precioUnd: 140, precioMayor: 140, escalonado: false }),

            // MANTAS POLARES HIPOALERGÉNICAS (270gr, venta por rollo) - precio único
            crearProducto({ codigo: "CAT-MANPOL-1.5", nombre: "Manta Polar Hipoalergénica 1.5 Plz (1.60x2.40) 270gr", precioUnd: 40, precioMayor: 40, escalonado: false }),
            crearProducto({ codigo: "CAT-MANPOL-2", nombre: "Manta Polar Hipoalergénica 2 Plz (2.00x2.40) 270gr", precioUnd: 45, precioMayor: 45, escalonado: false }),
            crearProducto({ codigo: "CAT-MANPOL-Q", nombre: "Manta Polar Hipoalergénica Queen (2.50x2.40) 270gr", precioUnd: 50, precioMayor: 50, escalonado: false }),
            crearProducto({ codigo: "CAT-MANPOL-K", nombre: "Manta Polar Hipoalergénica King (3.00x2.40) 270gr", precioUnd: 60, precioMayor: 60, escalonado: false }),

            // SÁBANAS 144 / 200 / 300 HILOS (100% Algodón Peruano) - Und / Docena
            crearProducto({ codigo: "CAT-SAB144-1.5", nombre: "Juego Sábanas 144 Hilos - 1.5 Plz (Catálogo)", precioUnd: 50, precioMayor: 45, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB144-2", nombre: "Juego Sábanas 144 Hilos - 2 Plz (Catálogo)", precioUnd: 60, precioMayor: 55, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB144-Q", nombre: "Juego Sábanas 144 Hilos - Queen (Catálogo)", precioUnd: 70, precioMayor: 65, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB144-K", nombre: "Juego Sábanas 144 Hilos - King (Catálogo)", precioUnd: 85, precioMayor: 80, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB200-1.5", nombre: "Juego Sábanas 200 Hilos - 1.5 Plz (Catálogo)", precioUnd: 75, precioMayor: 68, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB200-2", nombre: "Juego Sábanas 200 Hilos - 2 Plz (Catálogo)", precioUnd: 90, precioMayor: 85, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB200-Q", nombre: "Juego Sábanas 200 Hilos - Queen (Catálogo)", precioUnd: 100, precioMayor: 95, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB200-K", nombre: "Juego Sábanas 200 Hilos - King (Catálogo)", precioUnd: 125, precioMayor: 120, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB300-1.5", nombre: "Juego Sábanas 300 Hilos - 1.5 Plz (Catálogo)", precioUnd: 160, precioMayor: 145, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB300-2", nombre: "Juego Sábanas 300 Hilos - 2 Plz (Catálogo)", precioUnd: 195, precioMayor: 185, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB300-Q", nombre: "Juego Sábanas 300 Hilos - Queen (Catálogo)", precioUnd: 215, precioMayor: 205, escalonado: true, tipoMayor: 'docena' }),
            crearProducto({ codigo: "CAT-SAB300-K", nombre: "Juego Sábanas 300 Hilos - King (Catálogo)", precioUnd: 260, precioMayor: 245, escalonado: true, tipoMayor: 'docena' }),

            // DUVETS NACIONAL - el PDF solo publica precio x docena (sin precio unitario)
            crearProducto({ codigo: "CAT-DUVNAC-1.5", nombre: "Duvet Nacional 1.5 Plz (Catálogo)", precioUnd: 88, precioMayor: 88, escalonado: false, nota: 'Precio x docena en PDF; no publica precio unitario' }),
            crearProducto({ codigo: "CAT-DUVNAC-2", nombre: "Duvet Nacional 2 Plz (Catálogo)", precioUnd: 102, precioMayor: 102, escalonado: false, nota: 'Precio x docena en PDF; no publica precio unitario' }),
            crearProducto({ codigo: "CAT-DUVNAC-Q", nombre: "Duvet Nacional Queen (Catálogo)", precioUnd: 114, precioMayor: 114, escalonado: false, nota: 'Precio x docena en PDF; no publica precio unitario' }),
            crearProducto({ codigo: "CAT-DUVNAC-K", nombre: "Duvet Nacional King (Catálogo)", precioUnd: 126, precioMayor: 126, escalonado: false, nota: 'Precio x docena en PDF; no publica precio unitario' }),

            // PROTECTORES DE COLCHÓN (Bambú) - precio único
            crearProducto({ codigo: "CAT-PROBAM-1.5", nombre: "Protector de Colchón 1.5 Plz - Bambú (Catálogo)", precioUnd: 45, precioMayor: 45, escalonado: false }),
            crearProducto({ codigo: "CAT-PROBAM-2", nombre: "Protector de Colchón 2 Plz - Bambú (Catálogo)", precioUnd: 50, precioMayor: 50, escalonado: false }),
            crearProducto({ codigo: "CAT-PROBAM-Q", nombre: "Protector de Colchón Queen - Bambú (Catálogo)", precioUnd: 55, precioMayor: 55, escalonado: false }),
            crearProducto({ codigo: "CAT-PROBAM-K", nombre: "Protector de Colchón King - Bambú (Catálogo)", precioUnd: 60, precioMayor: 60, escalonado: false }),

            // ALMOHADAS - precio por pack de 2 unidades (no por unidad individual)
            crearProducto({ codigo: "CAT-ALM-PACK2", nombre: "Almohada 65x45cm - Pack 2 Und (Napa Siliconada)", precioUnd: 28, precioMayor: 28, escalonado: false, nota: 'Precio por el pack completo de 2 unidades' })
        ];

        // BASE DE DATOS COMPLETA DE SUCURSALES SHALOM (TODAS LAS SUCURSALES DEL DOCUMENTO)
        let sucursalesDB = [
            {nombre:"Chorrillos Los Faisanes",direccion:"Av. Los Faisanes 420",tipo:"Micro",ciudad:"Chorrillos",provincia:"Lima"},
            {nombre:"Chorrillos Co",direccion:"Av. Santa Anita N.° 580",tipo:"Grande / Co",ciudad:"Chorrillos",provincia:"Lima"},
            {nombre:"Las Delicias De Villa",direccion:"Av. 12 De Octubre Mz. A - 03, Lt. 02",tipo:"Pequeña",ciudad:"Villa",provincia:"Lima"},
            {nombre:"Los Sauces",direccion:"Av. Santa Rosa N°773 Manzana a Lote 6",tipo:"Pequeña",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Puente Santa Anita",direccion:"Av. Nicolás Ayllón N° 3080",tipo:"Micro",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Jr. Huaraz - Breña",direccion:"Jr. Huaraz 1633",tipo:"Pequeña",ciudad:"Breña",provincia:"Lima"},
            {nombre:"Lima Av Tingo María",direccion:"Av. Tingo María N°1252-a",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Malvinas - Jr. Ricardo Treneman",direccion:"Jr. Ricardo Treneman N° 920",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Malvinas - Jr. Garcia Villón",direccion:"Jr. Presbítero García Villon Nro. 560",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Venezuela",direccion:"Av. Venezuela 1670",tipo:"Micro",ciudad:"Breña",provincia:"Lima"},
            {nombre:"Bellavista Callao",direccion:"Av. Elmer Faucett 1641",tipo:"Pequeña",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Av El Sol",direccion:"Av. El Sol Mz. S Lt. 2",tipo:"Mediana",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Urb Santa Elvira",direccion:"Av. Ferrocarril Mz. C Lt. 19",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Callao Faucett",direccion:"Av. Elmer Faucett N° 492",tipo:"Mediana",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Ovalo La Perla",direccion:"Av. La Marina 530",tipo:"Mini-micro",ciudad:"La Perla",provincia:"Callao"},
            {nombre:"Av Marco Puente",direccion:"Av. Marco Puente Llanos 309",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Quilca",direccion:"Unidad Inmobiliaria N° 1, Av. Quilca Mz. G",tipo:"Micro",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Av Esperanza",direccion:"Av. Esperanza Mz. R Lt. 7",tipo:"Pequeña",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Cieneguilla Km. 14.5",direccion:"Av. Arterial Huarochiri d Mz. B Lt. 19",tipo:"Pequeña",ciudad:"Cieneguilla",provincia:"Lima"},
            {nombre:"Reparto San Luis",direccion:"San Luis",tipo:"Terminal",ciudad:"San Luis",provincia:"Lima"},
            {nombre:"Av Saenz Peña",direccion:"Av. Saenz Peña N° 414 - 416",tipo:"Pequeña",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Santa Clara",direccion:"Av. Pedro Ruíz Gallo Mz. H Lt. 3",tipo:"Mediana",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Av. Canta Callao",direccion:"Av. Canta Callao 10 - Parcela 2a Local 109",tipo:"Pequeña",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Av Bertello",direccion:"Av. Alejandro Bertello Bollati mz. B Lt. 20 Y 21",tipo:"Pequeña",ciudad:"Callao",provincia:"Callao"},
            {nombre:"Huaycan El Descanso",direccion:"Av. Jose Carlos Mariategui Mza. B Lte 06",tipo:"Pequeña",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Huaycan Av Horacio Zevallos",direccion:"Av. Horacio Zeballos Mz. V Lt. 12",tipo:"Mediana",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Huaycan Entrada",direccion:"Carretera Central Km 17 Mz. E Lt. 1",tipo:"Mediana",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Huaycan Av Jose C Mariategui",direccion:"Av. José Carlos Mariátegui Z. E Lt. 23",tipo:"Pequeña",ciudad:"Ate",provincia:"Lima"},
            {nombre:"Av Univ. Retablo",direccion:"Av. Universitaria N° 7241",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Carabayllo Establo",direccion:"Av. Tupac Amaru N? 441 - 443",tipo:"Micro",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"Tungasuca",direccion:"Av. Trapiche Mz. P Lt. 48",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Tupac Amaru Km. 19",direccion:"Av. Tupac Amaru N° 10472",tipo:"Mediana",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"Santo Domingo",direccion:"Av. A Mz. l2 Lt. 20",tipo:"Pequeña",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"El Progreso Km 22",direccion:"Av. Tupac Amaru 3493",tipo:"Micro",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"Av Jose Saco Rojas",direccion:"Av. José Saco Rojas Mz. A Lt. 15",tipo:"Pequeña",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"Ventanilla",direccion:"Calle 19, Mz. J Lt. 26 Zn",tipo:"Pequeña",ciudad:"Ventanilla",provincia:"Callao"},
            {nombre:"Av. Tupac Amaru Km. 23.5",direccion:"Av. Túpac Amaru Km. 23.5",tipo:"Pequeña",ciudad:"Carabayllo",provincia:"Lima"},
            {nombre:"Mi Peru",direccion:"V. Victor Raul Haya De La Torre Mz. A Lt. 02",tipo:"Micro",ciudad:"Mi Peru",provincia:"Callao"},
            {nombre:"Pachacútec",direccion:"Urb. Popular De Interés Social, Mz. A, Lt. 23",tipo:"Pequeña",ciudad:"Pachacutec",provincia:"Callao"},
            {nombre:"La Oroya",direccion:"Av. Arévalo S/n (carretera Central)",tipo:"Grande / Co",ciudad:"La Oroya",provincia:"Junín"},
            {nombre:"Tarma",direccion:"Jr. Amazonas Nro. 1164",tipo:"Grande / Co",ciudad:"Tarma",provincia:"Junín"},
            {nombre:"Chincha Pueblo Nuevo",direccion:"Aa. Hh. Los Alamos, Calle Los Laureles Mz. 17 Lt. 11- A",tipo:"Micro E/r",ciudad:"Chincha",provincia:"Ica"},
            {nombre:"Sunampe Co",direccion:"Carr. Panamericana sur Nro. 198 -b",tipo:"Grande / Co",ciudad:"Sunampe",provincia:"Ica"},
            {nombre:"Prolong Luis Massaro",direccion:"Prolongacion Luis Massaro N°247",tipo:"Micro E/r",ciudad:"Chincha Alta",provincia:"Ica"},
            {nombre:"Jauja",direccion:"Jr. Estanislao Marquez 286",tipo:"Mediana",ciudad:"Jauja",provincia:"Junín"},
            {nombre:"Calle Los Angeles",direccion:"Calle Los Ángeles N° Casa 217 01 - A",tipo:"Micro E/r",ciudad:"Chincha Alta",provincia:"Ica"},
            {nombre:"Concepcion",direccion:"Carretera Central Lt. 7 - Mz. E5",tipo:"Grande / Co",ciudad:"Concepcion",provincia:"Junín"},
            {nombre:"Chupaca",direccion:"Jr. Ramon Castilla 201",tipo:"Pequeña",ciudad:"Chupaca",provincia:"Junín"},
            {nombre:"Pilcomayo",direccion:"Plaza Independencia 131",tipo:"Pequeña",ciudad:"Pilcomayo",provincia:"Junín"},
            {nombre:"San Agustin De Cajas",direccion:"Carretera Central Km 7.5 S/n",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Terminal De Bus",direccion:"Av. Evitamiento S/n - Counter N°13",tipo:"Terminal",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Av Mariscal Castilla Co Parque Industrial",direccion:"Av Mariscal Castilla 2769",tipo:"Grande / Co",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Ciudad Universitaria",direccion:"Jr Tarma Nro. 37 - 24",tipo:"Micro",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"San Clemente",direccion:"Av. Los Libertadores Grupo Número 1 Mz,91 Lote 7ª",tipo:"Micro",ciudad:"Pisco",provincia:"Ica"},
            {nombre:"Pio Pata",direccion:"Av. Huancavelica 1201",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Av Abraham Valdelomar Co",direccion:"Av. Abraham Valdelomar S/n",tipo:"Grande / Co",ciudad:"Pisco",provincia:"Ica"},
            {nombre:"Huancayo Jr. Ica",direccion:"Jr. Ica Nº 1143",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Terminal Los Andes",direccion:"Av. Ferrocarril S/n - Counter N° 14",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Av Circunvalación Cruce Con Mariategui",direccion:"Av. Circunvalación 480 T-1",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"San Carlos Huancayo",direccion:"Pj. San Fernando 209",tipo:"Pequeña",ciudad:"Huancayo",provincia:"Junín"},
            {nombre:"Chilca Huancayo",direccion:"Jr. 28 De Julio N° 935",tipo:"Pequeña",ciudad:"Chilca",provincia:"Junín"},
            {nombre:"La Villa Cruce Pisco",direccion:"C. P. Oblacion Villa Los Angeles Mz.a Lt 13 B",tipo:"Pequeña",ciudad:"Pisco",provincia:"Ica"},
            {nombre:"San Ramón",direccion:"Jr. Ucayali 102",tipo:"Pequeña",ciudad:"San Ramón",provincia:"Junín"},
            {nombre:"La Merced",direccion:"Av. Peru 931 Sector Pampa Del Carmen",tipo:"Grande / Co",ciudad:"La Merced",provincia:"Junín"},
            {nombre:"Huancavelica",direccion:"Av. Universitaria 1003",tipo:"Grande / Co",ciudad:"Huancavelica",provincia:"Huancavelica"},
            {nombre:"Perene",direccion:"Av. Marginal S/n Aa.vv San Jacinto",tipo:"Mediana",ciudad:"Perene",provincia:"Junín"},
            {nombre:"Ambo",direccion:"Av. Las Americas 501",tipo:"Grande / Co",ciudad:"Ambo",provincia:"Huánuco"},
            {nombre:"Salas Ica",direccion:"Sub Lote 01 zona panamericana sur km. 293.350",tipo:"Pequeña",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Ica Subtanjalla Co",direccion:"C.p - Sector Macacona /predio Parcela 214 Lote 2",tipo:"Grande / Co",ciudad:"Ica",provincia:"Ica"},
            {nombre:"La Tinguiña",direccion:"Av. Victorio Gotuzzo N° 506",tipo:"Micro",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Ica San Joaquin",direccion:"Pasaje Grau N° 101",tipo:"Micro",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Parcona",direccion:"Cp. De Parcona -cercado Mz. B Lote 16",tipo:"Pequeña",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Ica Av. Jj Elias",direccion:"Manzana B, Sub-lote 02 Del Fundo La Palma",tipo:"Micro",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Ica Urb. Manzanilla",direccion:"Av. Manuel Santana Chiri N°359 A1",tipo:"Micro",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Jr Aguilar",direccion:"Jr. Aguilar N° 872",tipo:"Pequeña",ciudad:"Huánuco",provincia:"Huánuco"},
            {nombre:"Amarilis Co",direccion:"Jr. Los Pinos Lote 3 -d2 Urb Los Pinos",tipo:"Grande / Co",ciudad:"Huánuco",provincia:"Huánuco"},
            {nombre:"Huarmey",direccion:"Carr. Panamericana Norte N° Km 293",tipo:"Grande / Co",ciudad:"Huarmey",provincia:"Ancash"},
            {nombre:"Ica Santiago",direccion:"Centro Poblado Santiago Mz. E, Lt. 01",tipo:"Pequeña",ciudad:"Ica",provincia:"Ica"},
            {nombre:"Pichanaki",direccion:"Av. Venus Lt. 20 Ciudad Satélite",tipo:"Grande / Co",ciudad:"Pichanaki",provincia:"Junín"},
            {nombre:"Satipo",direccion:"Jr. Francisco Irazola 1077",tipo:"Grande / Co",ciudad:"Satipo",provincia:"Junín"},
            {nombre:"Mazamari",direccion:"Jr. Jorge Chavez Nro 144 Lt. 8a",tipo:"Grande / Co",ciudad:"Mazamari",provincia:"Junín"},
            {nombre:"Pangoa",direccion:"Av. Marginal S/n Número Villa Chavini",tipo:"Grande / Co",ciudad:"Pangoa",provincia:"Junín"},
            {nombre:"Huaraz",direccion:"Av. 27 De Noviembre Cdra. 20 S/n",tipo:"Grande / Co",ciudad:"Huaraz",provincia:"Ancash"},
            {nombre:"Huanta",direccion:"Jr. Gervasio Santillana N°976",tipo:"Mediana",ciudad:"Huanta",provincia:"Ayacucho"},
            {nombre:"Ayacucho Co",direccion:"Aa.hh Complejo Artesanal T1 Lt1",tipo:"Grande / Co",ciudad:"Ayacucho",provincia:"Ayacucho"},
            {nombre:"Ayacucho Carmen Alto",direccion:"Asentamiento Humano Carmen Alto Mz B1 Lote 9",tipo:"Pequeña",ciudad:"Ayacucho",provincia:"Ayacucho"},
            {nombre:"Ayacucho Jesús Nazareno",direccion:"Jr. José María Eguren 451",tipo:"Pequeña",ciudad:"Ayacucho",provincia:"Ayacucho"},
            {nombre:"Carhuaz",direccion:"Carretera Central 00s/n Cent",tipo:"Pequeña",ciudad:"Carhuaz",provincia:"Ancash"},
            {nombre:"Casma",direccion:"Av. Miguel Grau Mz. D 4 Lt. 1",tipo:"Grande / Co",ciudad:"Casma",provincia:"Ancash"},
            {nombre:"Tingo Maria Co Buenos Aires",direccion:"Calle Rosario Central",tipo:"Grande / Co",ciudad:"Tingo Maria",provincia:"Huánuco"},
            {nombre:"Tingo María - Amazonas",direccion:"Av. Amazonas Nro 778",tipo:"Mini-micro",ciudad:"Tingo María",provincia:"Huánuco"},
            {nombre:"Yungay",direccion:"Jr. Industrial, Lte. 14",tipo:"Mediana",ciudad:"Yungay",provincia:"Ancash"},
            {nombre:"El Ingenio",direccion:"Av. Principal Tulin 204",tipo:"Mediana",ciudad:"El Ingenio",provincia:"Ica"},
            {nombre:"Caraz",direccion:"Av. 9 De Octubre N° 259",tipo:"Mediana",ciudad:"Caraz",provincia:"Ancash"},
            {nombre:"Aucayacu",direccion:"Jr. Chiclayo 247 0c-02",tipo:"Grande / Co",ciudad:"Aucayacu",provincia:"Huánuco"},
            {nombre:"Av Circunvalacion Nazca",direccion:"En La Esquina De La Av. Circunvalación",tipo:"Mini-micro",ciudad:"Nazca",provincia:"Ica"},
            {nombre:"Av. Pacífico Belen",direccion:"Aa.hh. Belen Mz O Lt 28",tipo:"Pequeña",ciudad:"Nuevo Chimbote",provincia:"Ancash"},
            {nombre:"Vista Alegre Co",direccion:"carretera Panamericana Sur N° 906",tipo:"Grande / Co",ciudad:"Nazca",provincia:"Ica"},
            {nombre:"Ovalo De La Familia",direccion:"Urbanización José Carlos Mariategui Mz R 3 Lt 3",tipo:"Pequeña",ciudad:"Chimbote",provincia:"Ancash"},
            {nombre:"Garatea",direccion:"Urb. Nicolas Garatea Mz. 100 lt. 24",tipo:"Pequeña",ciudad:"Nuevo Chimbote",provincia:"Ancash"},
            {nombre:"Tres De Octubre",direccion:"Av. José Pardo Mz. K, Lt. 17",tipo:"Pequeña",ciudad:"Nuevo Chimbote",provincia:"Ancash"},
            {nombre:"Av. Los Pescadores Co",direccion:"Par. Parcela N° 16757 - E Sector La Perla",tipo:"Grande / Co",ciudad:"Chimbote",provincia:"Ancash"},
            {nombre:"Av Enrique Meiggs",direccion:"Av. Enrique Meiggs N° 2457",tipo:"Pequeña",ciudad:"Chimbote",provincia:"Ancash"},
            {nombre:"Av Jose Galvez",direccion:"Av. José Gálvez 791",tipo:"Pequeña",ciudad:"Chimbote",provincia:"Ancash"},
            {nombre:"Santa",direccion:"Panamericana Norte Km 442 - B",tipo:"Pequeña",ciudad:"Santa",provincia:"Ancash"},
            {nombre:"San Juan De Marcona",direccion:"Aa.hh. San Martín De Porres E-4",tipo:"Mediana",ciudad:"Marcona",provincia:"Ica"},
            {nombre:"Andahuaylas",direccion:"Av. Los Cedros 274",tipo:"Grande / Co",ciudad:"Andahuaylas",provincia:"Apurímac"},
            {nombre:"Chao",direccion:"Av. Victor Raul Haya De La Torre 575",tipo:"Grande / Co",ciudad:"Chao",provincia:"La Libertad"},
            {nombre:"Puente Viru",direccion:"Panamericana Norte N° 933",tipo:"Grande / Co",ciudad:"Virú",provincia:"La Libertad"},
            {nombre:"Viru Centro",direccion:"Calle Puno N° 125 - Mz. 32 Lt. 7a",tipo:"Pequeña",ciudad:"Virú",provincia:"La Libertad"},
            {nombre:"Abancay",direccion:"Av. Panamericana S/n",tipo:"Grande / Co",ciudad:"Abancay",provincia:"Apurímac"},
            {nombre:"Quillabamba",direccion:"Jr. Puno Lt. 10 Y 11 Mz. G",tipo:"Grande / Co",ciudad:"Quillabamba",provincia:"Cusco"},
            {nombre:"Moche",direccion:"Av. La Marina Lote 25 - B",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Huamachuco",direccion:"Jr. Simon Bolivar 763",tipo:"Grande / Co",ciudad:"Huamachuco",provincia:"La Libertad"},
            {nombre:"America Sur",direccion:"Av. América Sur 1736",tipo:"Micro",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Trujillo La Perla",direccion:"Av. La Perla Mz. E Lote 05",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Calle Santa Cruz - America Sur",direccion:"Calle Santa Cruz n° 389",tipo:"Mediana",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Av Larco",direccion:"Av. Larco 865",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Atahualpa",direccion:"Calle Atahualpa 481",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Ovalo Papal",direccion:"Urb. Vista Hermosa Mz. F Lt. 11",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Av Hnos Uceda - America Norte",direccion:"Av. Hermanos Uceda Meza N° 269",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Otuzco",direccion:"Av. Alfredo Gutiérrez N° 120",tipo:"Grande / Co",ciudad:"Otuzco",provincia:"La Libertad"},
            {nombre:"Calle Liverpool",direccion:"Calle Liverpool N° 329",tipo:"Mediana",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Chala",direccion:"Av. Emancipacion Lt. 3 Mz. 51",tipo:"Grande / Co",ciudad:"Chala",provincia:"Arequipa"},
            {nombre:"Cajabamba",direccion:"Jr. Caceres N° 211",tipo:"Grande / Co",ciudad:"Cajabamba",provincia:"Cajamarca"},
            {nombre:"Cusco Urubamba",direccion:"Asoc. Pro Vivienda Vilcanota",tipo:"Grande / Co",ciudad:"Urubamba",provincia:"Cusco"},
            {nombre:"Anta Izcuchaca",direccion:"Parque Del Carmen Lt. 1 Mz. B 2",tipo:"Grande / Co",ciudad:"Anta",provincia:"Cusco"},
            {nombre:"San Marcos",direccion:"Jr. Adolfo Amorin Bueno N° 140",tipo:"Grande / Co",ciudad:"San Marcos",provincia:"Cajamarca"},
            {nombre:"Chinchero",direccion:"Av. Mateo Pumacahua S/n",tipo:"Grande / Co",ciudad:"Chinchero",provincia:"Cusco"},
            {nombre:"Tica Tica",direccion:"Arco Ticatica Pustipata, Lt. N° A - 11 - 2",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Cusco Calca",direccion:"Av. Vilcanota Mz. A Lt 4",tipo:"Grande / Co",ciudad:"Calca",provincia:"Cusco"},
            {nombre:"Av Antonio Lorena",direccion:"Prolongación Av. Antonio Lorena # 140",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Huancaro",direccion:"Urb. Villa Union F-1-b Huancaro",tipo:"Terminal",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Urb. Bancopata Av. Industrial",direccion:"Av. Industrial Urb. Bancopata J-20",tipo:"Micro",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Av Pachacutec",direccion:"Av. Pachacutec 429",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Huaraclla",direccion:"Mz. A Lote S/n Cp Huaraclla",tipo:"Mediana",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Velasco Astete",direccion:"Velasco Astete D3",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Cusco Co Parque Industrial",direccion:"Av. Las Americas Mz. E Lt. 20",tipo:"Grande / Co",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Cachimayo - San Sebastian",direccion:"Urb. Cachimayo A-37 Av. La Cultura",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Via Evitamiento Chacahuayco",direccion:"Av. Evitamiento S/n Ups Chacahuayco",tipo:"Terminal",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Via Expresa Sur",direccion:"Urb. Tupac Amaru B-1-2",tipo:"Micro",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"San Jeronimo",direccion:"Calle Ciro Alegría 226 - 224",tipo:"Pequeña",ciudad:"Cusco",provincia:"Cusco"},
            {nombre:"Pisac",direccion:"Av Vilcanota S/n",tipo:"Grande / Co",ciudad:"Pisac",provincia:"Cusco"},
            {nombre:"Cajamarca Co",direccion:"Av. Independencia N° 787",tipo:"Grande / Co",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Baños Del Inca",direccion:"Jr. Cahuide N° 242",tipo:"Mediana",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Cajamarca Horacio Zevallos",direccion:"Jr. Emilio Barrantes Mz X Lote 3",tipo:"Mediana",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Barrio San Jose",direccion:"Jr. Chanchamayo N° 1162",tipo:"Mediana",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Chilete",direccion:"Jr. Santa Rosa N° 130",tipo:"Grande / Co",ciudad:"Chilete",provincia:"Cajamarca"},
            {nombre:"Huambocancha Baja",direccion:"Mz. A Lote S/n",tipo:"Pequeña",ciudad:"Cajamarca",provincia:"Cajamarca"},
            {nombre:"Oropesa",direccion:"Sec. Chimpapampa Apv. Jose Ccarlos Mareategui s/n",tipo:"Grande / Co",ciudad:"Oropesa",provincia:"Cusco"},
            {nombre:"Santo Tomas",direccion:"Calle Bolognesi Mz. 02 Lt. 25",tipo:"Grande / Co",ciudad:"Santo Tomas",provincia:"Cusco"},
            {nombre:"Tembladera Cajamarca",direccion:"Jr. Bolognesi S/n",tipo:"Grande / Co",ciudad:"Tembladera",provincia:"Cajamarca"},
            {nombre:"San Pablo Cajamarca",direccion:"Jr. Tnt. Lorenzo Iglesia N° 910",tipo:"Mediana",ciudad:"San Pablo",provincia:"Cajamarca"},
            {nombre:"Celendin",direccion:"Jr. Pedro Ortiz Montoya 148",tipo:"Grande / Co",ciudad:"Celendin",provincia:"Cajamarca"},
            {nombre:"San Miguel Cajamarca",direccion:"Jr. Bolognesi N° 717",tipo:"Mediana",ciudad:"San Miguel",provincia:"Cajamarca"},
            {nombre:"Urcos",direccion:"Mayupata S/n Paucarbamba",tipo:"Grande / Co",ciudad:"Urcos",provincia:"Cusco"},
            {nombre:"Bambamarca",direccion:"Av. Tupac Amaru 1105",tipo:"Grande / Co",ciudad:"Bambamarca",provincia:"Cajamarca"},
            {nombre:"Combapata",direccion:"Av. Señor De Huanca S/n",tipo:"Grande / Co",ciudad:"Combapata",provincia:"Cusco"},
            {nombre:"Chota",direccion:"Av. Fray José Arana N 805",tipo:"Grande / Co",ciudad:"Chota",provincia:"Cajamarca"},
            {nombre:"Aplao",direccion:"Manzana X1, Lote 07, Calle 8 De Setiembre",tipo:"Pequeña",ciudad:"Aplao",provincia:"Arequipa"},
            {nombre:"Chachapoyas Co Dos De Mayo",direccion:"Jr. Dos De Mayo Cdra. 15 S/n",tipo:"Grande / Co",ciudad:"Chachapoyas",provincia:"Amazonas"},
            {nombre:"Chachapoyas Jr Grau",direccion:"Jr. Grau 270",tipo:"Pequeña",ciudad:"Chachapoyas",provincia:"Amazonas"},
            {nombre:"Sicuani Av Manuel Callo",direccion:"Jr. Inambari Nro. 208",tipo:"Pequeña",ciudad:"Sicuani",provincia:"Cusco"},
            {nombre:"Sicuani Co Ovalo San Andres",direccion:"Prolong. Av. Arequipa 1010 S/n",tipo:"Grande / Co",ciudad:"Sicuani",provincia:"Cusco"},
            {nombre:"Cutervo",direccion:"Av. Salomón Vilchez Murga S/n. Cdra 9",tipo:"Grande / Co",ciudad:"Cutervo",provincia:"Cajamarca"},
            {nombre:"Espinar",direccion:"Av. Tintaya N° 215",tipo:"Grande / Co",ciudad:"Espinar",provincia:"Cusco"},
            {nombre:"Luya",direccion:"Jr. Ramón Castilla S/n",tipo:"Grande / Co",ciudad:"Luya",provincia:"Amazonas"},
            {nombre:"Camana",direccion:"Calle Agustín Gamarra N° 451",tipo:"Pequeña",ciudad:"Camana",provincia:"Arequipa"},
            {nombre:"Pedro Ruiz",direccion:"Av. Sacsahuaman N° 513",tipo:"Grande / Co",ciudad:"Pedro Ruiz",provincia:"Amazonas"},
            {nombre:"Pedregal Centro",direccion:"Calle Yarabamba, Mz. Y Lt 7",tipo:"Grande / Co",ciudad:"Majes",provincia:"Arequipa"},
            {nombre:"Av Colonizadores Co",direccion:"Av. Lote Colonizadores. 4 Parcela 180",tipo:"Terminal",ciudad:"Majes",provincia:"Arequipa"},
            {nombre:"Bagua Grande",direccion:"Av. Chachapoyas 1094 Sector Gonchillo",tipo:"Grande / Co",ciudad:"Bagua Grande",provincia:"Amazonas"},
            {nombre:"El Cruce La Joya",direccion:"Lateral 12 C Lt. 32",tipo:"Grande / Co",ciudad:"La Joya",provincia:"Arequipa"},
            {nombre:"Bagua Capital",direccion:"Av. Héroes De Cenepa N° 345",tipo:"Pequeña",ciudad:"Bagua",provincia:"Amazonas"},
            {nombre:"Yura",direccion:"Mz. O Lt. 4 Zna 2 Ciudad De Dios",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Jaen",direccion:"Av. Pakammuros Cuadra 6 S/n",tipo:"Grande / Co",ciudad:"Jaen",provincia:"Cajamarca"},
            {nombre:"Ciudad Municipal",direccion:"Mz. A, Sub Lt. 2 A",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Autopista La Joya",direccion:"Asoc. Urbanizadora Peruarbo Mz. B4 Lt. 4",tipo:"Mediana",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Asoc Las Flores - Av 54",direccion:"Asoc. Las Flores Zn.2 Mz.j Lt.8",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Asoc. Nuevo Horizonte - Av. 54",direccion:"Nuevo Horizonte Mz.h Lote 12",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Zamacola",direccion:"Calle Yavarí 507 B",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Charcani",direccion:"Av. Charcani 401",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Uchumayo",direccion:"Urb. El Carmen M. E. Lt. 1",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Plaza La Tomilla",direccion:"Av. Ramón Castilla N° 1000 - B",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Pumacahua",direccion:"Urb. San Felipe Av Pumacahua Lt 14",tipo:"Mediana",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Los Incas",direccion:"Av. Los Incas N° 604",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Parra 379 Co",direccion:"Av. Parra 379",tipo:"Grande / Co",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Lima",direccion:"Av. Lima N° 406",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Augusto Salazar Bondy",direccion:"Augusto Salazar Bondy Mz J Lt 4",tipo:"Pequeña",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Matarani",direccion:"Asentamiento Humano. Puerto Nuevo Mz. I Lt. 18",tipo:"Terminal",ciudad:"Matarani",provincia:"Arequipa"},
            {nombre:"Jacobo Hunter",direccion:"Calle Argentina # 405 - A",tipo:"Grande / Co",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Miraflores Arequipa",direccion:"Av. Goyoneche N° 1422",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Mariano Melgar",direccion:"Calle Ancash N° 202",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Urb Manuel Prado",direccion:"Calle Belén N°100 - A",tipo:"Mini-micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Socabaya - Los Toritos",direccion:"Av. Socabaya 301",tipo:"Mini-micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Av Jesus",direccion:"Av. Jesús N° 1100",tipo:"Micro",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Mollendo Co",direccion:"Mariscal Castilla 472 –a",tipo:"Grande / Co",ciudad:"Mollendo",provincia:"Arequipa"},
            {nombre:"Cercado Mollendo",direccion:"Calle Dean Valdivia 388",tipo:"Mini-micro",ciudad:"Mollendo",provincia:"Arequipa"},
            {nombre:"Av. Horacio Zevallos",direccion:"Asentamiento Urbano Municipal Horacio Zeballos Mz. 1 Lt. 18",tipo:"Mediana",ciudad:"Arequipa",provincia:"Arequipa"},
            {nombre:"Cocachacra",direccion:"Centro Poblado Cocachacra Mz. N5 Sub-lote 5b",tipo:"Terminal",ciudad:"Cocachacra",provincia:"Arequipa"},
            {nombre:"San Ignacio",direccion:"Pasaje Tres N° 113",tipo:"Grande / Co",ciudad:"San Ignacio",provincia:"Cajamarca"},
            {nombre:"Aperopuerto Trujillo",direccion:"Aeropuerto Internacional",tipo:"Terminal",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Av. Angamos",direccion:"Av. Angamos Este 2521",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Aviacion 2819",direccion:"Av. Aviación 2819",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Canada",direccion:"Av. Canadá 1603",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jr Casanova Con Petit Thouars",direccion:"Jr. domingo casanova N°318",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Los Fresnos",direccion:"Av. Los Fresnos 1305 Tienda 2",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Mexico Co",direccion:"Av. Mexico 1125",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Jose Leal Cdra 6",direccion:"Av. Coronel José Leal 648",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jesus Maria",direccion:"Av. Mariscal Luzuriaga 584-586",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jr. Luna Pizarro",direccion:"Jr. Luna Pizarro N° 701",tipo:"Terminal",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av La Fontana",direccion:"Av La Fontana 440",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jr. Raymondi",direccion:"Jr. Antonio Raymondi Nro. 113",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Magdalena Del Mar",direccion:"Jr. Ayacucho N° 756",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Flora Tristan",direccion:"Av. Flora Tristán N° 885",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. La Marina",direccion:"Av. La Marina 1640",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Bolivar",direccion:"Av. Bolivar 1097",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jiron Ancash",direccion:"Jr. Ancash Mz. B Lt. 11",tipo:"Terminal",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. La Molina Cdra. 35",direccion:"Av. La Molina #3551 Tda -7",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Puente Nuevo",direccion:"Av 1° De Mayo 3071",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Rimac Guardia Republicana Cdra. 9",direccion:"Sección Inmobiliaria N°2 Lt. 11 De La Mz. 2",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Manchay Tres Marias",direccion:"Av. Victor Malasquez mz. B11 Sub-lote 06-a",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Rimac Av. Amancaes",direccion:"Av. Amancaes Nro. 644",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"La Curva De Manchay",direccion:"Av. Prolongación De La Av. La Molina Mz. E Lote 21",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Sjl-av.proceres",direccion:"Av. Próceres De La Independencia Nro. 1295 - 1299",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. 13 De Enero",direccion:"Av. 13 De Enero Nº2057",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Plaza Norte S. Express",direccion:"Av. Gerardo Unger Nro. 6917 Int. Lb 19",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Plaza Norte Entregas",direccion:"Av. Gerardo Unger Nro. 6917 Int. Lb 19",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Angelica Gamarra",direccion:"Av. Angelica Gamarra De Leon Valverde N° 621",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Santa María De Huachipa",direccion:"Av. Circunvalación Mz. A Lt. 1 - D C - P",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Puente Lurin",direccion:"Antigua Panamericana Sur, lote 2",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Calle A Con Av Industrial",direccion:"Calle A, Mz. D Lt. 26",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Calle M. Asencio",direccion:"Calle Manuel Asencio Segura 309",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Manuel Valle",direccion:"Av. Manuel Valle Sub - Lote 2 - 1",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Sjl- Las Flores",direccion:"Av. Canto Grande N°. 2570",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Carlos Izaguirre Cdra. 5",direccion:"Av. Carlos Izaguirre 513",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Carlos Izaguirre Cdra. 14",direccion:"Calle David Alva Manzana H Lote 4",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Canto Grande",direccion:"Calle San Martin Con Av. Comercial Norte 189",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"La Cincuenta",direccion:"Av. Tupac Amaru N° 4708 - 4710",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Las Palmeras",direccion:"Av. Las Palmeras N° 5236",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Santa Rosa Urb Los Alamos",direccion:"Av. Santa Rosa Mz. D1 Lote 1",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Huandoy Con Marañon",direccion:"Av. Próceres, Mz. 3, Lt. 23",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Tres Postes",direccion:"Av. Alfredo Mendiola Lt. 22 Mz. C3",tipo:"Terminal",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Los Platinos",direccion:"Av. Los Platinos N°. 259",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Nuevo Lurin",direccion:"Av. Antigua Panamericana Sur Km 37 Mz C Lt 17",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Huandoy Con Av Central",direccion:"Av. Huandoy Mza. 72 Lte. 54",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Tupac Amaru Cdra. 57",direccion:"Av. Tupac Amaru 5725-5727",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Cruz de Motupe",direccion:"Av. Fernando Wiesse Mz. Q Lote 1",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Pro",direccion:"Av. Los Próceres Mz. Pp2 Lt.21",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Dos De Octubre",direccion:"Av. 2 De Octubre Mz. H Lt. 2",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Trapiche",direccion:"Av. Trapiche 886 A 16 2p 2",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Año Nuevo",direccion:"Av. Tupac Amaru N° 7837- 7839 Mz. C Lt. 010",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Area Shalom Empresas",direccion:"Direccion",tipo:"Terminal",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Tomas Marsano - La Bolichera",direccion:"Av. Santiago De Surco Nº 4348",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Higuereta",direccion:"Calle Barlovento N° 134",tipo:"Mini-micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Atocongo",direccion:"Av. De Los Héroes N° 228",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Principal",direccion:"Lt. 12 Mz. G, Av. Principal 995",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Canevaro",direccion:"Av. Canevaro 336 - A",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Miguel Grau Pamplona Alta",direccion:"Av. Almirante Miguel Grau Mz. Y3 Lt. 29",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av San Juan Pamplona Alta",direccion:"Av. San Juan Mz. 24 Lt. 1",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Rep. De Panama",direccion:"Av República De Panamá N° 5115",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Maria Auxiliadora",direccion:"Av. Los Héroes 1140",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Surco Mateo Pumacahua",direccion:"Av. San Juan Mz A Lote 01",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Pesquero",direccion:"Av. Pachacutec N° 3548",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Villa Maria",direccion:"Av Villa Maria Mz. G12 Lt. 9 - B Ps 1",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"01 De Mayo",direccion:"Av. 01de Mayo 1 Sect Gp 23 - A Mz N Lote 13",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Nueva Esperanza Vmt",direccion:"Av. 26 De Noviembre, 1728b - 1728c",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Cesar Vallejo",direccion:"Av. Cesar Vallejo, Mz. F Lt. 1",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Santa Rosa - Sta Anita",direccion:"Av. Santa Rosa #147",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Óvalo Mariátegui",direccion:"Av. Pastor Sevilla Sect. 6 - Gp 7 - Mz. A - Lote 05",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Las Conchitas",direccion:"Av. Pachacutec 6779, Mz. N, Lt. 20",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Malecon Checa Cdra. 1",direccion:"Av. Malecón Miguel Checa Eguiguren N° 167 Y 169",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Huarochirí",direccion:"Av. Huarochirí Mz. E1 Lt. 03",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Huarochiri Envios",direccion:"Av. Huarochiri Mz. D8 Lt. 13",tipo:"Luna Pizarro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Lima - Vmt",direccion:"Av. Lima 2208",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Campoy",direccion:"Av. Malecón Checa Mz. B Lt. 7",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jr Chinchaysuyo Cdra 4",direccion:"Jr. Chinchaysuyo 468",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Peru 15",direccion:"Av. Perú 1589",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Pastor Sevilla",direccion:"Mz. B Lt. 3 Barrio 3 Sector 2 - 4ta Etapa",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Jose Granda Cdra. 25",direccion:"Av. Jose Granda 2546",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Fiori",direccion:"Av. Miguel Angel N° 235",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Lima Cdra 38",direccion:"Av. Lima 3899",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Germán Aguirre",direccion:"Av. German Aguirre Ugarte 649",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Santa Rosa Cruce Av. El Sol",direccion:"Av. Santa Rosa De Lima Mz. D Lt. 4",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Smp-av. Proceres",direccion:"Av. Próceres N° 588",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Jose Granda Cdra 38",direccion:"Av. José Granda 3826",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Universitaria Cdra. 16",direccion:"Av. Universitaria 1619",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Los Pinos",direccion:"Mz. B1 Lt. 25 Urbanización Los Pinos",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Circunvalacion Sjl",direccion:"Av. Circunvalación mz. B-5 Lt. 20",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Carlos Izaguirre Cuadra 23",direccion:"Av. Carlos Izaguirre Sub Lt. 8",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Dominicos Cdra 14",direccion:"Av. Los Dominicos 1460",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Canta Callao Con Alisos",direccion:"Av. Canta Callao, Mz. A Lt. 3",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Canta Callao Con Izaguirre",direccion:"Av. Canta Callao Mz. A Lt. 3",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Bayovar",direccion:"Av. Fernando Wiesse Mz. E8. Lote 38b",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Central",direccion:"Av. Central Mz R9 Lote 3",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Del Mercado",direccion:"Programa Ciudad Mrcal. Caceres, Sector Iii Mz. Q8 Lt. 11",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. Gerardo Unger Cdra 64",direccion:"Av. Gerardo Unger 6475",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Jicamarca",direccion:"Av. Sinchi Roca Mz. P Lt. 16a",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Punta Hermosa",direccion:"Av. Garcia Rada Mz.b Lt.04",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Almacenes Bsf",direccion:"Car. Autopista Panamericana Sur N° 2001 (km. 38)",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Puente Piedra Naranjitos",direccion:"Fundo Tambo Inga Mz. A Lt. 8",tipo:"Terminal",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Ovalo Puente Piedra",direccion:"Av. Miguel Grau mz. A Lt. 07 Y 08",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av. San Lorenzo",direccion:"Av. San Lorenzo mz C Lt 20",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Puente Arica",direccion:"Panamericana Norte Km 32.5",tipo:"Grande / Co",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Buenos Aires",direccion:"Av. Buenos Aires Mz. D, Sub-lote 188e1",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Zapallal",direccion:"Av. Ancón 678",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Chosica",direccion:"El Sol 124",tipo:"Pequeña",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Santa Rosa",direccion:"Mz. L 23 Urb. Coovitiomar",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Av Nicolas De Pierola Cdra 4",direccion:"Av Nicolás De Pierola 462",tipo:"Micro",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Ant Panam Sur Cdra 11",direccion:"Antigua Panamericana Sur Cdra. 11 Mz. 46, Lt. 08",tipo:"Mediana",ciudad:"Lima",provincia:"Lima"},
            {nombre:"Mala",direccion:"Av. Marchand # 250",tipo:"Mediana",ciudad:"Mala",provincia:"Lima"},
            {nombre:"Chancay",direccion:"Prolongación San Martín N°403",tipo:"Mediana",ciudad:"Chancay",provincia:"Lima"},
            {nombre:"Huaral",direccion:"Av. Jorge Chavez 647",tipo:"Grande / Co",ciudad:"Huaral",provincia:"Lima"},
            {nombre:"Sayan",direccion:"Calle Naranjo N° 211",tipo:"Pequeña",ciudad:"Sayan",provincia:"Lima"},
            {nombre:"Cañete San Vicente",direccion:"Aa.hh. Víctor Andrés Belaunde Mz. B Lt. 12",tipo:"Pequeña",ciudad:"Cañete",provincia:"Lima"},
            {nombre:"Jr. Santa Rita - Cañete (por Definir)",direccion:"Jr. Santa Rita 399",tipo:"Pequeña",ciudad:"Cañete",provincia:"Lima"},
            {nombre:"Cañete Imperial",direccion:"Jr. Augusto B. Leguía N.º 457",tipo:"Pequeña",ciudad:"Cañete",provincia:"Lima"},
            {nombre:"Nuevo Imperial Co",direccion:"Fundo Santa Adela, Mz. A, Lotes 8 Y 9",tipo:"Grande / Co",ciudad:"Cañete",provincia:"Lima"},
            {nombre:"Salaverry Huacho Co",direccion:"Prolongación Salaverry N° 764",tipo:"Grande / Co",ciudad:"Huacho",provincia:"Lima"},
            {nombre:"Huacho Av Indacochea",direccion:"Av. Mercedes Indacochea 1276",tipo:"Micro",ciudad:"Huacho",provincia:"Lima"},
            {nombre:"Huaura",direccion:"Av. Las Malvinas Mz. C Lote 16",tipo:"Micro",ciudad:"Huaura",provincia:"Lima"},
            {nombre:"Huayllay",direccion:"Calle Lima S/n Barrio Arenales",tipo:"Mediana",ciudad:"Huayllay",provincia:"Pasco"},
            {nombre:"Supe",direccion:"Av. Francisco Vidal 1120",tipo:"Mediana",ciudad:"Supe",provincia:"Lima"},
            {nombre:"Barranca",direccion:"Urb. Las Vegas - Mz. C, Lt. 22",tipo:"Mediana",ciudad:"Barranca",provincia:"Lima"},
            {nombre:"Cerro De Pasco",direccion:"Jr. Huaricapcha S/n A.h. Tupac Amaru",tipo:"Grande / Co",ciudad:"Pasco",provincia:"Pasco"},
            {nombre:"Paramonga",direccion:"Av. Central N° 305 Mz. N1 Lt. 17",tipo:"Mediana",ciudad:"Paramonga",provincia:"Lima"},
            {nombre:"Oxapampa",direccion:"Mz. 239 Sub Lote H – 1",tipo:"Grande / Co",ciudad:"Oxapampa",provincia:"Pasco"},
            {nombre:"Villa Rica",direccion:"Av. Leopoldo Krausse N° 442",tipo:"Grande / Co",ciudad:"Villa Rica",provincia:"Pasco"},
            {nombre:"Aguaytía",direccion:"U. Vecinal Barrio Unido Mz. 1 Lt. 2",tipo:"Grande / Co",ciudad:"Aguaytia",provincia:"Ucayali"},
            {nombre:"Uchiza",direccion:"Av. Leoncio Prado N°524",tipo:"Pequeña",ciudad:"Uchiza",provincia:"San Martin"},
            {nombre:"Av Fernando Belaunde",direccion:"Av. Fernando Belaunde C-09 Mz H6 (21), Lt. 04",tipo:"Pequeña",ciudad:"Tocache",provincia:"San Martin"},
            {nombre:"Jr Fredy Aliaga Co",direccion:"Jr. Fredy Aliaga N°3046",tipo:"Grande / Co",ciudad:"Tocache",provincia:"San Martin"},
            {nombre:"Pucallpa Co Federico Basadre",direccion:"Carretera Federico Basadre Km 6.800",tipo:"Grande / Co",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Manantay Av Tupac Amaru",direccion:"Av. Tupac Amaru 2315",tipo:"Pequeña",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Yarinacocha Av Universitaria",direccion:"Av. Universitaria Mza A Lote 6",tipo:"Pequeña",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Manantay Av Aguaytia",direccion:"Av. Aguaytia Mz., 26 Lt. 20",tipo:"Mediana",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Calleria Jr Jose Galvez",direccion:"Jr. Jose Galvez 147",tipo:"Pequeña",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Calleria Av Saenz Peña",direccion:"Av. Saenz Peña 229",tipo:"Pequeña",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Yarinacocha Centro",direccion:"Jr. Tupac Amaru, Mz. 50, Lt. 07",tipo:"Pequeña",ciudad:"Pucallpa",provincia:"Ucayali"},
            {nombre:"Av Hermanos Angulo",direccion:"Av. Hermanos Angulo 628",tipo:"Mini-micro",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Jr. Cahuide",direccion:"Jr. Cahuide N° 342",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Alto Trujillo",direccion:"Av. Prolongación 12 De Noviembre, Mz. Q, Lt. 25",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Av. Las Magnolias",direccion:"Av. Las Magnolias Mz. 25 Lt. 2a",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Av Tahuantinsuyo",direccion:"Av. Tahuantinsuyo N° 739",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Ovalo Huanchaco Co",direccion:"Carretera Via De Evitamiento 576.2",tipo:"Grande / Co",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Wichanzao",direccion:"Mz. 1 Lt. 23 Aa.hh Wichanzao",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"El Milagro",direccion:"Av. Industrial Mz 23 Lt. 13",tipo:"Pequeña",ciudad:"Trujillo",provincia:"La Libertad"},
            {nombre:"Casa Grande",direccion:"Calle Luis sánchez N° 152",tipo:"Pequeña",ciudad:"Casa Grande",provincia:"La Libertad"},
            {nombre:"Paijan",direccion:"Av. Panamericana Norte N° 1320",tipo:"Grande / Co",ciudad:"Paijan",provincia:"La Libertad"},
            {nombre:"Juanjuí Fernando Belaunde Terry Co",direccion:"Carretera Fernando Terry Km. 1 S/n",tipo:"Grande / Co",ciudad:"Juanjui",provincia:"San Martin"},
            {nombre:"Juanjui Centro",direccion:"Jr. Sargento Lorez N° 568",tipo:"Pequeña",ciudad:"Juanjui",provincia:"San Martin"},
            {nombre:"San Martin Bellavista",direccion:"Av. Lima S/n Cdra. 8",tipo:"Grande / Co",ciudad:"Bellavista",provincia:"San Martin"},
            {nombre:"Saposoa",direccion:"Av. Loreto S/n",tipo:"Mediana",ciudad:"Saposoa",provincia:"San Martin"},
            {nombre:"Picota",direccion:"Av. Fernando Belaunde Terry Lote 2b",tipo:"Grande / Co",ciudad:"Picota",provincia:"San Martin"},
            {nombre:"San Pedro De Lloc",direccion:"Av. Vía De Evitamiento N° 407",tipo:"Pequeña",ciudad:"Pacasmayo",provincia:"La Libertad"},
            {nombre:"Pacasmayo Las Palmeras",direccion:"Ctra. Panamericana Norte N° Mz. P Lt. 4a",tipo:"Grande / Co",ciudad:"Pacasmayo",provincia:"La Libertad"},
            {nombre:"Pacasmayo Centro",direccion:"Av. Gonzalo Ugaz Salcedo S/n",tipo:"Mini-micro",ciudad:"Pacasmayo",provincia:"La Libertad"},
            {nombre:"Ciudad De Dios",direccion:"Mz. A Lt. 01 Cpm Ciudad De Dios",tipo:"Grande / Co",ciudad:"Guadalupe",provincia:"La Libertad"},
            {nombre:"Guadalupe La Libertad",direccion:"Av. Nilla Cerruty N° 299",tipo:"Grande / Co",ciudad:"Guadalupe",provincia:"La Libertad"},
            {nombre:"Chepen",direccion:"Prolongacion Ezequiel Gonzales Caceda 193",tipo:"Grande / Co",ciudad:"Chepen",provincia:"La Libertad"},
            {nombre:"Pacanguilla",direccion:"Carretera Panamericana # 835",tipo:"Mediana",ciudad:"Pacasmayo",provincia:"La Libertad"},
            {nombre:"San Jose De Sisa",direccion:"Jr. Bolognesi Cdra 6",tipo:"Mediana",ciudad:"San Jose De Sisa",provincia:"San Martin"},
            {nombre:"Tarapoto Co Jr Alfonso Ugarte",direccion:"Jr. Alfonso Ugarte N°2283",tipo:"Grande / Co",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Jr. Ramón Castilla",direccion:"Jr. Ramon Castilla N°1362",tipo:"Pequeña",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Jr. Tahuantinsuyo",direccion:"Jr. Tahuantinsuyo N° 158",tipo:"Pequeña",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Tarapoto La Banda De Shilcayo",direccion:"Jr. Perú N°186",tipo:"Pequeña",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Jr Leoncio Prado",direccion:"Jr. Leoncio Prado N° 1175",tipo:"Pequeña",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Tarapoto Jr. Sargento Lorez",direccion:"Jr. Sargento Lorez N° 264",tipo:"Pequeña",ciudad:"Tarapoto",provincia:"San Martin"},
            {nombre:"Lamas",direccion:"Jr. 16 De Octubre N°1137",tipo:"Mediana",ciudad:"Lamas",provincia:"San Martin"},
            {nombre:"Reque",direccion:"Av. Mariscal Ramon Castilla Mz. 4 Lote 14",tipo:"Mediana",ciudad:"Reque",provincia:"Lambayeque"},
            {nombre:"Monsefu",direccion:"av. Venezuela N° 221",tipo:"Pequeña",ciudad:"Monsefu",provincia:"Lambayeque"},
            {nombre:"Chongoyape",direccion:"Av. Atahualpa N° 1200",tipo:"Grande / Co",ciudad:"Chongoyape",provincia:"Lambayeque"},
            {nombre:"Patapo",direccion:"Av. Chongoyape N° S/n Sector Cerro Mirador",tipo:"Mediana",ciudad:"Patapo",provincia:"Lambayeque"},
            {nombre:"Soritor",direccion:"Jr. Miguel Grau Cdra 7 N°741",tipo:"Mediana",ciudad:"Soritor",provincia:"San Martin"},
            {nombre:"Av Victor R. Haya Co",direccion:"Av. Víctor Raul Haya De La Torre 2470",tipo:"Grande / Co",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Tuman",direccion:"Av. El Progreso N° 52 - Sector Santa Rosa",tipo:"Mediana",ciudad:"Tuman",provincia:"Lambayeque"},
            {nombre:"Pomalca",direccion:"Calle 25 Mz. I Lt. 6 Sect. 6 San Juan",tipo:"Mediana",ciudad:"Pomalca",provincia:"Lambayeque"},
            {nombre:"Pimentel",direccion:"Calle Miguel Grau Mz B Lote 3",tipo:"Mediana",ciudad:"Pimentel",provincia:"Lambayeque"},
            {nombre:"Mariscal Nieto",direccion:"Calle Mariscal Nieto N° 390",tipo:"Mini-micro",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Av Las Americas",direccion:"Av. Las Américas Lt. 42 Mz. D",tipo:"Mediana",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Calle Tahuantinsuyo",direccion:"Calle Tahuantinsuyo 995",tipo:"Pequeña",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Miraflores Chiclayo",direccion:"Av. Panamericana 975",tipo:"Mediana",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Av Balta Cdra. 36",direccion:"Av. Jose Balta N° 3653",tipo:"Mediana",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Ovalo Orquideas Co",direccion:"Jr. 20 De Abril 2138",tipo:"Grande / Co",ciudad:"Chiclayo",provincia:"Lambayeque"},
            {nombre:"Rioja",direccion:"Ctra. Fernando Belaúnde Terry N° 415",tipo:"Mediana",ciudad:"Rioja",provincia:"San Martin"},
            {nombre:"Moyobamba Centro",direccion:"Jr. Serafín Filomeno N°279",tipo:"Pequeña",ciudad:"Moyobamba",provincia:"San Martin"},
            {nombre:"Ferreñafe",direccion:"Av. Andrés A. Cáceres N°550a",tipo:"Mediana",ciudad:"Ferreñafe",provincia:"Lambayeque"},
            {nombre:"Lambayeque Centro",direccion:"Av. Federico Villarreal N° 491",tipo:"Micro",ciudad:"Lambayeque",provincia:"Lambayeque"},
            {nombre:"Lambayeque Panamericana",direccion:"Calle Paraguay Mz. D Lt 2a",tipo:"Mediana",ciudad:"Lambayeque",provincia:"Lambayeque"},
            {nombre:"Segunda Jerusalen",direccion:"Jr. Lima Mz. 43 Lt. 08",tipo:"Mediana",ciudad:"Rioja",provincia:"San Martin"},
            {nombre:"Nueva Cajamarca",direccion:"Av. Cajamarca Norte Mz. 51 Lt. 15",tipo:"Grande / Co",ciudad:"Nueva Cajamarca",provincia:"San Martin"},
            {nombre:"Tucume",direccion:"Av. Federico Villarreal N° 982",tipo:"Mediana",ciudad:"Tucume",provincia:"Lambayeque"},
            {nombre:"Yurimaguas",direccion:"Calle Jorge Chávez N° 300",tipo:"Grande / Co",ciudad:"Yurimaguas",provincia:"Loreto"},
            {nombre:"Morrope",direccion:"Calle Tahuantinsuyo N° 821",tipo:"Mediana",ciudad:"Morrope",provincia:"Lambayeque"},
            {nombre:"Jayanca",direccion:"Calle Diego Ferre N°1321",tipo:"Mediana",ciudad:"Jayanca",provincia:"Lambayeque"},
            {nombre:"Pardo Miguel Naranjos",direccion:"Jr. Miguel Grau 101 Mz. 34 Lt. 6",tipo:"Grande / Co",ciudad:"Rioja",provincia:"San Martin"},
            {nombre:"Mazuko",direccion:"Av. Inambari Fraccion N° 07",tipo:"Grande / Co",ciudad:"Mazuko",provincia:"Madre De Dios"},
            {nombre:"Motupe",direccion:"Calle Los Pinos N°116",tipo:"Grande / Co",ciudad:"Motupe",provincia:"Lambayeque"},
            {nombre:"Olmos",direccion:"Av. Augusto B. Leguía Mz. 87 Lt. 32",tipo:"Grande / Co",ciudad:"Olmos",provincia:"Lambayeque"},
            {nombre:"Ayaviri",direccion:"Jr. Santa Rosa Prolongación S/n",tipo:"Grande / Co",ciudad:"Ayaviri",provincia:"Puno"},
            {nombre:"Azangaro",direccion:"Av. Próceres S/n",tipo:"Grande / Co",ciudad:"Azangaro",provincia:"Puno"},
            {nombre:"Huancabamba",direccion:"Av. Ramon Castilla 0351",tipo:"Mediana",ciudad:"Huancabamba",provincia:"Piura"},
            {nombre:"Iberia",direccion:"Av. Jorge Chavez Mz. H1 Sub Lote 11-b",tipo:"Grande / Co",ciudad:"Iberia",provincia:"Madre De Dios"},
            {nombre:"Av. Lampa",direccion:"Av. Lampa Mz. B2 Lt. 3",tipo:"Pequeña",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Av Heroes Del Pacifico Co",direccion:"Av. Héroes De La Guerra Del Pacifico Km 3.5",tipo:"Grande / Co",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Las Mercedes",direccion:"Jr. Porvenir N° 228",tipo:"Mediana",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Av Independencia",direccion:"Av. Independencia Nro. 1538 Mz. A1 Lt. 04",tipo:"Pequeña",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Juliaca San Santiago",direccion:"Jr. Mama Ocllo 915 - B",tipo:"Grande / Co",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Av. Huancane Cdra. 9",direccion:"Jr. Sillustani N° 202",tipo:"Mediana",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Jr Agustin Gamarra",direccion:"Jr. Agustin Gamarra Mz. R1 Lt. 09",tipo:"Pequeña",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Av. Modesto Borda",direccion:"Av. Modesto Borda Mz. A Lt. 04",tipo:"Pequeña",ciudad:"Juliaca",provincia:"Puno"},
            {nombre:"Morropon",direccion:"Jr. Adrianzén N° 099",tipo:"Mediana",ciudad:"Morropon",provincia:"Piura"},
            {nombre:"Sechura",direccion:"Av. Bayovar N° 311",tipo:"Mediana",ciudad:"Sechura",provincia:"Piura"},
            {nombre:"Tambopata Av Circunvalacion",direccion:"Av. Circunvalacion Mz. C Lt. 01",tipo:"Pequeña",ciudad:"Tambopata",provincia:"Madre De Dios"},
            {nombre:"Tambopata Av La Joya Co",direccion:"Av. La Joya N° 122",tipo:"Grande / Co",ciudad:"Tambopata",provincia:"Madre De Dios"},
            {nombre:"Jr. Jaime Troncoso",direccion:"Jr. Jaime Troncoso 442",tipo:"Micro",ciudad:"Tambopata",provincia:"Madre De Dios"},
            {nombre:"El Triunfo",direccion:"Av. Interoceanica Km. 1",tipo:"Micro",ciudad:"Tambopata",provincia:"Madre De Dios"},
            {nombre:"La Union",direccion:"Av. Lima N° 590",tipo:"Mediana",ciudad:"La Union",provincia:"Piura"},
            {nombre:"Alto Puno",direccion:"Urb. San Pedro-alto Puno, Av La Cultura N° 160",tipo:"Pequeña",ciudad:"Puno",provincia:"Puno"},
            {nombre:"Chulucanas",direccion:"Jr. Huancavelica N° 548",tipo:"Mediana",ciudad:"Chulucanas",provincia:"Piura"},
            {nombre:"Av Costanera",direccion:"Av. Costanera N° 211 Con Jr. Los Incas",tipo:"Grande / Co",ciudad:"Puno",provincia:"Puno"},
            {nombre:"Calle Lima",direccion:"Calle Lima 190",tipo:"Micro",ciudad:"Moquegua",provincia:"Moquegua"},
            {nombre:"Quebrada Las Lechuzas Co",direccion:"Sector Quebrada Las Lechuzas Mz H Lt. 04",tipo:"Grande / Co",ciudad:"Moquegua",provincia:"Moquegua"},
            {nombre:"Ilo Pacocha",direccion:"Agrupación De Familias Pueblo Nuevo M.z E2 Lt. Com2a",tipo:"Pequeña",ciudad:"Ilo",provincia:"Moquegua"},
            {nombre:"San Antonio",direccion:"Av. Santa Fortunata Mz. N5 Lt. 10",tipo:"Pequeña",ciudad:"Moquegua",provincia:"Moquegua"},
            {nombre:"Chen Chen",direccion:"Mz. C Lt. 24",tipo:"Pequeña",ciudad:"Moquegua",provincia:"Moquegua"},
            {nombre:"Ilo Puerto",direccion:"Jr. Callao Prolongación Mz. N, Lt. 19 - A",tipo:"Pequeña",ciudad:"Ilo",provincia:"Moquegua"},
            {nombre:"Salcedo",direccion:"Urb. Aziruni Tepro I Etapa Mz. 18 Lt. 52",tipo:"Pequeña",ciudad:"Puno",provincia:"Puno"},
            {nombre:"Ilo Co Pampa Inalambrica",direccion:"Urb. Ciudad Del Pescador, Mz. J Lt. 18-19",tipo:"Grande / Co",ciudad:"Ilo",provincia:"Moquegua"},
            {nombre:"Catacaos",direccion:"Av. Francisco Bolognesi Mz. 60 Lt. 37",tipo:"Mediana",ciudad:"Catacaos",provincia:"Piura"},
            {nombre:"Av Tacna",direccion:"Av. Tacna 509",tipo:"Grande / Co",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Tacala",direccion:"Aa.hh. San Valentín Mz. N Lt. 12",tipo:"Mediana",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Av. Gullman",direccion:"A.a.h.h. Consuelo De Velasco 1 Etapa Sector B Mz Lt.18",tipo:"Mediana",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Av. Luis Eguiguren",direccion:"Av. Málaga Mz. A Lt.20 Int. 105",tipo:"Pequeña",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Av. Grau",direccion:"Av. Grau Manzana N, Lote 33",tipo:"Mediana",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Calle Emaús",direccion:"Calle Tres N° 102, Sublote N° 1d Mz. Y",tipo:"Grande / Co",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Aahh Santa Rosa Piura",direccion:"Urb. Santa Rosa Mz. D Lt. 7",tipo:"Pequeña",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Av Raul Mata La Cruz- Dos Grifos",direccion:"Av. Raúl Mata La Cruz Lt. 11 Mz. C",tipo:"Mediana",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Parque Industrial Co Piura Futura",direccion:"Urb. Parque Industrial Piura Futura Mz. G, Lt. 1a",tipo:"Grande / Co",ciudad:"Piura",provincia:"Piura"},
            {nombre:"Tambo Grande",direccion:"Av. Arámbulo Santín N° 100",tipo:"Mediana",ciudad:"Tambo Grande",provincia:"Piura"},
            {nombre:"Ayabaca",direccion:"Calle Bolognesi N° 136",tipo:"Mediana",ciudad:"Ayabaca",provincia:"Piura"},
            {nombre:"Paimas",direccion:"Av. Sullana S/n",tipo:"Pequeña",ciudad:"Paimas",provincia:"Piura"},
            {nombre:"Sullana Co Zona Industrial",direccion:"Ctra. Sullana Nº S/n Mz. K, Lt. 06",tipo:"Grande / Co",ciudad:"Sullana",provincia:"Piura"},
            {nombre:"Sullana Santa Rosa",direccion:"Carretera Panamericana Norte Nº 790",tipo:"Pequeña",ciudad:"Sullana",provincia:"Piura"},
            {nombre:"Bellavista Sullana",direccion:"Calle Moquegua 381",tipo:"Pequeña",ciudad:"Sullana",provincia:"Piura"},
            {nombre:"Paita",direccion:"Mz. H Lt. 14 Urb. Sol Y Mar",tipo:"Grande / Co",ciudad:"Paita",provincia:"Piura"},
            {nombre:"Las Lomas",direccion:"Jr. Miguel Grau Mz. H Lt. 7",tipo:"Mediana",ciudad:"Las Lomas",provincia:"Piura"},
            {nombre:"Ilave",direccion:"Jr. Bolognesi Nro. 866 Barrio Cruzani",tipo:"Grande / Co",ciudad:"Ilave",provincia:"Puno"},
            {nombre:"Ignacio Escudero",direccion:"Av. Panamericana Calle 26 Lote 3",tipo:"Mediana",ciudad:"Ignacio Escudero",provincia:"Piura"},
            {nombre:"Talara Alta 9 De Octubre",direccion:"Mz. N-10 Aa.hh 9 De Octubre",tipo:"Pequeña",ciudad:"Talara",provincia:"Piura"},
            {nombre:"Talara Co Asoc California",direccion:"Asociación California C - 03",tipo:"Grande / Co",ciudad:"Talara",provincia:"Piura"},
            {nombre:"Talara Baja Parque 22",direccion:"Parque 22 – 03 Lateral",tipo:"Pequeña",ciudad:"Talara",provincia:"Piura"},
            {nombre:"Tacna Co Av. Jorge Basadre",direccion:"Av. Jorge Basadre Grohmann Oeste N° 366",tipo:"Grande / Co",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Av. Arias Araguez",direccion:"Calle Arias Araguez N° 836",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Av Ejercito",direccion:"Av. Litoral Nro. 306",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Tacna Ciudad Nueva",direccion:"Ciudad Nueva Mz 46 Lt 12",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Av Vigil",direccion:"Av. Vigil 1636",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Pocollay",direccion:"Pueblo Tradicional Pocollay Mz. T Lote 01",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Av. Municipal",direccion:"Asociación Las vilcas mz. E Lt. 16",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Villa San Francisco",direccion:"Asoc. Villa San Francisco Mz. 94 Lt. 22",tipo:"Pequeña",ciudad:"Tacna",provincia:"Tacna"},
            {nombre:"Desaguadero",direccion:"Av. 28 De Julio N° 564 - 566",tipo:"Grande / Co",ciudad:"Desaguadero",provincia:"Puno"},
            {nombre:"El Alto",direccion:"Av. Bolognesi O-37 Centro",tipo:"Mediana",ciudad:"El Alto",provincia:"Piura"},
            {nombre:"Los Organos",direccion:"Av. Panamericana Norte P-29",tipo:"Grande / Co",ciudad:"Los Organos",provincia:"Piura"},
            {nombre:"Máncora",direccion:"Av. Grau Nro. 432",tipo:"Mediana",ciudad:"Mancora",provincia:"Piura"},
            {nombre:"Av Participacion Parcela",direccion:"Av. Participación Parcela 9-a",tipo:"Pequeña",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Av Jose A. Quiñones",direccion:"Av. José Abelardo Quiñones # 2475",tipo:"Pequeña",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Iquitos Av Tupac Amaru",direccion:"Av. tupac Amaru Con - Calle Lourdes De León #479",tipo:"Pequeña",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Iquitos Jr Francisco Bolognesi",direccion:"Jr. Francisco Bolognesi Nro 203 - 215",tipo:"Pequeña",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Iquitos Co Jr. Pablo Rossell",direccion:"Jr. Pablo Rossell 590 Con Nanay",tipo:"Grande / Co",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Punchana",direccion:"Calle Borja N°648",tipo:"Pequeña",ciudad:"Iquitos",provincia:"Loreto"},
            {nombre:"Corrales",direccion:"Av. Huáscar Nº 311 Int. 01 Centro",tipo:"Pequeña",ciudad:"Corrales",provincia:"Tumbes"},
            {nombre:"La Cruz Tumbes",direccion:"Jr. Piura 105 Caleta La Cruz",tipo:"Pequeña",ciudad:"La Cruz",provincia:"Tumbes"},
            {nombre:"Zorritos",direccion:"Av. 28 De Julio n° 205 Mz. 14 Lt. 04",tipo:"Mediana",ciudad:"Zorritos",provincia:"Tumbes"},
            {nombre:"Tumbes Puyango",direccion:"Urb. Andrés Araujo Morán Mz. 28-a Lote 03",tipo:"Pequeña",ciudad:"Tumbes",provincia:"Tumbes"},
            {nombre:"Pampa Grande Tumbes",direccion:"Mz. 0u Lt. 00a Aa.hh. Pampa Grande",tipo:"Pequeña",ciudad:"Tumbes",provincia:"Tumbes"},
            {nombre:"Zarumilla",direccion:"Jiron Independencia 309",tipo:"Pequeña",ciudad:"Zarumilla",provincia:"Tumbes"},
            {nombre:"Tumbes - Av Arica",direccion:"Av. Arica N° 227",tipo:"Pequeña",ciudad:"Tumbes",provincia:"Tumbes"},
            {nombre:"Tumbes Co - Panamericana Norte Km 2360",direccion:"Av. Panamericana Norte S/n Villa Primavera",tipo:"Grande / Co",ciudad:"Tumbes",provincia:"Tumbes"},
            {nombre:"Aguas Verdes",direccion:"Av Tumbes S/n Lote 09 Mz 17",tipo:"Mediana",ciudad:"Aguas Verdes",provincia:"Tumbes"}
        ];


        // ============================================
        // GESTIÓN DE PRODUCTOS
        // ============================================

        function agregarNuevoProducto(event) {
            event.preventDefault();
            
            const codigo = document.getElementById('newProductCodigo').value.trim();
            const nombre = document.getElementById('newProductNombre').value.trim();
            const menor = parseFloat(document.getElementById('newProductMenor').value);
            const mayor = parseFloat(document.getElementById('newProductMayor').value);
            
            const existe = productosDB.find(p => p.codigo === codigo);
            if (existe) {
                mostrarNotificacion('El código ya existe', 'warning');
                return;
            }
            
            productosDB.push(crearProducto({ codigo, nombre, precioUnd: menor, precioMayor: mayor }));
            guardarEstado();
            renderProductList();
            renderProductosVistaRapida();
            
            document.getElementById('newProductForm').reset();
            mostrarNotificacion('Producto agregado correctamente', 'success');

            // Se guarda también en la nube para que lo vean todos los usuarios, no solo este
            // dispositivo (antes solo quedaba en localStorage vía guardarEstado()).
            guardarProductoEnNube({
                codigo, nombre, precioUnd: menor, precioMayor: mayor, escalonado: false,
                sinKardex: false, origen: 'ajustes',
                creadoPor: usuarioActual?.username || '', creadoPorNombre: usuarioActual?.nombre || ''
            }).catch(e => {
                console.error('Error guardando producto en la nube:', e);
                mostrarNotificacion('El producto se agregó aquí, pero no se pudo guardar en la nube (sin conexión). Otros usuarios no lo verán todavía.', 'warning');
            });
        }

        function renderProductList() {
            const tbody = document.getElementById('productListBody');
            document.getElementById('productCount').textContent = productosDB.length;
            
            tbody.innerHTML = productosDB.map((producto, index) => `
                <tr>
                    <td class="codigo-cell">${producto.codigo}</td>
                    <td class="producto-cell">${producto.nombre}${producto.escalonado ? ` <span style="font-size:0.72em;background:#e0e7ff;color:#3730a3;padding:1px 6px;border-radius:4px;font-weight:700;">3 niveles · ${producto.tipoMayor === 'paquete' ? 'Paquete '+producto.cantidadMayor : 'Docena'}</span>` : ''}${obtenerStock(producto.codigo) !== null ? ` <span style="font-size:0.72em;padding:1px 6px;border-radius:4px;font-weight:700;background:${obtenerStock(producto.codigo) > 0 ? '#c6f6d5' : '#fed7d7'};color:${obtenerStock(producto.codigo) > 0 ? '#22543d' : '#c53030'};">📦 ${obtenerStock(producto.codigo)}</span>` : ''}</td>
                    <td class="precio-cell">
                        ${mostrarConIGV ? `
                            <div style="font-size: 0.85em;">
                                <div>S/ ${calcularPrecioConIGV(producto.precioUnd).toFixed(2)}</div>
                                <div class="igv-info">Sin IGV: S/ ${producto.precioUnd.toFixed(2)}</div>
                            </div>
                        ` : `S/ ${producto.precioUnd.toFixed(2)}`}
                    </td>
                    <td class="precio-cell">
                        ${producto.escalonado && producto.precioCuarto !== null ? (mostrarConIGV ? `
                            <div style="font-size: 0.85em;">
                                <div>S/ ${calcularPrecioConIGV(producto.precioCuarto).toFixed(2)}</div>
                                <div class="igv-info">Sin IGV: S/ ${producto.precioCuarto.toFixed(2)}</div>
                            </div>
                        ` : `S/ ${producto.precioCuarto.toFixed(2)}`) : '<span style="color:#cbd5e0;">—</span>'}
                    </td>
                    <td class="precio-cell">
                        ${mostrarConIGV ? `
                            <div style="font-size: 0.85em;">
                                <div>S/ ${calcularPrecioConIGV(producto.precioMayor).toFixed(2)}</div>
                                <div class="igv-info">Sin IGV: S/ ${producto.precioMayor.toFixed(2)}</div>
                            </div>
                        ` : `S/ ${producto.precioMayor.toFixed(2)}`}
                    </td>
                    <td>
                        <button class="btn-edit" onclick="editarProducto(${index})">✏️</button>
                        <button class="btn-remove" onclick="eliminarProducto(${index})">🗑️</button>
                    </td>
                </tr>
            `).join('');
        }

        // Vista rápida de SOLO LECTURA para la pestaña "Productos": precio, stock total
        // (sumando todos los colores) y los colores disponibles como círculos, con el
        // buscador inteligente (nombre, código o color, sin acentos, por palabras).
        function renderProductosVistaRapida() {
            const tbody = document.getElementById('productListBodyRapido');
            if (!tbody) return;

            const query = normalizarTexto((document.getElementById('searchProductosRapido')?.value || '').trim());
            const palabras = query.split(/\s+/).filter(Boolean);

            const productosFiltrados = productosDB.filter(producto => {
                if (palabras.length === 0) return true;
                const nombreNorm = normalizarTexto(producto.nombre);
                const codigoNorm = normalizarTexto(producto.codigo);
                const coloresNorm = (coloresPorProducto[producto.codigo] || []).map(c => normalizarTexto(c.color));
                return palabras.every(palabra =>
                    nombreNorm.includes(palabra) || codigoNorm.includes(palabra) || coloresNorm.some(c => c.includes(palabra))
                );
            });

            document.getElementById('productCountRapido').textContent = productosFiltrados.length;

            if (productosFiltrados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a0aec0;padding:24px;">Sin resultados para tu búsqueda.</td></tr>';
                return;
            }

            tbody.innerHTML = productosFiltrados.map(producto => {
                const stockTotal = obtenerStock(producto.codigo);
                return `
                    <tr>
                        <td class="codigo-cell">${producto.codigo}</td>
                        <td class="producto-cell">${producto.nombre}</td>
                        <td class="precio-cell">${mostrarConIGV ? `S/ ${calcularPrecioConIGV(producto.precioUnd).toFixed(2)}` : `S/ ${producto.precioUnd.toFixed(2)}`}</td>
                        <td class="precio-cell">${mostrarConIGV ? `S/ ${calcularPrecioConIGV(producto.precioMayor).toFixed(2)}` : `S/ ${producto.precioMayor.toFixed(2)}`}</td>
                        <td style="text-align:center;font-weight:700;color:${stockTotal === null ? '#a0aec0' : (stockTotal > 0 ? '#22543d' : '#c53030')};">${stockTotal === null ? '—' : stockTotal}</td>
                        <td>${generarCirculosColor(producto.codigo, 20)}</td>
                    </tr>
                `;
            }).join('');
        }

        function toggleCamposEscalonado() {
            const activo = document.getElementById('editProductoEscalonado').checked;
            document.getElementById('camposEscalonado').style.display = activo ? 'block' : 'none';
        }

        function actualizarCantidadMayorSugerida() {
            const tipo = document.getElementById('editProductoTipoMayor').value;
            const inputCant = document.getElementById('editProductoCantMayor');
            // Solo sugiere si el campo está vacío
            if (!inputCant.value) {
                inputCant.value = tipo === 'paquete' ? CANTIDAD_PAQUETE_DEFAULT : 12;
            }
        }

        function editarProducto(index) {
            productoEditandoIndex = index;
            const producto = productosDB[index];
            
            document.getElementById('editProductoCodigo').value = producto.codigo;
            document.getElementById('editProductoNombre').value = producto.nombre;
            document.getElementById('editProductoMenor').value = producto.precioUnd;
            document.getElementById('editProductoMayor').value = producto.precioMayor;
            document.getElementById('editProductoEscalonado').checked = !!producto.escalonado;
            document.getElementById('editProductoCuarto').value = producto.precioCuarto !== null && producto.precioCuarto !== undefined ? producto.precioCuarto : '';
            document.getElementById('editProductoCantCuarto').value = producto.cantidadCuarto || 3;
            document.getElementById('editProductoTipoMayor').value = producto.tipoMayor || 'docena';
            document.getElementById('editProductoCantMayor').value = producto.cantidadMayor || (producto.tipoMayor === 'paquete' ? CANTIDAD_PAQUETE_DEFAULT : 12);
            toggleCamposEscalonado();
            
            document.getElementById('editProductoModal').classList.add('active');
        }

        function closeEditProductoModal() {
            document.getElementById('editProductoModal').classList.remove('active');
            productoEditandoIndex = -1;
        }

        document.getElementById('editProductoForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (productoEditandoIndex === -1) return;

            const nuevoNombre = document.getElementById('editProductoNombre').value.trim();
            const nuevoPrecioMenor = parseFloat(document.getElementById('editProductoMenor').value);
            const nuevoPrecioMayor = parseFloat(document.getElementById('editProductoMayor').value);
            const escalonado = document.getElementById('editProductoEscalonado').checked;
            const cuartoRaw = document.getElementById('editProductoCuarto').value;
            const nuevoPrecioCuarto = cuartoRaw !== '' ? parseFloat(cuartoRaw) : null;
            const nuevaCantCuarto = parseInt(document.getElementById('editProductoCantCuarto').value) || 3;
            const nuevoTipoMayor = document.getElementById('editProductoTipoMayor').value;
            const nuevaCantMayor = parseInt(document.getElementById('editProductoCantMayor').value) || (nuevoTipoMayor === 'paquete' ? CANTIDAD_PAQUETE_DEFAULT : 12);

            if (!nuevoNombre || nuevoPrecioMenor <= 0 || nuevoPrecioMayor <= 0) {
                mostrarNotificacion('Por favor completa todos los campos', 'warning');
                return;
            }

            productosDB[productoEditandoIndex].nombre = nuevoNombre;
            productosDB[productoEditandoIndex].precioUnd = nuevoPrecioMenor;
            productosDB[productoEditandoIndex].precioMayor = nuevoPrecioMayor;
            productosDB[productoEditandoIndex].escalonado = escalonado;
            productosDB[productoEditandoIndex].precioCuarto = escalonado ? nuevoPrecioCuarto : null;
            productosDB[productoEditandoIndex].cantidadCuarto = nuevaCantCuarto;
            productosDB[productoEditandoIndex].tipoMayor = nuevoTipoMayor;
            productosDB[productoEditandoIndex].cantidadMayor = nuevaCantMayor;

            // Actualizar en cotización si existe
            const enTabla = productosEnTabla.find(p => p.codigo === productosDB[productoEditandoIndex].codigo);
            if (enTabla) {
                enTabla.nombre = nuevoNombre;
                enTabla.precioUnd = nuevoPrecioMenor;
                enTabla.precioMayor = nuevoPrecioMayor;
                enTabla.escalonado = escalonado;
                enTabla.precioCuarto = escalonado ? nuevoPrecioCuarto : null;
                enTabla.cantidadCuarto = nuevaCantCuarto;
                enTabla.tipoMayor = nuevoTipoMayor;
                enTabla.cantidadMayor = nuevaCantMayor;
            }

            renderProductList();
            renderTable();
            closeEditProductoModal();
            guardarEstado();
            renderProductosVistaRapida();
            mostrarNotificacion('Producto actualizado', 'success');
        });

        function eliminarProducto(index) {
            if (confirm('¿Eliminar este producto permanentemente?')) {
                productosDB.splice(index, 1);
                guardarEstado();
                renderProductList();
                renderProductosVistaRapida();
                mostrarNotificacion('Producto eliminado', 'success');
            }
        }


        // ============================================
        // PRODUCTOS EN LA NUBE (creados desde Ajustes o desde el buscador de Cotizar)
        // ============================================
        // El catálogo base (productosDB, definido más abajo) sigue viviendo en el código fuente —
        // es rápido y no depende de red. Los productos que el EQUIPO va agregando con el tiempo
        // (desde Ajustes → Productos, o desde "➕ Crear producto nuevo" en el buscador) se guardan
        // además en la nube (clase Productos), para que los vea cualquier usuario desde cualquier
        // dispositivo — no solo quien lo creó. Al iniciar sesión, se cargan y se suman al catálogo
        // en memoria (productosDB), así el resto del sistema (buscador, tabla, PDF, Kardex) los trata
        // exactamente igual que a cualquier producto del catálogo base, sin cambios adicionales.

        // Carga los productos guardados en la nube y los agrega a productosDB (evitando duplicados
        // por código). Se llama una vez al iniciar sesión.
        async function cargarProductosDesdeNube() {
            try {
                const where = encodeURIComponent(JSON.stringify({ activo: true }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_PRODUCTOS}?where=${where}&limit=1000`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return;
                const data = await resp.json();
                let agregados = 0;
                (data.results || []).forEach(p => {
                    if (productosDB.find(existente => existente.codigo === p.codigo)) return;
                    productosDB.push(crearProducto({
                        codigo: p.codigo,
                        nombre: p.nombre,
                        precioUnd: p.precioUnd,
                        precioCuarto: p.precioCuarto,
                        precioMayor: p.precioMayor,
                        escalonado: p.escalonado,
                        tipoMayor: p.tipoMayor,
                        cantidadCuarto: p.cantidadCuarto,
                        cantidadMayor: p.cantidadMayor,
                        sinKardex: !!p.sinKardex,
                        nota: p.nota
                    }));
                    agregados++;
                });
                if (agregados > 0) console.log(`☁️ ${agregados} producto(s) cargado(s) desde la nube`);
            } catch (e) {
                console.warn('No se pudieron cargar los productos desde la nube:', e);
            }
        }

        // Guarda un producto en la nube (POST). Se usa tanto desde Ajustes → Productos como desde la
        // creación rápida en el buscador de Cotizar, para que ambos caminos alimenten la misma tabla.
        async function guardarProductoEnNube(datosProducto) {
            const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_PRODUCTOS}`, {
                method: 'POST',
                headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                body: JSON.stringify({ activo: true, ...datosProducto })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || 'HTTP ' + resp.status);
            }
        }

        // Genera un código genérico autoincremental (NP-0001, NP-0002...) para productos creados
        // sobre la marcha. Reutiliza el mismo mecanismo atómico de los correlativos de documentos,
        // pero con su propio contador ("producto_generico") que arranca en 1, no en 450.
        // FIX (misma carrera que los correlativos, aplicada acá): existeCodigoGenericoEnUso() hace la
        // misma verificación anti-colisión que existeCorrelativoEnUso() pero contra la clase de
        // Productos, para que dos personas creando un producto "al vuelo" casi al mismo tiempo no
        // terminen con dos productos distintos compartiendo el mismo código NP-####.
        async function existeCodigoGenericoEnUso(codigo) {
            try {
                const where = encodeURIComponent(JSON.stringify({ codigo, activo: true }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_PRODUCTOS}?where=${where}&count=1&limit=0`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return false;
                const data = await resp.json();
                return (data.count || 0) > 0;
            } catch (e) {
                console.warn('No se pudo verificar colisión de código de producto:', e);
                return false;
            }
        }

        async function generarCodigoProductoGenerico() {
            let numero = await obtenerYAvanzarNumeroDocumento('producto_generico', 1);
            let codigo = 'NP-' + String(numero).padStart(4, '0');
            for (let intento = 0; intento < 5 && await existeCodigoGenericoEnUso(codigo); intento++) {
                console.warn(`⚠️ Código ${codigo} ya estaba en uso por otro producto — pidiendo otro (intento ${intento + 1})`);
                numero = await obtenerYAvanzarNumeroDocumento('producto_generico', 1);
                codigo = 'NP-' + String(numero).padStart(4, '0');
            }
            return codigo;
        }

        // Crea un producto nuevo desde el buscador de Cotizar: le asigna código genérico, lo guarda
        // en la nube para que lo vean todos los usuarios, y lo agrega también al catálogo en memoria
        // de esta sesión para poder usarlo de inmediato sin recargar la página. Queda marcado
        // "sinKardex: true" — son pedidos especiales sin stock físico previo en el almacén, así que
        // no participan del descuento/devolución automática de stock (ver calcularDiferenciaProductos).
        async function crearYGuardarProductoGenerico(nombre, precio) {
            const codigo = await generarCodigoProductoGenerico();
            const datosProducto = {
                codigo,
                nombre,
                precioUnd: precio,
                precioMayor: precio,
                escalonado: false,
                sinKardex: true,
                origen: 'buscador',
                creadoPor: usuarioActual?.username || '',
                creadoPorNombre: usuarioActual?.nombre || ''
            };
            try {
                await guardarProductoEnNube(datosProducto);
            } catch (e) {
                // No se pudo guardar en la nube (ej. sin conexión). Se avisa, pero no se bloquea la
                // venta: se agrega igual a ESTA cotización. Solo quedará pendiente de crearse de
                // nuevo para que otros usuarios lo vean, ya que esta vez no llegó a la nube.
                console.error('Error guardando producto en la nube:', e);
                mostrarNotificacion('El producto se agregó a la cotización, pero no se pudo guardar en la nube (sin conexión). Otros usuarios no lo verán todavía.', 'warning');
            }
            const nuevoProducto = crearProducto(datosProducto);
            productosDB.push(nuevoProducto);
            return nuevoProducto;
        }

        // FIX (correlativos duplicados): Parse REST no devuelve el valor ya incrementado en la
        // respuesta de un PUT con {__op:'Increment'} (solo devuelve "updatedAt"), así que
        // obtenerYAvanzarNumeroDocumento() casi siempre termina releyendo el contador por
        // separado (segunda llamada de red). Si dos personas guardan casi al mismo tiempo, ambas
        // pueden terminar leyendo el mismo número ya actualizado — eso es lo que producía
        // correlativos repetidos (confirmado en el historial: varias Cotizaciones/Órdenes/
        // Despachos activos comparten el mismo N°). Como refuerzo, antes de dar el número por
        // bueno se verifica que ningún otro documento ACTIVO del mismo tipo lo esté usando ya; si
        // lo está, se pide otro y se reintenta.
        async function existeCorrelativoEnUso(tipoContador, numero) {
            try {
                const where = encodeURIComponent(JSON.stringify({ tipoDocumento: tipoContador, correlativo: numero, activo: true }));
                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_COTIZACIONES}?where=${where}&count=1&limit=0`, {
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                });
                if (!resp.ok) return false;
                const data = await resp.json();
                return (data.count || 0) > 0;
            } catch (e) {
                console.warn('No se pudo verificar colisión de correlativo:', e);
                return false;
            }
        }

        // Devuelve el correlativo de la transacción en curso; si todavía no tiene uno, pide uno nuevo.
        // Si se vuelve a llamar para la MISMA cotización sin limpiar el carrito, reutiliza el mismo número.
        async function asegurarCorrelativo(tipoContador) {
            if (registroEnCurso[tipoContador]?.correlativo) {
                return registroEnCurso[tipoContador].correlativo;
            }
            let numero = await obtenerYAvanzarNumeroDocumento(tipoContador);
            for (let intento = 0; intento < 5 && await existeCorrelativoEnUso(tipoContador, numero); intento++) {
                console.warn(`⚠️ Correlativo ${numero} (${tipoContador}) ya estaba en uso por otro documento activo — pidiendo otro número (intento ${intento + 1})`);
                numero = await obtenerYAvanzarNumeroDocumento(tipoContador);
            }
            registroEnCurso[tipoContador] = { objectId: registroEnCurso[tipoContador]?.objectId || null, correlativo: numero };
            guardarEstado();
            return numero;
        }

        // Resuelve el número correlativo que debe mostrarse/guardarse para el documento actual.
        // - Cotización y Orden de Compra: cada una pide su propio número (numeración independiente).
        // - Despacho: NO pide un número nuevo; toma prestado el de CORRELATIVO_ASOCIADO_DESPACHO
        //   (lo crea si esa transacción todavía no tiene uno asignado en esta sesión). El despacho
        //   mantiene su PROPIO registro en el historial (con su propio objectId), solo el NÚMERO
        //   que se muestra es compartido.
        async function asegurarCorrelativoParaDocumento(tipodoc) {
            // 🧪 MODO DESARROLLADOR: cada tipo usa su propio contador "_prueba" y el Despacho de
            // prueba SIEMPRE es independiente (nunca toma prestado el número de una OC, ni real ni
            // de prueba), para que una prueba jamás pueda tocar el estado de un documento real.
            if (modoDesarrollador) {
                const tipoPrueba = tipodoc === 'DESPACHO' ? 'despacho_prueba' : obtenerTipoContador(tipodoc) + '_prueba';
                const numero = await asegurarCorrelativo(tipoPrueba);
                actualizarPanelCorrelativo();
                return numero;
            }
            if (tipodoc === 'DESPACHO') {
                // Si el despacho YA tiene un correlativo fijado de antemano (por ejemplo, se creó con
                // "📦 Crear Despacho" desde una Orden de Compra puntual, o se cargó uno ya guardado
                // desde el historial), se respeta ESE número tal cual — sin tocar el contador de
                // Orden de Compra ni pedir uno nuevo. Esto evita que regenerar el PDF de un despacho
                // ya guardado le cambie el número por el de la OC que esté en curso en ese momento.
                if (registroEnCurso.despacho?.correlativo) {
                    return registroEnCurso.despacho.correlativo;
                }
                const numeroPrestado = await asegurarCorrelativo(CORRELATIVO_ASOCIADO_DESPACHO);
                if (!registroEnCurso.despacho) registroEnCurso.despacho = { objectId: null, correlativo: null };
                registroEnCurso.despacho.correlativo = numeroPrestado;
                guardarEstado();
                return numeroPrestado;
            }
            const numero = await asegurarCorrelativo(obtenerTipoContador(tipodoc));
            actualizarPanelCorrelativo(); // el número ya quedó fijo: refresca el panel para mostrarlo como "asignado"
            return numero;
        }

