// ============================================
// PAPELETA DE ENVÍO (comprobante visual)
// ============================================
// Portado de SIA (js/envios/papeleta.js). Tarjeta con barra de progreso
// de 4 pasos (En origen → En tránsito → En destino → Entregado),
// rasterizada a PNG con html2canvas.
//
// Es 100% de presentación: NO escribe nada en Back4App, solo lee el envío
// ya cargado en memoria (shalomEnviosCache, de js/envios/shalom.js).
//
// Adaptaciones de stack vs. SIA:
//   - descargarOCompartirBlob() -> descargarArchivo() (js/exportar.js).
//   - copiarImagenAlPortapapeles() -> ClipboardItem inline (mismo patrón
//     que copiarImagen() en js/exportar.js).
// ============================================

const ETIQUETAS_PASO_PAPELETA = ['En origen', 'En tránsito', 'En destino', 'Entregado'];
const TITULOS_PASO_PAPELETA = ['EN ORIGEN', 'EN TRÁNSITO', 'EN DESTINO', 'ENTREGADO'];
const EMOJIS_PASO_PAPELETA = ['📍', '🚚', '📦', '✅'];

let papeletaEnvioActual = null;

// Quita tildes y pasa a minúsculas para comparar detalleEstado contra
// palabras clave sin que un acento lo rompa.
function normalizarPapeleta(texto) {
    return (texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

// Determina en qué paso (1-4) de la barra de progreso está el envío. Se
// prioriza el texto libre de detalleEstado sobre el campo grueso "estado"
// porque Shalom a veces manda un detalle más preciso ahí (ej. "En destino
// — Está listo para su recojo") antes de que el robot de fondo actualice
// el "estado" general.
// También lo usa js/envios/whatsapp-notif.js: "paso === 3" es la
// definición de "el envío está en destino".
function determinarPasoActual(envio) {
    const detalle = normalizarPapeleta(envio.detalleEstado);

    if (envio.estado === 'entregado' || detalle.includes('entregad') || detalle.includes('recogido') || detalle.includes('fue recogid')) {
        return 4;
    }
    if (detalle.includes('en destino') || detalle.includes('listo para') || detalle.includes('para su recojo') || detalle.includes('para recojo')) {
        return 3;
    }
    if (envio.estado === 'en_transito' || detalle.includes('transito') || detalle.includes('en camino') || detalle.includes('en ruta')) {
        return 2;
    }
    return 1;
}

function formatearFechaPapeleta(iso) {
    if (!iso) return 'Aún sin actualizar por el robot';
    const fecha = new Date(iso);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const aa = String(fecha.getFullYear()).slice(-2);
    const hh = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    return `Desde el ${dd}/${mm}/${aa} a las ${hh}:${min}`;
}

function renderBarraPasosPapeleta(pasoActual) {
    return `
        <div class="papeleta-steps">
            ${[1, 2, 3, 4].map((paso, i) => `
                ${i > 0 ? `<div class="papeleta-step-connector ${paso <= pasoActual ? 'current' : ''}"></div>` : ''}
                <div class="papeleta-step-circle ${paso === pasoActual ? 'current' : ''}">${paso === pasoActual ? '✓' : paso}</div>
            `).join('')}
        </div>
        <div class="papeleta-steps-labels">
            ${ETIQUETAS_PASO_PAPELETA.map((etiqueta, i) => `<div class="papeleta-step-label ${i + 1 === pasoActual ? 'current' : ''}">${etiqueta}</div>`).join('')}
        </div>
    `;
}

function armarHtmlPapeleta(envio) {
    const esError = envio.estado === 'error';
    const pasoActual = esError ? null : determinarPasoActual(envio);
    const emojiBadge = esError ? '⚠️' : EMOJIS_PASO_PAPELETA[pasoActual - 1];
    const titulo = esError ? '⚠️ ERROR DE SEGUIMIENTO' : TITULOS_PASO_PAPELETA[pasoActual - 1];

    const guiaLinea = (envio.guia || envio.codigo)
        ? `<div class="papeleta-guia">${[envio.guia, envio.codigo].filter(Boolean).join(' - ')}</div>`
        : '';

    return `
        <div class="papeleta-header">
            <div class="papeleta-brand">📦 FABEXSA</div>
            <div class="papeleta-badge">${emojiBadge}</div>
        </div>
        <div class="papeleta-estado-titulo">${titulo}</div>
        ${guiaLinea}
        <div class="papeleta-fecha">${formatearFechaPapeleta(envio.ultimaConsulta)}</div>
        ${!esError ? renderBarraPasosPapeleta(pasoActual) : ''}
        ${envio.detalleEstado ? `
            <div class="papeleta-mensaje">
                <div class="papeleta-mensaje-texto">${envio.detalleEstado}</div>
            </div>
        ` : ''}
        <div class="papeleta-divider"></div>
        ${envio.destino ? `
            <div class="papeleta-row-label">📍 Destino</div>
            <div class="papeleta-row-value">${envio.destino}</div>
        ` : ''}
        ${envio.cliente ? `
            <div class="papeleta-row-label">👤 Destinatario</div>
            <div class="papeleta-row-value">${envio.cliente}</div>
        ` : ''}
        ${envio.numeroOrdenCompra ? `<div class="papeleta-oc-chip">🔗 ${envio.numeroOrdenCompra}</div>` : ''}
        <div class="papeleta-footer">Seguimiento de envío generado por Fabexsa · rastreo Shalom</div>
    `;
}

function abrirPapeleta(objectId) {
    const envio = (shalomEnviosCache || []).find(e => e.objectId === objectId);
    if (!envio) {
        mostrarNotificacion('❌ No se encontró ese envío', 'warning');
        return;
    }
    if (envio.tipo === 'lima') {
        mostrarNotificacion('ℹ️ La papeleta solo aplica a envíos Shalom', 'info');
        return;
    }

    papeletaEnvioActual = envio;
    document.getElementById('papeletaPreviewCard').innerHTML = armarHtmlPapeleta(envio);
    document.getElementById('papeletaModal').classList.add('active');
}

function cerrarPapeleta() {
    document.getElementById('papeletaModal').classList.remove('active');
}

// Dibuja la tarjeta ya renderizada en #papeletaPreviewCard y devuelve el
// PNG resultante como Blob.
async function generarPapeletaBlob() {
    const element = document.getElementById('papeletaPreviewCard');
    const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: false,
        width: element.offsetWidth,
        height: element.offsetHeight
    });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Rasteriza la papeleta de un envío SIN abrir el modal — la usa la
// notificación por WhatsApp (js/envios/whatsapp-notif.js) para adjuntar la
// imagen. Renderiza en un nodo propio fuera de pantalla porque
// #papeletaPreviewCard vive dentro de un .modal oculto (sin layout,
// html2canvas no puede medirlo mientras no esté "active").
async function generarPapeletaBlobParaEnvio(envio) {
    let host = document.getElementById('papeletaRasterOffscreen');
    if (!host) {
        host = document.createElement('div');
        host.id = 'papeletaRasterOffscreen';
        host.className = 'papeleta-card';
        host.style.cssText = 'position:fixed; left:-9999px; top:0; width:300px;';
        document.body.appendChild(host);
    }
    host.innerHTML = armarHtmlPapeleta(envio);
    // Un tick para que el navegador aplique estilos/layout antes de capturar.
    await new Promise(resolve => setTimeout(resolve, 60));

    const canvas = await html2canvas(host, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: false,
        width: host.offsetWidth,
        height: host.offsetHeight
    });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Copia un blob de imagen al portapapeles (mismo patrón que copiarImagen()
// en js/exportar.js). Devuelve true si se copió.
async function copiarBlobImagenPortapapeles(blob) {
    if (!blob || !navigator.clipboard || !window.ClipboardItem) return false;
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (e) {
        console.warn('No se pudo copiar la imagen al portapapeles:', e);
        return false;
    }
}

async function descargarPapeleta() {
    showLoading(true);
    try {
        const blob = await generarPapeletaBlob();
        await descargarArchivo(blob, `Papeleta_Envio_${Date.now()}.png`, 'image/png');
        showLoading(false);
        mostrarNotificacion('✅ Papeleta generada y descargada', 'success');
    } catch (error) {
        console.error('Error al generar la papeleta:', error);
        showLoading(false);
        mostrarNotificacion('❌ Error al generar la papeleta', 'error');
    }
}

async function copiarPapeleta() {
    showLoading(true);
    try {
        const blob = await generarPapeletaBlob();
        const copiada = await copiarBlobImagenPortapapeles(blob);
        showLoading(false);
        mostrarNotificacion(
            copiada ? '✅ Papeleta copiada al portapapeles' : '⚠️ Tu navegador no permite copiar automáticamente — usa el botón "Descargar / Compartir"',
            copiada ? 'success' : 'warning'
        );
    } catch (error) {
        console.error('Error al generar la papeleta:', error);
        showLoading(false);
        mostrarNotificacion('❌ Error al generar la papeleta', 'error');
    }
}

function initPapeleta() {
    const btnCerrar = document.getElementById('btnCerrarPapeletaModal');
    const btnDescargar = document.getElementById('btnDescargarPapeleta');
    const btnCopiar = document.getElementById('btnCopiarPapeleta');
    const modal = document.getElementById('papeletaModal');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarPapeleta);
    if (btnDescargar) btnDescargar.addEventListener('click', descargarPapeleta);
    if (btnCopiar) btnCopiar.addEventListener('click', copiarPapeleta);
    if (modal) modal.addEventListener('click', function (e) { if (e.target === this) cerrarPapeleta(); });
}
