// ============================================
// LISTA DE COMPRA — pendientes de despacho
// ============================================
// Portado de SIA (js/envios/lista-compra.js).
//
// Agregación 100% de solo lectura: agrupa producto + color + cantidad de
// TODAS las Órdenes de Compra que todavía no se despacharon (sin guía
// registrada, o con guía en "pendiente"/"error" — deja de contar en
// cuanto pasa a "en_transito" o "entregado"). Sirve para saber qué
// reponerle al proveedor antes del próximo lote de envíos.
//
// Solo LEE historialCache y shalomEnviosCache (ya cargados por otras
// partes de la app). No modifica ningún dato.
//
// Adaptaciones de stack vs. SIA:
//   - OC = historialCache[i] con tipoDocumento === 'orden_compra'.
//   - registro.datos (JSON string) -> registro.productos (array real);
//     cada item ya trae { nombre, codigo, color, cantidad }.
//   - buscarEnvioPorOC por N° formateado + objectId.
// ============================================

function ordenPendienteDeDespacho(entry) {
    const envio = buscarEnvioPorOC(formatearCorrelativo(entry.correlativo), entry.objectId);
    if (!envio) return { pendiente: true, envio: null };
    const yaDespachado = envio.estado === 'en_transito' || envio.estado === 'entregado';
    return { pendiente: !yaDespachado, envio };
}

function calcularListaCompraPendiente() {
    const ordenes = (typeof historialCache !== 'undefined' && Array.isArray(historialCache))
        ? historialCache.filter(e => e.tipoDocumento === 'orden_compra' && !e.esPrueba && typeof e.correlativo === 'number')
        : [];
    const itemsPorClave = {}; // clave = código|color (o nombre|color si no hay código)
    const ordenesIncluidas = [];

    ordenes.forEach(registro => {
        const { pendiente, envio } = ordenPendienteDeDespacho(registro);
        if (!pendiente) return;

        const productos = Array.isArray(registro.productos) ? registro.productos : [];
        if (productos.length === 0) return;

        ordenesIncluidas.push({ registro, envio });

        productos.forEach(p => {
            const clave = `${p.codigo || p.nombre}|${p.color || ''}`;
            if (!itemsPorClave[clave]) {
                itemsPorClave[clave] = {
                    nombre: p.nombre,
                    color: p.color || '',
                    codigo: p.codigo || '',
                    cantidad: 0,
                    ordenes: [] // { numeroOC, cliente, cantidad }
                };
            }
            itemsPorClave[clave].cantidad += Number(p.cantidad) || 0;
            itemsPorClave[clave].ordenes.push({
                numeroOC: formatearCorrelativo(registro.correlativo),
                cliente: registro.cliente,
                cantidad: Number(p.cantidad) || 0
            });
        });
    });

    const items = Object.values(itemsPorClave).sort((a, b) => b.cantidad - a.cantidad);
    return { items, ordenesIncluidas };
}

// Resumen corto, siempre visible en la pestaña Envíos.
function pintarResumenListaCompra() {
    const wrap = document.getElementById('listaCompraResumenTexto');
    if (!wrap) return;
    const { items, ordenesIncluidas } = calcularListaCompraPendiente();
    if (ordenesIncluidas.length === 0) {
        wrap.textContent = 'No hay órdenes pendientes de despacho por ahora. 🎉';
    } else {
        const totalUnidades = items.reduce((a, it) => a + it.cantidad, 0);
        wrap.textContent = `${items.length} producto${items.length !== 1 ? 's' : ''} distinto${items.length !== 1 ? 's' : ''} · ${totalUnidades} unidad${totalUnidades !== 1 ? 'es' : ''} · de ${ordenesIncluidas.length} orden${ordenesIncluidas.length !== 1 ? 'es' : ''} sin despachar`;
    }
}

