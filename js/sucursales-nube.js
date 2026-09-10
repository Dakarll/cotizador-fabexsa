// ============================================
// SUCURSALES SHALOM — catálogo desde la nube (Back4App / clase SucursalShalom)
// ============================================
// Portado de SIA (js/catalogo/sucursales-crud.js), adaptado al stack de este
// proyecto (scripts globales, BACK4APP_CONFIG + headersBack4App con
// X-Parse-REST-API-Key).
//
// DIFERENCIA CLAVE vs. SIA: acá NO hay ningún array de sucursales hardcodeado
// como respaldo. El catálogo Shalom depende EXCLUSIVAMENTE de lo que sincroniza
// el bot (shalom-tracker/scripts/check_agencias.js) en la clase SucursalShalom.
//   - Éxito: se guarda una copia en localStorage (caché de la última sync).
//   - Fallo / 0 resultados: se muestra la última caché (si existe) con un
//     banner de error; si nunca hubo una sync exitosa, estado vacío/error
//     explícito. Nunca una lista hardcodeada.
// Las sucursales que el usuario agrega a mano viven aparte, en su propia clave
// de localStorage, y sobreviven a cualquier fallo/sincronización.
// ============================================

const SUCURSAL_CLASE = 'SucursalShalom';

// Flags de estado de la última carga (los lee renderSucursales / renderSucursalList).
let sucursalesCargaError = false;   // true si la última carga desde la nube falló o dio 0
let sucursalesCargadas = false;     // true si hay datos utilizables (de la nube o de caché)

// Claves de localStorage, por usuario (mismo criterio que claveEstadoLocal()).
function claveSucursalesManuales() {
    return 'sucursales_manuales_' + (usuarioActual?.username || 'anon');
}
function claveSucursalesCacheNube() {
    return 'sucursales_nube_cache_' + (usuarioActual?.username || 'anon');
}

