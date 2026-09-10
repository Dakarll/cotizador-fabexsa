// ============================================
// TAB: ENVÍOS — órdenes de compra + su estado de envío  ·  envíos Lima
// ============================================
// Portado de SIA (js/envios/lima.js).
//
// - Vista "Envíos": tabla de Órdenes de Compra confirmadas + su guía/
//   estado vinculado, con filtros por texto y por estado, badge de
//   pendientes, y atajo para saltar al formulario de registro de guía
//   prellenado. No pide datos nuevos: reutiliza historialCache
//   (cotizaciones) y shalomEnviosCache (guías).
// - Envíos Lima: entregas locales que NO pasan por Shalom (moto propia,
//   delivery, recojo en tienda). Mismo modelo de datos que un envío
//   Shalom pero tipo="lima", sin guía/código reales, estado cambiado A
//   MANO (nunca lo toca el bot).
//
// Adaptaciones de stack vs. SIA:
//   - Una OC es historialCache[i] con tipoDocumento === 'orden_compra'
//     (SIA: estado === 'orden_compra'). Su N° es formatearCorrelativo(correlativo).
//   - entry.datos (JSON string) -> entry.productos (array real).
//   - entry.empresa -> entry.empresaCliente.
//   - parseFetch(SHALOM_CLASE, ...) -> parseShalom(...).
// ============================================

// Órdenes de compra reales (no de prueba) del historial en memoria.
function ordenesCompraEnvios() {
    if (typeof historialCache === 'undefined' || !Array.isArray(historialCache)) return [];
    return historialCache.filter(e =>
        e.tipoDocumento === 'orden_compra' &&
        !e.esPrueba &&
        typeof e.correlativo === 'number'
    );
}

function envioDeOrden(entry) {
    return buscarEnvioPorOC(formatearCorrelativo(entry.correlativo), entry.objectId);
}

// Badge "Envíos": nº de OC confirmadas que aún NO están entregadas (sin
// guía registrada, o con guía en cualquier estado distinto de
// "entregado"). Conteo estable (no depende de los filtros de la vista).
function actualizarBadgeEnviosSidebar() {
    const badges = document.querySelectorAll('.js-envios-badge');
    if (!badges.length) return;
    const pendientes = ordenesCompraEnvios().filter(e => {
        const envio = envioDeOrden(e);
        return !envio || envio.estado !== 'entregado';
    }).length;
    badges.forEach(b => {
        b.textContent = pendientes;
        b.hidden = pendientes === 0;
    });
}

async function renderEnvios() {
    const listEl = document.getElementById('enviosList');
    const countEl = document.getElementById('enviosCount');
    if (!listEl) return;

    // Este proyecto no precarga el historial al iniciar sesión.
    if (typeof historialCache !== 'undefined' && historialCache.length === 0 && typeof cargarHistorialDesdeNube === 'function') {
        try { await cargarHistorialDesdeNube(); } catch (e) { console.warn('No se pudo cargar el historial para Envíos:', e); }
    }
    if (typeof shalomEnviosCache !== 'undefined' && shalomEnviosCache.length === 0 && typeof cargarEnviosShalom === 'function') {
        // Trae las guías si aún no están (cargarEnviosShalom vuelve a llamar
        // a renderEnvios al terminar, así que salimos y dejamos que ese
        // segundo pase pinte).
        cargarEnviosShalom();
    }

    actualizarBadgeEnviosSidebar();
    if (typeof pintarResumenListaCompra === 'function') pintarResumenListaCompra();

    const ordenes = ordenesCompraEnvios();

    const filtroTextoEl = document.getElementById('enviosFiltroTexto');
    const filtroEstadoEl = document.getElementById('enviosFiltroEstado');
    const filtroTexto = filtroTextoEl ? filtroTextoEl.value.trim().toLowerCase() : '';
    const filtroEstado = filtroEstadoEl ? filtroEstadoEl.value : '';

    const filas = ordenes.map(entry => ({ entry, envio: envioDeOrden(entry) }))
        .filter(({ entry, envio }) => {
            if (filtroTexto) {
                const texto = `${entry.cliente || ''} ${entry.empresaCliente || ''} ${envio ? envio.guia || '' : ''} ${formatearCorrelativo(entry.correlativo)}`.toLowerCase();
                if (!texto.includes(filtroTexto)) return false;
            }
            if (filtroEstado) {
                if (filtroEstado === 'sin_envio') { if (envio) return false; }
                else if (!envio || envio.estado !== filtroEstado) return false;
            }
            return true;
        });

    if (countEl) countEl.textContent = filas.length;

    if (ordenes.length === 0) {
        listEl.innerHTML = `<div class="historial-empty">Aún no tienes órdenes de compra confirmadas.<br><br>Genera una <strong>Orden de Compra</strong> desde "Cotizar" para que aparezca aquí.</div>`;
        return;
    }
    if (filas.length === 0) {
        listEl.innerHTML = `<div class="historial-empty">No se encontraron órdenes con esos filtros.</div>`;
        return;
    }

    listEl.innerHTML = `<div class="historial-list">${filas.map(({ entry, envio }) => {
        const numOC = formatearCorrelativo(entry.correlativo);
        const fecha = new Date(entry.createdAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const numProductos = (entry.productos || []).length;
        const badgeEnvio = envio
            ? badgeEnvioHtml(envio)
            : `<span style="display:inline-block; padding:2px 9px; border-radius:12px; font-size:0.72em; font-weight:700; background:#fff5f5; color:#c53030;">🚫 Sin envío registrado</span>`;
        const guiaLinea = envio && envio.guia
            ? `<span>📮 Guía ${envio.guia}${envio.destino ? ' · ' + envio.destino : ''}</span>`
            : '';
        return `
            <div class="historial-card">
                <div class="historial-card-left">
                    <div class="historial-card-title"><span style="color:#5568d3; font-weight:800;">${numOC}</span> · 👤 ${entry.cliente}${entry.empresaCliente ? ' — ' + entry.empresaCliente : ''}</div>
                    <div class="historial-card-meta">
                        <span>📅 ${fecha}</span>
                        <span>📦 ${numProductos} producto${numProductos !== 1 ? 's' : ''}</span>
                        ${guiaLinea}
                    </div>
                    <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${badgeEnvio}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                    <div class="historial-card-total">S/ ${(entry.total || 0).toFixed(2)}</div>
                    <div class="historial-card-actions">
                        <button class="btn-historial-ver" onclick="verCotizacionDesdeHistorial('${entry.objectId}')">👁️ Ver</button>
                        ${envio
                            ? `<button class="btn-historial-ver" style="background:#edf2f7; color:#4a5568;" onclick="switchTabById('shalom'); cargarEnviosShalom();">🚚 Ver en Shalom</button>`
                            : `<button class="btn-historial-ver" style="background:#e8f9ee; color:#38a169;" onclick="irARegistrarGuia('${numOC}', '${(entry.cliente || '').replace(/'/g, "\\'")}')">➕ Registrar guía</button>`
                        }
                    </div>
                </div>
            </div>`;
    }).join('')}</div>`;
}

