/**
 * check_agencias.js
 * ------------------------------------------------------------
 * Corre 1 vez al día vía GitHub Actions (ver .github/workflows/check_agencias.yml).
 *
 * 1. Abre la página PÚBLICA de agencias de Shalom con Playwright
 *    (https://shalom.com.pe/agencias/agencias — es una SPA en Vue).
 * 2. Lee el listado de agencias que la propia página ya cargó en su
 *    store de Pinia (store_agencias.agencias). Es data en claro, en
 *    memoria — la misma que la web usa para pintar el mapa y las
 *    tarjetas. No se consulta ninguna API privada ni se descifra nada:
 *    solo se lee el estado del navegador después de que la página
 *    terminó de cargar (equivalente a mirar el DOM ya renderizado).
 *    Si el store cambia de forma en el futuro, hay un respaldo que
 *    reconstruye el listado desde store_agencias.agencias_all filtrando
 *    agentes / puntos PRO.
 * 3. Sincroniza contra la clase `SucursalShalom` de Back4App:
 *      - crea las agencias nuevas,
 *      - actualiza las que cambiaron (dirección, teléfono, horario, etc.),
 *      - marca `activa:false` (baja suave, NUNCA borra) las que ya no
 *        aparecen — así no se rompen cotizaciones históricas que
 *        referencian una sucursal por nombre.
 * 4. Si el scrape devuelve 0 agencias, ABORTA sin tocar Back4App
 *    (probablemente Shalom cambió el front y hay que ajustar este
 *    script) — mejor eso que desactivar todo el catálogo por error.
 *
 * Requiere las mismas variables de entorno que check_shalom.js:
 *   BACK4APP_APP_ID, BACK4APP_MASTER_KEY   (solo en GitHub Secrets)
 * ------------------------------------------------------------
 */

const { chromium } = require('playwright');
const crypto = require('crypto');

const BACK4APP_APP_ID = process.env.BACK4APP_APP_ID;
const BACK4APP_MASTER_KEY = process.env.BACK4APP_MASTER_KEY; // solo en GitHub Secrets, nunca en el frontend

const PARSE_URL = 'https://parseapi.back4app.com';
const CLASE = 'SucursalShalom';

const SHALOM_AGENCIAS_URL = 'https://shalom.com.pe/agencias/agencias';
const FUENTE = 'shalom-agencias-scraper';

const variablesRequeridas = { BACK4APP_APP_ID, BACK4APP_MASTER_KEY };
const faltantes = Object.entries(variablesRequeridas)
    .filter(([nombre, valor]) => !valor)
    .map(([nombre]) => nombre);

if (faltantes.length > 0) {
    console.error(`❌ Faltan estas variables de entorno específicamente: ${faltantes.join(', ')}`);
    console.error('   (Revisa en GitHub: Settings → Secrets and variables → Actions → Repository secrets)');
    process.exit(1);
}

// ------------------------------------------------------------
// Back4App (mismo envoltorio que check_shalom.js, con paginación)
// ------------------------------------------------------------