// Envoltorio REST para la clase SucursalShalom (equivalente al parseFetch de SIA).
async function parseSucursal(metodo, objectId, body, query) {
    let url = `${BACK4APP_CONFIG.serverUrl}/classes/${SUCURSAL_CLASE}`;
    if (objectId) url += `/${objectId}`;

    if (metodo === 'GET' && query) {
        const params = new URLSearchParams();
        if (query.where) params.set('where', JSON.stringify(query.where));
        if (query.order) params.set('order', query.order);
        if (query.limit !== undefined && query.limit !== null) params.set('limit', query.limit);
        if (query.skip !== undefined && query.skip !== null) params.set('skip', query.skip);
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

// ---------- Persistencia local (solo manuales + caché de la nube) ----------

function leerSucursalesManuales() {
    try {
        const arr = JSON.parse(localStorage.getItem(claveSucursalesManuales()) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

// Vuelca a localStorage SOLO las sucursales agregadas a mano (las que no traen
// oficial:true). Se llama después de cada alta/edición/baja manual.
function persistirSucursalesManuales() {
    try {
        const manuales = (sucursalesDB || []).filter(s => s && !s.oficial).map(s => ({
            nombre: s.nombre, direccion: s.direccion, ciudad: s.ciudad,
            provincia: s.provincia, tipo: s.tipo,
            telefono: s.telefono || '', horario: s.horario || ''
        }));
        localStorage.setItem(claveSucursalesManuales(), JSON.stringify(manuales));
    } catch (e) {
        console.error('No se pudieron guardar las sucursales manuales:', e);
    }
}

function leerCacheNube() {
    try {
        const arr = JSON.parse(localStorage.getItem(claveSucursalesCacheNube()) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}
function guardarCacheNube(arr) {
    try { localStorage.setItem(claveSucursalesCacheNube(), JSON.stringify(arr || [])); }
    catch (e) { console.warn('No se pudo cachear el catálogo de sucursales:', e); }
}

// ---------- Carga desde la nube ----------

// Combina el listado oficial (nube o caché) con las manuales que no chocan por
// nombre, y refresca todas las vistas.
function aplicarCatalogoSucursales(oficiales, manuales) {
    const nombresOficiales = new Set(oficiales.map(s => (s.nombre || '').trim().toLowerCase()));
    const manualesLimpias = (manuales || []).filter(m =>
        m && !nombresOficiales.has((m.nombre || '').trim().toLowerCase())
    );
    sucursalesDB = [...oficiales, ...manualesLimpias];

    if (typeof renderSucursalList === 'function') renderSucursalList();
    renderSucursales();
    poblarListaProvincias();
    actualizarPanelEnvioCotizar();
}

// Trae las sucursales activas desde Back4App. Se llama en inicializarAppPostLogin().
// SIN fallback a un array hardcodeado: si falla o da 0, se usa la caché de la
// última sync exitosa (con banner de error) o se muestra estado vacío.
async function cargarSucursalesDesdeNube() {
    if (!usuarioActual) return;
    const manuales = leerSucursalesManuales();

    try {
        const res = await parseSucursal('GET', null, null, {
            where: { activa: true },
            order: 'departamento',
            limit: 1000
        });
        const nube = res.results || [];
        if (nube.length === 0) throw new Error('La nube devolvió 0 sucursales');

        const oficiales = nube.map(s => ({
            nombre: s.nombre,
            direccion: s.direccion || '',
            // "ciudad" en el cotizador ≈ distrito de la agencia.
            ciudad: s.ciudad || s.distrito || '',
            provincia: s.provincia || '',
            tipo: s.tipo || 'Micro',
            telefono: s.telefono || '',
            horario: s.horario || '',
            oficial: true,
            objectId: s.objectId
        }));

        guardarCacheNube(oficiales);
        sucursalesCargaError = false;
        sucursalesCargadas = true;
        aplicarCatalogoSucursales(oficiales, manuales);
    } catch (err) {
        console.warn('No se pudo cargar el catálogo de sucursales desde la nube:', err.message);
        sucursalesCargaError = true;
        const cache = leerCacheNube();
        if (cache.length > 0) {
            sucursalesCargadas = true; // se trabaja con la última sync conocida
            aplicarCatalogoSucursales(cache, manuales);
        } else {
            sucursalesCargadas = false; // nunca hubo una sync exitosa
            aplicarCatalogoSucursales([], manuales);
        }
    }
}

// Reintento manual desde el estado de error.
function reintentarCargaSucursales() {
    const grid = document.getElementById('sucursalGrid');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--gray-500);">Cargando catálogo…</div>';
    cargarSucursalesDesdeNube();
}

// HTML del banner de error (se muestra arriba de la grilla y de la tabla de
// gestión cuando la última carga falló).
function bannerErrorSucursalesHtml() {
    if (!sucursalesCargaError) return '';
    const conCache = sucursalesCargadas;
    return `
        <div class="sucursales-error-banner">
            <span>⚠️ ${conCache
                ? 'No se pudo actualizar el catálogo de sucursales Shalom. Mostrando la última sincronización guardada.'
                : 'No se pudo cargar el catálogo de sucursales Shalom.'}</span>
            <button type="button" class="btn btn-small" onclick="reintentarCargaSucursales()">↻ Reintentar</button>
        </div>`;
}

// ---------- Listado filtrable (pestaña "Sucursales" de la cotización) ----------

function filterByTipo(tipo) {
    tipoFiltro = tipo;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (typeof event !== 'undefined' && event && event.target) event.target.classList.add('active');
    renderSucursales();
}

function renderSucursales() {
    const searchSucursal = document.getElementById('searchSucursal');
    const grid = document.getElementById('sucursalGrid');
    if (!grid) return;
    const query = searchSucursal ? searchSucursal.value.trim().toLowerCase() : '';

    // Estado de error sin ninguna caché utilizable: mensaje claro, nada de lista.
    if (sucursalesCargaError && !sucursalesCargadas && (sucursalesDB || []).filter(s => s.oficial).length === 0) {
        grid.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:44px 20px; color:var(--gray-600);">
                <div style="font-size:1.05em; font-weight:700; margin-bottom:6px;">No se pudo cargar el catálogo de sucursales</div>
                <div style="font-size:0.9em; color:var(--gray-500); margin-bottom:14px;">El catálogo Shalom se sincroniza automáticamente. Revisa tu conexión y reintenta.</div>
                <button type="button" class="btn btn-primary btn-small" onclick="reintentarCargaSucursales()">↻ Reintentar</button>
            </div>`;
        updateSucursalStats();
        return;
    }

    let sucursales = sucursalesDB || [];
    if (tipoFiltro !== 'all') {
        sucursales = sucursales.filter(s => s.tipo === tipoFiltro);
    }
    if (query.length >= 2) {
        sucursales = sucursales.filter(sucursal =>
            (sucursal.nombre || '').toLowerCase().includes(query) ||
            (sucursal.ciudad || '').toLowerCase().includes(query) ||
            (sucursal.provincia || '').toLowerCase().includes(query) ||
            (sucursal.tipo || '').toLowerCase().includes(query) ||
            (sucursal.direccion || '').toLowerCase().includes(query) ||
            (sucursal.telefono || '').toLowerCase().includes(query)
        );
    }

    const banner = bannerErrorSucursalesHtml();

    if (sucursales.length === 0) {
        grid.innerHTML = banner + '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--gray-500);">No se encontraron sucursales</div>';
        updateSucursalStats();
        return;
    }

    grid.innerHTML = banner + sucursales.map(sucursal => {
        const selected = sucursalSeleccionada && sucursalSeleccionada.nombre === sucursal.nombre ? 'selected' : '';
        const badge = sucursal.oficial
            ? '<span class="sucursal-oficial-badge" title="Sincronizada desde Shalom">✓ Shalom</span>'
            : '<span class="sucursal-manual-badge" title="Agregada manualmente">✎ Manual</span>';
        const extra = [
            sucursal.telefono ? `📞 ${sucursal.telefono}` : '',
            sucursal.horario ? `🕒 ${sucursal.horario}` : ''
        ].filter(Boolean).map(t => `<div class="sucursal-direccion">${t}</div>`).join('');
        return `
            <div class="sucursal-card ${selected}" onclick='seleccionarSucursal(${JSON.stringify(sucursal).replace(/'/g, "&apos;")})'>
                <div class="sucursal-nombre">${sucursal.nombre}</div>
                <div class="sucursal-direccion">📍 ${sucursal.direccion}</div>
                <div class="sucursal-direccion">🏙️ ${sucursal.ciudad}, ${sucursal.provincia}</div>
                ${extra}
                <div class="sucursal-card-footer">
                    <span class="sucursal-tipo">${sucursal.tipo}</span>
                    ${badge}
                </div>
            </div>
        `;
    }).join('');

    updateSucursalStats();
}

function seleccionarSucursal(sucursal) {
    if (sucursalSeleccionada && sucursalSeleccionada.nombre === sucursal.nombre) {
        sucursalSeleccionada = null;
        const sel = document.getElementById('sucursalSeleccionada');
        if (sel) sel.style.display = 'none';
        mostrarNotificacion('Sucursal deseleccionada', 'info');
    } else {
        sucursalSeleccionada = sucursal;
        mostrarSucursalSeleccionada();
        mostrarNotificacion(`Sucursal seleccionada: ${sucursal.nombre}`, 'success');
    }

    renderSucursales();
    if (typeof updateTotal === 'function') updateTotal();
    if (typeof guardarEstado === 'function') guardarEstado();
    actualizarPanelEnvioCotizar();
}

function mostrarSucursalSeleccionada() {
    if (sucursalSeleccionada) {
        const sel = document.getElementById('sucursalSeleccionada');
        const info = document.getElementById('sucursalInfo');
        if (sel) sel.style.display = 'block';
        if (info) info.innerHTML = `
            <strong>${sucursalSeleccionada.nombre}</strong> (${sucursalSeleccionada.tipo})<br>
            📍 ${sucursalSeleccionada.direccion}<br>
            🏙️ ${sucursalSeleccionada.ciudad}, ${sucursalSeleccionada.provincia}
            ${sucursalSeleccionada.telefono ? '<br>📞 ' + sucursalSeleccionada.telefono : ''}
        `;
    }
    actualizarPanelEnvioCotizar();
}

function updateSucursalStats() {
    const stats = document.getElementById('sucursalStats');
    if (!stats) return;
    const total = (sucursalesDB || []).length;
    const filtradas = document.querySelectorAll('.sucursal-card').length;
    stats.innerHTML = `Mostrando ${filtradas} de ${total} sucursales`;
}

// ---------- Provincias (datalist) ----------

function poblarListaProvincias() {
    const datalist = document.getElementById('listaProvincias');
    if (!datalist) return;
    const provincias = [...new Set((sucursalesDB || []).map(s => s.provincia).filter(Boolean))].sort();
    datalist.innerHTML = provincias.map(p => `<option value="${p}"></option>`).join('');
}

// ---------- Imagen de sucursales por provincia ----------

async function generarImagenSucursalesPorProvincia() {
    const input = document.getElementById('provinciaImagenInput');
    const statusEl = document.getElementById('provinciaImagenStatus');
    if (!input) return;
    const textoIngresado = input.value.trim();

    if (!textoIngresado) {
        mostrarNotificacion('Escribe o elige una provincia', 'warning');
        return;
    }

    const provinciasDisponibles = [...new Set((sucursalesDB || []).map(s => s.provincia).filter(Boolean))];
    const provinciaReal = provinciasDisponibles.find(p => p.toLowerCase() === textoIngresado.toLowerCase());

    if (!provinciaReal) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">No se encontró la provincia "${textoIngresado}". Elige una de la lista.</span>`;
        return;
    }

    const sucursalesFiltradas = (sucursalesDB || []).filter(s => s.provincia === provinciaReal);
    if (sucursalesFiltradas.length === 0) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">No hay sucursales registradas en "${provinciaReal}".</span>`;
        return;
    }

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--gray-500);">Generando imagen…</span>';
    if (typeof showLoading === 'function') showLoading(true);

    try {
        document.getElementById('spImgProvinciaNombre').textContent = provinciaReal;
        document.getElementById('spImgCantidad').textContent = sucursalesFiltradas.length;
        document.getElementById('spImgFecha').textContent = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });

        const iconosPorTipo = {
            'Grande / Co': '🏢', 'Mediana': '🏪', 'Pequeña': '🏠',
            'Terminal': '🚌', 'Micro': '📦', 'Mini-micro': '📦', 'Micro E/r': '📦'
        };

        document.getElementById('spImgLista').innerHTML = sucursalesFiltradas
            .slice()
            .sort((a, b) => (a.ciudad || '').localeCompare(b.ciudad || '') || a.nombre.localeCompare(b.nombre))
            .map(s => `
                <div style="display:flex; gap:14px; align-items:flex-start; padding:14px 16px; background:#f7fafc; border-radius:10px; border:1px solid #e2e8f0;">
                    <div style="font-size:1.5em; line-height:1;">${iconosPorTipo[s.tipo] || '📍'}</div>
                    <div style="flex:1;">
                        <div style="font-weight:700; color:var(--primary); font-size:1.05em;">${s.nombre}</div>
                        <div style="color:var(--gray-500); font-size:0.9em; margin-top:2px;">${s.direccion}</div>
                        <div style="color:var(--gray-400); font-size:0.82em; margin-top:2px;">${s.ciudad} · ${s.tipo}${s.telefono ? ' · 📞 ' + s.telefono : ''}</div>
                    </div>
                </div>
            `).join('');

        await new Promise(resolve => setTimeout(resolve, 300));

        const elemento = document.getElementById('sucursalesProvinciaPrint');
        const canvas = await html2canvas(elemento, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: true,
            width: 1300,
            height: elemento.scrollHeight
        });

        const nombreArchivo = `Sucursales_${provinciaReal.replace(/\s+/g, '_')}_${Date.now()}.png`;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await descargarArchivo(blob, nombreArchivo, 'image/png');

        if (statusEl) statusEl.innerHTML = `<span style="color:var(--success);">✅ Imagen generada: ${sucursalesFiltradas.length} sucursales en ${provinciaReal}</span>`;
        mostrarNotificacion('✅ Imagen de sucursales generada', 'success');
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">❌ Error al generar la imagen: ${err.message}</span>`;
        mostrarNotificacion('❌ Error al generar la imagen', 'warning');
    } finally {
        if (typeof showLoading === 'function') showLoading(false);
    }
}

