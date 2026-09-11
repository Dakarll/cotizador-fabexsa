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

        // ============================================
        // CATÁLOGO DE SUCURSALES SHALOM
        // ============================================
        // Antes acá vivía un array de ~480 sucursales escrito a mano. Se eliminó a
        // propósito: el catálogo de sucursales Shalom depende EXCLUSIVAMENTE de lo que
        // sincroniza el bot (shalom-tracker/scripts/check_agencias.js) en la clase
        // Back4App "SucursalShalom". Lo carga cargarSucursalesDesdeNube() (js/sucursales-nube.js)
        // al iniciar sesión. Si la nube no responde o devuelve 0, la app muestra un estado
        // de error/caché — nunca una lista hardcodeada. Las sucursales que un usuario
        // agregue a mano viven aparte, en localStorage (ver js/sucursales-nube.js).
        let sucursalesDB = [];


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

