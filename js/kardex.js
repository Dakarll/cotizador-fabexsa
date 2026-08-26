        // ============================================
        // KARDEX — Dropbox (todas las hojas y columnas)
        // ============================================
        const KARDEX_CONFIG = {
            url: 'https://dl.dropboxusercontent.com/scl/fi/ypaoi32fdiu0l91l9wa8w/Kardex-Taller-2026.xlsx?rlkey=y0ywsqsa8acvlvfqniestyjd7&st=y3dxscyp&dl=1',
            // 'ULTIMA' = siempre usa la última hoja del Excel (la más reciente, ya que cada mes
            // agregan una hoja nueva). También puedes poner un número fijo (0, 1, 2...) o el
            // nombre exacto de una hoja puntual si alguna vez necesitas fijarla manualmente.
            hoja: 'Jul´26',
            columnaCodigo: null,  // null = detección automática, o escribe el nombre exacto ej: 'ARTICULO'
            columnaStock: null,   // null = detección automática, o escribe el nombre exacto ej: 'SALDO'
            // Columna donde vive el color/variante de cada fila. A diferencia de código/stock, esta
            // NO se detecta sola (el nombre es muy particular) — si el Excel cambia de nombre esta
            // columna en el futuro, actualiza el texto exacto aquí abajo:
            columnaColor: 'DESCRIPCION: INV 01/6'
        };

        // Contraseña para desbloquear la edición manual del Kardex desde el propio sistema
        // (botón "🔒 Editar Kardex"). Cámbiala por la que quieras usar en tu equipo.
        const KARDEX_EDIT_CONFIG = {
            password: 'Fabexsa2026'
        };

        // Clase de Back4App donde se guarda cada movimiento del Control Diario (para el
        // sistema de consulta), igual que CLASE_COTIZACIONES guarda el historial de cotizaciones.
        const CLASE_CONTROL_DIARIO = 'ControlDiario';

        // ============================================
        // IDENTIFICACIÓN INTELIGENTE DE PRODUCTOS (columna ARTICULO + columna DESCRIPCION)
        // ============================================
        // Varias filas del Kardex no tienen código en la columna ARTICULO y solo se distinguen
        // por su texto en la columna DESCRIPCION. Para poder referenciarlas de forma estable
        // (Control Diario, Exportar Stock, edición manual, etc.) se genera una "clave" única:
        //   - Si la fila SÍ tiene código en ARTICULO -> la clave ES ese código, tal cual.
        //   - Si NO tiene código -> la clave es "DESC::" + el texto de DESCRIPCION normalizado
        //     (sin tildes, en minúsculas, espacios colapsados), para que la fila se siga
        //     reconociendo como LA MISMA aunque el Excel cambie mayúsculas/tildes entre meses.
        function normalizarClaveDescripcion(descripcion) {
            return 'DESC::' + normalizarTexto(descripcion).replace(/\s+/g, ' ').trim();
        }

        // Ubica, dentro de una lista de encabezados de una hoja, cuál es la columna ARTICULO
        // (código) y cuál es la columna DESCRIPCION (nombre/detalle del producto).
        function encontrarColumnasIdentificacion(encabezados) {
            const colArticulo = encabezados.find(h => /^art[ií]culo$/i.test(h))
                || encabezados.find(h => /art[ií]culo|c[oó]digo|sku/i.test(h));
            const colDescripcion = encabezados.find(h => /^descripci[oó]n$/i.test(h))
                || encabezados.find(h => /descripci[oó]n/i.test(h));
            return { colArticulo, colDescripcion };
        }

        // Identifica una fila del Kardex (objeto plano, como lo entrega SheetJS) y devuelve
        // { clave, codigo, descripcion, tieneCodigo }.
        function identificarFilaKardex(fila, colArticulo, colDescripcion) {
            const codigo = colArticulo ? String(fila[colArticulo] || '').trim() : '';
            const descripcion = colDescripcion ? String(fila[colDescripcion] || '').trim() : '';
            if (codigo) return { clave: codigo, codigo, descripcion, tieneCodigo: true };
            return { clave: normalizarClaveDescripcion(descripcion || 'sin descripcion'), codigo: '', descripcion, tieneCodigo: false };
        }

        // Devuelve TODAS las filas de la hoja activa del Kardex ya identificadas con su clave
        // y su stock, listas para usarse en Control Diario, Exportar Stock, etc.
        function obtenerFilasKardexIdentificadas() {
            const nombreHoja = resolverNombreHojaKardex(kardexNombresHojas);
            const filas = kardexHojasData[nombreHoja];
            if (!filas || filas.length === 0) return [];
            const encabezados = Object.keys(filas[0]);
            const { colArticulo, colDescripcion } = encontrarColumnasIdentificacion(encabezados);
            const colStock = KARDEX_CONFIG.columnaStock || encabezados.find(h => /stock|saldo|cantidad|existenc/i.test(h));
            return filas.map(fila => {
                const id = identificarFilaKardex(fila, colArticulo, colDescripcion);
                const stock = parseFloat(fila[colStock]);
                return Object.assign({}, id, { stock: isNaN(stock) ? 0 : stock });
            });
        }

        // Resuelve, dentro de un ExcelJS.Worksheet ya cargado, los índices de columna de
        // ARTICULO, DESCRIPCION y STOCK (para las funciones que escriben en el Kardex).
        function resolverColumnasHojaExcel(hoja) {
            const encabezados = [];
            hoja.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                encabezados[colNumber] = (cell.value ?? '').toString().trim();
            });
            const colArticulo = encabezados.findIndex(h => h && /^art[ií]culo$/i.test(h)) > -1
                ? encabezados.findIndex(h => h && /^art[ií]culo$/i.test(h))
                : encabezados.findIndex(h => h && /art[ií]culo|c[oó]digo|sku/i.test(h));
            const colDescripcion = encabezados.findIndex(h => h && /^descripci[oó]n$/i.test(h)) > -1
                ? encabezados.findIndex(h => h && /^descripci[oó]n$/i.test(h))
                : encabezados.findIndex(h => h && /descripci[oó]n/i.test(h));
            const colStock = encabezados.findIndex(h => h && /stock|saldo|cantidad|existenc/i.test(h));
            return { colArticulo, colDescripcion, colStock, encabezados };
        }

        // Resuelve la "clave" (ARTICULO, o DESCRIPCION normalizada si no hay código) de una
        // fila de un ExcelJS.Worksheet ya cargado.
        function claveDeFilaExcel(fila, colArticulo, colDescripcion) {
            const valorCodigo = colArticulo > -1 ? String(fila.getCell(colArticulo).value || '').trim() : '';
            const valorDesc = colDescripcion > -1 ? String(fila.getCell(colDescripcion).value || '').trim() : '';
            return valorCodigo ? valorCodigo : normalizarClaveDescripcion(valorDesc || '');
        }

        // ============================================
        // ESCRITURA "AL ESTILO MANUAL" DEL KARDEX (Ingreso/Egreso rápido de stock)
        // ============================================
        // En el Kardex real, cuando llega o sale stock, NO se reemplaza el número: se le agrega
        // un término a la fórmula de la celda (ej. la celda pasa de "=120+50" a "=120+50+30").
        // Esta función replica EXACTAMENTE esa práctica: toma lo que ya haya en la celda (fórmula
        // o número suelto) y le agrega "+cantidad" (o "-cantidad" si es negativo), dejando la
        // celda como una fórmula viva con su resultado ya actualizado.
        function agregarTerminoAFormula(celda, delta) {
            const signo = delta >= 0 ? '+' : '-';
            const magnitud = Math.abs(delta);
            let formulaBase;
            let resultadoAnterior;
            if (celda.type === ExcelJS.ValueType.Formula) {
                formulaBase = celda.formula || '0';
                resultadoAnterior = parseFloat(celda.result) || 0;
            } else {
                const valorPlano = parseFloat(celda.value);
                formulaBase = isNaN(valorPlano) ? '0' : String(valorPlano);
                resultadoAnterior = isNaN(valorPlano) ? 0 : valorPlano;
            }
            const nuevoResultado = resultadoAnterior + delta;
            celda.value = { formula: `${formulaBase}${signo}${magnitud}`, result: nuevoResultado };
            return nuevoResultado;
        }

        // Para columnas "agregadas" (SALDO, TOTAL EGRESO): NO se toca el texto de la fórmula
        // (puede ser un SUM/resta que referencia otras celdas), solo se refresca su resultado
        // cacheado para que el sistema muestre el número correcto de inmediato. Si la celda no
        // tiene fórmula (es un valor suelto), simplemente se le suma/resta el delta.
        function actualizarResultadoCacheado(celda, delta) {
            if (celda.type === ExcelJS.ValueType.Formula) {
                const nuevoResultado = (parseFloat(celda.result) || 0) + delta;
                celda.value = { formula: celda.formula, result: nuevoResultado }; // misma fórmula, solo se refresca el resultado
                return nuevoResultado;
            }
            const nuevoValor = (parseFloat(celda.value) || 0) + delta;
            celda.value = nuevoValor;
            return nuevoValor;
        }

        // Config editable por si el auto-detectado de columnas no coincide exactamente con los
        // encabezados reales del Excel: escribe aquí el nombre EXACTO tal como aparece en el
        // Kardex y se usará ese en vez de la detección automática (mismo criterio que KARDEX_CONFIG).
        const KARDEX_MOVIMIENTO_CONFIG = {
            columnaIngresoSanJacinto: null, // ej: 'INGRESO CANT SJACINTO'
            columnaIngresoBellota: null,    // ej: 'INGRESO CANT BELLOTA'
            columnaFechaIngreso: null,      // ej: 'FECHA INGRESO'
            columnaTotalEgreso: null        // ej: 'TOTAL EGRESO'
        };

        // Ubica, dentro de un ExcelJS.Worksheet, las columnas usadas por Ingreso/Egreso rápido:
        // INGRESO CANT SJACINTO, INGRESO CANT BELLOTA, FECHA INGRESO, TOTAL EGRESO, y las 31
        // columnas de día (1 al 31) usadas para el egreso diario.
        function resolverColumnasMovimientoExcel(hoja) {
            const base = resolverColumnasHojaExcel(hoja);
            const encabezados = base.encabezados;

            const colIngresoSanJacinto = KARDEX_MOVIMIENTO_CONFIG.columnaIngresoSanJacinto
                ? encabezados.findIndex(h => h === KARDEX_MOVIMIENTO_CONFIG.columnaIngresoSanJacinto)
                : encabezados.findIndex(h => h && /ingreso/i.test(h) && /san\s*jacinto|s\.?\s*jacinto|sjacinto/i.test(h));

            const colIngresoBellota = KARDEX_MOVIMIENTO_CONFIG.columnaIngresoBellota
                ? encabezados.findIndex(h => h === KARDEX_MOVIMIENTO_CONFIG.columnaIngresoBellota)
                : encabezados.findIndex(h => h && /ingreso/i.test(h) && /bellota/i.test(h));

            const colFechaIngreso = KARDEX_MOVIMIENTO_CONFIG.columnaFechaIngreso
                ? encabezados.findIndex(h => h === KARDEX_MOVIMIENTO_CONFIG.columnaFechaIngreso)
                : encabezados.findIndex(h => h && /fecha/i.test(h) && /ingreso/i.test(h));

            const colTotalEgreso = KARDEX_MOVIMIENTO_CONFIG.columnaTotalEgreso
                ? encabezados.findIndex(h => h === KARDEX_MOVIMIENTO_CONFIG.columnaTotalEgreso)
                : encabezados.findIndex(h => h && /total/i.test(h) && /egreso/i.test(h));

            // Columnas de día (1 al 31): se leen los valores CRUDOS de la fila de encabezados
            // (no el texto ya convertido) porque en algunos Kardex esa columna es un número o
            // texto simple ("1".."31"), y en otros es una FECHA real de Excel (ej. 22/06/2026)
            // con formato de celda para mostrar solo el día. Se soportan ambos casos.
            const colesDias = {};
            hoja.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const valorCrudo = cell.value;
                let dia = null;
                if (valorCrudo instanceof Date) {
                    dia = valorCrudo.getDate();
                } else if (typeof valorCrudo === 'number' && valorCrudo >= 1 && valorCrudo <= 31) {
                    dia = valorCrudo;
                } else if (valorCrudo !== null && valorCrudo !== undefined) {
                    const texto = String(valorCrudo).trim();
                    if (/^\d{1,2}$/.test(texto)) {
                        dia = parseInt(texto, 10);
                    } else {
                        const m = texto.match(/(?:d[ií]a)\s*0*(\d{1,2})\b/i);
                        if (m) dia = parseInt(m[1], 10);
                    }
                }
                if (dia !== null && dia >= 1 && dia <= 31) colesDias[dia] = colNumber;
            });

            return Object.assign({}, base, { colIngresoSanJacinto, colIngresoBellota, colFechaIngreso, colTotalEgreso, colesDias });
        }

        // Formatea una fecha (yyyy-mm-dd, la que entrega un <input type="date">) como texto
        // dd/mm/aaaa, igual a como se llena a mano la columna FECHA INGRESO del Kardex.
        function formatearFechaDDMMAAAA(fechaISO) {
            const [anio, mes, dia] = fechaISO.split('-');
            return `${dia}/${mes}/${anio}`;
        }

        // ██  INGRESO DE STOCK (San Jacinto / La Bellota) — reemplaza el llenado manual  ██
        async function registrarIngresoStockKardex({ clave, marca, cantidad, fechaISO }) {
            const accessToken = await obtenerAccessTokenDropbox();

            for (let intento = 1; intento <= 5; intento++) {
                const { workbook, rev } = await descargarKardexParaEscritura(accessToken);
                const nombresHojas = workbook.worksheets.map(ws => ws.name);
                const nombreHoja = resolverNombreHojaKardex(nombresHojas);
                const hoja = workbook.getWorksheet(nombreHoja);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

                const cols = resolverColumnasMovimientoExcel(hoja);
                const colIngreso = marca === 'san_jacinto' ? cols.colIngresoSanJacinto : cols.colIngresoBellota;
                const etiquetaMarca = marca === 'san_jacinto' ? 'San Jacinto' : 'La Bellota';
                if (colIngreso < 0) throw new Error(`No se detectó la columna de ingreso de ${etiquetaMarca} en el Kardex (revisa KARDEX_MOVIMIENTO_CONFIG)`);
                if (cols.colStock < 1) throw new Error('No se detectó la columna SALDO del Kardex');

                let filaElegida = null;
                for (let f = 2; f <= hoja.rowCount; f++) {
                    const fila = hoja.getRow(f);
                    if (claveDeFilaExcel(fila, cols.colArticulo, cols.colDescripcion) === clave) { filaElegida = fila; break; }
                }
                if (!filaElegida) throw new Error('No se encontró el producto en el Kardex');

                agregarTerminoAFormula(filaElegida.getCell(colIngreso), cantidad);        // INGRESO CANT SJACINTO/BELLOTA: +cantidad
                actualizarResultadoCacheado(filaElegida.getCell(cols.colStock), cantidad); // SALDO: se refresca (+cantidad)
                if (cols.colFechaIngreso > -1) {
                    filaElegida.getCell(cols.colFechaIngreso).value = formatearFechaDDMMAAAA(fechaISO); // FECHA INGRESO
                }

                const exito = await subirKardexConCandado(accessToken, workbook, rev);
                if (exito) return;
            }
            throw new Error('No se pudo actualizar el Kardex después de varios intentos (mucha actividad simultánea)');
        }

        // ██  EGRESO DEL DÍA (columnas 1 al 31 + TOTAL EGRESO) — reemplaza el llenado manual  ██
        async function registrarEgresoStockKardex({ clave, cantidad, fechaISO }) {
            const accessToken = await obtenerAccessTokenDropbox();
            const dia = parseInt(fechaISO.split('-')[2], 10);

            for (let intento = 1; intento <= 5; intento++) {
                const { workbook, rev } = await descargarKardexParaEscritura(accessToken);
                const nombresHojas = workbook.worksheets.map(ws => ws.name);
                const nombreHoja = resolverNombreHojaKardex(nombresHojas);
                const hoja = workbook.getWorksheet(nombreHoja);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

                const cols = resolverColumnasMovimientoExcel(hoja);
                const colDia = cols.colesDias[dia];
                if (colDia === undefined) throw new Error(`No se detectó en el Kardex la columna del día ${dia}`);
                if (cols.colStock < 1) throw new Error('No se detectó la columna SALDO del Kardex');

                let filaElegida = null;
                for (let f = 2; f <= hoja.rowCount; f++) {
                    const fila = hoja.getRow(f);
                    if (claveDeFilaExcel(fila, cols.colArticulo, cols.colDescripcion) === clave) { filaElegida = fila; break; }
                }
                if (!filaElegida) throw new Error('No se encontró el producto en el Kardex');

                agregarTerminoAFormula(filaElegida.getCell(colDia), cantidad); // columna del día: +cantidad
                if (cols.colTotalEgreso > -1) actualizarResultadoCacheado(filaElegida.getCell(cols.colTotalEgreso), cantidad); // TOTAL EGRESO: se refresca
                actualizarResultadoCacheado(filaElegida.getCell(cols.colStock), -cantidad); // SALDO: se refresca (-cantidad)

                const exito = await subirKardexConCandado(accessToken, workbook, rev);
                if (exito) return;
            }
            throw new Error('No se pudo actualizar el Kardex después de varios intentos (mucha actividad simultánea)');
        }

        // Resuelve el nombre real de la hoja a usar, soportando 'ULTIMA' (dinámico), un índice fijo,
        // o un nombre de hoja puntual — a partir de una lista de nombres de hoja ya conocida.
        function resolverNombreHojaKardex(listaNombresHojas) {
            if (KARDEX_CONFIG.hoja === 'ULTIMA') return listaNombresHojas[listaNombresHojas.length - 1];
            if (typeof KARDEX_CONFIG.hoja === 'number') return listaNombresHojas[KARDEX_CONFIG.hoja];
            return KARDEX_CONFIG.hoja;
        }

        let coloresPorProducto = {};   // { "7015": [ {color:"Verde Laurel", saldo:12}, ... ], ... } — construido desde el Kardex
        let kardexColorDiagnostico = null; // { encontrada, hoja, columnasDisponibles } — para mostrar el aviso si no calza

        // ============================================
        // COLOR (texto del Kardex) → TONO VISUAL PARA LOS CÍRCULOS
        // ============================================
        // Excepciones manuales: si algún nombre de color del Kardex no se ve bien con el
        // diccionario automático de abajo, agrégalo aquí tal cual está escrito en el Excel.
        // Ejemplo: 'Verde Laurel': '#4a5f3a',
        const EXCEPCIONES_COLOR = {
            // 'Nombre exacto del Kardex': '#hexadecimal',
        };

        // Diccionario de palabras clave en español → tono base. Se busca cada palabra dentro
        // del nombre del color (sin importar mayúsculas/acentos) y se usa la primera que calce.
        const DICCIONARIO_COLORES = [
            { palabra: 'blanco', hex: '#f7fafc' },
            { palabra: 'crema', hex: '#f5e6ca' },
            { palabra: 'beige', hex: '#e8d5b7' },
            { palabra: 'hueso', hex: '#f0e6d2' },
            { palabra: 'negro', hex: '#1a1a1a' },
            { palabra: 'gris', hex: '#9ca3af' },
            { palabra: 'plata', hex: '#c0c0c0' },
            { palabra: 'plateado', hex: '#c0c0c0' },
            { palabra: 'azul', hex: '#3b82f6' },
            { palabra: 'celeste', hex: '#7dd3fc' },
            { palabra: 'turquesa', hex: '#2dd4bf' },
            { palabra: 'verde', hex: '#22c55e' },
            { palabra: 'oliva', hex: '#6b7f39' },
            { palabra: 'rojo', hex: '#ef4444' },
            { palabra: 'vino', hex: '#7f1d1d' },
            { palabra: 'guinda', hex: '#7f1d1d' },
            { palabra: 'rosado', hex: '#f472b6' },
            { palabra: 'rosa', hex: '#f472b6' },
            { palabra: 'fucsia', hex: '#d946ef' },
            { palabra: 'morado', hex: '#a855f7' },
            { palabra: 'lila', hex: '#c4b5fd' },
            { palabra: 'violeta', hex: '#8b5cf6' },
            { palabra: 'amarillo', hex: '#eab308' },
            { palabra: 'mostaza', hex: '#ca8a04' },
            { palabra: 'dorado', hex: '#d4af37' },
            { palabra: 'oro', hex: '#d4af37' },
            { palabra: 'naranja', hex: '#f97316' },
            { palabra: 'coral', hex: '#fb7185' },
            { palabra: 'marron', hex: '#78350f' },
            { palabra: 'marrón', hex: '#78350f' },
            { palabra: 'cafe', hex: '#6f4e37' },
            { palabra: 'café', hex: '#6f4e37' },
            { palabra: 'chocolate', hex: '#4a2c14' },
            { palabra: 'salmon', hex: '#fca5a5' },
            { palabra: 'salmón', hex: '#fca5a5' }
        ];

        // Convierte un color hex (#rrggbb) a más claro u oscuro según "claro"/"oscuro" en el nombre
        function ajustarIntensidad(hex, factor) {
            const num = parseInt(hex.replace('#', ''), 16);
            let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
            r = Math.min(255, Math.max(0, Math.round(r + (factor > 0 ? (255 - r) * factor : r * factor))));
            g = Math.min(255, Math.max(0, Math.round(g + (factor > 0 ? (255 - g) * factor : g * factor))));
            b = Math.min(255, Math.max(0, Math.round(b + (factor > 0 ? (255 - b) * factor : b * factor))));
            return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        }

        // Devuelve el tono visual (hex) que representa un nombre de color del Kardex
        function obtenerColorHex(nombreColor) {
            if (!nombreColor) return '#e2e8f0';
            if (EXCEPCIONES_COLOR[nombreColor]) return EXCEPCIONES_COLOR[nombreColor];

            const texto = nombreColor
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita acentos para comparar

            const encontrado = DICCIONARIO_COLORES.find(c => texto.includes(c.palabra.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
            if (!encontrado) return '#a0aec0'; // color genérico si no se reconoce ninguna palabra clave

            let hex = encontrado.hex;
            if (/\bclaro\b/.test(texto)) hex = ajustarIntensidad(hex, 0.35);
            if (/\boscuro\b/.test(texto)) hex = ajustarIntensidad(hex, -0.3);
            return hex;
        }

        // Círculos de color de SOLO LECTURA (para la lista rápida de Productos). En desktop se ve
        // el nombre al pasar el mouse (title nativo); en celular, al tocar aparece el mismo aviso
        // que ya usa el resto de la app, así funciona igual en ambos casos.
        function generarCirculosColor(codigo, tamano) {
            const colores = coloresPorProducto[codigo];
            if (!colores || colores.length === 0) return '<span style="color:#cbd5e0;font-size:0.8em;">—</span>';
            const px = tamano || 20;
            return `<div class="color-circulos">${colores.map(c => {
                const hex = obtenerColorHex(c.color);
                const agotado = c.saldo <= 0;
                const texto = `${c.color} — ${c.saldo} disponible${c.saldo === 1 ? '' : 's'}`;
                const textoEscapado = texto.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `<span class="color-circulo${agotado ? ' agotado' : ''}" style="width:${px}px;height:${px}px;background:${hex};" title="${textoEscapado}" onclick="mostrarNotificacion('${textoEscapado}', 'info')"></span>`;
            }).join('')}</div>`;
        }

        // Chips de color CLICKEABLES para el flujo de "Agregar Producto": al tocar uno, fija el
        // color elegido en el campo de texto y muestra cuánto stock real hay de ese color.
        function renderChipsColorAgregar(codigo, filtro = '') {
            const cont = document.getElementById('colorChips');
            if (!cont) return;
            const colores = coloresPorProducto[codigo];

            if (!colores || colores.length === 0) {
                // Sin colores registrados en el Kardex para este producto: se deja el campo libre
                cont.innerHTML = '<span style="font-size:0.78em;color:#a0aec0;">Sin colores registrados en el Kardex — escribe uno manualmente</span>';
                actualizarDisponibleColorSeleccionado(null);
                return;
            }

            // Filtro inteligente: a medida que escribes, solo se muestran los colores que calcen
            // (sin importar mayúsculas/acentos), igual que el buscador de productos.
            const filtroNorm = normalizarTexto(filtro.trim());
            const coloresFiltrados = filtroNorm ? colores.filter(c => normalizarTexto(c.color).includes(filtroNorm)) : colores;

            if (coloresFiltrados.length === 0) {
                cont.innerHTML = `<span style="font-size:0.78em;color:#a0aec0;">Sin colores que calcen con "${filtro}"</span>`;
                return;
            }

            cont.innerHTML = coloresFiltrados.map(c => {
                const hex = obtenerColorHex(c.color);
                const escapado = c.color.replace(/'/g, "\\'");
                return `<span class="color-circulo-chip" onclick="setColor('${escapado}')" data-color="${c.color.replace(/"/g, '&quot;')}">
                    <span class="dot" style="background:${hex};"></span>${c.color} (${c.saldo})
                </span>`;
            }).join('');
        }

        // Filtra los chips de color mientras escribes, y de paso actualiza el aviso de disponibilidad
        function filtrarChipsColorAgregar(texto) {
            if (productoSeleccionado) renderChipsColorAgregar(productoSeleccionado.codigo, texto);
            actualizarDisponibleColorSeleccionado(texto);
        }

        // Muestra "Disponible: X unidades" bajo el campo de cantidad, según el color elegido,
        // y avisa (sin bloquear) si la cantidad escrita supera lo que hay en el Kardex.
        function actualizarDisponibleColorSeleccionado(nombreColor) {
            const etiqueta = document.getElementById('disponibleColorLabel');
            if (!etiqueta) return;

            if (!productoSeleccionado || !nombreColor) {
                etiqueta.textContent = '';
                return;
            }
            const colores = coloresPorProducto[productoSeleccionado.codigo];
            const info = colores?.find(c => c.color.toLowerCase() === nombreColor.toLowerCase());
            if (!info) {
                etiqueta.textContent = '';
                return;
            }

            const cantidadPedida = parseInt(document.getElementById('inputCantidadInicial')?.value) || 0;
            const excede = cantidadPedida > info.saldo;
            etiqueta.innerHTML = excede
                ? `⚠️ Solo hay <strong>${info.saldo}</strong> disponibles de este color (estás cotizando ${cantidadPedida})`
                : `✅ Disponible: <strong>${info.saldo}</strong> unidades`;
            etiqueta.style.color = excede ? '#c05621' : '#2f855a';
        }


        let stockKardex = {};          // { "7015": 24, ... } — para los badges de stock en Productos
        let kardexHojasData = {};      // { "Hoja1": [ {col:val,...}, ... ], "Hoja2": [...] } — TODAS las hojas, TODAS las columnas
        let kardexNombresHojas = [];   // orden de las hojas tal como están en el Excel
        let kardexUltimaActualizacion = null;

        // ██████████████████████████████████████████████████████████████████████████
        // ██  DROPBOX — Descuento automático de stock en el Kardex por Orden de Compra  ██
        // ██████████████████████████████████████████████████████████████████████████
        // PASOS PARA CONECTARLO (una sola vez, lo haces tú en tu cuenta de Dropbox):
        //
        // 1. Ve a https://www.dropbox.com/developers/apps → "Create app" → elige
        //    "Scoped access" y "Full Dropbox" (o "App folder" si prefieres limitarlo).
        // 2. En la pestaña "Permissions" de esa app, activa: files.content.write,
        //    files.content.read y sharing.read (esta última solo es necesaria si vas a usar
        //    "enlaceCompartido" en vez de escribir la ruta exacta a mano). Guarda los cambios
        //    (botón "Submit" abajo de esa pestaña).
        // 3. En la pestaña "Settings" copia el "App key" y el "App secret" y pégalos en
        //    DROPBOX_CONFIG más abajo.
        // 4. Para obtener el REFRESH TOKEN (una sola vez, no caduca):
        //    a) Pega esta URL en el navegador, reemplazando TU_APP_KEY por el App key real:
        //       https://www.dropbox.com/oauth2/authorize?client_id=TU_APP_KEY&response_type=code&token_access_type=offline
        //    b) Inicia sesión con la cuenta de Dropbox donde vive el Kardex y autoriza la app.
        //       Te va a mostrar un CÓDIGO en pantalla, cópialo.
        //    c) Ejecuta este comando (reemplaza CODIGO, APP_KEY, APP_SECRET) desde una
        //       terminal, o pégalo en una web como https://reqbin.com (método POST):
        //       curl https://api.dropboxapi.com/oauth2/token -d code=CODIGO -d grant_type=authorization_code -d client_id=APP_KEY -d client_secret=APP_SECRET
        //    d) La respuesta trae un campo "refresh_token": cópialo y pégalo en DROPBOX_CONFIG.
        // 5. En "rutaArchivo" escribe la ruta exacta del Excel dentro de tu Dropbox (con "/" al
        //    inicio). La ves haciendo clic derecho sobre el archivo en dropbox.com → "Copiar ruta".
        //    Si no la tienes a mano, deja "rutaArchivo" vacío ('') y pon en "enlaceCompartido" el
        //    link de compartir (el que empieza con https://www.dropbox.com/scl/...): el código la
        //    resuelve solo la primera vez que se necesita (requiere el permiso sharing.read).
        //
        // Sobre el riesgo de que dos Órdenes de Compra se generen al mismo segundo: el código
        // de abajo usa el sistema de "candado" de Dropbox (el parámetro `rev`) para detectar si
        // alguien más escribió el archivo mientras tanto, y en ese caso vuelve a intentar con los
        // datos más recientes en vez de pisar el descuento de la otra persona (hasta 5 intentos).
        const DROPBOX_CONFIG = {
            appKey: 'qfh4gbwe1bzmx8n',
            appSecret: '8fo4y50faonp5wq',
            refreshToken: 'qg6ZvE4r5mkAAAAAAAAAAR_Co-hqZhhpFj8SkIa2-upya--AJ4NfjC_yC9Svnkwy',
            // No conocemos la ruta exacta dentro del Dropbox, pero sí el link para compartir.
            // rutaArchivo se deja vacío y se resuelve solo (una vez) a partir de enlaceCompartido.
            rutaArchivo: '',
            enlaceCompartido: 'https://www.dropbox.com/scl/fi/ypaoi32fdiu0l91l9wa8w/Kardex-Taller-2026.xlsx?rlkey=y0ywsqsa8acvlvfqniestyjd7&dl=0'
        };

        let dropboxAccessTokenCache = null; // { token, expiraEn } — se reutiliza mientras no venza
        let dropboxRutaResuelta = null;     // path_lower resuelto a partir del enlace compartido (se cachea)

        async function obtenerAccessTokenDropbox() {
            if (dropboxAccessTokenCache && Date.now() < dropboxAccessTokenCache.expiraEn) {
                return dropboxAccessTokenCache.token;
            }
            const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: DROPBOX_CONFIG.refreshToken,
                    client_id: DROPBOX_CONFIG.appKey,
                    client_secret: DROPBOX_CONFIG.appSecret
                })
            });
            if (!resp.ok) throw new Error('No se pudo autenticar con Dropbox (revisa DROPBOX_CONFIG)');
            const data = await resp.json();
            dropboxAccessTokenCache = { token: data.access_token, expiraEn: Date.now() + (data.expires_in - 60) * 1000 };
            return dropboxAccessTokenCache.token;
        }

        // Cuando no se conoce la ruta exacta del archivo dentro del Dropbox, la resolvemos una
        // sola vez a partir del link de compartición (DROPBOX_CONFIG.enlaceCompartido) usando la
        // API de Dropbox, y la dejamos en caché en memoria para no repetir la consulta.
        async function obtenerRutaArchivoKardex(accessToken) {
            if (DROPBOX_CONFIG.rutaArchivo) return DROPBOX_CONFIG.rutaArchivo;
            if (dropboxRutaResuelta) return dropboxRutaResuelta;
            if (!DROPBOX_CONFIG.enlaceCompartido) {
                throw new Error('Falta configurar rutaArchivo o enlaceCompartido en DROPBOX_CONFIG');
            }
            const resp = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: DROPBOX_CONFIG.enlaceCompartido })
            });
            if (!resp.ok) {
                const errTxt = await resp.text().catch(() => '');
                throw new Error('No se pudo resolver la ruta del Kardex desde el enlace compartido (HTTP ' + resp.status + '). ' + errTxt);
            }
            const meta = await resp.json();
            if (!meta.path_lower) {
                throw new Error('El enlace compartido no devolvió una ruta de archivo (¿es un link de carpeta?)');
            }
            dropboxRutaResuelta = meta.path_lower;
            return dropboxRutaResuelta;
        }

        // Descarga el Excel del Kardex directo desde Dropbox (con permisos de escritura) y
        // devuelve el workbook ya parseado junto con el "rev" (versión) que tenía en ese momento.
        // Se usa ExcelJS (no SheetJS) porque ExcelJS conserva colores, bordes, anchos de columna
        // y demás formato del archivo original al modificar solo algunas celdas y volver a guardar;
        // SheetJS (usado en el resto del cotizador para SOLO LEER) descarta ese formato al reescribir.
        async function descargarKardexParaEscritura(accessToken) {
            const ruta = await obtenerRutaArchivoKardex(accessToken);
            const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Dropbox-API-Arg': JSON.stringify({ path: ruta })
                }
            });
            if (!resp.ok) throw new Error('No se pudo descargar el Kardex desde Dropbox (HTTP ' + resp.status + ')');
            const metaHeader = resp.headers.get('dropbox-api-result');
            const meta = metaHeader ? JSON.parse(metaHeader) : {};
            const buffer = await resp.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            return { workbook, rev: meta.rev };
        }

        // ExcelJS a veces no logra volver a guardar un Excel que tiene "fórmulas compartidas"
        // (una fórmula que se clona hacia abajo/derecha desde una celda "maestra") y lanza
        // "Shared Formula master must exist above and or left of clone". Esto es un bug conocido
        // de ExcelJS al re-serializar ese tipo de fórmulas, y puede pasar SIN IMPORTAR qué celda
        // hayamos modificado. La solución NO es borrar las fórmulas (como se hacía antes): es
        // "desconectarlas" de ese mecanismo compartido, dejando en cada celda la MISMA fórmula
        // efectiva (ExcelJS la resuelve automáticamente) pero ya no declarada como "compartida".
        // Así Excel la sigue viendo y recalculando como una fórmula normal — no se pierde nada.
        function desconectarFormulasCompartidas(workbook) {
            workbook.eachSheet(hoja => {
                hoja.eachRow({ includeEmpty: false }, fila => {
                    fila.eachCell({ includeEmpty: false }, celda => {
                        if (celda.type === ExcelJS.ValueType.Formula) {
                            try {
                                const formulaTexto = celda.formula; // ExcelJS resuelve el texto real aunque sea una fórmula compartida
                                if (formulaTexto) {
                                    celda.value = { formula: formulaTexto, result: celda.result };
                                }
                            } catch (errorCelda) {
                                // Caso extremo: ni siquiera se puede leer la fórmula de esta celda puntual.
                                // Solo aquí, como último recurso, se deja el valor calculado (deja de ser fórmula).
                                console.warn('No se pudo preservar la fórmula de una celda, se deja su valor calculado:', errorCelda.message);
                                celda.value = (celda.result !== undefined && celda.result !== null) ? celda.result : '';
                            }
                        }
                    });
                });
            });
        }

        // Último recurso ABSOLUTO (solo si ni siquiera "desconectarFormulasCompartidas" permite
        // guardar): convierte todas las fórmulas del libro a su valor ya calculado. Se avisa
        // siempre visiblemente al usuario si esto llega a ocurrir, porque significa que el Excel
        // deja de tener fórmulas vivas en esas celdas.
        function aplanarFormulasWorkbook(workbook) {
            workbook.eachSheet(hoja => {
                hoja.eachRow({ includeEmpty: false }, fila => {
                    fila.eachCell({ includeEmpty: false }, celda => {
                        if (celda.type === ExcelJS.ValueType.Formula) {
                            celda.value = (celda.result !== undefined && celda.result !== null) ? celda.result : '';
                        }
                    });
                });
            });
        }

        // Sube el Excel modificado a Dropbox, pero SOLO si nadie más lo modificó mientras tanto
        // (usa el "rev" de la descarga como candado). Si alguien más escribió primero, Dropbox
        // rechaza la subida (409) y hay que reintentar con datos frescos.
        async function subirKardexConCandado(accessToken, workbook, revEsperada) {
            let wbout;
            try {
                wbout = await workbook.xlsx.writeBuffer(); // conserva todo el formato y TODAS las fórmulas intactas
            } catch (errorAlEscribir) {
                console.warn('No se pudo guardar el Excel con sus fórmulas tal cual, se reintenta desconectando fórmulas compartidas (sin perderlas):', errorAlEscribir.message);
                try {
                    desconectarFormulasCompartidas(workbook);
                    wbout = await workbook.xlsx.writeBuffer();
                } catch (segundoError) {
                    console.error('Tampoco se pudo guardar desconectando fórmulas compartidas; se aplanan a su valor calculado como último recurso:', segundoError.message);
                    aplanarFormulasWorkbook(workbook);
                    wbout = await workbook.xlsx.writeBuffer();
                    mostrarNotificacion('Atención: para poder guardar, algunas fórmulas del Kardex se convirtieron a su valor fijo. Revisa el archivo en Dropbox.', 'warning');
                }
            }
            const ruta = await obtenerRutaArchivoKardex(accessToken);
            const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Dropbox-API-Arg': JSON.stringify({
                        path: ruta,
                        mode: { '.tag': 'update', update: revEsperada },
                        mute: true
                    }),
                    'Content-Type': 'application/octet-stream'
                },
                body: wbout
            });
            if (resp.status === 409) return false; // alguien más escribió primero: hay que reintentar
            if (!resp.ok) throw new Error('No se pudo subir el Kardex a Dropbox (HTTP ' + resp.status + ')');
            return true;
        }

        // Ajusta el Kardex según una lista de diferencias (una Orden de Compra nueva o editada).
        // Cada item = { codigo, color, cantidad }. cantidad POSITIVA = se descuenta del stock
        // (venta/aumento); cantidad NEGATIVA = se devuelve al stock (producto quitado o reducido
        // en una edición). Modifica ÚNICAMENTE el valor numérico de la celda de stock de cada
        // producto (no reconstruye la hoja), así se conserva el diseño original (colores, orden de
        // columnas, anchos, etc.). Matchea por código+color cuando el Kardex tiene varias filas
        // (variantes) para un mismo código, para no tocar el stock del color equivocado. Reintenta
        // hasta 5 veces si detecta que alguien más modificó el archivo justo en el mismo momento.
        async function ajustarStockKardexDropbox(items) {
            if (!items.length) return;
            const accessToken = await obtenerAccessTokenDropbox();

            for (let intento = 1; intento <= 5; intento++) {
                const { workbook, rev } = await descargarKardexParaEscritura(accessToken);
                const nombresHojas = workbook.worksheets.map(ws => ws.name);
                const nombreHoja = resolverNombreHojaKardex(nombresHojas);
                const hoja = workbook.getWorksheet(nombreHoja);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

                // Encabezados de la fila 1, para ubicar las columnas de código, stock y color por su
                // texto (sin tocar ninguna celda todavía).
                const encabezados = [];
                hoja.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    encabezados[colNumber] = (cell.value ?? '').toString().trim();
                });
                const encontrarColumna = (nombreExacto, regex) => {
                    if (nombreExacto) {
                        const idx = encabezados.findIndex(h => h === nombreExacto);
                        if (idx > -1) return idx;
                    }
                    return encabezados.findIndex(h => h && regex.test(h));
                };
                const colCodigo = encontrarColumna(KARDEX_CONFIG.columnaCodigo, /c[oó]digo|articulo|sku/i);
                const colStock = encontrarColumna(KARDEX_CONFIG.columnaStock, /stock|saldo|cantidad|existenc/i);
                if (colCodigo < 1 || colStock < 1) throw new Error('No se detectaron las columnas de código/stock del Kardex');

                // Columna de color: mismo criterio (exacto, tolerante a mayúsculas/acentos/espacios)
                // que usa construirStockDesdeHojas() para mostrar el stock por color en el cotizador.
                const colColorNormalizado = normalizarTexto(KARDEX_CONFIG.columnaColor || '').replace(/\s+/g, ' ').trim();
                const colColor = colColorNormalizado
                    ? encabezados.findIndex(h => h && normalizarTexto(h).replace(/\s+/g, ' ').trim() === colColorNormalizado)
                    : -1;

                // Un mismo código puede repetirse en varias filas (una por color). Se arma un índice
                // código -> [ {fila, color} ] para no recorrer toda la hoja por cada producto y para
                // poder matchear por código+color cuando corresponda.
                const filasPorCodigo = {};
                for (let f = 2; f <= hoja.rowCount; f++) {
                    const fila = hoja.getRow(f);
                    const valorCodigo = fila.getCell(colCodigo).value;
                    if (valorCodigo === null || valorCodigo === undefined || valorCodigo === '') continue;
                    const codigo = String(valorCodigo).trim();
                    const color = colColor > -1 ? String(fila.getCell(colColor).value || '').trim() : '';
                    if (!filasPorCodigo[codigo]) filasPorCodigo[codigo] = [];
                    filasPorCodigo[codigo].push({ fila, color });
                }

                let huboCambios = false;
                const noEncontrados = [];
                items.forEach(item => {
                    const candidatas = filasPorCodigo[String(item.codigo).trim()];
                    if (!candidatas || candidatas.length === 0) { noEncontrados.push(item.codigo); return; }

                    let filaElegida = null;
                    const colorItem = String(item.color || '').trim();

                    if (candidatas.length === 1) {
                        // Solo hay una fila para este código en el Kardex: no hay ambigüedad de color.
                        filaElegida = candidatas[0].fila;
                    } else if (colColor > -1 && colorItem) {
                        // Varias filas (varios colores) para el mismo código: hay que acertar la fila
                        // correcta, si no se le descontaría el stock al color equivocado.
                        const match = candidatas.find(c => c.color.toLowerCase() === colorItem.toLowerCase());
                        filaElegida = match ? match.fila : null;
                        if (!filaElegida) {
                            console.warn(`⚠️ Kardex: el código ${item.codigo} tiene color "${colorItem}" en la cotización, pero ese color no aparece entre sus filas del Kardex (${candidatas.map(c => c.color).join(', ')}). No se descontó ese ítem.`);
                            noEncontrados.push(`${item.codigo} (color "${colorItem}")`);
                        }
                    } else {
                        // Varias filas para el mismo código pero no se puede distinguir (el producto no
                        // trae color en la cotización, o el Kardex no tiene columna de color): mejor no
                        // adivinar y avisar, en vez de descontarle a una fila al azar.
                        console.warn(`⚠️ Kardex: el código ${item.codigo} tiene ${candidatas.length} filas (colores) y no se pudo determinar cuál descontar. No se descontó ese ítem.`);
                        noEncontrados.push(`${item.codigo} (color ambiguo)`);
                    }

                    if (filaElegida) {
                        const celdaStock = filaElegida.getCell(colStock);
                        const stockActual = celdaStock.type === ExcelJS.ValueType.Formula
                            ? (parseFloat(celdaStock.result) || 0)
                            : (parseFloat(celdaStock.value) || 0);
                        const nuevoStock = Math.max(0, stockActual - item.cantidad);
                        if (celdaStock.type === ExcelJS.ValueType.Formula) {
                            celdaStock.value = { formula: celdaStock.formula, result: nuevoStock }; // misma fórmula, solo se refresca el resultado
                        } else {
                            celdaStock.value = nuevoStock;
                        }
                        huboCambios = true;
                    }
                });

                if (noEncontrados.length > 0) {
                    mostrarNotificacion(`No se pudo ajustar en el Kardex: ${noEncontrados.join(', ')}`, 'warning');
                }

                if (!huboCambios) return; // ningún producto de la orden pudo descontarse, nada que subir

                const exito = await subirKardexConCandado(accessToken, workbook, rev);
                if (exito) return; // listo
                // si no tuvo éxito, se repite el ciclo: se vuelve a descargar la versión más reciente
            }
            throw new Error('No se pudo actualizar el Kardex después de varios intentos (mucha actividad simultánea)');
        }

        // ██  DROPBOX — Descuento directo de stock por CLAVE (Control Diario)  ██
        // ██████████████████████████████████████████████████████████████████████████
        // Igual que ajustarStockKardexDropbox(), pero matchea por la CLAVE de identificación
        // (código ARTICULO, o texto de DESCRIPCION normalizado cuando no hay código) en vez de
        // por código+color. Se usa desde el Control Diario, que puede descartar productos que
        // en el Kardex no tienen código y solo se distinguen por su descripción.
        // items = [{ clave, codigo, descripcion, cantidad }], cantidad SIEMPRE se descuenta del stock.
        async function ajustarStockKardexPorClave(items) {
            if (!items.length) return;
            const accessToken = await obtenerAccessTokenDropbox();

            for (let intento = 1; intento <= 5; intento++) {
                const { workbook, rev } = await descargarKardexParaEscritura(accessToken);
                const nombresHojas = workbook.worksheets.map(ws => ws.name);
                const nombreHoja = resolverNombreHojaKardex(nombresHojas);
                const hoja = workbook.getWorksheet(nombreHoja);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

                const { colArticulo, colDescripcion, colStock } = resolverColumnasHojaExcel(hoja);
                if (colStock < 1) throw new Error('No se detectó la columna de stock del Kardex');

                let huboCambios = false;
                const noEncontrados = [];
                items.forEach(item => {
                    let filaElegida = null;
                    for (let f = 2; f <= hoja.rowCount; f++) {
                        const fila = hoja.getRow(f);
                        if (claveDeFilaExcel(fila, colArticulo, colDescripcion) === item.clave) { filaElegida = fila; break; }
                    }
                    if (!filaElegida) { noEncontrados.push(item.descripcion || item.codigo || item.clave); return; }
                    const celdaStock = filaElegida.getCell(colStock);
                    const stockActual = celdaStock.type === ExcelJS.ValueType.Formula
                        ? (parseFloat(celdaStock.result) || 0)
                        : (parseFloat(celdaStock.value) || 0);
                    const nuevoStock = Math.max(0, stockActual - item.cantidad);
                    if (celdaStock.type === ExcelJS.ValueType.Formula) {
                        celdaStock.value = { formula: celdaStock.formula, result: nuevoStock }; // misma fórmula, solo se refresca el resultado
                    } else {
                        celdaStock.value = nuevoStock;
                    }
                    huboCambios = true;
                });

                if (noEncontrados.length > 0) {
                    mostrarNotificacion(`No se encontró en el Kardex: ${noEncontrados.join(', ')}`, 'warning');
                }
                if (!huboCambios) return;

                const exito = await subirKardexConCandado(accessToken, workbook, rev);
                if (exito) return;
            }
            throw new Error('No se pudo actualizar el Kardex después de varios intentos (mucha actividad simultánea)');
        }

        // ██  DROPBOX — Edición manual del Kardex (valores absolutos, protegida por contraseña)  ██
        // ██████████████████████████████████████████████████████████████████████████
        // cambiosPorClave = { clave: nuevoValorDeStock, ... }. A diferencia de las dos funciones
        // de arriba (que RESTAN una cantidad), esta REEMPLAZA el valor de stock tal cual lo dejó
        // la persona en el modo de edición del Kardex (botón "🔒 Editar Kardex").
        async function aplicarValoresAbsolutosKardex(cambiosPorClave) {
            const claves = Object.keys(cambiosPorClave);
            if (claves.length === 0) return;
            const accessToken = await obtenerAccessTokenDropbox();

            for (let intento = 1; intento <= 5; intento++) {
                const { workbook, rev } = await descargarKardexParaEscritura(accessToken);
                const nombresHojas = workbook.worksheets.map(ws => ws.name);
                const nombreHoja = resolverNombreHojaKardex(nombresHojas);
                const hoja = workbook.getWorksheet(nombreHoja);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada en KARDEX_CONFIG');

                const { colArticulo, colDescripcion, colStock } = resolverColumnasHojaExcel(hoja);
                if (colStock < 1) throw new Error('No se detectó la columna de stock del Kardex');

                let huboCambios = false;
                for (let f = 2; f <= hoja.rowCount; f++) {
                    const fila = hoja.getRow(f);
                    const clave = claveDeFilaExcel(fila, colArticulo, colDescripcion);
                    if (Object.prototype.hasOwnProperty.call(cambiosPorClave, clave)) {
                        fila.getCell(colStock).value = cambiosPorClave[clave];
                        huboCambios = true;
                    }
                }
                if (!huboCambios) return;

                const exito = await subirKardexConCandado(accessToken, workbook, rev);
                if (exito) return;
            }
            throw new Error('No se pudo actualizar el Kardex después de varios intentos (mucha actividad simultánea)');
        }

        // Compara lo que ya se había descontado del Kardex la última vez (anteriores) contra lo que
        // hay AHORA en la tabla (actuales), y devuelve solo las diferencias por código+color:
        //   - producto nuevo o cantidad aumentada  -> diferencia positiva (hay que descontar más)
        //   - cantidad reducida o producto quitado -> diferencia negativa (hay que devolver stock)
        //   - sin cambios -> no aparece en el resultado
        // Así, al editar una Orden de Compra ya guardada, solo se toca el Kardex por lo que
        // realmente cambió — no se vuelve a descontar lo que ya estaba.
        function calcularDiferenciaProductos(anteriores, actuales) {
            // Los productos creados sobre la marcha desde el buscador (código "NP-####") quedan
            // exentos de Kardex por defecto — normalmente son pedidos especiales sin stock físico
            // previo en el almacén, así que no tiene sentido descontarlos/devolverlos del inventario.
            const sinExentos = lista => (lista || []).filter(p => !p.sinKardex);
            anteriores = sinExentos(anteriores);
            actuales = sinExentos(actuales);

            const clave = p => `${String(p.codigo).trim()}||${String(p.color || '').trim().toLowerCase()}`;

            const sumarPorClave = (lista) => {
                const mapa = {};
                (lista || []).forEach(p => {
                    const k = clave(p);
                    mapa[k] = (mapa[k] || 0) + (parseFloat(p.cantidad) || 0);
                });
                return mapa;
            };

            const mapaAnt = sumarPorClave(anteriores);
            const mapaAct = sumarPorClave(actuales);
            const todasLasClaves = new Set([...Object.keys(mapaAnt), ...Object.keys(mapaAct)]);

            const deltas = [];
            todasLasClaves.forEach(k => {
                const diferencia = (mapaAct[k] || 0) - (mapaAnt[k] || 0);
                if (diferencia === 0) return;
                const origen = (actuales || []).find(p => clave(p) === k) || (anteriores || []).find(p => clave(p) === k);
                deltas.push({ codigo: origen.codigo, color: origen.color || '', cantidad: diferencia });
            });
            return deltas;
        }

        async function cargarKardex(mostrarAviso = true) {
            const btn = document.getElementById('btnActualizarStock');
            try {
                if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualizando...'; }

                const resp = await fetch(KARDEX_CONFIG.url);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const buffer = await resp.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });

                // Parsear TODAS las hojas con TODAS sus columnas
                kardexNombresHojas = workbook.SheetNames;
                kardexHojasData = {};
                kardexNombresHojas.forEach(nombre => {
                    kardexHojasData[nombre] = XLSX.utils.sheet_to_json(workbook.Sheets[nombre], { defval: '' });
                });

                // Construir el mapa de stock (para los badges) desde la hoja configurada en KARDEX_CONFIG
                construirStockDesdeHojas();

                kardexUltimaActualizacion = new Date();
                localStorage.setItem('kardexCache', JSON.stringify({
                    hojasData: kardexHojasData,
                    nombresHojas: kardexNombresHojas,
                    stock: stockKardex,
                    fecha: kardexUltimaActualizacion.toISOString()
                }));

                renderProductList();
                renderProductosVistaRapida();
                poblarSelectorHojas();
                renderKardexTabCompleta();
                actualizarEtiquetaStockHeader();
                actualizarAvisoColorKardex();
                if (mostrarAviso) mostrarNotificacion(`Kardex actualizado (${kardexNombresHojas.length} hojas)`, 'success');
            } catch (e) {
                console.error('Error al cargar Kardex:', e);
                if (mostrarAviso) mostrarNotificacion('No se pudo actualizar el Kardex: ' + e.message, 'warning');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar desde Dropbox'; }
            }
        }

        // Arma stockKardex (código -> cantidad) a partir de la hoja/columnas configuradas en KARDEX_CONFIG
        function construirStockDesdeHojas() {
            const nombreHoja = resolverNombreHojaKardex(kardexNombresHojas);
            const filas = kardexHojasData[nombreHoja];
            if (!filas || filas.length === 0) { stockKardex = {}; coloresPorProducto = {}; return; }

            const encabezados = Object.keys(filas[0]);
            const colCodigo = KARDEX_CONFIG.columnaCodigo || encabezados.find(h => /c[oó]digo|sku|item|art[ií]culo/i.test(h));
            const colStock = KARDEX_CONFIG.columnaStock || encabezados.find(h => /stock|saldo|cantidad|existenc/i.test(h));

            // Coincidencia tolerante (sin importar mayúsculas, acentos ni espacios de más) para no
            // fallar en silencio por una diferencia mínima de formato entre el Excel y la config.
            const colColorNormalizado = normalizarTexto(KARDEX_CONFIG.columnaColor || '').replace(/\s+/g, ' ').trim();
            const colColor = colColorNormalizado
                ? encabezados.find(h => normalizarTexto(h).replace(/\s+/g, ' ').trim() === colColorNormalizado)
                : null;

            if (KARDEX_CONFIG.columnaColor && !colColor) {
                console.warn(
                    `⚠️ No se encontró la columna de color "${KARDEX_CONFIG.columnaColor}" en la hoja "${nombreHoja}".\n` +
                    `Columnas encontradas en esa hoja: ${encabezados.join(' | ')}\n` +
                    `Revisa: (1) que el nombre en KARDEX_CONFIG.columnaColor esté escrito exactamente igual, ` +
                    `y (2) que estés usando la hoja correcta en KARDEX_CONFIG.hoja (hoja actual: "${nombreHoja}").`
                );
                kardexColorDiagnostico = { encontrada: false, hoja: nombreHoja, columnasDisponibles: encabezados };
            } else {
                kardexColorDiagnostico = { encontrada: true, hoja: nombreHoja, columnasDisponibles: encabezados };
            }

            if (!colCodigo || !colStock) { stockKardex = {}; coloresPorProducto = {}; return; }

            // Un mismo código puede aparecer varias veces (una fila por color); se SUMA el stock
            // de todas sus filas para el total del producto, y se arma además el detalle por color.
            const nuevoStock = {};
            const nuevoColores = {};
            filas.forEach(fila => {
                const codigo = String(fila[colCodigo]).trim();
                if (!codigo) return;
                const cantidad = parseFloat(fila[colStock]);
                const cantidadValida = isNaN(cantidad) ? 0 : cantidad;

                nuevoStock[codigo] = (nuevoStock[codigo] || 0) + cantidadValida;

                if (colColor) {
                    const nombreColor = String(fila[colColor] || '').trim();
                    if (nombreColor) {
                        if (!nuevoColores[codigo]) nuevoColores[codigo] = [];
                        const existente = nuevoColores[codigo].find(c => c.color.toLowerCase() === nombreColor.toLowerCase());
                        if (existente) {
                            existente.saldo += cantidadValida; // mismo código+color repetido: se suma
                        } else {
                            nuevoColores[codigo].push({ color: nombreColor, saldo: cantidadValida });
                        }
                    }
                }
            });
            stockKardex = nuevoStock;
            coloresPorProducto = nuevoColores;
        }

        function cargarKardexDesdeCache() {
            try {
                const cache = localStorage.getItem('kardexCache');
                if (cache) {
                    const data = JSON.parse(cache);
                    kardexHojasData = data.hojasData || {};
                    kardexNombresHojas = data.nombresHojas || [];
                    stockKardex = data.stock || {};
                    kardexUltimaActualizacion = data.fecha ? new Date(data.fecha) : null;
                    construirStockDesdeHojas(); // también arma coloresPorProducto a partir de los datos cacheados
                    actualizarEtiquetaStockHeader();
                    actualizarAvisoColorKardex();
                    poblarSelectorHojas();
                }
            } catch (e) { console.error('Error al leer cache de Kardex:', e); }
        }

        function actualizarEtiquetaStockHeader() {
            const el = document.getElementById('kardexUltimaActualizacion');
            if (el && kardexUltimaActualizacion) {
                el.textContent = `Última actualización: ${kardexUltimaActualizacion.toLocaleString('es-PE')}`;
            }
        }

        // Muestra un aviso visible (sin necesidad de abrir la consola) si la columna de color
        // configurada no se encontró en la hoja del Kardex que se está usando.
        function actualizarAvisoColorKardex() {
            const el = document.getElementById('kardexColorWarning');
            if (!el) return;
            if (!kardexColorDiagnostico || kardexColorDiagnostico.encontrada) {
                el.style.display = 'none';
                return;
            }
            el.style.display = 'block';
            el.innerHTML = `⚠️ No se encontró la columna de color <strong>"${KARDEX_CONFIG.columnaColor}"</strong> en la hoja "<strong>${kardexColorDiagnostico.hoja}</strong>".<br>
                Columnas disponibles ahí: ${kardexColorDiagnostico.columnasDisponibles.join(' · ')}`;
        }

        // Devuelve la cantidad en stock del producto, o null si el código no está en el Kardex
        function obtenerStock(codigo) {
            return stockKardex.hasOwnProperty(codigo) ? stockKardex[codigo] : null;
        }

        // Llena el selector de hojas y recupera la hoja que el usuario tenía elegida (localStorage)
        function poblarSelectorHojas() {
            const select = document.getElementById('kardexHojaSelect');
            if (!select) return;
            if (kardexNombresHojas.length === 0) {
                select.innerHTML = '<option value="">Sin datos aún</option>';
                return;
            }
            const guardada = localStorage.getItem('kardexHojaSeleccionada');
            const hojaActual = kardexNombresHojas.includes(guardada) ? guardada : kardexNombresHojas[0];

            select.innerHTML = kardexNombresHojas.map(h => `<option value="${h}" ${h === hojaActual ? 'selected' : ''}>${h}</option>`).join('');
        }

        // Se ejecuta cuando el usuario cambia de hoja en el selector — guarda su elección
        function cambiarHojaKardex() {
            const select = document.getElementById('kardexHojaSelect');
            if (!select || !select.value) return;
            localStorage.setItem('kardexHojaSeleccionada', select.value);
            renderKardexTabCompleta();
        }

        // Renderiza la tabla completa (todas las columnas) de la hoja seleccionada
        // Escapa comillas dobles para poder meter texto libre (código o descripción) dentro
        // de un atributo HTML (data-clave="...") sin romper el marcado.
        function escaparAtributo(texto) {
            return String(texto || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        }

        function renderKardexTabCompleta() {
            const thead = document.getElementById('kardexTableHead');
            const tbody = document.getElementById('kardexListBody');
            if (!thead || !tbody) return;

            const select = document.getElementById('kardexHojaSelect');
            const hoja = select ? select.value : null;
            const filas = hoja ? (kardexHojasData[hoja] || []) : [];

            if (filas.length === 0) {
                thead.innerHTML = '';
                document.getElementById('kardexCount').textContent = 0;
                tbody.innerHTML = `<tr><td style="text-align:center;color:#a0aec0;padding:20px;">${kardexNombresHojas.length === 0 ? 'Sin datos aún. Presiona "Actualizar desde Dropbox".' : 'Esta hoja no tiene filas de datos.'}</td></tr>`;
                renderIdentificacionSinCodigo();
                return;
            }

            const columnas = Object.keys(filas[0]);
            thead.innerHTML = columnas.map(c => `<th>${c}</th>`).join('');

const filtro = (document.getElementById('kardexSearchInput')?.value || '').toLowerCase().trim();
const palabras = filtro.split(/\s+/).filter(Boolean);
const filtradas = palabras.length === 0 ? filas : filas.filter(fila =>
    palabras.every(palabra => columnas.some(c => String(fila[c]).toLowerCase().includes(palabra)))
);

            document.getElementById('kardexCount').textContent = filtradas.length;

            if (filtradas.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${columnas.length}" style="text-align:center;color:#a0aec0;padding:20px;">Sin resultados para tu búsqueda.</td></tr>`;
                renderIdentificacionSinCodigo();
                return;
            }

            // Modo edición (desbloqueado con contraseña, ver abrirModalEditarKardex): la columna
            // de stock se pinta como un input editable en vez de texto plano.
            const { colArticulo, colDescripcion } = encontrarColumnasIdentificacion(columnas);
            const colStockNombre = KARDEX_CONFIG.columnaStock || columnas.find(h => /stock|saldo|cantidad|existenc/i.test(h));

            tbody.innerHTML = filtradas.map(fila => {
                const id = identificarFilaKardex(fila, colArticulo, colDescripcion);
                return `<tr>${columnas.map(c => {
                    if (kardexEdicionActiva && c === colStockNombre) {
                        const valorActual = Object.prototype.hasOwnProperty.call(kardexCambiosPendientes, id.clave)
                            ? kardexCambiosPendientes[id.clave]
                            : (fila[c] === '' ? 0 : fila[c]);
                        return `<td><input type="number" step="0.01" class="kardex-edit-input" data-clave="${escaparAtributo(id.clave)}" value="${valorActual}" style="width:90px;padding:4px 6px;border:1.5px solid #805ad5;border-radius:6px;" onchange="marcarCambioKardex(this)"></td>`;
                    }
                    return `<td>${fila[c] === '' ? '' : fila[c]}</td>`;
                }).join('')}</tr>`;
            }).join('');

            renderIdentificacionSinCodigo();
        }

        // ============================================
        // PANEL: IDENTIFICACIÓN DE PRODUCTOS SIN CÓDIGO (dentro de la pestaña Kardex)
        // ============================================
        function toggleIdentificacionPanel() {
            const body = document.getElementById('identificacionPanelBody');
            const icon = document.getElementById('identificacionToggleIcon');
            if (!body || !icon) return;
            const abrir = body.style.display === 'none';
            body.style.display = abrir ? 'block' : 'none';
            icon.textContent = abrir ? '▲' : '▼';
            if (abrir) renderIdentificacionSinCodigo();
        }

        function renderIdentificacionSinCodigo() {
            const tbody = document.getElementById('identificacionBody');
            const countEl = document.getElementById('kardexSinCodigoCount');
            if (!tbody || !countEl) return;
            const sinCodigo = obtenerFilasKardexIdentificadas().filter(f => !f.tieneCodigo);
            countEl.textContent = sinCodigo.length;
            if (sinCodigo.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#a0aec0;padding:12px;">Todas las filas de esta hoja tienen código en ARTICULO.</td></tr>';
                return;
            }
            tbody.innerHTML = sinCodigo.map(f => `
                <tr><td>${f.descripcion || '(sin descripción)'}</td><td>${f.stock}</td><td style="font-family:monospace;font-size:0.78em;color:#718096;">${f.clave}</td></tr>
            `).join('');
        }

        // ============================================
        // EDICIÓN MANUAL DEL KARDEX (protegida por contraseña)
        // ============================================
        let kardexEdicionActiva = false;
        let kardexCambiosPendientes = {}; // { clave: nuevoValorDeStock, ... }

        function abrirModalEditarKardex() {
            const input = document.getElementById('kardexPasswordInput');
            if (input) input.value = '';
            document.getElementById('kardexPasswordModal').classList.add('active');
        }

        function cerrarModalEditarKardex() {
            document.getElementById('kardexPasswordModal').classList.remove('active');
        }

        function confirmarPasswordEditarKardex() {
            const pass = document.getElementById('kardexPasswordInput').value;
            if (pass !== KARDEX_EDIT_CONFIG.password) {
                mostrarNotificacion('Contraseña incorrecta', 'warning');
                return;
            }
            cerrarModalEditarKardex();
            kardexEdicionActiva = true;
            kardexCambiosPendientes = {};
            document.getElementById('btnEditarKardex').style.display = 'none';
            document.getElementById('btnGuardarEdicionKardex').style.display = 'inline-block';
            document.getElementById('btnCancelarEdicionKardex').style.display = 'inline-block';
            document.getElementById('kardexEdicionAviso').style.display = 'block';
            mostrarNotificacion('Modo edición activado', 'success');
            renderKardexTabCompleta();
        }

        function marcarCambioKardex(input) {
            const clave = input.getAttribute('data-clave');
            kardexCambiosPendientes[clave] = parseFloat(input.value) || 0;
        }

        async function guardarEdicionKardex() {
            const claves = Object.keys(kardexCambiosPendientes);
            if (claves.length === 0) { mostrarNotificacion('No hay cambios para guardar', 'warning'); return; }
            if (!confirm(`¿Confirmas guardar ${claves.length} cambio(s) de stock directamente en el Kardex de Dropbox?`)) return;

            const btn = document.getElementById('btnGuardarEdicionKardex');
            try {
                btn.disabled = true; btn.textContent = '⏳ Guardando...';
                await aplicarValoresAbsolutosKardex(kardexCambiosPendientes);
                kardexCambiosPendientes = {};
                kardexEdicionActiva = false;
                document.getElementById('btnGuardarEdicionKardex').style.display = 'none';
                document.getElementById('btnCancelarEdicionKardex').style.display = 'none';
                document.getElementById('btnEditarKardex').style.display = 'inline-block';
                document.getElementById('kardexEdicionAviso').style.display = 'none';
                await cargarKardex(false);
                mostrarNotificacion('Kardex actualizado en Dropbox', 'success');
            } catch (e) {
                console.error('Error al guardar edición de Kardex:', e);
                mostrarNotificacion('No se pudo guardar: ' + e.message, 'warning');
            } finally {
                btn.disabled = false; btn.textContent = '💾 Guardar cambios';
            }
        }

        function cancelarEdicionKardex() {
            kardexCambiosPendientes = {};
            kardexEdicionActiva = false;
            document.getElementById('btnGuardarEdicionKardex').style.display = 'none';
            document.getElementById('btnCancelarEdicionKardex').style.display = 'none';
            document.getElementById('btnEditarKardex').style.display = 'inline-block';
            document.getElementById('kardexEdicionAviso').style.display = 'none';
            renderKardexTabCompleta();
        }

        // ============================================
        // EXPORTAR STOCK DEL KARDEX (San Jacinto / La Bellota / Telas / Todo)
        // ============================================
        const GRUPOS_EXPORT_STOCK = {
            san_jacinto: ['7041', '7042', '7043', '7015', '7016', '7018', '7066', '7067', '7068'],
            la_bellota: ['la bellota', 'bellota'],
            telas: ['tela', 'telas']
        };

        function abrirModalExportarStock() {
            document.getElementById('exportStockModal').classList.add('active');
        }

        function cerrarModalExportarStock() {
            document.getElementById('exportStockModal').classList.remove('active');
        }

        function exportarStockKardex() {
            const grupo = document.getElementById('exportStockGrupo').value;
            const filas = obtenerFilasKardexIdentificadas();

            let filtradas = filas;
            if (grupo !== 'todo') {
                const palabrasClave = GRUPOS_EXPORT_STOCK[grupo] || [];
                filtradas = filas.filter(f => {
                    const texto = normalizarTexto((f.codigo || '') + ' ' + (f.descripcion || ''));
                    return palabrasClave.some(p => texto.includes(normalizarTexto(p)));
                });
            }

            if (filtradas.length === 0) {
                mostrarNotificacion('No se encontraron productos de ese grupo en la hoja actual del Kardex', 'warning');
                return;
            }

            const datos = filtradas.map(f => ({
                'Código': f.codigo || '(sin código)',
                'Descripción': f.descripcion || '',
                'Stock actual': f.stock
            }));
            const ws = XLSX.utils.json_to_sheet(datos);
            const wb = XLSX.utils.book_new();
            const nombreHojaSanitizado = (resolverNombreHojaKardex(kardexNombresHojas) || 'Stock').replace(/[\\/*?:\[\]]/g, '_').substring(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, nombreHojaSanitizado);

            const etiquetaGrupo = { todo: 'Todo', san_jacinto: 'San_Jacinto', la_bellota: 'La_Bellota', telas: 'Telas' }[grupo] || grupo;
            XLSX.writeFile(wb, `Stock_${etiquetaGrupo}_${new Date().toISOString().slice(0, 10)}.xlsx`);

            cerrarModalExportarStock();
            mostrarNotificacion(`Se exportaron ${filtradas.length} producto(s)`, 'success');
        }

        // ============================================
        // CONTROL DIARIO (descarte directo de stock en el Kardex + consulta de movimientos)
        // ============================================
        let cdMatchesActuales = [];
        let cdProductoSeleccionado = null;

        function buscarProductosControlDiario(query) {
            const dropdown = document.getElementById('cdBuscarDropdown');
            if (!dropdown) return;
            const q = normalizarTexto(query || '').trim();
            if (q.length < 2) { dropdown.classList.remove('visible'); return; }

            cdMatchesActuales = obtenerFilasKardexIdentificadas().filter(f =>
                normalizarTexto(f.codigo).includes(q) || normalizarTexto(f.descripcion).includes(q)
            ).slice(0, 8);

            if (cdMatchesActuales.length === 0) {
                dropdown.innerHTML = '<div style="padding:10px;color:#a0aec0;">Sin resultados en la hoja actual del Kardex</div>';
                dropdown.classList.add('visible');
                return;
            }

            dropdown.innerHTML = cdMatchesActuales.map((m, i) => `
                <div class="cliente-db-item" onclick="seleccionarProductoControlDiario(${i})">
                    <div class="cliente-db-item-name">${m.codigo ? m.codigo + ' — ' : ''}${m.descripcion || '(sin descripción)'}</div>
                    <div class="cliente-db-item-sub">Stock actual: ${m.stock}${m.tieneCodigo ? '' : ' · sin código (vinculado por descripción)'}</div>
                </div>
            `).join('');
            dropdown.classList.add('visible');
        }

        function seleccionarProductoControlDiario(i) {
            const m = cdMatchesActuales[i];
            if (!m) return;
            cdProductoSeleccionado = m;
            document.getElementById('cdBuscarProducto').value = (m.codigo ? m.codigo + ' — ' : '') + (m.descripcion || '');
            document.getElementById('cdBuscarDropdown').classList.remove('visible');
            document.getElementById('cdProductoStockActual').textContent = `📦 Stock actual en Kardex: ${m.stock}${m.tieneCodigo ? '' : ' (producto sin código, vinculado por descripción)'}`;
            document.getElementById('cdProductoInfo').style.display = 'block';
        }

        // Cerrar el dropdown de Control Diario al hacer click fuera
        document.addEventListener('click', function(e) {
            const dropdown = document.getElementById('cdBuscarDropdown');
            const input = document.getElementById('cdBuscarProducto');
            if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
                dropdown.classList.remove('visible');
            }
        });

        async function registrarControlDiario() {
            if (!cdProductoSeleccionado) { mostrarNotificacion('Busca y selecciona un producto del Kardex primero', 'warning'); return; }
            const cantidad = parseFloat(document.getElementById('cdCantidad').value);
            if (!cantidad || cantidad <= 0) { mostrarNotificacion('Ingresa una cantidad válida a descartar', 'warning'); return; }
            const motivo = document.getElementById('cdMotivo').value.trim();

            const etiquetaProducto = cdProductoSeleccionado.descripcion || cdProductoSeleccionado.codigo;
            if (!confirm(`¿Confirmas descartar ${cantidad} und. de "${etiquetaProducto}"?\n\nEsto descuenta el stock directamente en el Kardex, igual que una Orden de Compra.`)) return;

            const btn = document.getElementById('btnRegistrarControlDiario');
            try {
                btn.disabled = true; btn.textContent = '⏳ Descontando en el Kardex...';

                await ajustarStockKardexPorClave([{
                    clave: cdProductoSeleccionado.clave,
                    codigo: cdProductoSeleccionado.codigo,
                    descripcion: cdProductoSeleccionado.descripcion,
                    cantidad
                }]);
                cargarKardex(false); // refresca los badges de stock con el nuevo saldo

                const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTROL_DIARIO}`, {
                    method: 'POST',
                    headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                    body: JSON.stringify({
                        clave: cdProductoSeleccionado.clave,
                        codigo: cdProductoSeleccionado.codigo || '',
                        descripcion: cdProductoSeleccionado.descripcion || '',
                        cantidad,
                        motivo: motivo || '',
                        usuario: usuarioActual?.username || '',
                        usuarioNombre: usuarioActual?.nombre || '',
                        activo: true
                    })
                });
                if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }

                mostrarNotificacion('Descarte registrado y stock actualizado en el Kardex', 'success');
                document.getElementById('cdCantidad').value = '';
                document.getElementById('cdMotivo').value = '';
                document.getElementById('cdBuscarProducto').value = '';
                document.getElementById('cdProductoInfo').style.display = 'none';
                cdProductoSeleccionado = null;
                cargarMovimientosControlDiario();
            } catch (e) {
                console.error('Error al registrar Control Diario:', e);
                mostrarNotificacion('No se pudo registrar el descarte: ' + e.message, 'warning');
            } finally {
                btn.disabled = false; btn.textContent = '📉 Registrar Descarte';
            }
        }

        let controlDiarioCache = [];

        // Trae del Back4App los movimientos de Control Diario: los usuarios 'master' ven los de
        // TODOS los usuarios; el resto (incluida la categoría 'control_diario') solo ve los suyos.
        async function cargarMovimientosControlDiario() {
            const tbody = document.getElementById('cdMovimientosBody');
            if (!tbody) return;
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:16px;">⏳ Cargando movimientos...</td></tr>`;

            try {
                const desde = document.getElementById('cdFiltroDesde')?.value;
                const hasta = document.getElementById('cdFiltroHasta')?.value;
                const where = { activo: true };
                if (usuarioActual?.nivel !== 'master') where.usuario = usuarioActual?.username || '';
                if (desde) where.createdAt = Object.assign({}, where.createdAt, { $gte: { __type: 'Date', iso: new Date(desde + 'T00:00:00').toISOString() } });
                if (hasta) where.createdAt = Object.assign({}, where.createdAt, { $lte: { __type: 'Date', iso: new Date(hasta + 'T23:59:59').toISOString() } });

                const url = `${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CONTROL_DIARIO}?where=${encodeURIComponent(JSON.stringify(where))}&order=-createdAt&limit=300`;
                const resp = await fetch(url, { headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }) });
                if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + resp.status); }
                const data = await resp.json();
                controlDiarioCache = data.results || [];
                pintarMovimientosControlDiario();
            } catch (e) {
                console.error('Error al cargar movimientos de Control Diario:', e);
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f56565;padding:16px;">⚠️ ${e.message}</td></tr>`;
            }
        }

        function pintarMovimientosControlDiario() {
            const tbody = document.getElementById('cdMovimientosBody');
            if (!tbody) return;
            const filtro = normalizarTexto((document.getElementById('cdFiltroTexto')?.value || '').trim());
            const lista = filtro
                ? controlDiarioCache.filter(m =>
                    normalizarTexto(m.codigo || '').includes(filtro) ||
                    normalizarTexto(m.descripcion || '').includes(filtro) ||
                    normalizarTexto(m.usuarioNombre || m.usuario || '').includes(filtro))
                : controlDiarioCache;

            if (lista.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:16px;">Sin movimientos registrados.</td></tr>`;
                return;
            }

            tbody.innerHTML = lista.map(m => `
                <tr>
                    <td>${new Date(m.createdAt).toLocaleString('es-PE')}</td>
                    <td>${m.codigo ? m.codigo + ' — ' : ''}${m.descripcion || ''}</td>
                    <td style="text-align:center;font-weight:700;color:#c53030;">-${m.cantidad}</td>
                    <td>${m.motivo || '—'}</td>
                    <td>${m.usuarioNombre || m.usuario || '—'}</td>
                </tr>
            `).join('');
        }

        // ============================================
        // INGRESO / EGRESO RÁPIDO DE STOCK (reemplaza el llenado manual del Excel)
        // ============================================
        function inicializarFechasMovimientoStock() {
            const hoyISO = new Date().toISOString().slice(0, 10);
            const ingFecha = document.getElementById('ingFecha');
            const egrFecha = document.getElementById('egrFecha');
            if (ingFecha && !ingFecha.value) ingFecha.value = hoyISO;
            if (egrFecha && !egrFecha.value) egrFecha.value = hoyISO;
        }

        // --- Ingreso ---
        let ingMatchesActuales = [];
        let ingProductoSeleccionado = null;

        function buscarProductosIngreso(query) {
            const dropdown = document.getElementById('ingBuscarDropdown');
            if (!dropdown) return;
            const q = normalizarTexto(query || '').trim();
            if (q.length < 2) { dropdown.classList.remove('visible'); return; }

            ingMatchesActuales = obtenerFilasKardexIdentificadas().filter(f =>
                normalizarTexto(f.codigo).includes(q) || normalizarTexto(f.descripcion).includes(q)
            ).slice(0, 8);

            if (ingMatchesActuales.length === 0) {
                dropdown.innerHTML = '<div style="padding:10px;color:#a0aec0;">Sin resultados en la hoja actual del Kardex</div>';
                dropdown.classList.add('visible');
                return;
            }
            dropdown.innerHTML = ingMatchesActuales.map((m, i) => `
                <div class="cliente-db-item" onclick="seleccionarProductoIngreso(${i})">
                    <div class="cliente-db-item-name">${m.codigo ? m.codigo + ' — ' : ''}${m.descripcion || '(sin descripción)'}</div>
                    <div class="cliente-db-item-sub">Stock actual: ${m.stock}${m.tieneCodigo ? '' : ' · sin código (vinculado por descripción)'}</div>
                </div>
            `).join('');
            dropdown.classList.add('visible');
        }

        function seleccionarProductoIngreso(i) {
            const m = ingMatchesActuales[i];
            if (!m) return;
            ingProductoSeleccionado = m;
            document.getElementById('ingBuscarProducto').value = (m.codigo ? m.codigo + ' — ' : '') + (m.descripcion || '');
            document.getElementById('ingBuscarDropdown').classList.remove('visible');
            document.getElementById('ingProductoStockActual').textContent = `📦 SALDO actual en Kardex: ${m.stock}${m.tieneCodigo ? '' : ' (producto sin código, vinculado por descripción)'}`;
            document.getElementById('ingProductoInfo').style.display = 'block';
        }

        async function registrarIngresoStock() {
            if (!ingProductoSeleccionado) { mostrarNotificacion('Busca y selecciona un producto del Kardex primero', 'warning'); return; }
            const cantidad = parseFloat(document.getElementById('ingCantidad').value);
            if (!cantidad || cantidad <= 0) { mostrarNotificacion('Ingresa una cantidad válida', 'warning'); return; }
            const marca = document.getElementById('ingMarca').value;
            const fechaISO = document.getElementById('ingFecha').value || new Date().toISOString().slice(0, 10);
            const etiquetaMarca = marca === 'san_jacinto' ? 'San Jacinto' : 'La Bellota';
            const etiquetaProducto = ingProductoSeleccionado.descripcion || ingProductoSeleccionado.codigo;

            if (!confirm(`¿Confirmas el ingreso de ${cantidad} und. de "${etiquetaProducto}" (${etiquetaMarca})?\\n\\nSe sumará en INGRESO CANT ${etiquetaMarca.toUpperCase()}, en SALDO, y se registrará la fecha en FECHA INGRESO — directamente en el Kardex.`)) return;

            const btn = document.getElementById('btnRegistrarIngreso');
            try {
                btn.disabled = true; btn.textContent = '⏳ Actualizando el Kardex...';
                await registrarIngresoStockKardex({ clave: ingProductoSeleccionado.clave, marca, cantidad, fechaISO });
                await cargarKardex(false);
                mostrarNotificacion('Ingreso registrado en el Kardex', 'success');
                document.getElementById('ingCantidad').value = '';
                document.getElementById('ingBuscarProducto').value = '';
                document.getElementById('ingProductoInfo').style.display = 'none';
                ingProductoSeleccionado = null;
            } catch (e) {
                console.error('Error al registrar ingreso de stock:', e);
                mostrarNotificacion('No se pudo registrar el ingreso: ' + e.message, 'warning');
            } finally {
                btn.disabled = false; btn.textContent = '📥 Registrar Ingreso';
            }
        }

        // --- Egreso ---
        let egrMatchesActuales = [];
        let egrProductoSeleccionado = null;

        function buscarProductosEgreso(query) {
            const dropdown = document.getElementById('egrBuscarDropdown');
            if (!dropdown) return;
            const q = normalizarTexto(query || '').trim();
            if (q.length < 2) { dropdown.classList.remove('visible'); return; }

            egrMatchesActuales = obtenerFilasKardexIdentificadas().filter(f =>
                normalizarTexto(f.codigo).includes(q) || normalizarTexto(f.descripcion).includes(q)
            ).slice(0, 8);

            if (egrMatchesActuales.length === 0) {
                dropdown.innerHTML = '<div style="padding:10px;color:#a0aec0;">Sin resultados en la hoja actual del Kardex</div>';
                dropdown.classList.add('visible');
                return;
            }
            dropdown.innerHTML = egrMatchesActuales.map((m, i) => `
                <div class="cliente-db-item" onclick="seleccionarProductoEgreso(${i})">
                    <div class="cliente-db-item-name">${m.codigo ? m.codigo + ' — ' : ''}${m.descripcion || '(sin descripción)'}</div>
                    <div class="cliente-db-item-sub">Stock actual: ${m.stock}${m.tieneCodigo ? '' : ' · sin código (vinculado por descripción)'}</div>
                </div>
            `).join('');
            dropdown.classList.add('visible');
        }

        function seleccionarProductoEgreso(i) {
            const m = egrMatchesActuales[i];
            if (!m) return;
            egrProductoSeleccionado = m;
            document.getElementById('egrBuscarProducto').value = (m.codigo ? m.codigo + ' — ' : '') + (m.descripcion || '');
            document.getElementById('egrBuscarDropdown').classList.remove('visible');
            document.getElementById('egrProductoStockActual').textContent = `📦 SALDO actual en Kardex: ${m.stock}${m.tieneCodigo ? '' : ' (producto sin código, vinculado por descripción)'}`;
            document.getElementById('egrProductoInfo').style.display = 'block';
        }

        async function registrarEgresoStock() {
            if (!egrProductoSeleccionado) { mostrarNotificacion('Busca y selecciona un producto del Kardex primero', 'warning'); return; }
            const cantidad = parseFloat(document.getElementById('egrCantidad').value);
            if (!cantidad || cantidad <= 0) { mostrarNotificacion('Ingresa una cantidad válida', 'warning'); return; }
            const fechaISO = document.getElementById('egrFecha').value || new Date().toISOString().slice(0, 10);
            const dia = parseInt(fechaISO.split('-')[2], 10);
            const etiquetaProducto = egrProductoSeleccionado.descripcion || egrProductoSeleccionado.codigo;

            if (!confirm(`¿Confirmas el egreso de ${cantidad} und. de "${etiquetaProducto}" el día ${dia}?\\n\\nSe sumará en la columna del día ${dia}, en TOTAL EGRESO, y se descontará del SALDO — directamente en el Kardex.`)) return;

            const btn = document.getElementById('btnRegistrarEgreso');
            try {
                btn.disabled = true; btn.textContent = '⏳ Actualizando el Kardex...';
                await registrarEgresoStockKardex({ clave: egrProductoSeleccionado.clave, cantidad, fechaISO });
                await cargarKardex(false);
                mostrarNotificacion('Egreso registrado en el Kardex', 'success');
                document.getElementById('egrCantidad').value = '';
                document.getElementById('egrBuscarProducto').value = '';
                document.getElementById('egrProductoInfo').style.display = 'none';
                egrProductoSeleccionado = null;
            } catch (e) {
                console.error('Error al registrar egreso de stock:', e);
                mostrarNotificacion('No se pudo registrar el egreso: ' + e.message, 'warning');
            } finally {
                btn.disabled = false; btn.textContent = '📤 Registrar Egreso';
            }
        }

        // Cerrar los dropdowns de Ingreso/Egreso al hacer click fuera
        document.addEventListener('click', function(e) {
            const pares = [['ingBuscarDropdown', 'ingBuscarProducto'], ['egrBuscarDropdown', 'egrBuscarProducto']];
            pares.forEach(([dropdownId, inputId]) => {
                const dropdown = document.getElementById(dropdownId);
                const input = document.getElementById(inputId);
                if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
                    dropdown.classList.remove('visible');
                }
            });
        });

