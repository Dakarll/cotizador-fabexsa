// ============================================
// SEGUIMIENTO SHALOM (QR + Back4App + robot de fondo)
// ============================================
// Portado de SIA (js/envios/shalom.js). Escaneo de guías por cámara/foto,
// registro manual, listado/estado en caché, y aviso de entregas.
//
// DIFERENCIAS DE STACK vs. SIA (ver README del bot):
//   - SIA usa ES Modules + parseFetch() genérico + X-Parse-JavaScript-Key.
//     Aquí todo es scope global (sin build) y se reutiliza BACK4APP_CONFIG
//     + headersBack4App() de js/auth.js (X-Parse-REST-API-Key).
//   - SIA guarda cada registro con ACL por objeto (dueño + role:Admin).
//     Aquí NO se pone ACL por objeto: se controla por CLP a nivel de
//     clase, igual que Cotizaciones y Clientes en este proyecto. Se sigue
//     guardando creadoPorUsername para la etiqueta "· por X".
//   - El vínculo con una Orden de Compra: SIA usa un string libre
//     numeroOrdenCompra en la clase Cotizacion. Aquí las OC no tienen ese
//     campo; su identificador humano es formatearCorrelativo(correlativo)
//     -> "N° 000500". Se guarda ese string en numeroOrdenCompra y además
//     ordenCompraObjectId para un vínculo estable.
// ============================================

const SHALOM_CLASE = 'EnvioShalom';

let shalomEnviosCache = [];          // último listado del servidor, para filtrar sin refetch
let shalomCameraStream = null;
let shalomScanLoopActive = false;