async function parseFetch(metodo, objectId, body, query) {
    let url = `${PARSE_URL}/classes/${CLASE}`;
    if (objectId) url += `/${objectId}`;

    if (metodo === 'GET' && query) {
        const params = new URLSearchParams();
        if (query.where) params.set('where', JSON.stringify(query.where));
        if (query.order) params.set('order', query.order);
        if (query.limit != null) params.set('limit', String(query.limit));
        if (query.skip != null) params.set('skip', String(query.skip));
        if (query.keys) params.set('keys', query.keys);
        url += `?${params.toString()}`;
    }

    const res = await fetch(url, {
        method: metodo,
        headers: {
            'X-Parse-Application-Id': BACK4APP_APP_ID,
            'X-Parse-Master-Key': BACK4APP_MASTER_KEY,
            'Content-Type': 'application/json'
        },
        body: (metodo === 'POST' || metodo === 'PUT') ? JSON.stringify(body || {}) : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Error Back4App (${res.status})`);
    }
    return data;
}

// Trae TODAS las filas de SucursalShalom (paginando de a 1000).
async function getTodasLasSucursales() {
    const todas = [];
    let skip = 0;
    for (;;) {
        const res = await parseFetch('GET', null, null, { limit: 1000, skip, order: 'createdAt' });
        const lote = res.results || [];
        todas.push(...lote);
        if (lote.length < 1000) break;
        skip += 1000;
    }
    return todas;
}

// ------------------------------------------------------------
// Normalización
// ------------------------------------------------------------

// Mayúsculas, sin acentos, sin espacios repetidos — para comparar
// texto libre y para armar la "clave" estable.
function norm(texto) {
    return (texto || '')
        .toString()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

// Clave estable = hash de (nombre + dirección) normalizados. Tolera que
// cambie el teléfono / horario / estado sin crear un duplicado. Se usa
// como respaldo cuando no hay match por ter_id.
function hashClave(nombre, direccion) {
    return crypto.createHash('sha1').update(`${norm(nombre)}|${norm(direccion)}`).digest('hex');
}

// Palabras que van en minúscula dentro de un nombre propio en español.
const MINUSCULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'EN', 'A']);

// "CERCADO LIMA" -> "Cercado Lima" ; "SAN JUAN DE LURIGANCHO" -> "San Juan de Lurigancho".
function aTitulo(texto) {
    const limpio = (texto || '').toString().normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!limpio) return '';
    return limpio
        .toLowerCase()
        .split(' ')
        .map((palabra, i) => {
            const up = palabra.toUpperCase();
            if (i > 0 && MINUSCULAS.has(up)) return palabra;
            return palabra.charAt(0).toUpperCase() + palabra.slice(1);
        })
        .join(' ');
}

// La categoría de Shalom viene con mayúsculas/acentos inconsistentes
// ("GRANDE / CO", "PEQUEÑA", "Terminal"...). Se lleva al mismo juego de
// "tipo" que ya usa el cotizador (index.html: filtros y <select>).
const MAPA_TIPO = {
    'GRANDE / CO': 'Grande / Co',
    'MEDIANA': 'Mediana',
    'PEQUENA': 'Pequeña',
    'MICRO': 'Micro',
    'MINI-MICRO': 'Mini-micro',
    'MICRO E/R': 'Micro E/r',
    'TERMINAL': 'Terminal',
    'SOLO ENVIOS': 'Solo Envíos'
};
function normalizarTipo(categoria) {
    return MAPA_TIPO[norm(categoria)] || aTitulo(categoria) || 'Micro';
}

// Teléfono: se deja tal cual lo publica Shalom, solo colapsando espacios.
function normalizarTelefono(tel) {
    const t = (tel || '').toString().replace(/\s+/g, ' ').trim();
    return t || null;
}

// Arma un string de horario legible a partir de los campos que trae
// cada agencia. Prioriza `hora_atencion_web_lines` (ya viene partido en
// líneas limpias); si no, combina los campos sueltos.
function construirHorario(item) {
    const lineas = [];
    if (Array.isArray(item.hora_atencion_web_lines) && item.hora_atencion_web_lines.length) {
        lineas.push(...item.hora_atencion_web_lines);
    } else {
        if (item.hora_atencion) lineas.push(item.hora_atencion);
        if (item.hora_domingo) lineas.push(item.hora_domingo);
    }
    if (Array.isArray(item.horario_atencion_final)) lineas.push(...item.horario_atencion_final);
    const limpio = lineas
        .map(l => (l || '').toString().replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return limpio.length ? [...new Set(limpio)].join(' · ') : null;
}

// `lugar` = "DEPARTAMENTO / PROVINCIA / DISTRITO / NOMBRE" (a veces el
// nombre trae " / " y quedan 5+ partes). El distrito es el 3er campo.
function distritoDeLugar(item) {
    const partes = (item.lugar || '').split(' / ').map(p => p.trim()).filter(Boolean);
    if (partes.length >= 3) return partes[2];
    return item.zona || '';
}

// Pasa una agencia cruda del store a la forma que guardamos en Back4App.
function normalizarAgencia(item) {
    const nombre = (item.nombre || '').toString().replace(/\s+/g, ' ').trim();
    const direccion = (item.direccion || '').toString().replace(/\s+/g, ' ').trim();
    const distritoRaw = distritoDeLugar(item);
    const lat = parseFloat(item.latitud);
    const lng = parseFloat(item.longitud);

    return {
        terId: Number.isFinite(item.ter_id) ? item.ter_id : null,
        nombre,
        direccion,
        // "ciudad" en el cotizador ≈ distrito de la agencia.
        ciudad: aTitulo(distritoRaw),
        distrito: aTitulo(distritoRaw),
        provincia: aTitulo(item.provincia),
        departamento: aTitulo(item.departamento),
        telefono: normalizarTelefono(item.telefono),
        horario: construirHorario(item),
        categoria: (item.categoria || '').toString().trim() || null, // cruda, como referencia
        tipo: normalizarTipo(item.categoria),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        clave: hashClave(nombre, direccion)
    };
}

// ------------------------------------------------------------
// Scrape
// ------------------------------------------------------------

async function scrapeAgencias(page) {
    await page.goto(SHALOM_AGENCIAS_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // La SPA pide su data y la deja en el store de Pinia. Esperamos a que
    // store_agencias.agencias tenga elementos (hasta ~40s).
    await page.waitForFunction(() => {
        try {
            const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
            if (!app) return false;
            let pinia = app.config && app.config.globalProperties && app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) {
                const provides = app._context && app._context.provides;
                if (provides) {
                    for (const s of Object.getOwnPropertySymbols(provides)) {
                        const v = provides[s];
                        if (v && v._s) { pinia = v; break; }
                    }
                }
            }
            const store = pinia && pinia._s && pinia._s.get('store_agencias');
            const arr = store && (store.agencias || store.agencias_all);
            return Array.isArray(arr) && arr.length > 0;
        } catch (e) {
            return false;
        }
    }, { timeout: 40000, polling: 500 });

    // Extrae el array crudo (sin los enormes listados origenes_aereos /
    // destinos_aereos, que no nos sirven y pesan).
    const crudas = await page.evaluate(() => {
        const app = document.querySelector('#app').__vue_app__;
        let pinia = app.config && app.config.globalProperties && app.config.globalProperties.$pinia;
        if (!pinia || !pinia._s) {
            const provides = app._context && app._context.provides;
            for (const s of Object.getOwnPropertySymbols(provides || {})) {
                const v = provides[s];
                if (v && v._s) { pinia = v; break; }
            }
        }
        const store = pinia._s.get('store_agencias');

        // Primario: store.agencias (solo agencias físicas).
        // Respaldo: store.agencias_all filtrando agentes / puntos PRO.
        let lista = Array.isArray(store.agencias) && store.agencias.length
            ? store.agencias
            : (store.agencias_all || []).filter(a => a && a.agente === 0 && a.puntospro === 0);

        return lista.map(a => ({
            ter_id: a.ter_id,
            nombre: a.nombre,
            direccion: a.direccion,
            lugar: a.lugar,
            zona: a.zona,
            provincia: a.provincia,
            departamento: a.departamento,
            telefono: a.telefono,
            categoria: a.categoria,
            latitud: a.latitud,
            longitud: a.longitud,
            hora_atencion: a.hora_atencion,
            hora_domingo: a.hora_domingo,
            hora_atencion_web_lines: a.hora_atencion_web_lines,
            horario_atencion_final: a.horario_atencion_final
        }));
    });

    // Normaliza + descarta filas sin nombre o sin dirección (no sirven).
    const vistas = new Set();
    const agencias = [];
    for (const cruda of crudas) {
        const a = normalizarAgencia(cruda);
        if (!a.nombre || !a.direccion) continue;
        // dedupe defensivo por ter_id / clave dentro del mismo scrape
        const id = a.terId != null ? `ter:${a.terId}` : `clave:${a.clave}`;
        if (vistas.has(id)) continue;
        vistas.add(id);
        agencias.push(a);
    }
    return agencias;
}

// ------------------------------------------------------------
// Sincronización
// ------------------------------------------------------------

// Campos que comparamos para decidir si una fila existente cambió.
const CAMPOS_COMPARABLES = ['terId', 'nombre', 'direccion', 'ciudad', 'distrito', 'provincia', 'departamento', 'telefono', 'horario', 'categoria', 'tipo', 'lat', 'lng', 'clave'];

function calcularCambios(existente, entrante) {
    const cambios = {};
    for (const campo of CAMPOS_COMPARABLES) {
        const antes = existente[campo];
        const ahora = entrante[campo];
        // comparación laxa: null/undefined/'' se consideran iguales
        const a = antes == null ? '' : antes;
        const b = ahora == null ? '' : ahora;
        if (typeof a === 'number' || typeof b === 'number') {
            if (Number(a) !== Number(b)) cambios[campo] = ahora;
        } else if (String(a) !== String(b)) {
            cambios[campo] = ahora;
        }
    }
    return cambios;
}

async function sincronizar(agencias) {
    const existentes = await getTodasLasSucursales();
    console.log(`☁️  Back4App ya tiene ${existentes.length} fila(s) en ${CLASE}.`);

    const porTerId = new Map();
    const porClave = new Map();
    for (const fila of existentes) {
        if (fila.terId != null) porTerId.set(String(fila.terId), fila);
        if (fila.clave) porClave.set(fila.clave, fila);
    }

    const ahoraISO = new Date().toISOString();
    let creadas = 0, actualizadas = 0, reactivadas = 0, sinCambios = 0, desactivadas = 0, errores = 0;
    const emparejadas = new Set(); // objectId de filas existentes que siguen vivas

    for (const a of agencias) {
        const existente =
            (a.terId != null && porTerId.get(String(a.terId))) ||
            porClave.get(a.clave) ||
            null;

        try {
            if (!existente) {
                await parseFetch('POST', null, {
                    ...a,
                    activa: true,
                    fuente: FUENTE,
                    sincronizadoEn: ahoraISO,
                    // Lectura pública; escritura solo con Master Key (ver CLP).
                    ACL: { '*': { read: true } }
                });
                creadas++;
                continue;
            }

            emparejadas.add(existente.objectId);
            const cambios = calcularCambios(existente, a);
            const estabaInactiva = existente.activa === false;

            if (Object.keys(cambios).length === 0 && !estabaInactiva) {
                sinCambios++;
                continue;
            }

            const patch = { ...cambios, sincronizadoEn: ahoraISO };
            if (estabaInactiva) {
                patch.activa = true;
                patch.bajaEn = null;
                reactivadas++;
            } else {
                actualizadas++;
            }
            await parseFetch('PUT', existente.objectId, patch);
        } catch (err) {
            errores++;
            console.error(`⚠️  Error sincronizando "${a.nombre}": ${err.message}`);
        }
    }

    // Baja suave de las que ya no aparecen en el scrape.
    for (const fila of existentes) {
        if (emparejadas.has(fila.objectId)) continue;
        if (fila.activa === false) continue; // ya estaba dada de baja
        try {
            await parseFetch('PUT', fila.objectId, { activa: false, bajaEn: ahoraISO, sincronizadoEn: ahoraISO });
            desactivadas++;
        } catch (err) {
            errores++;
            console.error(`⚠️  Error desactivando "${fila.nombre}": ${err.message}`);
        }
    }

    console.log('------------------------------------------------------------');
    console.log(`✅ Sincronización terminada:`);
    console.log(`   nuevas:        ${creadas}`);
    console.log(`   actualizadas:  ${actualizadas}`);
    console.log(`   reactivadas:   ${reactivadas}`);
    console.log(`   sin cambios:   ${sinCambios}`);
    console.log(`   desactivadas:  ${desactivadas}`);
    if (errores) console.log(`   ⚠️ errores:    ${errores}`);
    return errores;
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------

async function main() {
    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 900 }
    });

    let agencias = [];
    try {
        agencias = await scrapeAgencias(page);
    } catch (err) {
        await browser.close();
        console.error(`❌ No se pudo leer el listado de agencias de Shalom: ${err.message}`);
        console.error('   (Probablemente Shalom cambió su front. Revisar scrapeAgencias().)');
        process.exit(1);
    }
    await browser.close();

    console.log(`🏢 Scrape: ${agencias.length} agencia(s) leídas de shalom.com.pe`);

    if (agencias.length === 0) {
        console.error('❌ El scrape devolvió 0 agencias. Se ABORTA sin tocar Back4App para no');
        console.error('   desactivar todo el catálogo por un cambio en la web de Shalom.');
        process.exit(1);
    }

    const errores = await sincronizar(agencias);
    if (errores > 0) process.exit(1);
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
