// ============================================
// NOTIFICACIÓN POR WHATSAPP (Seguimiento Shalom)
// ============================================
// Portado de SIA (js/envios/whatsapp-notif.js). Cuando un envío llega "en
// destino" (paso 3 de la papeleta) y todavía no se avisó al cliente, se
// muestra un botón "Enviar WhatsApp" en su tarjeta:
//   - arma un mensaje genérico con saludo según la hora REAL de Lima,
//   - MÓVIL: abre wa.me/<numero>?text=... directo y copia la papeleta al
//     portapapeles en paralelo (para pegarla a mano),
//   - ESCRITORIO: copia la papeleta y abre WhatsApp según la preferencia
//     guardada en localStorage (WhatsApp Web / app de escritorio / auto).
// El cambio a "notificado" es OPTIMISTA (no hay forma de confirmar la
// entrega real) y queda en un log de auditoría (usuario + fecha + si fue
// primer aviso o reenvío) sin pisar el registro del primer aviso.
//
// Adaptaciones de stack vs. SIA:
//   - state.sesionUsuario -> usuarioActual (js/auth.js).
//   - parseFetch(SHALOM_CLASE, ...) -> parseShalom(...) (js/envios/shalom.js).
//   - copiarImagenAlPortapapeles() -> copiarBlobImagenPortapapeles()
//     (js/envios/papeleta.js).
//   - El teléfono del cliente: en este proyecto la OC guarda un campo
//     "telefono" directo, así que no hace falta parsear el blob "datos".
// ============================================

const MENSAJE_BASE_WSP = 'su pedido ya se encuentra en destino.';

// Pestaña con nombre fijo para WhatsApp Web: window.open() con este
// nombre reutiliza la pestaña que abrió este mismo botón.
const WSP_WEB_WINDOW = 'shalom_wsp_web';

// Preferencia de canal en PC ("web" | "app" | "auto"), en localStorage.
const CANAL_PC_KEY = 'wsp_canal_pc';

function getCanalPC() {
    try {
        const v = localStorage.getItem(CANAL_PC_KEY);
        return (v === 'web' || v === 'app' || v === 'auto') ? v : 'web';
    } catch (e) {
        return 'web';
    }
}

function setCanalPC(valor) {
    try { localStorage.setItem(CANAL_PC_KEY, valor); } catch (e) { /* sin storage */ }
}

// ---------- Utilidades ----------

// Saludo según la hora REAL de Lima (zona fija "America/Lima"), NO la hora
// del navegador: 00:00–11:59 → Buenos días · 12:00–17:59 → Buenas tardes ·
// 18:00–23:59 → Buenas noches.
function saludoLima(fecha = new Date()) {
    let hora;
    try {
        hora = Number(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Lima', hour: '2-digit', hour12: false
        }).format(fecha)) % 24; // algunos motores devuelven "24" a medianoche
    } catch (e) {
        hora = fecha.getHours(); // fallback muy improbable
    }
    if (hora < 12) return 'Buenos días';
    if (hora < 18) return 'Buenas tardes';
    return 'Buenas noches';
}

// Mensaje final, genérico y fijo (sin datos variables del pedido).
function mensajeNotifWsp() {
    return `${saludoLima()}, ${MENSAJE_BASE_WSP}`;
}

// Normaliza el número del cliente: quita separadores; antepone "51" si no
// trae código de país; valida que quede como número peruano (51 + 9
// dígitos). Devuelve { numero, valido }.
function normalizarTelefono(raw) {
    if (!raw) return { numero: '', valido: false };

    let v = String(raw).trim();
    const teniaPlus = v.startsWith('+');
    v = v.replace(/[^\d]/g, ''); // fuera espacios, guiones, paréntesis, puntos, "+", letras

    if (v.startsWith('00')) v = v.slice(2); // prefijo internacional viejo "00XX"

    if (!teniaPlus && v.length === 9) {
        v = '51' + v;                       // celular peruano sin código de país
    } else if (!teniaPlus && v.length === 10 && v.startsWith('0')) {
        v = '51' + v.slice(1);              // "0XXXXXXXXX" → quitar 0 y anteponer 51
    }

    const valido = /^51\d{9}$/.test(v);
    return { numero: v, valido };
}