// ============================================
// PANEL "SUCURSAL DE ENVÍO" EN LA PANTALLA "COTIZAR"
// Fila colapsable (mismo patrón que "Datos del Cliente"). Escribe en
// sucursalSeleccionada vía seleccionarSucursal(), así el valor queda
// disponible para guardado / imagen igual que si se hubiera elegido desde
// la pestaña Sucursales.
// ============================================

function debounceSucursal(fn, ms) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

function ocultarSugerenciasEnvio() {
    const dd = document.getElementById('envioSucursalDropdown');
    if (dd) dd.style.display = 'none';
}

function toggleEnvioPanelCotizar() {
    const body = document.getElementById('envioPanelBody');
    const icon = document.getElementById('envioPanelToggleIcon');
    if (!body) return;
    const abriendo = !body.classList.contains('open');
    body.classList.toggle('open');
    if (icon) icon.classList.toggle('open');
    if (abriendo) {
        const searchEl = document.getElementById('envioSucursalSearch');
        if (searchEl && sucursalSeleccionada && !searchEl.value) searchEl.value = sucursalSeleccionada.nombre;
    } else {
        ocultarSugerenciasEnvio();
    }
}

// Sincroniza encabezado (resumen + badge), pista y valor del campo cuando
// cambia sucursalSeleccionada (elegida acá o en la pestaña Sucursales).
function actualizarPanelEnvioCotizar() {
    const resumen = document.getElementById('envioPanelResumen');
    const badge = document.getElementById('envioPanelBadge');
    const hint = document.getElementById('envioSucursalHint');
    const searchEl = document.getElementById('envioSucursalSearch');
    const s = sucursalSeleccionada;

    if (resumen && badge) {
        if (s) {
            resumen.innerHTML = `<span>📦 ${s.nombre}</span><span>🏙️ ${s.ciudad}, ${s.provincia}</span>`;
            badge.style.display = 'inline-block';
        } else {
            resumen.innerHTML = '';
            badge.style.display = 'none';
        }
    }
    if (hint) {
        hint.innerHTML = s
            ? `✅ Envío a: <strong>${s.nombre}</strong> — ${s.ciudad}, ${s.provincia}`
            : 'Sin sucursal de envío seleccionada.';
    }
    if (searchEl && document.activeElement !== searchEl) {
        searchEl.value = s ? s.nombre : '';
    }
}