// Atajo desde la pestaña Envíos: salta a Seguimiento Shalom con el
// formulario de "Registrar nueva guía" prellenado con el cliente y la
// orden de compra.
function irARegistrarGuia(numeroOC, cliente) {
    switchTabById('shalom');
    const ocInput = document.getElementById('shalomOcManual');
    const clienteInput = document.getElementById('shalomClienteManual');
    if (ocInput) ocInput.value = numeroOC || '';
    if (clienteInput && !clienteInput.value) clienteInput.value = cliente || '';
    const guiaInput = document.getElementById('shalomGuiaManual');
    if (guiaInput) guiaInput.focus();
}

async function registrarEnvioLima() {
    const cliente = document.getElementById('limaClienteManual').value.trim();
    const direccion = document.getElementById('limaDireccionManual').value.trim();
    const repartidor = document.getElementById('limaRepartidorManual').value.trim();
    const estadoInicial = document.getElementById('limaEstadoManual').value || 'pendiente';
    const oc = resolverOrdenCompra(document.getElementById('limaOcManual').value);
    const destino = [direccion, repartidor ? `Repartidor: ${repartidor}` : ''].filter(Boolean).join(' · ');

    await crearRegistroShalom(null, null, cliente, destino, oc.numeroOrdenCompra, 'lima', estadoInicial, oc.ordenCompraObjectId);

    document.getElementById('limaClienteManual').value = '';
    document.getElementById('limaDireccionManual').value = '';
    document.getElementById('limaRepartidorManual').value = '';
    document.getElementById('limaOcManual').value = '';
    document.getElementById('limaEstadoManual').value = 'pendiente';
}

// Los envíos Lima no tienen robot que los actualice (no pasan por la API
// de Shalom), así que el estado se cambia a mano con este botón. Nunca
// toca envíos tipo "shalom".
async function cambiarEstadoLima(objectId, nuevoEstado) {
    try {
        await parseShalom('PUT', objectId, { estado: nuevoEstado, notificado: nuevoEstado === 'entregado' ? false : true });
        cargarEnviosShalom();
    } catch (err) {
        mostrarNotificacion('❌ Error al actualizar: ' + err.message, 'warning');
    }
}

function initLima() {
    const fTexto = document.getElementById('enviosFiltroTexto');
    const fEstado = document.getElementById('enviosFiltroEstado');
    const btnLimpiar = document.getElementById('btnLimpiarFiltrosEnvios');
    const btnRegistrar = document.getElementById('btnRegistrarEnvioLima');
    const btnActualizar = document.getElementById('btnActualizarEnvios');

    if (fTexto) fTexto.addEventListener('input', renderEnvios);
    if (fEstado) fEstado.addEventListener('change', renderEnvios);
    if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
        if (fTexto) fTexto.value = '';
        if (fEstado) fEstado.value = '';
        renderEnvios();
    });
    if (btnRegistrar) btnRegistrar.addEventListener('click', registrarEnvioLima);
    if (btnActualizar) btnActualizar.addEventListener('click', () => { cargarEnviosShalom(); renderEnvios(); });
}