// Detecta móvil (para decidir wa.me directo vs. flujo de escritorio).
function esMovilWsp() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
    }
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile|Silk/i.test(ua)) return true;
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches
        && window.matchMedia('(max-width: 820px)').matches;
}

// Busca la Orden de Compra vinculada a un envío dentro de historialCache
// (por N° formateado o por objectId).
function ordenCompraDeEnvio(envio) {
    if (!envio || typeof historialCache === 'undefined' || !Array.isArray(historialCache)) return null;
    return historialCache.find(e =>
        (envio.ordenCompraObjectId && e.objectId === envio.ordenCompraObjectId) ||
        (envio.numeroOrdenCompra && typeof e.correlativo === 'number' && formatearCorrelativo(e.correlativo) === envio.numeroOrdenCompra)
    ) || null;
}

// El teléfono del cliente: primero de la OC vinculada (campo "telefono"),
// como respaldo la base local de clientes por nombre exacto.
function telefonoDeEnvio(envio) {
    if (!envio) return '';

    const orden = ordenCompraDeEnvio(envio);
    if (orden && orden.telefono) return orden.telefono;

    const nombre = (envio.cliente || '').trim().toLowerCase();
    if (nombre && typeof getClientesDB === 'function') {
        try {
            const match = getClientesDB().find(c => (c.nombre || '').trim().toLowerCase() === nombre);
            if (match && match.telefono) return match.telefono;
        } catch (e) { /* base de clientes no disponible */ }
    }

    return '';
}

// "En destino" = paso 3 de la barra de progreso de la papeleta.
function estaEnDestino(envio) {
    if (!envio || envio.tipo === 'lima' || envio.estado === 'error') return false;
    return determinarPasoActual(envio) === 3;
}

// Estado de notificación interno, con retrocompatibilidad con el booleano
// viejo "notificado".
function estadoNotif(envio) {
    return envio.estadoNotificacion || (envio.notificado ? 'notificado' : 'sin_notificar');
}

function formatearFechaHoraWsp(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('es-PE', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return '—'; }
}

// ---------- Render del bloque en la tarjeta ----------

// HTML que js/envios/shalom.js inyecta al final de cada tarjeta de envío
// Shalom (no aplica a envíos Lima).
function botonNotificacionHtml(envio) {
    if (!envio || envio.tipo === 'lima') return '';

    // Ya notificado: se oculta el botón principal y se muestra el sello
    // "Notificado el [fecha/hora] por [usuario]" + botón "Reenviar".
    if (estadoNotif(envio) === 'notificado') {
        const cuando = formatearFechaHoraWsp(envio.notificadoEn);
        const quien = envio.notificadoPor || '—';
        return `
            <div class="wsp-notif wsp-notif--done">
                <span class="wsp-notif-info">✅ Notificado el ${cuando} por ${quien}</span>
                <button type="button" class="btn btn-small btn-whatsapp" onclick="reenviarWhatsappNotif('${envio.objectId}')">↻ Reenviar</button>
            </div>`;
    }

    // Sin notificar: el botón solo aparece si el envío está "en destino".
    if (!estaEnDestino(envio)) return '';

    const tel = normalizarTelefono(telefonoDeEnvio(envio));
    if (!tel.valido) {
        return `
            <div class="wsp-notif">
                <button type="button" class="btn btn-small btn-whatsapp" style="width:100%;" disabled>📲 Enviar WhatsApp</button>
                <div class="wsp-notif-aviso">⚠️ ${envio.numeroOrdenCompra
                    ? 'La orden vinculada no tiene un teléfono válido para WhatsApp.'
                    : 'Envío sin orden de compra vinculada: no hay teléfono del cliente.'}</div>
            </div>`;
    }

    return `
        <div class="wsp-notif">
            <button type="button" class="btn btn-small btn-whatsapp" style="width:100%;" onclick="enviarWhatsappNotif('${envio.objectId}')">📲 Enviar WhatsApp</button>
        </div>`;
}