// Envoltorio REST para la clase EnvioShalom (equivale al parseFetch de SIA,
// pero fijado a esta clase y con soporte de DELETE).
async function parseShalom(metodo, objectId, body, query) {
    let url = `${BACK4APP_CONFIG.serverUrl}/classes/${SHALOM_CLASE}`;
    if (objectId) url += `/${objectId}`;

    if (metodo === 'GET' && query) {
        const params = new URLSearchParams();
        if (query.where) params.set('where', JSON.stringify(query.where));
        if (query.order) params.set('order', query.order);
        if (query.limit !== undefined && query.limit !== null) params.set('limit', query.limit);
        if (query.count) params.set('count', query.count);
        url += `?${params.toString()}`;
    }

    const res = await fetch(url, {
        method: metodo,
        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
        body: (metodo === 'POST' || metodo === 'PUT') ? JSON.stringify(body || {}) : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((data && data.error) || `Error Back4App (${res.status})`);
    }
    return data;
}

// Tarjetas "esqueleto" mientras llega la respuesta de la nube (portado de
// mostrarSkeletonCards de SIA).
function mostrarSkeletonCardsShalom(contenedorId, cantidad = 3, alto = 30) {
    const el = document.getElementById(contenedorId);
    if (!el) return;
    el.innerHTML = Array.from({ length: cantidad }).map(() => `
        <div class="skeleton-card">
            <div class="skeleton-block" style="width:60%; height:16px;"></div>
            <div class="skeleton-block" style="width:40%; height:12px;"></div>
            <div class="skeleton-block" style="width:90%; height:${alto}px;"></div>
        </div>
    `).join('');
}

// ---------- Escaneo de QR ----------

function contextoSeguroParaCamara() {
    return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function mostrarErrorCamara(msg) {
    const el = document.getElementById('shalomCameraError');
    el.textContent = msg;
    el.style.display = 'block';
}
function ocultarErrorCamara() {
    document.getElementById('shalomCameraError').style.display = 'none';
}

async function iniciarCamaraQR() {
    ocultarErrorCamara();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        mostrarErrorCamara('Este navegador no soporta acceso a cámara desde aquí.');
        return;
    }
    if (!contextoSeguroParaCamara()) {
        mostrarErrorCamara('⚠️ La cámara solo funciona si abres esta página por HTTPS (o localhost) — abrirla directo desde tu carpeta de archivos no funciona en la mayoría de navegadores. Usa "Subir foto" mientras tanto.');
        return;
    }

    detenerCamaraQR(); // por si había una cámara abierta de un intento anterior

    const video = document.getElementById('shalomVideo');
    const wrapper = document.getElementById('shalomCameraWrapper');

    try {
        shalomCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = shalomCameraStream;
        wrapper.style.display = 'block';
        document.getElementById('btnIniciarCamara').style.display = 'none';
        document.getElementById('btnDetenerCamara').style.display = 'inline-block';

        await new Promise(resolve => {
            if (video.readyState >= video.HAVE_METADATA) return resolve();
            video.addEventListener('loadedmetadata', resolve, { once: true });
        });
        await video.play().catch(() => {});

        shalomScanLoopActive = true;
        requestAnimationFrame(shalomScanLoop);
    } catch (err) {
        console.error(err);
        if (err.name === 'NotAllowedError') {
            mostrarErrorCamara('Bloqueaste el permiso de cámara. Habilítalo en el ícono de candado/cámara de la barra de direcciones y vuelve a intentar.');
        } else if (err.name === 'NotFoundError') {
            mostrarErrorCamara('No se encontró ninguna cámara en este dispositivo.');
        } else {
            mostrarErrorCamara('No se pudo acceder a la cámara (' + err.message + '). Usa "Subir foto" en su lugar.');
        }
        detenerCamaraQR();
    }
}

function detenerCamaraQR() {
    shalomScanLoopActive = false;
    if (shalomCameraStream) {
        shalomCameraStream.getTracks().forEach(t => t.stop());
        shalomCameraStream = null;
    }
    const wrapper = document.getElementById('shalomCameraWrapper');
    if (wrapper) wrapper.style.display = 'none';
    const btnIniciar = document.getElementById('btnIniciarCamara');
    const btnDetener = document.getElementById('btnDetenerCamara');
    if (btnIniciar) btnIniciar.style.display = 'inline-block';
    if (btnDetener) btnDetener.style.display = 'none';
}

function shalomScanLoop() {
    if (!shalomScanLoopActive) return;
    const video = document.getElementById('shalomVideo');
    const canvas = document.getElementById('shalomCanvas');

    if (video && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const codigo = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
        if (codigo && codigo.data) {
            mostrarQRDetectado(codigo.data);
            detenerCamaraQR();
            return;
        }
    }
    requestAnimationFrame(shalomScanLoop);
}

function leerQRDesdeArchivo(input) {
    const file = input.files[0];
    if (!file) return;
    ocultarErrorCamara();
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.getElementById('shalomCanvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const codigo = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
            if (codigo && codigo.data) {
                mostrarQRDetectado(codigo.data);
            } else {
                mostrarNotificacion('⚠️ No se detectó ningún QR en la imagen. Intenta con mejor luz/enfoque o usa el ingreso manual.', 'warning');
            }
        };
        img.onerror = function () {
            mostrarNotificacion('⚠️ No se pudo leer esa imagen.', 'warning');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// El QR de Shalom NO contiene el N° de Orden público ni el código de
// seguridad — contiene un ID interno propio de Shalom ("oseId", ej.
// "89636411/document/1/"). Por eso el registro manual (N° de Orden +
// Código de 4 dígitos) sigue siendo la vía confiable; el QR es un atajo.
function mostrarQRDetectado(textoQR) {
    document.getElementById('shalomQrTexto').textContent = textoQR;
    document.getElementById('shalomQrResultado').style.display = 'block';
}

// ---------- Vínculo con Órdenes de Compra ----------

// Devuelve las OC "reales" (no de prueba) del historial en memoria.
function ordenesCompraDelHistorial() {
    if (typeof historialCache === 'undefined' || !Array.isArray(historialCache)) return [];
    return historialCache.filter(e =>
        e.tipoDocumento === 'orden_compra' &&
        !e.esPrueba &&
        typeof e.correlativo === 'number'
    );
}

// A partir del texto del campo "vincular a OC" ("N° 000500 — Cliente" o
// solo "N° 000500"), resuelve el string de N° de orden y el objectId de
// la OC vinculada (si se encuentra en historialCache).
function resolverOrdenCompra(texto) {
    const raw = (texto || '').trim();
    if (!raw) return { numeroOrdenCompra: null, ordenCompraObjectId: null };
    const numero = raw.includes(' — ') ? raw.split(' — ')[0].trim() : raw;
    const oc = ordenesCompraDelHistorial().find(e => formatearCorrelativo(e.correlativo) === numero);
    return { numeroOrdenCompra: numero, ordenCompraObjectId: oc ? oc.objectId : null };
}

// Llena el datalist del buscador de "vincular a orden de compra".
function poblarListaOrdenesCompra() {
    const datalist = document.getElementById('listaOrdenesCompra');
    if (!datalist) return;
    datalist.innerHTML = ordenesCompraDelHistorial()
        .map(o => `<option value="${formatearCorrelativo(o.correlativo)} — ${o.cliente}"></option>`)
        .join('');
}

// ---------- Registro y listado ----------

async function registrarGuiaManual() {
    const guia = document.getElementById('shalomGuiaManual').value.trim();
    const codigo = document.getElementById('shalomCodigoManual').value.trim();
    const cliente = document.getElementById('shalomClienteManual').value.trim();
    const destino = document.getElementById('shalomDestinoManual').value.trim();
    const oc = resolverOrdenCompra(document.getElementById('shalomOcManual').value);
    await crearRegistroShalom(guia, codigo, cliente, destino, oc.numeroOrdenCompra, 'shalom', 'pendiente', oc.ordenCompraObjectId);
    document.getElementById('shalomGuiaManual').value = '';
    document.getElementById('shalomCodigoManual').value = '';
    document.getElementById('shalomClienteManual').value = '';
    document.getElementById('shalomDestinoManual').value = '';
    document.getElementById('shalomOcManual').value = '';
}

async function crearRegistroShalom(guia, codigo, cliente, destino, numeroOrdenCompra, tipo = 'shalom', estadoInicial = 'pendiente', ordenCompraObjectId = null) {
    if (tipo === 'shalom') {
        if (!guia || !codigo) {
            mostrarNotificacion('⚠️ Shalom necesita el N° de Orden Y el Código de Orden (4 dígitos) para poder rastrear', 'warning');
            return;
        }
    } else {
        // Envío Lima: no pasa por Shalom, así que no necesita guía ni
        // código — pero sí algo que lo identifique.
        if (!cliente && !numeroOrdenCompra) {
            mostrarNotificacion('⚠️ Ingresa al menos el cliente o la orden de compra para registrar el envío Lima', 'warning');
            return;
        }
        if (!guia) guia = `LIMA-${Date.now().toString().slice(-8)}`;
    }
    try {
        if (guia) {
            const existentes = await parseShalom('GET', null, null, { where: { guia }, limit: 1 });
            if (existentes.results && existentes.results.length > 0) {
                mostrarNotificacion(`ℹ️ Ya había un envío registrado con esa referencia (${guia})`, 'info');
                return;
            }
        }

        await parseShalom('POST', null, {
            guia,
            codigo: codigo || null,
            cliente: cliente || null,
            destino: destino || (tipo === 'lima' ? 'Lima' : null),
            numeroOrdenCompra: numeroOrdenCompra || null,
            ordenCompraObjectId: ordenCompraObjectId || null,
            estado: estadoInicial,
            tipo,
            notificado: false,
            creadoPorUsername: usuarioActual.username
        });
        mostrarNotificacion(tipo === 'lima' ? '✅ Envío Lima registrado' : `✅ Guía ${guia} registrada para seguimiento`, 'success');
        document.getElementById('shalomQrResultado').style.display = 'none';
        cargarEnviosShalom();
    } catch (err) {
        mostrarNotificacion('❌ Error al registrar: ' + err.message, 'warning');
        console.error(err);
    }
}

function eliminarEnvioShalom(objectId) {
    if (!confirm('¿Eliminar este envío del seguimiento?')) return;
    parseShalom('DELETE', objectId)
        .then(() => cargarEnviosShalom())
        .catch(err => mostrarNotificacion('❌ Error al eliminar: ' + err.message, 'warning'));
}

async function marcarNotificadoShalom(objectId) {
    try {
        await parseShalom('PUT', objectId, { notificado: true });
    } catch (err) { console.error(err); }
}

const ETIQUETAS_ESTADO_SHALOM = {
    pendiente: { texto: '⏳ Pendiente', color: '#718096', bg: '#edf2f7' },
    en_transito: { texto: '🚚 En tránsito', color: '#3182ce', bg: '#ebf8ff' },
    entregado: { texto: '✅ Entregado', color: '#38a169', bg: '#f0fff4' },
    error: { texto: '⚠️ Error', color: '#e53e3e', bg: '#fff5f5' }
};

async function cargarEnviosShalom() {
    if (!usuarioActual) return;
    const listEl = document.getElementById('shalomList');
    const bannerEl = document.getElementById('shalomNotifBanner');
    if (!listEl) return;

    // El teléfono del cliente (para el botón WhatsApp) y la vista Envíos
    // dependen de las OC del historial. Este proyecto NO precarga el
    // historial al iniciar sesión (solo al abrir su pestaña), así que lo
    // pedimos aquí si aún no está en memoria.
    if (typeof historialCache !== 'undefined' && historialCache.length === 0 && typeof cargarHistorialDesdeNube === 'function') {
        try { await cargarHistorialDesdeNube(); } catch (e) { console.warn('No se pudo precargar el historial para Shalom:', e); }
    }
    poblarListaOrdenesCompra();

    mostrarSkeletonCardsShalom('shalomList', 3, 30);

    try {
        const resultado = await parseShalom('GET', null, null, { order: '-createdAt' });
        shalomEnviosCache = resultado.results || [];

        const nuevos = shalomEnviosCache.filter(e => e.estado === 'entregado' && !e.notificado);
        if (bannerEl) {
            if (nuevos.length > 0) {
                bannerEl.style.display = 'block';
                bannerEl.innerHTML = nuevos.map(e => `
                    <div class="ios-banner ios-banner--success">
                        <div class="ios-banner-icon">📦</div>
                        <div class="ios-banner-body">
                            <div class="ios-banner-title">${e.guia ? 'Guía ' + e.guia : (e.cliente || 'Envío')} entregado</div>
                            <div class="ios-banner-text">${e.cliente && e.guia ? e.cliente + ' — ' : ''}ya llegó a destino.</div>
                        </div>
                        <button class="ios-banner-dismiss" onclick="marcarNotificadoShalom('${e.objectId}'); this.closest('.ios-banner').remove();">Visto</button>
                    </div>
                `).join('');
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                    nuevos.forEach(e => new Notification('📦 Envío entregado', { body: `${e.guia || e.cliente || 'Tu envío'} ya llegó a destino.` }));
                } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
                    Notification.requestPermission();
                }
            } else {
                bannerEl.style.display = 'none';
            }
        }

        renderListaShalom();

        // Si la pestaña Envíos está abierta, refrescamos sus etiquetas de
        // estado sin volver a pedir las cotizaciones al servidor.
        const tabEnvios = document.getElementById('tab-envios');
        if (tabEnvios && tabEnvios.classList.contains('active') && typeof renderEnvios === 'function') {
            renderEnvios();
        }
    } catch (err) {
        listEl.innerHTML = `<div class="historial-empty">❌ Error al conectar con Back4App: ${err.message}</div>`;
        console.error(err);
    }
}

// Filtra shalomEnviosCache por el texto del buscador y pinta las tarjetas.
// No vuelve a pedir datos al servidor — solo filtra lo ya cargado.
function renderListaShalom() {
    const listEl = document.getElementById('shalomList');
    const countEl = document.getElementById('shalomCount');
    const buscadorEl = document.getElementById('shalomBuscador');
    if (!listEl) return;
    const texto = buscadorEl ? buscadorEl.value.trim().toLowerCase() : '';

    if (countEl) countEl.textContent = shalomEnviosCache.length;

    const filtrados = !texto ? shalomEnviosCache : shalomEnviosCache.filter(e => {
        const info = ETIQUETAS_ESTADO_SHALOM[e.estado] || ETIQUETAS_ESTADO_SHALOM.pendiente;
        const campo = [e.guia, e.codigo, e.oseId, e.cliente, e.destino, e.detalleEstado, e.numeroOrdenCompra, info.texto]
            .filter(Boolean).join(' ').toLowerCase();
        return campo.includes(texto);
    });

    if (shalomEnviosCache.length === 0) {
        listEl.innerHTML = '<div class="historial-empty">No hay envíos en seguimiento. Registra una guía (N° de Orden + Código) para empezar.</div>';
        return;
    }
    if (filtrados.length === 0) {
        listEl.innerHTML = '<div class="historial-empty">No se encontró ningún envío con ese criterio de búsqueda.</div>';
        return;
    }

    listEl.innerHTML = filtrados.map(e => {
        const info = ETIQUETAS_ESTADO_SHALOM[e.estado] || ETIQUETAS_ESTADO_SHALOM.pendiente;
        const esLima = e.tipo === 'lima';
        const ultima = esLima
            ? 'Actualización manual'
            : (e.ultimaConsulta ? new Date(e.ultimaConsulta).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Aún no consultado');
        const nombreMostrado = e.cliente || (e.guia ? `Guía ${e.guia}` : '🤖 QR sin resolver aún');
        const subinfo = esLima
            ? '🏙️ Envío Lima (entrega local)'
            : (e.guia ? `Guía ${e.guia}${e.codigo ? ' · Código ' + e.codigo : ''}` : `Registrado por QR`);
        const creadoPor = (e.creadoPorUsername && e.creadoPorUsername !== usuarioActual.username) ? ' · por ' + e.creadoPorUsername : '';
        return `
            <div class="shalom-card">
                <div class="shalom-card-top">
                    <div style="min-width:0;">
                        <h3 class="shalom-card-nombre">${nombreMostrado}</h3>
                        <div class="shalom-card-subinfo">${subinfo}</div>
                    </div>
                    <button class="shalom-card-del-btn" onclick="eliminarEnvioShalom('${e.objectId}')" title="Eliminar" aria-label="Eliminar envío del seguimiento">✕</button>
                </div>
                ${e.destino ? `<div class="shalom-card-destino">📍 ${e.destino}</div>` : ''}
                ${e.numeroOrdenCompra ? `<div style="font-size:0.78em; font-weight:700; color:#5568d3;">🔗 ${e.numeroOrdenCompra}</div>` : ''}
                <span class="shalom-card-estado-badge" style="color:${info.color}; background:${info.bg};">${info.texto}</span>
                ${e.detalleEstado ? `<div class="shalom-card-detalle">${e.detalleEstado}</div>` : ''}
                <div class="shalom-card-fecha">${ultima}${creadoPor}</div>
                ${esLima ? `<div style="margin-top:8px;">
                    ${e.estado === 'entregado'
                        ? `<button type="button" class="btn btn-small" style="background:#edf2f7; color:#718096; width:100%;" onclick="cambiarEstadoLima('${e.objectId}', 'pendiente')">↩ Marcar pendiente</button>`
                        : `<button type="button" class="btn btn-small" style="background:#38a169; color:white; width:100%;" onclick="cambiarEstadoLima('${e.objectId}', 'entregado')">✅ Marcar entregado</button>`
                    }
                </div>` : `
                    ${e.guia ? `<div style="margin-top:8px;">
                        <button type="button" class="btn btn-small" style="background:#5568d3; color:white; width:100%;" onclick="abrirPapeleta('${e.objectId}')">🎫 Ver papeleta</button>
                    </div>` : ''}
                    ${typeof botonNotificacionHtml === 'function' ? botonNotificacionHtml(e) : ''}
                `}
            </div>`;
    }).join('');
}

// Busca, dentro de los envíos ya cargados en memoria, uno vinculado a una
// Orden de Compra dada (por su N° formateado o por su objectId).
function buscarEnvioPorOC(numeroOC, ocObjectId) {
    if (!Array.isArray(shalomEnviosCache)) return null;
    return shalomEnviosCache.find(e =>
        (numeroOC && e.numeroOrdenCompra === numeroOC) ||
        (ocObjectId && e.ordenCompraObjectId === ocObjectId)
    ) || null;
}

// Etiqueta visual reutilizable para el estado de envío de una orden
// (usada en la pestaña Envíos).
function badgeEnvioHtml(envio) {
    const info = ETIQUETAS_ESTADO_SHALOM[envio.estado] || { texto: '🚚 Enviado', color: '#3182ce', bg: '#ebf8ff' };
    return `<span style="display:inline-block; padding:2px 9px; border-radius:12px; font-size:0.72em; font-weight:700; background:${info.bg}; color:${info.color};">🚚 Envío: ${info.texto}</span>`;
}

function initShalom() {
    const btnIniciar = document.getElementById('btnIniciarCamara');
    const btnDetener = document.getElementById('btnDetenerCamara');
    const inputArchivo = document.getElementById('shalomInputArchivo');
    const btnRegistrar = document.getElementById('btnRegistrarGuiaManual');
    const buscador = document.getElementById('shalomBuscador');
    const btnActualizar = document.getElementById('btnActualizarShalom');

    if (btnIniciar) btnIniciar.addEventListener('click', iniciarCamaraQR);
    if (btnDetener) btnDetener.addEventListener('click', detenerCamaraQR);
    if (inputArchivo) inputArchivo.addEventListener('change', function () { leerQRDesdeArchivo(this); });
    if (btnRegistrar) btnRegistrar.addEventListener('click', registrarGuiaManual);
    if (buscador) buscador.addEventListener('input', renderListaShalom);
    if (btnActualizar) btnActualizar.addEventListener('click', cargarEnviosShalom);
}
