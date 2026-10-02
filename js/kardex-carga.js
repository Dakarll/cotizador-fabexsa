        // ============================================
        // KARDEX — CARGA MASIVA DE INGRESOS (núcleo: índice, parser, emparejado y guardado atómico)
        // ============================================
        // El Excel NO tiene columna de medida: vive dentro de la columna B ("DESCRIPCION") con formatos
        // distintos ("BELEN 30*30 BLANCO", "BLANCO (145*75)", "AZUL 14 OZ TALLA 28"...). Este módulo
        // deriva de cada fila (producto, medida, color) SIN modificar el Excel y deja como "dudosa"
        // —excluida de la carga— toda fila que no pueda interpretar con seguridad.
        //
        // Reglas de oro (no negociables):
        //   - Nunca se insertan filas en medio: las variantes nuevas van SIEMPRE al final, porque la
        //     columna C enlaza al SALDO de la hoja anterior por número de fila.
        //   - Nunca se reescribe la descripción de una fila existente.
        //   - Una sola descarga, todos los cambios en memoria, una sola subida con `rev`.
        //   - Ante un corte de red (no se sabe si Dropbox guardó) NO se reintenta a ciegas: se verifica
        //     primero si los cambios ya están en el archivo.
        //
        // Todo lo de este archivo usa el prefijo `kc` para no chocar con kardex.js.

        // ---------- Normalización y utilidades ----------
        function kcNormalizar(texto) {
            return String(texto === null || texto === undefined ? '' : texto)
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toUpperCase().replace(/\s+/g, ' ').trim();
        }

        // Clave de comparación del color: sin espacios alrededor de "/" o "-", y "14 OZ" == "14OZ".
        function kcClaveColor(color) {
            return kcNormalizar(color)
                .replace(/\s*([\/\-])\s*/g, '$1')
                .replace(/(\d)\s+(OZ|GR|G)\b/g, '$1$2');
        }

        // Texto de una celda ExcelJS (número, texto, texto enriquecido o fórmula con resultado).
        function kcTextoCelda(celda) {
            let v = celda.value;
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && !(v instanceof Date)) {
                if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
                else if (v.formula !== undefined || v.sharedFormula !== undefined) v = (v.result === undefined || v.result === null) ? '' : v.result;
                else if (v.text !== undefined) v = v.text;
                else v = '';
            }
            if (v instanceof Date) return '';
            return String(v).trim();
        }

        // Valor numérico de una celda (para SALDO): fórmula -> su resultado cacheado.
        function kcNumeroCelda(celda) {
            const v = celda.value;
            if (v === null || v === undefined || v === '') return 0;
            if (typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined)) return parseFloat(v.result) || 0;
            return parseFloat(v) || 0;
        }

        function kcDistancia(a, b) {
            if (a === b) return 0;
            if (!a.length) return b.length;
            if (!b.length) return a.length;
            let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
            for (let i = 1; i <= a.length; i++) {
                const cur = [i];
                for (let j = 1; j <= b.length; j++) {
                    cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                }
                prev = cur;
            }
            return prev[b.length];
        }

        // ---------- Parser de la descripción (columna B) ----------
        // Devuelve { medida:{tipo,valor}|null, color, colorClave, notas[], tipo:'variante'|'libre',
        //            estado:'ok'|'dudosa', motivo }
        //   medida.tipo: 'dim' (cm, "30*30"), 'plz' ("2 PLZ", "1 1/2 PLZ", "QUEEN"), 'talla' ("30", "XL")
        //   tipo 'libre': familia de texto sin medida (TELA, TOALLA...): el texto completo ES la variante.
        function kcParsearDescripcion(descripcion, producto) {
            let t = kcNormalizar(descripcion);
            const notas = [];
            t = t.replace(/\(\s*((?:NO|SIN)\b[^)]*)\)/g, (m, n) => { notas.push(n.trim()); return ' '; });

            const halladas = [];
            // Dimensiones: "30*30", "(145*75)", "(150*70CM)", "30X30"
            t = t.replace(/\(?\s*(?<![\d.,])(\d{1,3}(?:[.,]\d+)?)\s*[*X]\s*(\d{1,3}(?:[.,]\d+)?)(?!\d)\s*(?:CMS?\b)?\s*\)?/g,
                (m, a, b) => { halladas.push({ tipo: 'dim', valor: `${a.replace(',', '.')}*${b.replace(',', '.')}` }); return ' '; });
            // Plazas: "2 PLAZAS", "1 1/2 PLAZA", "2 PLZ", y QUEEN / KING
            t = t.replace(/(?<![\d\/])(\d(?:\s+1\/2)?)\s*(?:PLAZAS?|PLZS?)\b/g,
                (m, n) => { halladas.push({ tipo: 'plz', valor: n.replace(/\s+/g, ' ') + ' PLZ' }); return ' '; });
            t = t.replace(/\b(SUPER KING|KING|QUEEN)\b/g,
                (m, n) => { halladas.push({ tipo: 'plz', valor: n }); return ' '; });
            // Tallas: "TALLA 28", "TALLA XL" y una letra suelta al final (S/M/L/XL)
            t = t.replace(/\bTALLA\s*(XXL|XL|XS|S|M|L|\d{1,2})\b/g,
                (m, n) => { halladas.push({ tipo: 'talla', valor: n }); return ' '; });
            t = t.replace(/(?<=\S)\s+(XXL|XL|XS|S|M|L)\s*$/,
                (m, n) => { halladas.push({ tipo: 'talla', valor: n }); return ' '; });

            // Gramaje/onzas pegado al color: "(650GR)" -> "650GR" (se conserva como parte del color)
            t = t.replace(/\(\s*(\d+\s*(?:OZ|GR|G))\s*\)/g, ' $1 ');
            t = t.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ');
            t = t.replace(/^[\s\-–:,\/.]+|[\s\-–:,\/.]+$/g, '').trim();

            // Medida: una sola (las repetidas idénticas cuentan como una).
            const unicas = [];
            halladas.forEach(h => { if (!unicas.some(u => u.tipo === h.tipo && u.valor === h.valor)) unicas.push(h); });
            let medida = null;
            let estado = 'ok';
            let motivo = '';
            if (unicas.length === 1) medida = unicas[0];
            else if (unicas.length > 1) { estado = 'dudosa'; motivo = 'varias medidas en la descripción (' + unicas.map(u => u.valor).join(' / ') + ')'; }

            // Quitar del color las palabras del nombre de la familia ("BELEN 30*30 ACERO" -> ACERO),
            // solo cuando hay medida (en las filas "libres" el texto completo es la identidad).
            const claveProducto = kcNormalizar(producto);
            const esNumerico = /^\d+$/.test(claveProducto);
            if (medida && !esNumerico) {
                const palabras = new Set(claveProducto.split(' ').filter(w => w && !/^\d+$/.test(w)));
                const pal = t ? t.split(' ') : [];
                while (pal.length && palabras.has(pal[0])) pal.shift();
                while (pal.length && palabras.has(pal[pal.length - 1])) pal.pop();
                t = pal.join(' ');
            }

            const tipo = medida ? 'variante' : (esNumerico ? 'variante' : 'libre');
            if (estado === 'ok') {
                if (!t) { estado = 'dudosa'; motivo = 'no se encontró el color'; }
                else if (/[()]/.test(t) && (esNumerico || medida)) { estado = 'dudosa'; motivo = 'paréntesis sin interpretar: ' + t; }
                else if ((esNumerico || medida) && /\d/.test(t.replace(/\d+\s*(?:OZ|GR|G)\b/g, ''))) { estado = 'dudosa'; motivo = 'números en el color que no son medida: ' + t; }
            }
            return { medida, color: t, colorClave: kcClaveColor(t), notas, tipo, estado, motivo };
        }

        function kcClaveMedida(medida) { return medida ? `${medida.tipo}:${medida.valor}` : 'sin'; }
        function kcTextoMedida(medida) {
            if (!medida) return 'Sin medida';
            if (medida.tipo === 'talla') return 'TALLA ' + medida.valor;
            return medida.valor;
        }
        function kcEtiquetaTipoMedida(tipo) {
            return { dim: 'Dimensión (cm)', plz: 'Plaza (PLZ)', talla: 'Talla' }[tipo] || tipo;
        }
        function kcNotaDescontinuada(notas) {
            return (notas || []).some(n => /PRODUCCION|PEDIR/.test(n));
        }

        // Formato uniforme de la descripción de una variante NUEVA: "MEDIDA COLOR".
        // Sin medida: solo el color. Ej.: "30*30 AZUL MARINO", "2 PLZ BLANCO", "TALLA 30 AZUL 14 OZ".
        function kcDescripcionNueva(medida, color) {
            const c = String(color || '').toUpperCase().replace(/\s+/g, ' ').trim();
            return medida ? `${kcTextoMedida(medida)} ${c}` : c;
        }

        // Valida/normaliza lo que el usuario escribe al crear una variante (devuelve medida o lanza).
        function kcMedidaDesdeEntrada(tipo, valorCrudo) {
            if (!tipo || tipo === 'sin') return null;
            const v = kcNormalizar(valorCrudo);
            if (tipo === 'dim') {
                const m = v.match(/^(\d{1,3}(?:[.,]\d+)?)\s*[*X]\s*(\d{1,3}(?:[.,]\d+)?)$/);
                if (!m) throw new Error('La dimensión debe verse así: 140*75');
                return { tipo: 'dim', valor: `${m[1].replace(',', '.')}*${m[2].replace(',', '.')}` };
            }
            if (tipo === 'plz') {
                const m = v.match(/^(\d(?:\s+1\/2)?)\s*(?:PLAZAS?|PLZS?)?$/);
                if (m) return { tipo: 'plz', valor: m[1].replace(/\s+/g, ' ') + ' PLZ' };
                if (/^(SUPER KING|KING|QUEEN)$/.test(v)) return { tipo: 'plz', valor: v };
                throw new Error('La plaza debe verse así: 2 PLZ, 1 1/2 PLZ, QUEEN o KING');
            }
            if (tipo === 'talla') {
                const m = v.replace(/^TALLA\s*/, '').match(/^(XXL|XL|XS|S|M|L|\d{1,2})$/);
                if (!m) throw new Error('La talla debe ser un número (28, 30...) o S/M/L/XL');
                return { tipo: 'talla', valor: m[1] };
            }
            throw new Error('Tipo de medida desconocido');
        }

        // ---------- Índice interno (solo lectura) ----------
        // Recorre una hoja ExcelJS y devuelve:
        //  { filas:[{fila, producto, productoClave, descripcion, descClave, saldo, medida, medidaClave,
        //            color, colorClave, notas, tipo, estado, motivo}], dudosas:[...], reservadas, vacias,
        //    ultimaFilaConDatos }
        function kcConstruirIndice(hoja, cols) {
            const filas = [];
            let reservadas = 0;
            let vacias = 0;
            let ultimaFilaConDatos = 1;
            for (let r = 2; r <= hoja.rowCount; r++) {
                const row = hoja.getRow(r);
                const a = kcTextoCelda(row.getCell(cols.colArticulo));
                const b = kcTextoCelda(row.getCell(cols.colDescripcion));
                if (!a && !b) { vacias++; continue; }
                ultimaFilaConDatos = r;
                if (a && !b) { reservadas++; continue; }   // fila reservada del bloque (A sin descripción): no se toca
                const base = {
                    fila: r, producto: a, productoClave: kcNormalizar(a), descripcion: b, descClave: kcNormalizar(b),
                    saldo: kcNumeroCelda(row.getCell(cols.colStock))
                };
                if (!a) {
                    filas.push(Object.assign(base, { medida: null, medidaClave: 'sin', color: '', colorClave: '', notas: [], tipo: 'libre', estado: 'dudosa', motivo: 'la fila no tiene código/familia en la columna A' }));
                    continue;
                }
                const p = kcParsearDescripcion(b, a);
                filas.push(Object.assign(base, p, { medidaClave: kcClaveMedida(p.medida) }));
            }
            // Duplicados exactos (mismo producto + medida + color): no se pueden distinguir -> dudosas las dos.
            const grupos = {};
            filas.forEach(f => {
                if (f.estado !== 'ok') return;
                const k = `${f.productoClave}|${f.medidaClave}|${f.colorClave}`;
                (grupos[k] = grupos[k] || []).push(f);
            });
            Object.values(grupos).forEach(g => {
                if (g.length > 1) g.forEach(f => {
                    f.estado = 'dudosa';
                    f.motivo = 'variante duplicada en las filas ' + g.map(x => x.fila).join(' y ') + ' (no se puede distinguir)';
                });
            });
            return { filas, dudosas: filas.filter(f => f.estado !== 'ok'), reservadas, vacias, ultimaFilaConDatos };
        }

        // Productos con al menos una fila válida: [{clave, nombre, filas}] ordenados (códigos numéricos primero).
        function kcListarProductos(indice) {
            const mapa = new Map();
            indice.filas.filter(f => f.estado === 'ok').forEach(f => {
                if (!mapa.has(f.productoClave)) mapa.set(f.productoClave, { clave: f.productoClave, nombre: f.producto, filas: [] });
                mapa.get(f.productoClave).filas.push(f);
            });
            return [...mapa.values()].sort((x, y) => {
                const nx = /^\d+$/.test(x.clave), ny = /^\d+$/.test(y.clave);
                if (nx !== ny) return nx ? -1 : 1;
                return x.clave.localeCompare(y.clave, 'es', { numeric: true });
            });
        }

        // Medidas existentes de un producto: [{clave, texto, medida, filas}] ("Sin medida" primero).
        function kcListarMedidas(producto) {
            const mapa = new Map();
            producto.filas.forEach(f => {
                if (!mapa.has(f.medidaClave)) mapa.set(f.medidaClave, { clave: f.medidaClave, texto: kcTextoMedida(f.medida), medida: f.medida, filas: [] });
                mapa.get(f.medidaClave).filas.push(f);
            });
            const orden = { sin: 0, dim: 1, plz: 2, talla: 3 };
            const numeros = m => (m.medida ? m.medida.valor : '').split(/[*\s\/]/).map(Number).filter(n => !isNaN(n));
            return [...mapa.values()].sort((a, b) => {
                const ta = a.medida ? orden[a.medida.tipo] : 0, tb = b.medida ? orden[b.medida.tipo] : 0;
                if (ta !== tb) return ta - tb;
                const na = numeros(a), nb = numeros(b);
                for (let i = 0; i < Math.max(na.length, nb.length); i++) {
                    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
                }
                return a.texto.localeCompare(b.texto, 'es');
            });
        }

        // ---------- Carga rápida por pegado ----------
        // Línea: "CÓDIGO MEDIDA COLOR CANTIDAD" (la medida puede ir antes o después del color).
        // Resultado: { linea, estado:'ok'|'error', fila?(objeto del índice), cantidad, medida, color,
        //              producto?, motivo?, sugerencias:[{tipo:'fila'|'nueva', fila?, etiqueta, ...}] }
        function kcProductoAlias(productos) {
            // Alias por última palabra ("BELEN" -> BELLOTA BELEN) solo si no es ambigua.
            const cuenta = {};
            productos.forEach(p => {
                const pal = p.clave.split(' ');
                if (pal.length > 1) { const u = pal[pal.length - 1]; cuenta[u] = (cuenta[u] || 0) + 1; }
            });
            const alias = {};
            productos.forEach(p => {
                const pal = p.clave.split(' ');
                if (pal.length > 1 && cuenta[pal[pal.length - 1]] === 1 && !productos.some(q => q.clave === pal[pal.length - 1])) alias[pal[pal.length - 1]] = p;
            });
            return alias;
        }

        function kcEmparejarLinea(lineaCruda, indice) {
            const salida = { linea: lineaCruda, estado: 'error', cantidad: 0, sugerencias: [] };
            let texto = kcNormalizar(lineaCruda).replace(/[\t;|]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!texto) { salida.motivo = 'línea vacía'; return salida; }

            // Cantidad: último número de la línea ("x50", "= 50", "50 UND" también valen).
            const mq = texto.match(/(?:^|\s)[X=]?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:UND|UNDS|UNID|UNIDADES|UN|U)?\s*$/);
            if (!mq) { salida.motivo = 'no se encontró la cantidad al final de la línea'; return salida; }
            const cantidad = parseFloat(mq[1].replace(',', '.'));
            texto = texto.slice(0, mq.index).trim();
            if (!(cantidad > 0)) { salida.motivo = 'la cantidad debe ser mayor a 0'; return salida; }
            salida.cantidad = cantidad;

            const productos = kcListarProductos(indice);
            const todasClaves = [...new Set(indice.filas.map(f => f.productoClave))];
            const alias = kcProductoAlias(productos);
            let prod = null;
            let resto = '';
            const ordenadas = productos.slice().sort((a, b) => b.clave.length - a.clave.length);
            for (const p of ordenadas) {
                if (texto === p.clave || texto.startsWith(p.clave + ' ')) { prod = p; resto = texto.slice(p.clave.length).trim(); break; }
            }
            if (!prod) {
                const primera = texto.split(' ')[0];
                if (alias[primera]) { prod = alias[primera]; resto = texto.slice(primera.length).trim(); }
            }
            if (!prod) {
                salida.motivo = 'producto/código no encontrado';
                const primera = texto.split(' ')[0];
                todasClaves.map(c => ({ c, d: kcDistancia(primera, c.split(' ')[0]) }))
                    .filter(x => x.d <= 1).slice(0, 3)
                    .forEach(x => salida.sugerencias.push({ tipo: 'texto', etiqueta: `¿Quisiste decir "${x.c}"?` }));
                return salida;
            }
            salida.producto = prod;
            let p = kcParsearDescripcion(resto, prod.nombre);
            // Familias cuyas medidas son todas tallas (PANTALON DENIN): "30 AZUL 14 OZ" = TALLA 30.
            if (!p.medida && prod.filas.every(f => f.medida && f.medida.tipo === 'talla') && /^\d{1,2}\s+\S/.test(resto)) {
                p = kcParsearDescripcion('TALLA ' + resto, prod.nombre);
            }
            salida.medida = p.medida;
            salida.color = p.color;
            if (p.estado !== 'ok' && p.motivo && !/no se encontró el color/.test(p.motivo)) {
                salida.motivo = 'no se pudo interpretar la medida/color: ' + p.motivo;
                return salida;
            }
            if (!p.color) { salida.motivo = 'falta el color'; return salida; }

            const mk = kcClaveMedida(p.medida);
            const exacta = indice.filas.filter(f => f.productoClave === prod.clave && f.medidaClave === mk && f.colorClave === p.colorClave);
            const validas = exacta.filter(f => f.estado === 'ok');
            if (validas.length === 1) { salida.estado = 'ok'; salida.fila = validas[0]; return salida; }
            if (exacta.length) { salida.motivo = 'esa variante está en una fila dudosa/duplicada (excluida): fila ' + exacta.map(f => f.fila).join(', '); return salida; }

            salida.motivo = `no existe "${kcTextoMedida(p.medida)} · ${p.color}" en ${prod.nombre}`;
            const mismaMedida = prod.filas.filter(f => f.medidaClave === mk);
            mismaMedida
                .map(f => ({ f, d: kcDistancia(p.colorClave, f.colorClave), sub: f.colorClave.includes(p.colorClave) || p.colorClave.includes(f.colorClave) }))
                .filter(x => x.sub || x.d <= Math.max(2, Math.floor(p.colorClave.length / 3)))
                .sort((x, y) => x.d - y.d).slice(0, 3)
                .forEach(x => salida.sugerencias.push({ tipo: 'fila', fila: x.f, etiqueta: `${kcTextoMedida(x.f.medida)} · ${x.f.color}` }));
            prod.filas.filter(f => f.medidaClave !== mk && f.colorClave === p.colorClave).slice(0, 4)
                .forEach(f => salida.sugerencias.push({ tipo: 'fila', fila: f, etiqueta: `${kcTextoMedida(f.medida)} · ${f.color} (otra medida)` }));
            if (!salida.sugerencias.length && !mismaMedida.length) {
                const medidas = kcListarMedidas(prod).map(m => m.texto).slice(0, 8).join(', ');
                salida.sugerencias.push({ tipo: 'texto', etiqueta: `Medidas de ${prod.nombre}: ${medidas}` });
            }
            salida.sugerencias.push({ tipo: 'nueva', etiqueta: `Crear variante nueva: ${kcDescripcionNueva(p.medida, p.color)}`, medida: p.medida, color: p.color });
            return salida;
        }

        // ---------- Escritura: aplicar el carrito sobre un workbook ya descargado ----------
        // carrito = [{ tipo:'existente', fila, productoClave, descClave, descripcion, cantidad }
        //          | { tipo:'nueva', producto, medida, color, cantidad }]
        // Modifica el workbook en memoria (NO sube nada). Si algo no cuadra LANZA antes de terminar:
        // como nada se sube, no queda nada a medias.

        // Las fórmulas D y AJ vienen como "compartidas" (un maestro y clones). Se convierten en fórmulas
        // normales SOLO en la hoja a modificar, con el mismo texto efectivo, para que ExcelJS pueda volver
        // a guardarlas siempre (mismo criterio que desconectarFormulasCompartidas, pero acotado a una hoja).
        function kcDesconectarFormulasHoja(hoja) { desconectarFormulasCompartidasHoja(hoja); }

        function kcFormulaTexto(celda) {
            return celda.type === ExcelJS.ValueType.Formula ? (celda.formula || null) : null;
        }

        // Traslada las referencias relativas de la fila `origen` a la fila `destino` (C627 -> C628,
        // 'Jul´26'!D627 -> 'Jul´26'!D628, SUM(E627:AI627) -> SUM(E628:AI628)). Las absolutas ($) no se tocan.
        function kcTrasladarFormula(formula, origen, destino) {
            return formula.replace(/(?<![A-Za-z0-9_.´'$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z])/g,
                (m, col, dol, num) => (dol === '' && col[0] !== '$' && Number(num) === origen) ? `${col}${destino}` : m);
        }

        function kcEsVacio(celda) {
            const v = celda.value;
            return v === null || v === undefined || v === '';
        }

        // ¿La fila r de la hoja actual sirve para una variante nueva? (nada de datos, solo fórmulas de C/D/AJ)
        function kcFilaLibre(hoja, r, cols, hojaPrevia) {
            const row = hoja.getRow(r);
            const total = Math.max(hoja.columnCount, cols.colTotalEgreso, cols.colIngresoBellota, cols.colIngresoSanJacinto);
            const colC = cols.colStock - 1;
            for (let c = 1; c <= total; c++) {
                const celda = row.getCell(c);
                if (kcEsVacio(celda)) continue;
                const esFormula = celda.type === ExcelJS.ValueType.Formula;
                if ((c === colC || c === cols.colStock || c === cols.colTotalEgreso) && esFormula) continue;
                return false;
            }
            if (hojaPrevia) {
                const prev = hojaPrevia.getRow(r);
                if (kcTextoCelda(prev.getCell(cols.colArticulo)) || kcTextoCelda(prev.getCell(cols.colDescripcion))) return false;
                if (kcNumeroCelda(prev.getCell(cols.colStock)) !== 0) return false;
            }
            return true;
        }

        function kcLetraColumna(hoja, n) { return hoja.getColumn(n).letter; }

        // ---------- Ubicación de una variante nueva dentro de su bloque ----------
        const KC_FORMULA_ENLACE = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/;

        // Hoja del mes anterior (la que enlaza la columna C: `Jul´26!D2`), buscando una fila con ese enlace.
        function kcHojaPrevia(workbook, hoja, cols) {
            const colC = cols.colStock - 1;
            for (let r = hoja.rowCount; r >= 2; r--) {
                const f = kcFormulaTexto(hoja.getRow(r).getCell(colC));
                const m = f && f.match(KC_FORMULA_ENLACE);
                if (m && Number(m[3]) === r) return workbook.getWorksheet(m[1]) || null;
            }
            return null;
        }

        function kcFormulaEstandarSaldo(hoja, cols, r) {
            const L = n => kcLetraColumna(hoja, n);
            return `${L(cols.colStock - 1)}${r}-${L(cols.colTotalEgreso)}${r}+${L(cols.colIngresoSanJacinto)}${r}+${L(cols.colIngresoBellota)}${r}`;
        }
        function kcFormulaEstandarEgreso(hoja, cols, r) {
            const dias = Object.values(cols.colesDias);
            return `SUM(${kcLetraColumna(hoja, Math.min(...dias))}${r}:${kcLetraColumna(hoja, Math.max(...dias))}${r})`;
        }

        // ¿La fila r es una fila RESERVADA del producto que se puede usar? (código en A, descripción y datos vacíos;
        // SALDO/TOTAL EGRESO, si tienen fórmula, estándar; y en la hoja anterior esa fila también está vacía y en 0)
        function kcFilaReservadaUsable(hoja, cols, r, prodClave, hojaPrevia) {
            const fila = hoja.getRow(r);
            if (kcNormalizar(kcTextoCelda(fila.getCell(cols.colArticulo))) !== prodClave) return false;
            if (kcTextoCelda(fila.getCell(cols.colDescripcion))) return false;
            const total = Math.max(hoja.columnCount, cols.colTotalEgreso, cols.colIngresoBellota, cols.colIngresoSanJacinto);
            const colC = cols.colStock - 1;
            for (let c = 1; c <= total; c++) {
                if (c === cols.colArticulo) continue;
                const celda = fila.getCell(c);
                if (kcEsVacio(celda)) continue;
                const esFormula = celda.type === ExcelJS.ValueType.Formula;
                if ((c === colC || c === cols.colStock || c === cols.colTotalEgreso) && esFormula) continue;
                return false;
            }
            const d = fila.getCell(cols.colStock), aj = fila.getCell(cols.colTotalEgreso);
            const norm = x => String(x.formula || '').replace(/\s+/g, '');
            if (d.type === ExcelJS.ValueType.Formula && norm(d) !== kcFormulaEstandarSaldo(hoja, cols, r)) return false;
            if (aj.type === ExcelJS.ValueType.Formula && norm(aj) !== kcFormulaEstandarEgreso(hoja, cols, r)) return false;
            if (hojaPrevia) {
                const prev = hojaPrevia.getRow(r);
                if (kcTextoCelda(prev.getCell(cols.colDescripcion))) return false;
                const aPrev = kcNormalizar(kcTextoCelda(prev.getCell(cols.colArticulo)));
                if (aPrev && aPrev !== prodClave) return false;
                if (kcNumeroCelda(prev.getCell(cols.colStock)) !== 0) return false;
            }
            return true;
        }

        // Motivo por el que NO es seguro insertar una fila en la posición `pos` (o null si se puede).
        // Insertar corre las filas de abajo: solo se hace si todo lo que depende del número de fila se puede ajustar.
        function kcRiesgoDeInsertar(workbook, hoja, pos) {
            if (hoja.model && hoja.model.merges && hoja.model.merges.length) return 'la hoja tiene celdas combinadas';
            if (hoja.dataValidations && hoja.dataValidations.model && Object.keys(hoja.dataValidations.model).length) return 'la hoja tiene validaciones de datos';
            if ((hoja.tables && Object.keys(hoja.tables).length) || (hoja.getImages && hoja.getImages().length)) return 'la hoja tiene tablas o imágenes';
            const escapado = hoja.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const referencia = new RegExp(`(^|[^A-Za-z0-9_])'?${escapado}'?!`);
            let motivo = null;
            workbook.eachSheet(ws => {
                if (motivo) return;
                ws.eachRow({ includeEmpty: false }, fila => fila.eachCell({ includeEmpty: false }, celda => {
                    if (motivo || celda.type !== ExcelJS.ValueType.Formula) return;
                    const f = String(celda.formula || '');
                    if (ws !== hoja && referencia.test(f)) motivo = `la hoja "${ws.name}" ya enlaza con esta hoja por número de fila`;
                    else if (ws === hoja && /INDIRECT|OFFSET|INDEX|ROW\(|ADDRESS/i.test(f)) motivo = `la fórmula ${celda.address} usa referencias dinámicas`;
                    if (!motivo && ws === hoja && celda.row >= pos && celda.note) motivo = 'hay comentarios en celdas de la hoja';
                }));
            });
            if (motivo) return motivo;
            const nombreDefinido = JSON.stringify((workbook.definedNames && workbook.definedNames.model) || []);
            if (nombreDefinido.includes(`${hoja.name}'!`) || nombreDefinido.includes(`${hoja.name}!`)) return 'hay rangos con nombre que apuntan a esta hoja';
            return null;
        }

        // Inserta una fila vacía en la posición `pos` corriendo todo lo de abajo una fila: valores, estilos, alturas,
        // fórmulas de la misma fila (se re-numeran) y los rangos del formato condicional y del autofiltro.
        // Los enlaces a la hoja anterior (columna C) conservan su texto: siguen apuntando al producto correcto.
        // Re-numera las referencias de la MISMA hoja de una fórmula al insertar una fila en `pos` (como hace Excel):
        // toda referencia a una fila >= pos pasa a la siguiente; un rango que atraviesa pos se estira. No toca fórmulas
        // que enlazan con otras hojas ("Jul´26!D2"): ese texto sigue apuntando al producto correcto de la hoja anterior.
        function kcAjustarReferenciasPorInsercion(formula, pos) {
            if (/!/.test(formula)) return formula;
            return formula.replace(/(?<![A-Za-z0-9_.'"$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z])/g,
                (m, col, dol, num) => Number(num) >= pos ? `${col}${dol}${Number(num) + 1}` : m);
        }

        function kcInsertarFila(hoja, cols, pos) {
            const ultima = hoja.rowCount;
            const total = Math.max(hoja.columnCount, cols.colTotalEgreso, cols.colIngresoBellota, cols.colIngresoSanJacinto);
            for (let r = ultima; r >= pos; r--) {
                const origen = hoja.getRow(r), destino = hoja.getRow(r + 1);
                for (let c = 1; c <= total; c++) {
                    const oc = origen.getCell(c), dc = destino.getCell(c);
                    dc.value = oc.type === ExcelJS.ValueType.Formula ? { formula: String(oc.formula || ''), result: oc.result } : oc.value;
                    dc.style = Object.assign({}, oc.style);
                }
                destino.height = origen.height;
                destino.hidden = origen.hidden;
                destino.outlineLevel = origen.outlineLevel;
            }
            const vacia = hoja.getRow(pos);
            for (let c = 1; c <= total; c++) vacia.getCell(c).value = null;
            // Re-numerar las referencias de todas las fórmulas de la hoja (las de las filas corridas y las que apuntan hacia abajo).
            hoja.eachRow({ includeEmpty: false }, fila => fila.eachCell({ includeEmpty: false }, celda => {
                if (celda.type !== ExcelJS.ValueType.Formula) return;
                const f = String(celda.formula || '');
                const nuevo = kcAjustarReferenciasPorInsercion(f, pos);
                if (nuevo !== f) celda.value = { formula: nuevo, result: celda.result };
            }));
            // Rangos que dependen de filas
            (hoja.conditionalFormattings || []).forEach(cf => {
                const m = String(cf.ref || '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
                if (!m) return;
                const ini = Number(m[2]) >= pos ? Number(m[2]) + 1 : Number(m[2]);
                const fin = Number(m[4]) >= pos ? Number(m[4]) + 1 : Number(m[4]);
                cf.ref = `${m[1]}${ini}:${m[3]}${fin}`;
            });
            const af = hoja.autoFilter;
            if (typeof af === 'string') {
                const m = af.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
                if (m && Number(m[4]) >= pos) hoja.autoFilter = `${m[1]}${m[2]}:${m[3]}${Number(m[4]) + 1}`;
            } else if (af && af.to && typeof af.to.row === 'number' && af.to.row >= pos) {
                af.to.row += 1;
            }
        }

        // Decide dónde va una variante nueva y deja ESA fila escrita (A, B, C, D, AJ y formato).
        // Devuelve { fila, insertada, ubicacion:'reservada'|'insertada'|'final', aviso }.
        function kcColocarVarianteNueva(workbook, hoja, cols, n) {
            const indice = kcConstruirIndice(hoja, cols);
            const hojaPrevia = kcHojaPrevia(workbook, hoja, cols);
            const colC = cols.colStock - 1;
            const delProducto = indice.filas.filter(f => f.productoClave === n.prodClave);
            let fila = 0, insertada = false, ubicacion = 'final', aviso = '', plantillaFila = 0;

            if (delProducto.length) {
                const delGrupo = delProducto.filter(f => f.medidaClave === n.mk);
                const ancla = Math.max(...(delGrupo.length ? delGrupo : delProducto).map(f => f.fila));
                if (kcFilaReservadaUsable(hoja, cols, ancla + 1, n.prodClave, hojaPrevia)) {
                    fila = ancla + 1; ubicacion = 'reservada'; plantillaFila = ancla;
                } else {
                    const motivo = kcRiesgoDeInsertar(workbook, hoja, ancla + 1);
                    if (!motivo) {
                        kcInsertarFila(hoja, cols, ancla + 1);
                        fila = ancla + 1; insertada = true; ubicacion = 'insertada'; plantillaFila = ancla;
                    } else {
                        aviso = `No se pudo insertar la variante "${kcDescripcionNueva(n.medida, n.color)}" dentro de ${n.producto} (${motivo}); se agregó al final del Kardex.`;
                    }
                }
            }
            if (!fila) {   // al final de la hoja (respaldo)
                let siguiente = indice.ultimaFilaConDatos + 1;
                const tope = siguiente + 60;
                while (siguiente < tope && !kcFilaLibre(hoja, siguiente, cols, hojaPrevia)) siguiente++;
                if (siguiente >= tope) throw new Error('No se encontró una fila libre para crear la variante nueva');
                fila = siguiente; plantillaFila = indice.ultimaFilaConDatos;
            }

            const r = fila;
            const filaX = hoja.getRow(r);
            const plantilla = hoja.getRow(plantillaFila);
            const total = Math.max(hoja.columnCount, cols.colTotalEgreso);
            if (ubicacion !== 'reservada') {
                // Mismo formato (bordes, colores, formatos de número) que la fila de referencia del bloque.
                for (let c = 1; c <= total; c++) filaX.getCell(c).style = Object.assign({}, plantilla.getCell(c).style);
                if (plantilla.height) filaX.height = plantilla.height;
            }
            // A: mismo tipo de dato que las demás filas del producto (los códigos son números).
            if (kcEsVacio(filaX.getCell(cols.colArticulo))) {
                const hermana = delProducto[delProducto.length - 1];
                filaX.getCell(cols.colArticulo).value = hermana ? hoja.getRow(hermana.fila).getCell(cols.colArticulo).value : n.producto;
            }
            filaX.getCell(cols.colDescripcion).value = kcDescripcionNueva(n.medida, n.color);

            // C: en una fila reservada ya trae su enlace; al final de la hoja se enlaza como las demás; una fila INSERTADA no
            // tiene fila equivalente en la hoja anterior, así que queda sin enlace (arranca en 0).
            let saldoPrevio = 0;
            const formulaC = kcFormulaTexto(plantilla.getCell(colC));
            const mC = formulaC && formulaC.match(KC_FORMULA_ENLACE);
            if (ubicacion === 'final' && mC && Number(mC[3]) === plantillaFila) {
                saldoPrevio = hojaPrevia ? kcNumeroCelda(hojaPrevia.getRow(r).getCell(cols.colStock)) : 0;
                filaX.getCell(colC).value = { formula: kcTrasladarFormula(formulaC, plantillaFila, r), result: saldoPrevio };
            } else if (ubicacion === 'insertada') {
                filaX.getCell(colC).value = null;
            } else if (ubicacion === 'reservada') {
                const cC = filaX.getCell(colC);
                if (cC.type === ExcelJS.ValueType.Formula) saldoPrevio = kcNumeroCelda(cC);
            }
            // D (SALDO) y AJ (TOTAL EGRESO): fórmulas estándar de la fila (las de la fila de referencia, trasladadas).
            const celdaD = filaX.getCell(cols.colStock), celdaAJ = filaX.getCell(cols.colTotalEgreso);
            if (celdaD.type !== ExcelJS.ValueType.Formula) {
                const formD = kcFormulaTexto(plantilla.getCell(cols.colStock));
                celdaD.value = { formula: formD ? kcTrasladarFormula(formD, plantillaFila, r) : kcFormulaEstandarSaldo(hoja, cols, r), result: saldoPrevio };
            } else celdaD.value = { formula: celdaD.formula, result: saldoPrevio };
            if (celdaAJ.type !== ExcelJS.ValueType.Formula) {
                const formAJ = kcFormulaTexto(plantilla.getCell(cols.colTotalEgreso));
                celdaAJ.value = { formula: formAJ ? kcTrasladarFormula(formAJ, plantillaFila, r) : kcFormulaEstandarEgreso(hoja, cols, r), result: 0 };
            } else celdaAJ.value = { formula: celdaAJ.formula, result: 0 };
            return { fila: r, insertada, ubicacion, aviso };
        }

        function kcAplicarCargaEnWorkbook(workbook, carrito, opciones) {
            const { planta, fechaISO } = opciones;
            if (!Array.isArray(carrito) || carrito.length === 0) throw new Error('El carrito de carga está vacío');
            // Sin planta (''/'inicial'): la cantidad se suma en la columna C (Cant Inicial).
            // Con planta: ingreso de esa planta (AK = San Jacinto, AL = La Bellota) + FECHA INGRESO.
            const aInicial = !planta || planta === 'inicial';
            if (!aInicial && planta !== 'san_jacinto' && planta !== 'la_bellota') throw new Error('Planta desconocida');
            if (!aInicial && !fechaISO) throw new Error('Falta la fecha de ingreso');

            const nombreHoja = resolverNombreHojaKardexWorkbook(workbook);
            const hoja = workbook.getWorksheet(nombreHoja);
            if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

            const cols = resolverColumnasMovimientoExcel(hoja);
            if (cols.colStock < 2) throw new Error('No se detectó la columna SALDO del Kardex');
            const colIngreso = aInicial ? cols.colStock - 1 : (planta === 'san_jacinto' ? cols.colIngresoSanJacinto : cols.colIngresoBellota);
            if (colIngreso < 1) throw new Error('No se detectó la columna de ingreso de la planta elegida en el Kardex');
            if (cols.colArticulo < 1 || cols.colDescripcion < 1) throw new Error('No se detectaron las columnas ARTICULO/DESCRIPCION del Kardex');
            if (cols.colTotalEgreso < 1) throw new Error('No se detectó la columna TOTAL EGRESO del Kardex');

            kcDesconectarFormulasHoja(hoja);
            const indice = kcConstruirIndice(hoja, cols);
            const colC = cols.colStock - 1;

            // 1) Resolver cada línea del carrito contra la hoja FRESCA (nunca contra lo que se vio antes).
            const destinos = new Map(); // fila -> { fila, cantidad, descripcion, nueva, datosNueva }
            const porAsignar = [];
            carrito.forEach(item => {
                const cantidad = Number(item.cantidad);
                if (!(cantidad > 0)) throw new Error('Hay una línea con cantidad inválida en el carrito');
                if (item.tipo === 'existente') {
                    let f = indice.filas.find(x => x.fila === item.fila && x.productoClave === item.productoClave && x.descClave === item.descClave);
                    if (!f) {
                        const otras = indice.filas.filter(x => x.productoClave === item.productoClave && x.descClave === item.descClave);
                        if (otras.length === 1) f = otras[0];
                    }
                    if (!f) throw new Error(`La fila ${item.fila} ("${item.descripcion}") ya no coincide con el Kardex actual. Actualiza el índice y vuelve a armar la carga.`);
                    if (f.estado !== 'ok') throw new Error(`La fila ${f.fila} ("${f.descripcion}") ahora figura como dudosa: ${f.motivo}`);
                    const d = destinos.get(f.fila) || { fila: f.fila, cantidad: 0, descripcion: f.descripcion, producto: f.producto, nueva: false };
                    d.cantidad += cantidad;
                    destinos.set(f.fila, d);
                } else if (item.tipo === 'nueva') {
                    const prodClave = kcNormalizar(item.producto);
                    const mk = kcClaveMedida(item.medida);
                    const ck = kcClaveColor(item.color);
                    if (!ck) throw new Error('Una variante nueva no tiene color');
                    const iguales = indice.filas.filter(x => x.productoClave === prodClave && x.medidaClave === mk && x.colorClave === ck);
                    if (iguales.length > 1 || (iguales.length === 1 && iguales[0].estado !== 'ok')) {
                        throw new Error(`La variante "${kcDescripcionNueva(item.medida, item.color)}" de ${item.producto} ya aparece en filas dudosas/duplicadas (${iguales.map(x => x.fila).join(', ')}).`);
                    }
                    if (iguales.length === 1) {
                        // Alguien (o tú) ya la creó: se usa esa fila, NO se crea otra (evita duplicar al reintentar).
                        const f = iguales[0];
                        const d = destinos.get(f.fila) || { fila: f.fila, cantidad: 0, descripcion: f.descripcion, producto: f.producto, nueva: false };
                        d.cantidad += cantidad;
                        destinos.set(f.fila, d);
                    } else {
                        const previo = porAsignar.find(x => x.prodClave === prodClave && x.mk === mk && x.ck === ck);
                        if (previo) previo.cantidad += cantidad;
                        else porAsignar.push({ prodClave, mk, ck, producto: item.producto, medida: item.medida, color: item.color, cantidad });
                    }
                } else throw new Error('Línea de carrito desconocida');
            });

            // 2) Filas nuevas: cada variante va al FINAL DE SU BLOQUE (producto o producto+medida), no al final de la hoja.
            //    Primero se usa una fila RESERVADA del bloque (código en A, descripción vacía, ya con sus fórmulas y su
            //    enlace a la hoja anterior); si no hay, se INSERTA una fila nueva justo después del bloque.
            const avisos = [];
            porAsignar.forEach(n => {
                const pos = kcColocarVarianteNueva(workbook, hoja, cols, n);
                n.fila = pos.fila;
                if (pos.aviso) avisos.push(pos.aviso);
                if (pos.insertada) {
                    // Las filas de abajo se corrieron una posición: se actualizan las ya resueltas.
                    const corridos = new Map();
                    destinos.forEach((d, f) => {
                        const nueva = f >= pos.fila ? f + 1 : f;
                        d.fila = nueva;
                        corridos.set(nueva, d);
                    });
                    destinos.clear();
                    corridos.forEach((d, f) => destinos.set(f, d));
                    porAsignar.forEach(o => { if (o !== n && o.fila && o.fila >= pos.fila) o.fila++; });
                }
                destinos.set(n.fila, { fila: n.fila, cantidad: n.cantidad, descripcion: kcDescripcionNueva(n.medida, n.color), producto: n.producto, nueva: true, ubicacion: pos.ubicacion });
            });

            // 3) Sumar el ingreso (AK/AL), refrescar SALDO y poner la fecha.
            const lineas = [];
            const marcadores = [];
            [...destinos.values()].sort((x, y) => x.fila - y.fila).forEach(d => {
                const fila = hoja.getRow(d.fila);
                const celdaIng = fila.getCell(colIngreso);
                const celdaSaldo = fila.getCell(cols.colStock);
                const antes = kcNumeroCelda(celdaSaldo);
                if (aInicial && !d.nueva) {
                    // Sumar en C solo sirve si SALDO lo calcula con la fórmula estándar C-AJ+AK+AL; si no, no se adivina.
                    const letra = n => kcLetraColumna(hoja, n);
                    const esperada = `${letra(colIngreso)}${d.fila}-${letra(cols.colTotalEgreso)}${d.fila}+${letra(cols.colIngresoSanJacinto)}${d.fila}+${letra(cols.colIngresoBellota)}${d.fila}`;
                    if (celdaSaldo.type !== ExcelJS.ValueType.Formula || String(celdaSaldo.formula).replace(/\s+/g, '') !== esperada) {
                        throw new Error(`La fórmula de SALDO de la fila ${d.fila} no es la estándar (C-AJ+AK+AL): no se puede sumar en la columna C. No se guardó nada.`);
                    }
                }
                if (kcEsVacio(celdaIng)) {
                    celdaIng.value = d.cantidad;
                } else {
                    const v = celdaIng.value;
                    const esFormula = celdaIng.type === ExcelJS.ValueType.Formula;
                    if (!esFormula && isNaN(parseFloat(v))) {
                        throw new Error(`La celda de ingreso de la fila ${d.fila} tiene texto no numérico ("${v}"); se abortó la carga para no pisarlo.`);
                    }
                    agregarTerminoAFormula(celdaIng, d.cantidad);
                }
                actualizarResultadoCacheado(celdaSaldo, d.cantidad);
                if (!aInicial && cols.colFechaIngreso > 0) fila.getCell(cols.colFechaIngreso).value = formatearFechaDDMMAAAA(fechaISO);
                const esFormulaFinal = celdaIng.type === ExcelJS.ValueType.Formula;
                marcadores.push({
                    fila: d.fila, columna: colIngreso, nueva: d.nueva,
                    despues: esFormulaFinal ? celdaIng.formula : String(celdaIng.value),
                    articulo: kcNormalizar(kcTextoCelda(fila.getCell(cols.colArticulo))),
                    descripcion: kcNormalizar(kcTextoCelda(fila.getCell(cols.colDescripcion)))
                });
                lineas.push({ fila: d.fila, producto: d.producto, descripcion: d.descripcion, cantidad: d.cantidad, antes, despues: antes + d.cantidad, nueva: d.nueva, ubicacion: d.ubicacion || '' });
            });

            // Que Excel recalcule todo al abrir (los resultados cacheados de D/AJ no son confiables).
            workbook.calcProperties = Object.assign({}, workbook.calcProperties || {}, { fullCalcOnLoad: true });
            return { hoja: nombreHoja, planta: aInicial ? 'inicial' : planta, lineas, marcadores, avisos };
        }

        // ¿Ya están aplicados estos cambios en este workbook? (para no duplicar tras un corte de red)
        // Devuelve { aplicados, total }.
        function kcVerificarAplicado(workbook, marcadores) {
            const hoja = workbook.getWorksheet(resolverNombreHojaKardexWorkbook(workbook));
            const cols = resolverColumnasMovimientoExcel(hoja);
            let aplicados = 0;
            marcadores.forEach(m => {
                const fila = hoja.getRow(m.fila);
                if (kcNormalizar(kcTextoCelda(fila.getCell(cols.colArticulo))) !== m.articulo) return;
                if (kcNormalizar(kcTextoCelda(fila.getCell(cols.colDescripcion))) !== m.descripcion) return;
                const celda = fila.getCell(m.columna);
                const actual = celda.type === ExcelJS.ValueType.Formula ? String(celda.formula || '') : (kcEsVacio(celda) ? '' : String(celda.value));
                // Igual, o el mismo texto seguido de otro "+n" que alguien agregó después.
                if (actual === m.despues || (actual.startsWith(m.despues) && /^[+-]/.test(actual.slice(m.despues.length)))) aplicados++;
            });
            return { aplicados, total: marcadores.length };
        }

        // Fórmulas por hoja (para comprobar que la carga no pierde ninguna).
        function kcContarFormulas(workbook) { return contarFormulasPorHoja(workbook); }

        // Red de seguridad: tras aplicar la carga, NINGUNA hoja puede tener menos fórmulas que antes.
        function kcExigirFormulasIntactas(antes, despues) {
            Object.keys(antes).forEach(hoja => {
                if ((despues[hoja] || 0) < antes[hoja]) {
                    throw new Error(`Control de seguridad: la hoja "${hoja}" habría perdido fórmulas (${antes[hoja]} -> ${despues[hoja] || 0}). No se guardó nada.`);
                }
            });
        }

        // ---------- Guardado atómico con candado `rev` ----------
        // `io` permite inyectar la descarga/subida en pruebas. Por defecto usa Dropbox real.
        // Garantías:
        //  - 1 descarga + 1 subida por intento; si falla algo, Dropbox no recibe nada.
        //  - Conflicto (409): el archivo NO se escribió -> se descarga la versión nueva y se reaplica TODO.
        //  - Corte de red/5xx (resultado incierto): antes de reintentar se comprueba si ya quedó guardado.
        async function kcGuardarAtomico(aplicarFn, io) {
            const servicios = Object.assign({
                obtenerToken: obtenerAccessTokenDropbox,
                descargar: descargarKardexParaEscritura,
                subir: (token, workbook, rev) => subirKardexConCandado(token, workbook, rev, { prohibirAplanar: true })
            }, io || {});
            const token = await servicios.obtenerToken();
            let pendienteIncierto = null;     // marcadores del intento cuyo resultado no se conoce
            let ultimoError = null;

            for (let intento = 1; intento <= 6; intento++) {
                const { workbook, rev } = await servicios.descargar(token);

                if (pendienteIncierto) {
                    const { aplicados, total } = kcVerificarAplicado(workbook, pendienteIncierto.marcadores);
                    if (aplicados === total) return Object.assign({ yaAplicado: true, intentos: intento }, pendienteIncierto.resultado);
                    if (aplicados > 0) {
                        const e = new Error(`Estado incierto: ${aplicados} de ${total} cambios ya figuran en el Kardex tras un corte de conexión. NO se reintentó para no duplicar. Revisa el Kardex antes de volver a cargar.`);
                        e.incierto = true;
                        throw e;
                    }
                    pendienteIncierto = null;  // ninguno quedó guardado: es seguro reaplicar sobre esta versión
                }

                const formulasAntes = kcContarFormulas(workbook);
                const resultado = aplicarFn(workbook);
                kcExigirFormulasIntactas(formulasAntes, kcContarFormulas(workbook));
                if (resultado.sinCambios) return Object.assign({ yaAplicado: false, intentos: intento }, resultado); // nada que subir
                let exito;
                try {
                    exito = await servicios.subir(token, workbook, rev);
                } catch (errorSubida) {
                    if (errorSubida && errorSubida.ambiguo) {
                        pendienteIncierto = { marcadores: resultado.marcadores, resultado };
                        ultimoError = errorSubida;
                        continue;   // la siguiente vuelta verifica antes de reaplicar
                    }
                    throw errorSubida;
                }
                if (exito) return Object.assign({ yaAplicado: false, intentos: intento }, resultado);
                // 409: alguien guardó primero; nada se escribió. Se repite con la versión nueva.
            }
            const fin = new Error('No se pudo guardar la carga tras varios intentos' + (ultimoError ? ` (${ultimoError.message})` : ' (mucha actividad simultánea)') + '. Verifica el Kardex antes de repetirla.');
            if (pendienteIncierto) fin.incierto = true;
            throw fin;
        }

        // Carga masiva de ingresos: aplica el carrito y lo guarda de forma atómica.
        async function kcGuardarCargaMasiva(carrito, opciones, io) {
            return kcGuardarAtomico(workbook => kcAplicarCargaEnWorkbook(workbook, carrito, opciones), io);
        }
