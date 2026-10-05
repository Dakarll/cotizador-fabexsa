// ============================================================
// tests/stress-historial.mjs
// ============================================================
// Envoltorio con Playwright para tests/stress-historial.html: abre esa misma
// página (sin tocarla, sin duplicar su lógica) en un Chromium headless y
// falla el proceso (exit code 1) si algo salió en rojo — pensado para correr
// en CI o antes de un merge, además de poder abrir el .html a mano.
//
// REQUISITO — no viene instalado por este cambio a propósito (el proyecto es
// JS puro sin build ni package.json; instalar Playwright descarga un
// Chromium propio, ~300MB, y eso hay que decidirlo a propósito, no como
// efecto secundario de este rediseño):
//   npm init -y                      (si todavía no hay package.json)
//   npm install -D playwright
//   npx playwright install chromium
//
// Uso:
//   node tests/stress-historial.mjs
// ============================================================

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rutaHtml = join(__dirname, 'stress-historial.html');
const url = 'file://' + rutaHtml;

const browser = await chromium.launch();
const page = await browser.newPage();

const erroresConsola = [];
page.on('pageerror', (err) => erroresConsola.push('pageerror: ' + err.message));
page.on('console', (msg) => {
    if (msg.type() === 'error') erroresConsola.push('console.error: ' + msg.text());
});

await page.goto(url);

// El banner de resumen (#resumenBanner) solo tiene su clase final ("ok"/"fail")
// una vez que el script de la página terminó de correr los 10 checks — es
// síncrono dentro de un IIFE, así que basta con esperar a que deje de decir
// "⏳ Ejecutando…".
await page.waitForFunction(() => {
    const el = document.getElementById('resumenBanner');
    return el && !el.textContent.includes('Ejecutando');
}, { timeout: 30000 });

const resumenTexto = await page.textContent('#resumenBanner');
const filasFalladas = await page.$$eval('#tbodyResultados tr', (filas) =>
    filas
        .filter((tr) => tr.querySelector('.badge.fail'))
        .map((tr) => tr.children[1].textContent.trim() + ' — ' + tr.children[4].textContent.trim())
);

console.log('\n' + resumenTexto + '\n');

if (filasFalladas.length > 0) {
    console.log('Checks en rojo:');
    filasFalladas.forEach((f) => console.log('  ❌ ' + f));
}
if (erroresConsola.length > 0) {
    console.log('\nErrores de consola/página durante la corrida:');
    erroresConsola.forEach((e) => console.log('  ⚠️  ' + e));
}

await browser.close();

const huboFallasReales = /HAY FALLAS/.test(resumenTexto);
if (huboFallasReales || erroresConsola.length > 0) {
    process.exitCode = 1;
}
