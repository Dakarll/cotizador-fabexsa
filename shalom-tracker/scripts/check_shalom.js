/**
 * check_shalom.js
 * ------------------------------------------------------------
 * Corre cada 30 min vía GitHub Actions (ver .github/workflows/check.yml).
 * 1. Lee de Back4App las guías que aún no están "entregado".
 * 2. Consulta cada una en la página PÚBLICA de rastreo de Shalom
 *    (https://shalom.com.pe/rastrea) — no requiere login. Usa el
 *    formulario normal: N° de Orden + Código de Orden (4 dígitos).
 * 3. Actualiza Back4App con el nuevo estado.
 *
 * Nota histórica: se intentó también un flujo alternativo por QR
 * (escaneando con una "cámara falsa" el ID interno que trae el QR de
 * Shalom). Se descartó porque el sistema de seguridad de Shalom lo
 * detecta y bloquea a propósito ("Verificación de seguridad fallida"),
 * y burlar esa protección no es algo que hagamos, sin importar el
 * motivo. El registro por N° de Orden + Código sigue siendo la única
 * vía, y es confiable.
 * ------------------------------------------------------------
 */

const { chromium } = require('playwright');

const BACK4APP_APP_ID = process.env.BACK4APP_APP_ID;
const BACK4APP_MASTER_KEY = process.env.BACK4APP_MASTER_KEY; // solo en GitHub Secrets, nunca en el frontend

const PARSE_URL = 'https://parseapi.back4app.com';
const CLASE = 'EnvioShalom';

const variablesRequeridas = { BACK4APP_APP_ID, BACK4APP_MASTER_KEY };
const faltantes = Object.entries(variablesRequeridas)
    .filter(([nombre, valor]) => !valor)
    .map(([nombre]) => nombre);

if (faltantes.length > 0) {
    console.error(`❌ Faltan estas variables de entorno específicamente: ${faltantes.join(', ')}`);
    console.error('   (Revisa en GitHub: Settings → Secrets and variables → Actions → Repository secrets)');
    process.exit(1);
}

async function parseFetch(metodo, objectId, body, query) {
    let url = `${PARSE_URL}/classes/${CLASE}`;
    if (objectId) url += `/${objectId}`;

    if (metodo === 'GET' && query) {
        const params = new URLSearchParams();
        if (query.where) params.set('where', JSON.stringify(query.where));
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

async function getGuiasPendientes() {
    const resultado = await parseFetch('GET', null, null, { where: { estado: { '$ne': 'entregado' } } });
    // Solo procesamos envíos con guía + código completos (los que se
    // hayan quedado registrados solo con QR/oseId de pruebas anteriores
    // se ignoran — esa vía quedó descartada).
    return (resultado.results || []).filter(e => e.guia && e.codigo);
}

async function actualizarEnvio(objectId, cambios) {
    return parseFetch('PUT', objectId, cambios);
}

async function consultarGuia(page, guia, codigo) {
    await page.goto('https://shalom.com.pe/rastrea', { waitUntil: 'networkidle' });

    // El formulario de rastreo tiene DOS campos obligatorios:
    //   - N° de Orden (input maxlength=8)
    //   - Código de Orden (input maxlength=4, código de seguridad de 4 dígitos)
    // y se envía con un botón real (type="submit"), no basta con Enter.
    await page.fill('input[placeholder="N° de Orden"]', guia);
    await page.fill('input[placeholder="Código de Orden"]', codigo);
    await page.click('button[type="submit"]:has-text("Buscar")');

    const estadoLocator = page.locator('.text-4xl.font-bold.text-red-color-sidebar').first();

    try {
        await estadoLocator.waitFor({ state: 'visible', timeout: 8000 });
    } catch (err) {
        return { estado: 'error', detalle: 'No se encontró resultado (verifica guía + código, o si la orden es muy reciente).' };
    }

    const estadoTexto = (await estadoLocator.innerText()).trim();
    const detalleTexto = await page.locator('p.text-silver-title').first().innerText().catch(() => '');

    const normalizado = estadoTexto.toLowerCase();
    const entregado = /entregad/.test(normalizado);

    return {
        estado: entregado ? 'entregado' : 'en_transito',
        detalle: detalleTexto ? `${estadoTexto} — ${detalleTexto.trim()}` : estadoTexto
    };
}

async function main() {
    const guias = await getGuiasPendientes();
    console.log(`📦 ${guias.length} guía(s) pendiente(s) de consultar.`);

    if (guias.length === 0) {
        console.log('Nada que hacer. Fin.');
        return;
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        for (const envio of guias) {
            console.log(`🔍 Consultando guía ${envio.guia}...`);
            try {
                const resultado = await consultarGuia(page, envio.guia, envio.codigo);

                const cambios = {
                    estado: resultado.estado,
                    detalleEstado: resultado.detalle,
                    ultimaConsulta: new Date().toISOString()
                };

                if (resultado.estado === 'entregado' && envio.estado !== 'entregado') {
                    cambios.notificado = false; // para que el cotizador muestre el aviso
                    cambios.entregadoEn = new Date().toISOString();
                    console.log(`🎉 Guía ${envio.guia} marcada como ENTREGADA.`);
                }

                await actualizarEnvio(envio.objectId, cambios);
            } catch (err) {
                console.error(`⚠️ Error consultando guía ${envio.guia}:`, err.message);
                await actualizarEnvio(envio.objectId, {
                    estado: 'error',
                    detalleEstado: `Error: ${err.message}`,
                    ultimaConsulta: new Date().toISOString()
                });
            }
        }
    } finally {
        await browser.close();
    }

    console.log('✅ Ronda de verificación completa.');
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
