        // ============================================
        // KARDEX — DETECCIÓN DE COLORES Y STOCK PARA PRODUCTOS SIN CÓDIGO NUMÉRICO
        // ============================================
        // Las toallas con código numérico (7015, 7041...) ya salen del Kardex por código. Pero muchos
        // productos del catálogo (Belén "BEL-001", Silver "SIL-001", batas...) tienen un código propio que
        // NO existe en el Kardex: ahí la columna A trae la FAMILIA ("BELLOTA BELEN") y la medida y el
        // color van dentro de la descripción ("BELEN 140*70 BLANCO"). Este módulo empareja cada producto
        // del catálogo con su familia + medida y suma stock/colores, SIN tocar el Excel.
        // Reutiliza kcParsearDescripcion (kardex-carga.js), que ya sabe leer medida y color.

        // Palabra del nombre del catálogo -> familia(s) de la columna A del Kardex (normalizadas).
        const KD_FAMILIAS = [
            { re: /\bBELEN\b/, familias: ['BELLOTA BELEN'] },
            { re: /\bSILVER\b/, familias: ['BELLOTA SILVER'] },
            { re: /\bBATA\b/, familias: ['BATAS'] },
            { re: /\bPISO\b/, familias: ['PISO'] }
        ];

        // Medida de un nombre de catálogo: "140x70cm" -> dim, "1.5 Plz"/"Queen" -> plz, "S y M" -> tallas.
        function kdMedidasDeNombre(nombre) {
            const t = kcNormalizar(nombre).replace(/\b1\.5\b/g, '1 1/2').replace(/\b(\d)\.0\b/g, '$1');
            const p = kcParsearDescripcion(t, '');
            if (p.medida) return [p.medida];
            const m = t.match(/\b(XXL|XL|XS|S|M|L)(?:\s+Y\s+(XXL|XL|XS|S|M|L))?\s*$/);
            return m ? [m[1], m[2]].filter(Boolean).map(v => ({ tipo: 'talla', valor: v })) : [];
        }

        // Las dimensiones "60*40" y "40*60" son la misma toalla.
        function kdClaveMedida(m) {
            if (!m) return 'sin';
            if (m.tipo === 'dim') return 'dim:' + m.valor.split('*').map(Number).sort((a, b) => a - b).join('*');
            return `${m.tipo}:${m.valor}`;
        }

        // filas: [{articulo, descripcion, saldo}] de la hoja. catalogo: [{codigo, nombre}].
        // Devuelve { stock:{codigo:n}, colores:{codigo:[{color,saldo}]}, sinEmparejar:[codigo] }.
        function kdDetectarProductos(filas, catalogo, codigosYaCubiertos) {
            const porFamilia = {};
            filas.forEach(f => {
                const fam = kcNormalizar(f.articulo);
                if (!fam || /^\d+$/.test(fam) || !f.descripcion) return;
                const p = kcParsearDescripcion(f.descripcion, fam);
                const medida = p.medida;
                const color = p.tipo === 'variante' ? p.color : '';
                if (!color) return;
                (porFamilia[fam] = porFamilia[fam] || []).push({ medidaClave: kdClaveMedida(medida), color, saldo: f.saldo });
            });

            const res = { stock: {}, colores: {}, sinEmparejar: [] };
            catalogo.forEach(prod => {
                if (codigosYaCubiertos && codigosYaCubiertos.has(prod.codigo)) return;
                const nombre = kcNormalizar(prod.nombre);
                const regla = KD_FAMILIAS.find(r => r.re.test(nombre));
                if (!regla) return;
                const claves = new Set(kdMedidasDeNombre(prod.nombre).map(kdClaveMedida));
                if (!claves.size) { res.sinEmparejar.push(prod.codigo); return; }
                const mapa = new Map();
                regla.familias.forEach(fam => (porFamilia[kcNormalizar(fam)] || []).forEach(r => {
                    if (!claves.has(r.medidaClave)) return;
                    const k = kcClaveColor(r.color);
                    const ex = mapa.get(k);
                    if (ex) ex.saldo += r.saldo; else mapa.set(k, { color: r.color, saldo: r.saldo });
                }));
                if (!mapa.size) { res.sinEmparejar.push(prod.codigo); return; }
                const lista = [...mapa.values()];
                res.colores[prod.codigo] = lista;
                res.stock[prod.codigo] = lista.reduce((s, c) => s + c.saldo, 0);
            });
            return res;
        }

        // Integración con la app: completa stockKardex / coloresPorProducto (ya armados por código)
        // para los productos del catálogo que no figuran por código en el Kardex.
        function completarStockPorFamilia(filasHoja, colArticulo, colDescripcion, colStock) {
            if (typeof productosDB === 'undefined' || !colArticulo || !colDescripcion) return;
            const filas = filasHoja.map(f => ({
                articulo: f[colArticulo],
                descripcion: f[colDescripcion],
                saldo: parseFloat(f[colStock]) || 0
            }));
            const r = kdDetectarProductos(filas, productosDB, new Set(Object.keys(stockKardex)));
            Object.assign(stockKardex, r.stock);
            Object.assign(coloresPorProducto, r.colores);
        }