// ---------- Envío / reenvío ----------

async function ejecutarEnvioWsp(objectId, esReenvio) {
    const envio = (shalomEnviosCache || []).find(e => e.objectId === objectId);
    if (!envio) { mostrarNotificacion('❌ No se encontró ese envío', 'warning'); return; }

    const tel = normalizarTelefono(telefonoDeEnvio(envio));
    if (!tel.valido) {
        mostrarNotificacion('⚠️ El cliente no tiene un número de WhatsApp válido en la orden vinculada.', 'warning');
        return;
    }

    const mensaje = mensajeNotifWsp();
    const movil = esMovilWsp();
    const textoUrl = encodeURIComponent(mensaje);

    // Estado optimista + auditoría: se hace YA, sin esperar a saber qué
    // hace el usuario en WhatsApp, porque no hay forma de confirmar la
    // entrega real del mensaje.
    marcarNotificadoWsp(envio, esReenvio);

    // MÓVIL: abrir el chat del cliente inmediatamente (aún dentro del
    // gesto del clic, para que el navegador no bloquee la apertura).
    if (movil) {
        window.open(`https://wa.me/${tel.numero}?text=${textoUrl}`, '_blank');
    }

    // Imagen de la papeleta → portapapeles, para adjuntar a mano.
    let blob = null;
    let copiada = false;
    showLoading(true);
    try {
        blob = await generarPapeletaBlobParaEnvio(envio);
        if (blob) copiada = await copiarBlobImagenPortapapeles(blob);
    } catch (err) {
        console.error('No se pudo preparar la imagen de la papeleta para WhatsApp:', err);
    } finally {
        showLoading(false);
    }

    // ESCRITORIO: abrir WhatsApp según la preferencia (web / app / auto).
    if (!movil) {
        enviarPorEscritorio(tel.numero, mensaje, getCanalPC());
    }

    if (copiada) {
        mostrarNotificacion(
            movil
                ? '✅ Imagen copiada. En el chat de WhatsApp: mantén pulsado el campo de texto → Pegar, y envía.'
                : '✅ Imagen copiada. Pégala con Ctrl+V en el chat de WhatsApp y envía. Si WhatsApp no se abrió, ábrelo tú y pega ahí.',
            'success'
        );
    } else {
        mostrarNotificacion('⚠️ No se pudo copiar la imagen automáticamente. Genera la papeleta con "🎫 Ver papeleta" y adjúntala a mano.', 'warning');
    }
}

// Enruta el envío en PC según la preferencia guardada.
function enviarPorEscritorio(numero, mensaje, canal) {
    if (canal === 'app') {
        abrirWhatsappApp(numero, mensaje);
        return;
    }
    if (canal === 'auto') {
        enviarAutoEscritorio(numero, mensaje);
        return;
    }
    abrirWhatsappWeb(numero, mensaje); // 'web' (por defecto)
}