function abrirListaCompra() {
    const { items, ordenesIncluidas } = calcularListaCompraPendiente();
    const contenido = document.getElementById('listaCompraContenido');

    if (ordenesIncluidas.length === 0) {
        contenido.innerHTML = `<div class="historial-empty">🎉 No tienes órdenes de compra pendientes de despacho — nada por comprar por ahora.</div>`;
        document.getElementById('listaCompraModal').classList.add('active');
        return;
    }

    const totalUnidades = items.reduce((a, it) => a + it.cantidad, 0);

    const filasHtml = items.map(it => {
        const ocsTexto = it.ordenes.map(o => `${o.numeroOC} (${o.cantidad})`).join(', ');
        return `
            <tr>
                <td>${it.nombre}${it.codigo ? ` <span style="color:#a0aec0; font-size:0.85em;">· ${it.codigo}</span>` : ''}</td>
                <td>${it.color || '—'}</td>
                <td style="text-align:center; font-weight:800; color:#5568d3;">${it.cantidad}</td>
                <td style="font-size:0.78em; color:#718096;">${ocsTexto}</td>
            </tr>`;
    }).join('');

    contenido.innerHTML = `
        <p style="font-size:0.85em; color:#718096; margin-bottom:14px;">
            Suma de productos, colores y cantidades de las <strong>${ordenesIncluidas.length}</strong> orden${ordenesIncluidas.length !== 1 ? 'es' : ''} de compra que aún no se despachan (sin guía registrada, o con guía que todavía no sale de camino). Es una vista de solo lectura — no cambia nada de tus órdenes, precios ni catálogo.
        </p>
        <div class="products-table-container" style="overflow-x:auto;">
            <table class="products-table" style="width:100%;">
                <thead><tr><th>Producto</th><th>Color</th><th style="text-align:center;">Cant. a comprar</th><th>Órdenes que lo incluyen</th></tr></thead>
                <tbody>${filasHtml}</tbody>
            </table>
        </div>
        <div style="text-align:right; margin-top:14px; font-size:1.05em; font-weight:700; color:#5568d3;">
            Total: ${items.length} producto${items.length !== 1 ? 's' : ''} · ${totalUnidades} unidad${totalUnidades !== 1 ? 'es' : ''}
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px;">
            <button type="button" class="btn btn-success" onclick="exportarListaCompraExcel()">📊 Exportar a Excel</button>
            <button type="button" class="btn btn-primary" onclick="copiarListaCompraTexto()">📋 Copiar como texto</button>
        </div>
    `;

    document.getElementById('listaCompraModal').classList.add('active');
}

function exportarListaCompraExcel() {
    const { items } = calcularListaCompraPendiente();
    if (items.length === 0) {
        mostrarNotificacion('No hay productos pendientes de compra', 'info');
        return;
    }
    const filas = items.map(it => ({
        'Producto': it.nombre,
        'Código': it.codigo,
        'Color': it.color,
        'Cantidad a comprar': it.cantidad,
        'Órdenes que lo incluyen': it.ordenes.map(o => `${o.numeroOC} (${o.cantidad})`).join(', ')
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Lista de compra');
    XLSX.writeFile(wb, `Lista_de_compra_${new Date().toISOString().slice(0, 10)}.xlsx`);
    mostrarNotificacion('✅ Excel de lista de compra generado', 'success');
}

function copiarListaCompraTexto() {
    const { items, ordenesIncluidas } = calcularListaCompraPendiente();
    if (items.length === 0) {
        mostrarNotificacion('No hay productos pendientes de compra', 'info');
        return;
    }
    const totalUnidades = items.reduce((a, it) => a + it.cantidad, 0);
    let texto = `🛒 LISTA DE COMPRA — ${new Date().toLocaleDateString('es-PE')}\n`;
    texto += `(${ordenesIncluidas.length} órdenes sin despachar, ${totalUnidades} unidades en total)\n\n`;
    items.forEach(it => {
        texto += `• ${it.nombre}${it.color ? ' (' + it.color + ')' : ''}: ${it.cantidad}\n`;
    });

    const finalizar = () => mostrarNotificacion('📋 Lista de compra copiada al portapapeles', 'success');
    const fallar = () => mostrarNotificacion('❌ No se pudo copiar automáticamente. Usa "📊 Exportar a Excel" en su lugar.', 'warning');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(finalizar).catch(fallar);
    } else {
        fallar();
    }
}

function initListaCompra() {
    const btnAbrir = document.getElementById('btnAbrirListaCompra');
    const btnCerrar = document.getElementById('btnCerrarListaCompraModal');
    if (btnAbrir) btnAbrir.addEventListener('click', abrirListaCompra);
    if (btnCerrar) btnCerrar.addEventListener('click', () => {
        document.getElementById('listaCompraModal').classList.remove('active');
    });
    const modal = document.getElementById('listaCompraModal');
    if (modal) modal.addEventListener('click', function (e) { if (e.target === this) modal.classList.remove('active'); });
}
