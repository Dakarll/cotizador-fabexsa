        // ============================================
        // KARDEX — SALIDAS DIARIAS (órdenes de compra, ventas en tienda y descartes)
        // ============================================
        // Cada salida se anota en la columna del DÍA (1 al 31) de la hoja actual del Kardex, sumándola como
        // un término más de la celda (varias OC el mismo día quedan visibles: =10+5+3). TOTAL EGRESO y SALDO
        // conservan SUS fórmulas (SALDO = C - TOTAL EGRESO + INGRESOS); solo se refresca su resultado guardado.
        // Una devolución (OC editada o anulada) es una cantidad NEGATIVA: queda como "-n" en la columna de hoy.
        //
        // Reutiliza el guardado atómico de la carga masiva (kcGuardarAtomico): una descarga, una subida con
        // `rev`, sin duplicar tras un conflicto o un corte de red, y sin aplanar nunca las fórmulas.
        // Además cada movimiento se registra en Back4App (clase MovimientoKardex) para poder consultar
        // quién, cuándo y por qué se descontó; el Excel conserva los totales por día.

        const CLASE_MOVIMIENTO_KARDEX = 'MovimientoKardex';

        // Mes/año de una hoja a partir de su nombre ("Sept´26", "Agos´26", "Oct¨25 Inv") o null si no se entiende.
        function ksMesDeNombreHoja(nombre) {
            const meses = { ENE: 0, ENER: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, AGOS: 7, SEP: 8, SEPT: 8, SET: 8, OCT: 9, NOV: 10, DIC: 11 };
            const m = kcNormalizar(nombre).match(/^(ENER|ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGOS|AGO|SEPT|SEP|SET|OCT|NOV|DIC)\D*(\d{2,4})/);
            if (!m) return null;
            let anio = parseInt(m[2], 10);
            if (anio < 100) anio += 2000;
            return { mes: meses[m[1]], anio };
        }

        // Fecha local de hoy como yyyy-mm-dd.
        function ksFechaHoyISO() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        // Busca en el índice la fila de un producto por (código, color) tal como vienen en una orden de compra.
        // Devuelve { fila } o { error }. Nunca adivina: si hay más de una candidata, no se aplica.
        function ksResolverFilaPorCodigoColor(indice, codigo, color) {
            const pk = kcNormalizar(codigo);
            const delProducto = indice.filas.filter(f => f.productoClave === pk);
            if (!delProducto.length) return { error: 'el código no está en el Kardex' };
            // Un solo renglón para ese código: no hay ambigüedad posible (mismo criterio que antes).
            if (delProducto.length === 1) return { fila: delProducto[0] };

            const texto = String(color || '').trim();
            if (!texto) return { error: `el código tiene ${delProducto.length} filas y la orden no indica color` };

            // 1) texto exacto de la descripción (como lo ofrece la lista de colores del cotizador)
            const dn = kcNormalizar(texto);
            let candidatas = delProducto.filter(f => f.descClave === dn);
            if (candidatas.length === 1) return { fila: candidatas[0] };
            if (candidatas.length > 1) return { error: `el color "${texto}" está repetido en filas ${candidatas.map(f => f.fila).join(', ')}` };

            // 2) color interpretado (ignora notas como "(NO HABRA PRODUCCION)")
            const p = kcParsearDescripcion(texto, codigo);
            candidatas = delProducto.filter(f => f.estado === 'ok' && f.colorClave === p.colorClave && f.medidaClave === kcClaveMedida(p.medida));
            if (!candidatas.length && !p.medida) candidatas = delProducto.filter(f => f.estado === 'ok' && f.colorClave === p.colorClave);
            if (candidatas.length === 1) return { fila: candidatas[0] };
            if (candidatas.length > 1) return { error: `el color "${texto}" coincide con varias filas (${candidatas.map(f => f.fila).join(', ')})` };
            return { error: `el color "${texto}" no existe entre las filas de ese código` };
        }

        // Clave estable de cada fila (código|descripción|orden de aparición), la misma que usa la vista del Kardex
        // para enlazar el "Detalle diario" con el historial de movimientos.
        function ksClavesEdicionPorFila(hoja, cols) {
            const vistas = {};
            const mapa = new Map();
            for (let f = 2; f <= hoja.rowCount; f++) {
                const fila = hoja.getRow(f);
                const base = claveBaseEdicionKardex(textoCeldaKardex(fila.getCell(cols.colArticulo)), textoCeldaKardex(fila.getCell(cols.colDescripcion)));
                if (!base) continue;
                const n = vistas[base] = (vistas[base] === undefined ? 0 : vistas[base] + 1);
                mapa.set(f, `${base}|${n}`);
            }
            return mapa;
        }

        // salidas: [{ tipo:'fila', fila, productoClave, descClave, descripcion, cantidad }
        //         | { tipo:'codigo', codigo, color, descripcion, cantidad }]   (cantidad > 0 salida, < 0 devolución)
        // Modifica el workbook en memoria. Las líneas que no se pueden ubicar con seguridad se devuelven en
        // `noAplicadas` (no se toca nada de ellas); si no queda ninguna, `sinCambios` evita subir el archivo.
        function ksAplicarSalidasEnWorkbook(workbook, salidas, opciones) {
            const fechaISO = (opciones && opciones.fechaISO) || ksFechaHoyISO();
            if (!Array.isArray(salidas) || !salidas.length) throw new Error('No hay salidas para registrar');
            const dia = parseInt(fechaISO.split('-')[2], 10);
            if (!(dia >= 1 && dia <= 31)) throw new Error('Fecha inválida');

            const nombreHoja = resolverNombreHojaKardexWorkbook(workbook);
            const hoja = workbook.getWorksheet(nombreHoja);
            if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');
            const cols = resolverColumnasMovimientoExcel(hoja);
            const colDia = cols.colesDias[dia];
            if (colDia === undefined) throw new Error(`No se detectó en el Kardex la columna del día ${dia}`);
            if (cols.colStock < 2) throw new Error('No se detectó la columna SALDO del Kardex');
            if (cols.colTotalEgreso < 1) throw new Error('No se detectó la columna TOTAL EGRESO del Kardex');
            if (cols.colArticulo < 1 || cols.colDescripcion < 1) throw new Error('No se detectaron las columnas ARTICULO/DESCRIPCION del Kardex');

            kcDesconectarFormulasHoja(hoja);
            const indice = kcConstruirIndice(hoja, cols);
            const clavesFila = ksClavesEdicionPorFila(hoja, cols);
            const letra = n => kcLetraColumna(hoja, n);
            const diasCols = Object.values(cols.colesDias);
            const primerDia = Math.min(...diasCols), ultimoDia = Math.max(...diasCols);

            // 1) ubicar cada línea en una fila concreta
            const destinos = new Map();
            const noAplicadas = [];
            const acumular = (f, item) => {
                const d = destinos.get(f.fila) || { fila: f.fila, cantidad: 0, producto: f.producto, descripcion: f.descripcion, items: [] };
                d.cantidad += Number(item.cantidad);
                d.items.push(item);
                destinos.set(f.fila, d);
            };
            salidas.forEach(item => {
                const cantidad = Number(item.cantidad);
                if (!cantidad || isNaN(cantidad)) { noAplicadas.push({ item, motivo: 'cantidad inválida' }); return; }
                if (item.tipo === 'fila') {
                    let f = indice.filas.find(x => x.fila === item.fila && x.productoClave === item.productoClave && x.descClave === item.descClave);
                    if (!f) {
                        const otras = indice.filas.filter(x => x.productoClave === item.productoClave && x.descClave === item.descClave);
                        if (otras.length === 1) f = otras[0];
                    }
                    if (!f) { noAplicadas.push({ item, motivo: `la fila ${item.fila} ("${item.descripcion}") ya no coincide con el Kardex` }); return; }
                    if (f.estado !== 'ok') { noAplicadas.push({ item, motivo: `la fila ${f.fila} figura como dudosa: ${f.motivo}` }); return; }
                    acumular(f, item);
                } else {
                    const r = ksResolverFilaPorCodigoColor(indice, item.codigo, item.color);
                    if (r.error) { noAplicadas.push({ item, motivo: r.error }); return; }
                    acumular(r.fila, item);
                }
            });

            // 2) comprobar que SALDO y TOTAL EGRESO tienen su fórmula estándar antes de tocar nada
            [...destinos.values()].forEach(d => {
                const fila = hoja.getRow(d.fila);
                const celdaD = fila.getCell(cols.colStock), celdaAJ = fila.getCell(cols.colTotalEgreso);
                const normal = c => String(c.formula || '').replace(/\s+/g, '');
                const esperadaD = `${letra(cols.colStock - 1)}${d.fila}-${letra(cols.colTotalEgreso)}${d.fila}+${letra(cols.colIngresoSanJacinto)}${d.fila}+${letra(cols.colIngresoBellota)}${d.fila}`;
                const esperadaAJ = `SUM(${letra(primerDia)}${d.fila}:${letra(ultimoDia)}${d.fila})`;
                const okD = celdaD.type === ExcelJS.ValueType.Formula && normal(celdaD) === esperadaD;
                const okAJ = celdaAJ.type === ExcelJS.ValueType.Formula && normal(celdaAJ) === esperadaAJ;
                const celdaDia = fila.getCell(colDia);
                const diaTexto = !kcEsVacio(celdaDia) && celdaDia.type !== ExcelJS.ValueType.Formula && isNaN(parseFloat(celdaDia.value));
                if (!okD || !okAJ || diaTexto) {
                    d.items.forEach(item => noAplicadas.push({ item, motivo: diaTexto ? `la celda del día ${dia} de la fila ${d.fila} tiene texto no numérico` : `la fila ${d.fila} tiene fórmulas de SALDO/TOTAL EGRESO no estándar` }));
                    destinos.delete(d.fila);
                }
            });

            const mesHoja = ksMesDeNombreHoja(nombreHoja);
            const [anioF, mesF] = fechaISO.split('-').map(Number);
            const advertenciaMes = (mesHoja && (mesHoja.anio !== anioF || mesHoja.mes !== mesF - 1))
                ? `La hoja "${nombreHoja}" no es del mes de la fecha ${fechaISO.split('-').reverse().join('/')}: la salida se anotó en el día ${dia} de esa hoja y en el Detalle diario se verá como ${String(dia).padStart(2, '0')}/${String(mesF).padStart(2, '0')}.`
                : '';
            if (!destinos.size) return { sinCambios: true, hoja: nombreHoja, fechaISO, dia, advertenciaMes, lineas: [], noAplicadas, marcadores: [] };

            // 3) anotar en la columna del día, TOTAL EGRESO y SALDO (solo resultados guardados)
            const lineas = [];
            const marcadores = [];
            [...destinos.values()].sort((a, b) => a.fila - b.fila).forEach(d => {
                if (!d.cantidad) return; // +n y -n del mismo producto en el mismo guardado se compensan
                const fila = hoja.getRow(d.fila);
                const celdaDia = fila.getCell(colDia);
                const celdaSaldo = fila.getCell(cols.colStock);
                const antes = kcNumeroCelda(celdaSaldo);
                if (kcEsVacio(celdaDia)) celdaDia.value = d.cantidad;
                else agregarTerminoAFormula(celdaDia, d.cantidad);
                actualizarResultadoCacheado(fila.getCell(cols.colTotalEgreso), d.cantidad);
                actualizarResultadoCacheado(celdaSaldo, -d.cantidad);
                marcadores.push({
                    fila: d.fila, columna: colDia,
                    despues: celdaDia.type === ExcelJS.ValueType.Formula ? celdaDia.formula : String(celdaDia.value),
                    articulo: kcNormalizar(kcTextoCelda(fila.getCell(cols.colArticulo))),
                    descripcion: kcNormalizar(kcTextoCelda(fila.getCell(cols.colDescripcion)))
                });
                lineas.push({ fila: d.fila, producto: d.producto, descripcion: d.descripcion, cantidad: d.cantidad, antes, despues: antes - d.cantidad, items: d.items, claveEdicion: clavesFila.get(d.fila) || '' });
            });
            if (!lineas.length) return { sinCambios: true, hoja: nombreHoja, fechaISO, dia, advertenciaMes, lineas: [], noAplicadas, marcadores: [] };

            workbook.calcProperties = Object.assign({}, workbook.calcProperties || {}, { fullCalcOnLoad: true });
            return { hoja: nombreHoja, fechaISO, dia, advertenciaMes, lineas, noAplicadas, marcadores };
        }

        // Guarda las salidas en el Kardex (atómico). Devuelve el resultado de ksAplicarSalidasEnWorkbook.
        async function ksGuardarSalidas(salidas, opciones, io) {
            return kcGuardarAtomico(workbook => ksAplicarSalidasEnWorkbook(workbook, salidas, opciones), io);
        }

        // ---------- Registro de movimientos (Back4App) ----------
        // registros: [{ tipo:'tienda'|'descarte'|'oc'|'oc_ajuste', fecha, dia, hoja, fila, codigo, descripcion,
        //               cantidad (+ salida, - devolución), precioUnit, total, referencia, nota, ocObjectId }]
        // Devuelve { guardados, fallidos }. Nunca lanza: el Excel es la fuente de verdad y no se revierte.
        async function ksRegistrarMovimientos(registros) {
            let guardados = 0, fallidos = 0;
            const base = {
                usuario: (typeof usuarioActual !== 'undefined' && usuarioActual?.username) || '',
                usuarioNombre: (typeof usuarioActual !== 'undefined' && usuarioActual?.nombre) || '',
                activo: true
            };
            const enviar = async r => {
                try {
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_MOVIMIENTO_KARDEX}`, {
                        method: 'POST',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(Object.assign({}, base, r))
                    });
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    guardados++;
                } catch (e) {
                    console.error('No se pudo registrar un movimiento del Kardex:', e);
                    fallidos++;
                }
            };
            for (let i = 0; i < registros.length; i += 8) {
                await Promise.all(registros.slice(i, i + 8).map(enviar));
            }
            if (typeof invalidarDetalleForaneoKardex === 'function') invalidarDetalleForaneoKardex();
            return { guardados, fallidos };
        }

        // Registros del historial a partir del resultado de un guardado.
        function ksRegistrosDesdeResultado(resultado, datos) {
            return resultado.lineas.map(l => {
                const precio = datos && datos.precios ? datos.precios[l.fila] : undefined;
                const r = {
                    tipo: datos.tipo,
                    fecha: resultado.fechaISO, dia: resultado.dia, hoja: resultado.hoja, fila: l.fila,
                    codigo: l.producto, descripcion: l.descripcion, cantidad: l.cantidad,
                    referencia: datos.referencia || '', nota: datos.nota || ''
                };
                if (datos.ocObjectId) r.ocObjectId = datos.ocObjectId;
                if (l.claveEdicion) r.claveEdicion = l.claveEdicion;
                // ¿La fecha cae en otro mes que la hoja? (así el Detalle diario la muestra con día/mes)
                const mh = ksMesDeNombreHoja(resultado.hoja);
                const [af, mf] = String(resultado.fechaISO).split('-').map(Number);
                r.fueraDeHoja = !!(mh && (mh.anio !== af || mh.mes !== mf - 1));
                if (precio !== undefined) { r.precioUnit = precio; r.total = Math.round(precio * l.cantidad * 100) / 100; }
                return r;
            });
        }

        // ---------- Órdenes de compra ----------
        // deltas: [{ codigo, color, cantidad }]  (> 0 se descuenta, < 0 se devuelve) — mismo formato que
        // calcularDiferenciaProductos(). Reemplaza a ajustarStockKardexDropbox: ahora queda anotado en la
        // columna del día. Devuelve { noAplicadas, advertenciaMes } y NO lanza por líneas no ubicables.
        async function registrarSalidasOCKardex(deltas, datosOC) {
            if (!deltas || !deltas.length) return { noAplicadas: [], advertenciaMes: '' };
            const salidas = deltas.map(d => ({ tipo: 'codigo', codigo: d.codigo, color: d.color || '', descripcion: `${d.codigo}${d.color ? ' ' + d.color : ''}`, cantidad: d.cantidad }));
            const resultado = await ksGuardarSalidas(salidas, { fechaISO: ksFechaHoyISO() });
            if (resultado.lineas.length) {
                const registros = [];
                resultado.lineas.forEach(l => registros.push(...ksRegistrosDesdeResultado({ lineas: [l], fechaISO: resultado.fechaISO, dia: resultado.dia, hoja: resultado.hoja },
                    { tipo: l.cantidad > 0 ? 'oc' : 'oc_ajuste', referencia: (datosOC && datosOC.referencia) || '', ocObjectId: datosOC && datosOC.ocObjectId })));
                const r = await ksRegistrarMovimientos(registros);
                if (r.fallidos) console.warn(`Kardex: ${r.fallidos} movimiento(s) no se pudieron registrar en el historial (el Excel sí se actualizó).`);
            }
            return { noAplicadas: resultado.noAplicadas, advertenciaMes: resultado.advertenciaMes };
        }