// Abre la app de WhatsApp Escritorio con un esquema whatsapp:// desde un
// <a> temporal: si no hay app registrada, el clic no hace nada.
function abrirWhatsappApp(numero, mensaje) {
    const a = document.createElement('a');
    a.href = `whatsapp://send?phone=${numero}&text=${encodeURIComponent(mensaje)}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Abre web.whatsapp.com/send en una pestaña con NOMBRE FIJO: si este botón
// ya abrió una antes, el navegador la reutiliza.
function abrirWhatsappWeb(numero, mensaje) {
    const url = `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensaje)}`;
    let win = null;
    try {
        win = window.open(url, WSP_WEB_WINDOW);
    } catch (e) {
        win = null;
    }
    if (win) { try { win.focus(); } catch (e) { /* focus cross-origin puede fallar */ } }
    return win;
}

// "auto": intenta la app y reserva —dentro del gesto del clic— una pestaña
// en blanco con el nombre fijo. A los ~1.2 s: si el navegador perdió el
// foco, asumimos que la app abrió y cerramos la pestaña reservada; si no,
// la navegamos a WhatsApp Web.
function enviarAutoEscritorio(numero, mensaje) {
    abrirWhatsappApp(numero, mensaje);

    let win = null;
    try { win = window.open('about:blank', WSP_WEB_WINDOW); } catch (e) { win = null; }

    let perdioFoco = false;
    const onBlur = () => { perdioFoco = true; };
    window.addEventListener('blur', onBlur, { once: true });

    setTimeout(() => {
        window.removeEventListener('blur', onBlur);
        const url = `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensaje)}`;
        try {
            if (perdioFoco || document.visibilityState === 'hidden') {
                if (win && !win.closed) win.close();
            } else if (win && !win.closed) {
                win.location.href = url;
                try { win.focus(); } catch (e) { /* noop */ }
            } else {
                abrirWhatsappWeb(numero, mensaje);
            }
        } catch (e) {
            abrirWhatsappWeb(numero, mensaje);
        }
    }, 1200);
}

// Marca "notificado" en la cache local (re-render inmediato) y lo persiste
// en Back4App en segundo plano. El primer aviso fija notificadoEn/
// notificadoPor; un reenvío solo agrega al log.
function marcarNotificadoWsp(envio, esReenvio) {
    const ahora = new Date().toISOString();
    const usuario = usuarioActual ? usuarioActual.username : '—';
    const esPrimera = !esReenvio && !envio.notificadoEn;
    const registro = { usuario, fecha: ahora, tipo: esReenvio ? 'reenvio' : 'envio' };

    // Optimista local.
    envio.estadoNotificacion = 'notificado';
    envio.notificado = true;
    envio.notificacionLog = [...(envio.notificacionLog || []), registro];
    if (esPrimera) {
        envio.notificadoEn = ahora;
        envio.notificadoPor = usuario;
    }
    renderListaShalom();

    // Persistencia (segundo plano, no bloquea el flujo de compartir).
    const cambios = {
        estadoNotificacion: 'notificado',
        notificado: true, // se mantiene sincronizado el booleano viejo
        notificacionLog: { __op: 'Add', objects: [registro] }
    };
    if (esPrimera) {
        cambios.notificadoEn = ahora;
        cambios.notificadoPor = usuario;
    }
    parseShalom('PUT', envio.objectId, cambios).catch(err => {
        console.error('No se pudo guardar el estado de notificación en la nube:', err);
        mostrarNotificacion('⚠️ Se abrió WhatsApp, pero no se pudo guardar "notificado" en la nube. Usa "Reenviar" para reintentar.', 'warning');
    });
}

function initWhatsappNotif() {
    // Los botones se generan por innerHTML en js/envios/shalom.js.
    window.enviarWhatsappNotif = (objectId) => ejecutarEnvioWsp(objectId, false);
    window.reenviarWhatsappNotif = (objectId) => ejecutarEnvioWsp(objectId, true);

    // Selector de canal de envío WhatsApp en PC. En móvil no aplica.
    const wrap = document.getElementById('wspCanalPcWrap');
    const select = document.getElementById('wspCanalPcSelect');
    if (wrap && select && !esMovilWsp()) {
        wrap.style.display = '';
        select.value = getCanalPC();
        const etiquetas = { web: 'WhatsApp Web', app: 'WhatsApp Escritorio', auto: 'Automático' };
        select.addEventListener('change', () => {
            setCanalPC(select.value);
            mostrarNotificacion(`✅ En PC se enviará por: ${etiquetas[select.value] || select.value}`, 'success');
        });
    }
}