function renderSugerenciasSucursalEnvio() {
    const searchEl = document.getElementById('envioSucursalSearch');
    const dd = document.getElementById('envioSucursalDropdown');
    if (!searchEl || !dd) return;
    const q = searchEl.value.trim().toLowerCase();

    if (q.length < 2) { dd.style.display = 'none'; return; }

    const matches = (sucursalesDB || []).filter(s =>
        (s.nombre || '').toLowerCase().includes(q) ||
        (s.ciudad || '').toLowerCase().includes(q) ||
        (s.provincia || '').toLowerCase().includes(q) ||
        (s.direccion || '').toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
        dd.innerHTML = `<div style="padding:15px; text-align:center; color:var(--gray-500);">${(sucursalesDB || []).length === 0 ? 'No hay sucursales cargadas todavía.' : 'No se encontraron sucursales'}</div>`;
        dd.style.display = 'block';
        return;
    }

    const activa = sucursalSeleccionada ? sucursalSeleccionada.nombre : null;
    dd.innerHTML = matches.map(s => {
        const sel = s.nombre === activa;
        return `<div class="autocomplete-item" data-nombre="${encodeURIComponent(s.nombre)}">
            <div class="product-name">${sel ? '✅ ' : ''}${s.nombre}</div>
            <div class="product-prices">📍 ${s.direccion ? s.direccion + ' · ' : ''}${s.ciudad}, ${s.provincia}<span style="margin-left:8px; color:var(--gray-400);">${s.tipo || ''}</span></div>
        </div>`;
    }).join('');
    dd.style.display = 'block';
}

function initEnvioPanelCotizar() {
    const header = document.getElementById('envioPanelHeader');
    const searchEl = document.getElementById('envioSucursalSearch');
    const dd = document.getElementById('envioSucursalDropdown');
    const container = searchEl ? searchEl.closest('.search-container') : null;
    if (!header) return;

    header.addEventListener('click', toggleEnvioPanelCotizar);

    if (searchEl) {
        searchEl.addEventListener('input', debounceSucursal(renderSugerenciasSucursalEnvio, 120));
        searchEl.addEventListener('focus', renderSugerenciasSucursalEnvio);
        searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = dd && dd.querySelector('.autocomplete-item[data-nombre]');
                if (first) first.click();
            } else if (e.key === 'Escape') {
                ocultarSugerenciasEnvio();
            }
        });
    }
    if (dd) {
        dd.addEventListener('click', (e) => {
            const item = e.target.closest('.autocomplete-item[data-nombre]');
            if (!item) return;
            const nombre = decodeURIComponent(item.dataset.nombre);
            const sucursal = (sucursalesDB || []).find(s => s.nombre === nombre);
            ocultarSugerenciasEnvio();
            if (sucursal) seleccionarSucursal(sucursal);
        });
    }
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) ocultarSugerenciasEnvio();
    });

    actualizarPanelEnvioCotizar();
}

function initSucursalesNube() {
    const searchSucursal = document.getElementById('searchSucursal');
    if (searchSucursal) searchSucursal.addEventListener('input', renderSucursales);

    const btnImg = document.getElementById('btnGenerarImagenSucursalesProvincia');
    if (btnImg) btnImg.addEventListener('click', generarImagenSucursalesPorProvincia);

    document.querySelectorAll('.filter-btn[data-tipo]').forEach(btn => {
        btn.addEventListener('click', () => filterByTipo(btn.dataset.tipo));
    });

    initEnvioPanelCotizar();
}
