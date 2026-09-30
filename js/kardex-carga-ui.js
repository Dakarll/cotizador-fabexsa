        // ============================================
        // KARDEX — CARGA MASIVA DE INGRESOS (pantalla)
        // ============================================
        // La lógica (índice, parser, emparejado, guardado atómico) vive en kardex-carga.js.
        // Aquí solo está la pantalla: selección producto -> medida -> colores, pegado de listas,
        // carrito de carga, vista previa y guardado. El modal se crea la primera vez que se abre.
        const KC = {
            desbloqueado: false,
            indice: null,
            hoja: '',
            indiceHora: null,
            cargando: false,
            guardando: false,
            carrito: [],            // líneas del carrito (ver kcLineaExistente / kcLineaNueva)
            tab: 'elegir',          // 'elegir' | 'pegar' | 'dudosas'
            vista: 'editor',        // 'editor' | 'previa' | 'resultado'
            selProd: '',
            selMed: '',
            busqueda: '',
            pegado: [],
            resultado: null
        };

        function kcEsc(t) {
            return String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }
        function kcNum(n) {
            const x = Number(n);
            return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
        }
        function kcEl(id) { return document.getElementById(id); }

        // ---------- Apertura / clave ----------
        function abrirCargaMasivaKardex() {
            kcAsegurarModal();
            kcEl('kcModal').classList.add('active');
            if (!KC.desbloqueado) { kcRenderClave(); return; }
            kcIniciar();
        }

        function cerrarCargaMasivaKardex() {
            if (KC.guardando) { mostrarNotificacion('Espera a que termine el guardado', 'warning'); return; }
            const modal = kcEl('kcModal');
            if (modal) modal.classList.remove('active');
        }

        function kcRenderClave() {
            kcEl('kcCuerpo').innerHTML = `
                <div style="max-width:380px;margin:10px auto 0;">
                    <div class="form-group">
                        <label class="form-label" for="kcClave">Contraseña para habilitar la carga masiva</label>
                        <input type="password" class="form-input" id="kcClave" placeholder="Contraseña" autocomplete="off">
                    </div>
                    <p style="font-size:0.8em;color:var(--gray-500);margin-top:-8px;">Es la misma de "Editar Kardex". La carga modifica el Kardex de Dropbox directamente.</p>
                    <div class="modal-buttons">
                        <button type="button" class="btn btn-secondary" data-kc="cerrar">Cancelar</button>
                        <button type="button" class="btn btn-success" data-kc="clave-ok">Continuar</button>
                    </div>
                </div>`;
            setTimeout(() => { const i = kcEl('kcClave'); if (i) i.focus(); }, 50);
        }

        function kcConfirmarClave() {
            const pass = kcEl('kcClave').value;
            if (pass !== KARDEX_EDIT_CONFIG.password) { mostrarNotificacion('Contraseña incorrecta', 'warning'); return; }
            KC.desbloqueado = true;
            kcIniciar();
        }

        async function kcIniciar() {
            if (KC.indice) { kcRenderTodo(); return; }
            await kcCargarIndice();
        }

        // Descarga el Kardex (solo lectura) y arma el índice. Se usa la misma hoja en la que luego se escribe.
        async function kcCargarIndice() {
            if (KC.cargando) return;
            KC.cargando = true;
            kcEl('kcCuerpo').innerHTML = `<div class="kc-estado">Leyendo el Kardex desde Dropbox…</div>`;
            try {
                const token = await obtenerAccessTokenDropbox();
                const { workbook } = await descargarKardexParaEscritura(token);
                const nombre = resolverNombreHojaKardexWorkbook(workbook);
                const hoja = workbook.getWorksheet(nombre);
                if (!hoja) throw new Error('No se encontró la hoja del Kardex configurada');
                const cols = resolverColumnasMovimientoExcel(hoja);
                if (cols.colArticulo < 1 || cols.colDescripcion < 1 || cols.colStock < 1) throw new Error('No se detectaron las columnas ARTICULO / DESCRIPCION / SALDO');
                KC.indice = kcConstruirIndice(hoja, cols);
                KC.hoja = nombre;
                KC.indiceHora = new Date();
                if (!kcListarProductos(KC.indice).some(p => p.clave === KC.selProd)) { KC.selProd = ''; KC.selMed = ''; }
                kcRenderTodo();
            } catch (e) {
                console.error('Carga masiva: no se pudo leer el Kardex', e);
                kcEl('kcCuerpo').innerHTML = `<div class="kc-estado kc-error">No se pudo leer el Kardex: ${kcEsc(e.message)}<br><br><button type="button" class="btn btn-secondary" data-kc="reintentar-indice">Reintentar</button></div>`;
            } finally {
                KC.cargando = false;
            }
        }

        // ---------- Armado del modal ----------
        function kcAsegurarModal() {
            if (kcEl('kcModal')) return;
            const div = document.createElement('div');
            div.className = 'modal';
            div.id = 'kcModal';
            div.innerHTML = `
                <div class="modal-content kc-content">
                    <div class="modal-header">
                        <h2 class="modal-title">Carga masiva de ingresos</h2>
                        <button type="button" class="modal-close" data-kc="cerrar" aria-label="Cerrar">×</button>
                    </div>
                    <div id="kcCuerpo"></div>
                </div>`;
            document.body.appendChild(div);
            div.addEventListener('click', kcManejarClick);
            div.addEventListener('input', kcManejarInput);
            div.addEventListener('change', kcManejarChange);
            div.addEventListener('keydown', e => {
                if (e.key === 'Enter' && e.target && e.target.id === 'kcClave') { e.preventDefault(); kcConfirmarClave(); }
                if (e.key === 'Enter' && e.target && e.target.id === 'kcBuscarColor') { e.preventDefault(); kcBuscarColor(); }
            });
        }

        function kcManejarClick(e) {
            const el = e.target.closest('[data-kc]');
            if (!el) { if (e.target === kcEl('kcModal')) cerrarCargaMasivaKardex(); return; }
            const a = el.dataset.kc;
            const i = el.dataset.i !== undefined ? parseInt(el.dataset.i, 10) : null;
            const j = el.dataset.j !== undefined ? parseInt(el.dataset.j, 10) : null;
            switch (a) {
                case 'cerrar': cerrarCargaMasivaKardex(); break;
                case 'clave-ok': kcConfirmarClave(); break;
                case 'reintentar-indice': kcCargarIndice(); break;
                case 'actualizar-indice': kcCargarIndice(); break;
                case 'tab': KC.tab = el.dataset.tab; kcRenderTabs(); break;
                case 'agregar-tabla': kcAgregarDesdeTabla('kcTabla'); break;
                case 'agregar-busqueda': kcAgregarDesdeTabla('kcTablaBusq'); break;
                case 'buscar-color': kcBuscarColor(); break;
                case 'limpiar-busqueda': KC.busqueda = ''; kcEl('kcBuscarColor').value = ''; kcRenderBusqueda(); break;
                case 'abrir-variante': KC.selProd = el.dataset.prod; KC.selMed = el.dataset.med; kcEl('kcSelProd').value = KC.selProd; kcRenderSelector(); { const t = kcEl('kcTablaWrap'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } break;
                case 'toggle-nueva': { const p = kcEl('kcNuevaPanel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; kcActualizarNuevaPreview(); break; }
                case 'agregar-nueva': kcAgregarNueva(); break;
                case 'analizar': kcAnalizarPegado(); break;
                case 'pegado-usar': kcPegadoUsar(i, j); break;
                case 'pegado-crear': kcPegadoCrear(i, j); break;
                case 'pegado-agregar': kcPegadoAgregar(); break;
                case 'quitar-linea': KC.carrito.splice(i, 1); kcRenderCarrito(); kcRefrescarTablaSiHay(); break;
                case 'vaciar': KC.carrito = []; kcRenderCarrito(); kcRefrescarTablaSiHay(); break;
                case 'previa': kcIrAPrevia(); break;
                case 'volver': KC.vista = 'editor'; kcRenderTodo(); break;
                case 'guardar': kcGuardar(); break;
                case 'nueva-carga': KC.vista = 'editor'; KC.resultado = null; kcIniciar(); break;
            }
        }

        function kcManejarInput(e) {
            const t = e.target;
            if (t.matches && t.matches('#kcTabla input[data-fila], #kcTablaBusq input[data-fila]')) kcActualizarSaldoFila(t);
            if (t.id === 'kcBuscarColor') kcBuscarColor();
            if (t.id === 'kcNuevaValor' || t.id === 'kcNuevaColor') kcActualizarNuevaPreview();
        }

        function kcManejarChange(e) {
            const t = e.target;
            if (t.id === 'kcSelProd') { KC.selProd = t.value; KC.selMed = ''; kcRenderSelector(); }
            else if (t.id === 'kcSelMed') { KC.selMed = t.value; kcRenderTabla(); kcRenderNuevaPanel(); }
            else if (t.id === 'kcNuevaTipo') kcActualizarNuevaPreview();
            else if (t.id === 'kcPlanta') { const f = kcEl('kcFecha'); if (f) f.disabled = !t.value; }
        }

        // ---------- Render principal ----------
        function kcRenderTodo() {
            if (KC.vista === 'previa') { kcRenderPrevia(); return; }
            if (KC.vista === 'resultado') { kcRenderResultado(); return; }
            const ind = KC.indice;
            const validas = ind.filas.filter(f => f.estado === 'ok').length;
            const hora = KC.indiceHora ? KC.indiceHora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
            const planta = kcEl('kcPlanta') ? kcEl('kcPlanta').value : '';
            const fecha = kcEl('kcFecha') ? kcEl('kcFecha').value : new Date().toLocaleDateString('en-CA');
            kcEl('kcCuerpo').innerHTML = `
                <div class="kc-barra">
                    <div class="kc-barra-info">
                        Hoja de destino: <strong>${kcEsc(KC.hoja)}</strong> · ${validas} variantes válidas ·
                        <a href="#" data-kc="tab" data-tab="dudosas" style="color:var(--chip-warning-text);font-weight:600;">${ind.dudosas.length} dudosas (excluidas)</a>
                        <span class="kc-tenue">· índice de las ${kcEsc(hora)}</span>
                        <button type="button" class="btn btn-secondary kc-mini" data-kc="actualizar-indice">Actualizar</button>
                    </div>
                    <div class="kc-barra-ctrl">
                        <label>Planta que recibe
                            <select class="form-input" id="kcPlanta">
                                <option value="">Ninguna → columna C (Cant. inicial)</option>
                                <option value="san_jacinto">San Jacinto</option>
                                <option value="la_bellota">La Bellota</option>
                            </select>
                        </label>
                        <label>Fecha de ingreso <span class="kc-tenue">(solo con planta)</span>
                            <input type="date" class="form-input" id="kcFecha" value="${kcEsc(fecha)}"${planta ? '' : ' disabled'}>
                        </label>
                    </div>
                </div>
                <div class="kc-layout">
                    <div class="kc-principal">
                        <div class="kc-tabs" id="kcTabs"></div>
                        <div id="kcTabContenido"></div>
                    </div>
                    <aside class="kc-carrito" id="kcCarrito"></aside>
                </div>`;
            if (planta) kcEl('kcPlanta').value = planta;
            kcRenderTabs();
            kcRenderCarrito();
        }

        function kcRenderTabs() {
            const tabs = [['elegir', 'Elegir producto'], ['pegar', 'Pegar lista'], ['dudosas', `Filas dudosas (${KC.indice.dudosas.length})`]];
            kcEl('kcTabs').innerHTML = tabs.map(([k, t]) => `<button type="button" class="kc-tab${KC.tab === k ? ' activa' : ''}" data-kc="tab" data-tab="${k}">${t}</button>`).join('');
            if (KC.tab === 'elegir') kcRenderElegir();
            else if (KC.tab === 'pegar') kcRenderPegar();
            else kcRenderDudosas();
        }

        // ---------- Pestaña: elegir producto -> medida -> colores ----------
        function kcRenderElegir() {
            const productos = kcListarProductos(KC.indice);
            kcEl('kcTabContenido').innerHTML = `
                <div class="kc-buscador">
                    <input type="search" class="form-input" id="kcBuscarColor" value="${kcEsc(KC.busqueda)}" placeholder="Buscar color en todos los productos (ej: azul marino, verde, 14 oz)…" autocomplete="off">
                    <button type="button" class="btn btn-primary" data-kc="buscar-color">Buscar color</button>
                    <button type="button" class="btn btn-secondary" data-kc="limpiar-busqueda">Limpiar</button>
                </div>
                <div id="kcBusquedaRes"></div>
                <div class="kc-selectores">
                    <label>Producto / código
                        <select class="form-input" id="kcSelProd">
                            <option value="">Elige…</option>
                            ${productos.map(p => `<option value="${kcEsc(p.clave)}"${p.clave === KC.selProd ? ' selected' : ''}>${kcEsc(p.nombre)} (${p.filas.length})</option>`).join('')}
                        </select>
                    </label>
                    <label>Medida
                        <select class="form-input" id="kcSelMed"></select>
                    </label>
                </div>
                <div id="kcTablaWrap"></div>
                <div id="kcNuevaWrap"></div>`;
            kcRenderSelector();
            kcRenderBusqueda();
        }

        function kcProductoActual() {
            return kcListarProductos(KC.indice).find(p => p.clave === KC.selProd) || null;
        }

        function kcRenderSelector() {
            const prod = kcProductoActual();
            const sel = kcEl('kcSelMed');
            if (!prod) { sel.innerHTML = '<option value="">Primero elige un producto</option>'; sel.disabled = true; kcEl('kcTablaWrap').innerHTML = ''; kcEl('kcNuevaWrap').innerHTML = ''; return; }
            const medidas = kcListarMedidas(prod);
            if (!medidas.some(m => m.clave === KC.selMed)) KC.selMed = medidas.length === 1 ? medidas[0].clave : '';
            sel.disabled = false;
            sel.innerHTML = `<option value="">Elige…</option>` + medidas.map(m => `<option value="${kcEsc(m.clave)}"${m.clave === KC.selMed ? ' selected' : ''}>${kcEsc(m.texto)} (${m.filas.length} ${m.filas.length === 1 ? 'variante' : 'variantes'})</option>`).join('');
            kcRenderTabla();
            kcRenderNuevaPanel();
        }

        function kcRenderTabla() {
            const prod = kcProductoActual();
            const wrap = kcEl('kcTablaWrap');
            if (!prod || !KC.selMed) { wrap.innerHTML = prod ? '<p class="kc-tenue" style="margin:14px 0;">Elige una medida para ver los colores.</p>' : ''; return; }
            const med = kcListarMedidas(prod).find(m => m.clave === KC.selMed);
            if (!med) { wrap.innerHTML = ''; return; }
            const filas = med.filas.slice().sort((a, b) => a.fila - b.fila);
            wrap.innerHTML = `
                <div class="kc-tabla-scroll">
                <table class="kc-tabla" id="kcTabla">
                    <thead><tr><th>Color / variante</th><th class="num">Saldo actual</th><th class="num">Cantidad que ingresa</th><th class="num">Saldo resultante</th></tr></thead>
                    <tbody>
                    ${filas.map(f => {
                        const enCarrito = KC.carrito.find(c => c.tipo === 'existente' && c.fila === f.fila);
                        const cant = enCarrito ? enCarrito.cantidad : '';
                        const aviso = kcNotaDescontinuada(f.notas) ? `<span class="kc-chip kc-chip-aviso" title="${kcEsc(f.notas.join(' · '))}">${kcEsc(f.notas[0])}</span>` : '';
                        return `<tr>
                            <td>${kcEsc(f.color)} ${aviso} <span class="kc-tenue">fila ${f.fila}</span></td>
                            <td class="num">${kcNum(f.saldo)}</td>
                            <td class="num"><input type="number" min="0" step="any" inputmode="decimal" class="form-input kc-cant" data-fila="${f.fila}" data-saldo="${f.saldo}" data-res="kcRes${f.fila}" value="${cant}" placeholder="0"></td>
                            <td class="num kc-res" id="kcRes${f.fila}">${cant !== '' ? kcNum(f.saldo + cant) : '—'}</td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
                </div>
                <div class="kc-acciones">
                    <button type="button" class="btn btn-success" data-kc="agregar-tabla">Agregar al carrito</button>
                    <span class="kc-tenue">Solo se agregan las filas con cantidad mayor a 0. Volver a agregar reemplaza lo de estas filas.</span>
                </div>`;
        }

        function kcRefrescarTablaSiHay() {
            if (KC.tab === 'elegir' && kcEl('kcTabla')) kcRenderTabla();
            if (KC.tab === 'elegir') kcRenderBusqueda();
        }

        // ---------- Buscar color (en todos los productos y medidas) ----------
        const KC_MAX_RESULTADOS = 60;

        function kcBuscarColor() {
            KC.busqueda = kcEl('kcBuscarColor').value;
            kcRenderBusqueda();
        }

        function kcRenderBusqueda() {
            const box = kcEl('kcBusquedaRes');
            if (!box) return;
            const tokens = kcNormalizar(KC.busqueda).split(' ').filter(Boolean);
            if (!tokens.length) { box.innerHTML = ''; return; }
            const coincidencias = KC.indice.filas.filter(f => {
                if (f.estado !== 'ok') return false;
                const pajar = kcNormalizar(`${f.color} ${f.descripcion} ${f.producto} ${kcTextoMedida(f.medida)}`);
                return tokens.every(t => pajar.includes(t));
            });
            if (!coincidencias.length) {
                box.innerHTML = `<p class="kc-tenue" style="margin:0 0 14px;">Sin resultados para "${kcEsc(KC.busqueda)}". Prueba con menos palabras. Si el color no existe, créalo con "Crear variante nueva".</p>`;
                return;
            }
            const mostradas = coincidencias.slice(0, KC_MAX_RESULTADOS);
            box.innerHTML = `
                <div class="kc-busq-cab"><strong>${coincidencias.length}</strong> resultado(s) para "${kcEsc(KC.busqueda)}"${coincidencias.length > mostradas.length ? ` <span class="kc-tenue">(se muestran los primeros ${mostradas.length}; afina la búsqueda)</span>` : ''}</div>
                <div class="kc-tabla-scroll">
                <table class="kc-tabla" id="kcTablaBusq">
                    <thead><tr><th>Producto</th><th>Medida</th><th>Color / variante</th><th class="num">Saldo actual</th><th class="num">Cantidad</th><th class="num">Saldo resultante</th><th></th></tr></thead>
                    <tbody>
                    ${mostradas.map(f => {
                        const enCarrito = KC.carrito.find(c => c.tipo === 'existente' && c.fila === f.fila);
                        const cant = enCarrito ? enCarrito.cantidad : '';
                        const aviso = kcNotaDescontinuada(f.notas) ? ` <span class="kc-chip kc-chip-aviso" title="${kcEsc(f.notas.join(' · '))}">${kcEsc(f.notas[0])}</span>` : '';
                        return `<tr>
                            <td>${kcEsc(f.producto)}</td>
                            <td>${kcEsc(kcTextoMedida(f.medida))}</td>
                            <td>${kcEsc(f.color)}${aviso} <span class="kc-tenue">fila ${f.fila}</span></td>
                            <td class="num">${kcNum(f.saldo)}</td>
                            <td class="num"><input type="number" min="0" step="any" inputmode="decimal" class="form-input kc-cant" data-fila="${f.fila}" data-saldo="${f.saldo}" data-res="kcResB${f.fila}" value="${cant}" placeholder="0"></td>
                            <td class="num kc-res" id="kcResB${f.fila}">${cant !== '' ? kcNum(f.saldo + cant) : '—'}</td>
                            <td><button type="button" class="kc-sug" data-kc="abrir-variante" data-prod="${kcEsc(f.productoClave)}" data-med="${kcEsc(f.medidaClave)}" title="Ver todos los colores de esta medida">Ver tabla</button></td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
                </div>
                <div class="kc-acciones" style="margin-bottom:16px;">
                    <button type="button" class="btn btn-success" data-kc="agregar-busqueda">Agregar al carrito</button>
                    <span class="kc-tenue">Solo se agregan las filas con cantidad mayor a 0.</span>
                </div>`;
        }

        function kcActualizarSaldoFila(input) {
            const cant = parseFloat(input.value);
            const saldo = parseFloat(input.dataset.saldo) || 0;
            const celda = kcEl(input.dataset.res || ('kcRes' + input.dataset.fila));
            if (!celda) return;
            if (input.value === '') { celda.textContent = '—'; celda.classList.remove('kc-mal'); return; }
            if (!(cant >= 0)) { celda.textContent = 'inválido'; celda.classList.add('kc-mal'); return; }
            celda.classList.remove('kc-mal');
            celda.textContent = kcNum(saldo + cant);
        }

        function kcLineaExistente(f, cantidad) {
            return { tipo: 'existente', fila: f.fila, productoClave: f.productoClave, producto: f.producto, descClave: f.descClave, descripcion: f.descripcion, medidaTexto: kcTextoMedida(f.medida), color: f.color, saldo: f.saldo, cantidad };
        }

        function kcAgregarDesdeTabla(tablaId) {
            const inputs = [...document.querySelectorAll('#' + tablaId + ' input[data-fila]')];
            for (const inp of inputs) {
                if (inp.value !== '' && !(parseFloat(inp.value) >= 0)) { mostrarNotificacion('Hay una cantidad inválida en la tabla', 'warning'); return; }
            }
            let agregadas = 0;
            inputs.forEach(inp => {
                const fila = parseInt(inp.dataset.fila, 10);
                const cant = parseFloat(inp.value);
                const f = KC.indice.filas.find(x => x.fila === fila);
                const idx = KC.carrito.findIndex(c => c.tipo === 'existente' && c.fila === fila);
                if (cant > 0) {
                    const linea = kcLineaExistente(f, cant);
                    if (idx > -1) KC.carrito[idx] = linea; else KC.carrito.push(linea);
                    agregadas++;
                } else if (idx > -1) {
                    KC.carrito.splice(idx, 1);
                }
            });
            kcRenderCarrito();
            kcRenderTabla();
            kcRenderBusqueda();
            mostrarNotificacion(agregadas ? `${agregadas} línea(s) en el carrito` : 'No había cantidades mayores a 0', agregadas ? 'success' : 'warning');
        }

        // ---------- Crear variante nueva (color o medida inexistente) ----------
        function kcRenderNuevaPanel() {
            const prod = kcProductoActual();
            const wrap = kcEl('kcNuevaWrap');
            if (!prod) { wrap.innerHTML = ''; return; }
            const med = KC.selMed ? kcListarMedidas(prod).find(m => m.clave === KC.selMed) : null;
            const tipo = med && med.medida ? med.medida.tipo : 'sin';
            const valor = med && med.medida ? (med.medida.tipo === 'talla' ? med.medida.valor : med.medida.valor) : '';
            wrap.innerHTML = `
                <div class="kc-nueva">
                    <button type="button" class="btn btn-secondary" data-kc="toggle-nueva">+ Crear variante nueva (color o medida que no existe)</button>
                    <div id="kcNuevaPanel" style="display:none;margin-top:12px;">
                        <div class="kc-selectores">
                            <label>Tipo de medida
                                <select class="form-input" id="kcNuevaTipo">
                                    <option value="sin"${tipo === 'sin' ? ' selected' : ''}>Sin medida</option>
                                    <option value="dim"${tipo === 'dim' ? ' selected' : ''}>Dimensión (cm)</option>
                                    <option value="plz"${tipo === 'plz' ? ' selected' : ''}>Plaza (PLZ)</option>
                                    <option value="talla"${tipo === 'talla' ? ' selected' : ''}>Talla</option>
                                </select>
                            </label>
                            <label>Medida
                                <input type="text" class="form-input" id="kcNuevaValor" value="${kcEsc(valor)}" placeholder="140*75 · 2 PLZ · 30 · XL">
                            </label>
                            <label>Color
                                <input type="text" class="form-input" id="kcNuevaColor" placeholder="Ej: AZUL MARINO" autocomplete="off">
                            </label>
                            <label>Cantidad
                                <input type="number" min="0" step="any" class="form-input" id="kcNuevaCant" placeholder="0">
                            </label>
                        </div>
                        <div id="kcNuevaPreview" class="kc-preview-nueva"></div>
                        <button type="button" class="btn btn-success" data-kc="agregar-nueva">Agregar variante nueva al carrito</button>
                    </div>
                </div>`;
        }

        // Lee el formulario de variante nueva; devuelve { medida, color, desc, conflicto, parecidos } o { error }.
        function kcLeerNueva() {
            const prod = kcProductoActual();
            if (!prod) return { error: 'Elige un producto' };
            const tipo = kcEl('kcNuevaTipo').value;
            let medida = null;
            try { medida = kcMedidaDesdeEntrada(tipo, kcEl('kcNuevaValor').value); } catch (e) { return { error: e.message }; }
            const color = kcEl('kcNuevaColor').value.toUpperCase().replace(/\s+/g, ' ').trim();
            if (!color) return { error: 'Escribe el color' };
            if (/[()]/.test(color)) return { error: 'El color no debe llevar paréntesis' };
            const ck = kcClaveColor(color);
            const mk = kcClaveMedida(medida);
            const iguales = KC.indice.filas.filter(f => f.productoClave === prod.clave && f.medidaClave === mk && f.colorClave === ck);
            const parecidos = prod.filas
                .filter(f => f.medidaClave === mk && f.colorClave !== ck && (f.colorClave.includes(ck) || ck.includes(f.colorClave) || kcDistancia(ck, f.colorClave) <= 2))
                .slice(0, 3);
            return { prod, medida, color, desc: kcDescripcionNueva(medida, color), iguales, parecidos };
        }

        function kcActualizarNuevaPreview() {
            const box = kcEl('kcNuevaPreview');
            if (!box) return;
            const r = kcLeerNueva();
            if (r.error) { box.innerHTML = `<span class="kc-tenue">${kcEsc(r.error)}</span>`; return; }
            let html = `Se agregará al final del Kardex: <strong>${kcEsc(r.prod.nombre)}</strong> · "${kcEsc(r.desc)}"`;
            if (r.iguales.length) html += `<br><span class="kc-mal">Ya existe (fila ${r.iguales.map(f => f.fila).join(', ')}). Búscala en la tabla en vez de crearla.</span>`;
            if (r.parecidos.length) html += `<br><span class="kc-aviso">Parecidos ya existentes en esa medida: ${r.parecidos.map(f => kcEsc(f.color)).join(', ')}. ¿Es el mismo color?</span>`;
            box.innerHTML = html;
        }

        function kcAgregarNueva() {
            const r = kcLeerNueva();
            if (r.error) { mostrarNotificacion(r.error, 'warning'); return; }
            if (r.iguales.length) { mostrarNotificacion('Esa variante ya existe en el Kardex; usa la tabla', 'warning'); return; }
            const cant = parseFloat(kcEl('kcNuevaCant').value);
            if (!(cant > 0)) { mostrarNotificacion('Escribe una cantidad mayor a 0', 'warning'); return; }
            kcSumarNuevaAlCarrito(r.prod.nombre, r.medida, r.color, cant);
            kcEl('kcNuevaColor').value = '';
            kcEl('kcNuevaCant').value = '';
            kcActualizarNuevaPreview();
            kcRenderCarrito();
            mostrarNotificacion('Variante nueva en el carrito', 'success');
        }

        function kcSumarNuevaAlCarrito(producto, medida, color, cantidad) {
            const pk = kcNormalizar(producto), mk = kcClaveMedida(medida), ck = kcClaveColor(color);
            const previa = KC.carrito.find(c => c.tipo === 'nueva' && kcNormalizar(c.producto) === pk && kcClaveMedida(c.medida) === mk && kcClaveColor(c.color) === ck);
            if (previa) previa.cantidad += cantidad;
            else KC.carrito.push({ tipo: 'nueva', producto, productoClave: pk, medida, medidaTexto: kcTextoMedida(medida), color, descripcion: kcDescripcionNueva(medida, color), cantidad });
        }

        // ---------- Pestaña: pegar lista ----------
        function kcRenderPegar() {
            kcEl('kcTabContenido').innerHTML = `
                <p class="kc-tenue" style="margin-bottom:8px;">Una línea por ingreso: <strong>CÓDIGO MEDIDA COLOR CANTIDAD</strong> (pegado desde Excel o WhatsApp). Ej.: <code>7015 ACERO 120</code> · <code>BELLOTA BELEN 30*30 BEIGE 50</code> · <code>PANTALON DENIN TALLA 30 AZUL 14 OZ 6</code></p>
                <textarea class="form-input kc-pegar" id="kcTextoPegado" rows="7" placeholder="7015 ACERO 120&#10;BELLOTA BELEN 30*30 BEIGE 50"></textarea>
                <div class="kc-acciones"><button type="button" class="btn btn-primary" data-kc="analizar">Analizar líneas</button></div>
                <div id="kcPegadoRes"></div>`;
            if (KC.pegado.length) kcRenderPegadoResultados();
        }

        function kcAnalizarPegado() {
            const lineas = kcEl('kcTextoPegado').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (!lineas.length) { mostrarNotificacion('Pega al menos una línea', 'warning'); return; }
            KC.pegado = lineas.map(l => kcEmparejarLinea(l, KC.indice));
            kcRenderPegadoResultados();
        }

        function kcRenderPegadoResultados() {
            const box = kcEl('kcPegadoRes');
            if (!box) return;
            const ok = KC.pegado.filter(r => r.estado === 'ok' && !r.agregada).length;
            const mal = KC.pegado.filter(r => r.estado !== 'ok').length;
            box.innerHTML = `
                <div class="kc-resumen-pegado"><span class="kc-chip kc-chip-ok">${ok} válidas</span> <span class="kc-chip ${mal ? 'kc-chip-mal' : 'kc-chip-ok'}">${mal} con error</span></div>
                <div class="kc-tabla-scroll"><table class="kc-tabla kc-pegado">
                    <thead><tr><th></th><th>Línea</th><th>Interpretación</th><th class="num">Cant.</th></tr></thead>
                    <tbody>
                    ${KC.pegado.map((r, i) => {
                        if (r.estado === 'ok') {
                            const que = r.nueva ? `<strong>NUEVA</strong> ${kcEsc(r.nueva.producto)} · ${kcEsc(kcDescripcionNueva(r.nueva.medida, r.nueva.color))} <span class="kc-tenue">(al final del Kardex)</span>`
                                : `${kcEsc(r.fila.producto)} · ${kcEsc(kcTextoMedida(r.fila.medida))} · ${kcEsc(r.fila.color)} <span class="kc-tenue">fila ${r.fila.fila} · saldo ${kcNum(r.fila.saldo)}</span>`;
                            return `<tr class="${r.agregada ? 'kc-agregada' : ''}"><td class="kc-ico kc-ok-ico">${r.agregada ? '✓✓' : '✓'}</td><td class="kc-linea">${kcEsc(r.linea)}</td><td>${que}${r.agregada ? ' <span class="kc-tenue">· ya en el carrito</span>' : ''}</td><td class="num">${kcNum(r.cantidad)}</td></tr>`;
                        }
                        const sug = r.sugerencias.map((s, j) => {
                            if (s.tipo === 'fila') return `<button type="button" class="kc-sug" data-kc="pegado-usar" data-i="${i}" data-j="${j}">${kcEsc(s.etiqueta)}</button>`;
                            if (s.tipo === 'nueva') return `<button type="button" class="kc-sug kc-sug-nueva" data-kc="pegado-crear" data-i="${i}" data-j="${j}">${kcEsc(s.etiqueta)}</button>`;
                            return `<span class="kc-tenue">${kcEsc(s.etiqueta)}</span>`;
                        }).join(' ');
                        return `<tr class="kc-fila-mal"><td class="kc-ico kc-mal-ico">✗</td><td class="kc-linea">${kcEsc(r.linea)}</td><td><span class="kc-mal">${kcEsc(r.motivo || 'no se pudo interpretar')}</span>${sug ? '<div class="kc-sugs">' + sug + '</div>' : ''}</td><td class="num">${r.cantidad ? kcNum(r.cantidad) : ''}</td></tr>`;
                    }).join('')}
                    </tbody></table></div>
                <div class="kc-acciones">
                    <button type="button" class="btn btn-success" data-kc="pegado-agregar"${ok ? '' : ' disabled'}>Agregar ${ok} válida(s) al carrito</button>
                    ${mal ? '<span class="kc-tenue">Las líneas en rojo no se agregan: corrígelas o elige una sugerencia.</span>' : ''}
                </div>`;
        }

        function kcPegadoUsar(i, j) {
            const r = KC.pegado[i];
            const s = r.sugerencias[j];
            if (!s || s.tipo !== 'fila') return;
            KC.pegado[i] = { linea: r.linea, estado: 'ok', cantidad: r.cantidad, fila: s.fila };
            kcRenderPegadoResultados();
        }

        function kcPegadoCrear(i, j) {
            const r = KC.pegado[i];
            const s = r.sugerencias[j];
            if (!s || s.tipo !== 'nueva') return;
            KC.pegado[i] = { linea: r.linea, estado: 'ok', cantidad: r.cantidad, nueva: { producto: r.producto.nombre, medida: s.medida, color: s.color } };
            kcRenderPegadoResultados();
        }

        function kcPegadoAgregar() {
            let n = 0;
            KC.pegado.forEach(r => {
                if (r.estado !== 'ok' || r.agregada) return;
                if (r.nueva) {
                    kcSumarNuevaAlCarrito(r.nueva.producto, r.nueva.medida, r.nueva.color, r.cantidad);
                } else {
                    const idx = KC.carrito.findIndex(c => c.tipo === 'existente' && c.fila === r.fila.fila);
                    if (idx > -1) KC.carrito[idx].cantidad += r.cantidad;
                    else KC.carrito.push(kcLineaExistente(r.fila, r.cantidad));
                }
                r.agregada = true;
                n++;
            });
            kcRenderPegadoResultados();
            kcRenderCarrito();
            mostrarNotificacion(`${n} línea(s) agregadas al carrito`, 'success');
        }

        // ---------- Pestaña: filas dudosas ----------
        function kcRenderDudosas() {
            const d = KC.indice.dudosas;
            kcEl('kcTabContenido').innerHTML = `
                <p class="kc-tenue" style="margin-bottom:10px;">Estas filas no se pudieron interpretar con seguridad (o son duplicados indistinguibles). <strong>Quedan excluidas de la carga</strong>; el sistema no adivina. Además hay ${KC.indice.reservadas} filas reservadas (con código pero sin descripción) que tampoco se tocan.</p>
                ${d.length ? `<div class="kc-tabla-scroll"><table class="kc-tabla"><thead><tr><th>Fila</th><th>Código</th><th>Descripción (columna B)</th><th>Motivo</th></tr></thead><tbody>
                ${d.map(f => `<tr><td>${f.fila}</td><td>${kcEsc(f.producto)}</td><td>${kcEsc(f.descripcion)}</td><td class="kc-aviso">${kcEsc(f.motivo)}</td></tr>`).join('')}
                </tbody></table></div>` : '<p>No hay filas dudosas.</p>'}`;
        }

        // ---------- Carrito ----------
        function kcRenderCarrito() {
            const box = kcEl('kcCarrito');
            if (!box) return;
            const unidades = KC.carrito.reduce((s, c) => s + c.cantidad, 0);
            // Agrupa por producto -> medida
            const grupos = new Map();
            KC.carrito.forEach((c, idx) => {
                const k = `${c.producto}||${c.medidaTexto}`;
                if (!grupos.has(k)) grupos.set(k, { producto: c.producto, medida: c.medidaTexto, lineas: [] });
                grupos.get(k).lineas.push({ c, idx });
            });
            box.innerHTML = `
                <h3>Carrito de carga</h3>
                ${KC.carrito.length ? [...grupos.values()].map(g => `
                    <div class="kc-grupo">
                        <div class="kc-grupo-t">${kcEsc(g.producto)} · ${kcEsc(g.medida)}</div>
                        ${g.lineas.map(({ c, idx }) => `<div class="kc-linea-c">
                            <span>${kcEsc(c.color)}${c.tipo === 'nueva' ? ' <span class="kc-chip kc-chip-info">NUEVA</span>' : ''}</span>
                            <span><strong>+${kcNum(c.cantidad)}</strong> <button type="button" class="kc-x" data-kc="quitar-linea" data-i="${idx}" aria-label="Quitar">×</button></span>
                        </div>`).join('')}
                    </div>`).join('') : '<p class="kc-tenue">Vacío. Agrega cantidades desde la tabla o pegando una lista.</p>'}
                <div class="kc-total">${KC.carrito.length} línea(s) · <strong>${kcNum(unidades)}</strong> unidades</div>
                <button type="button" class="btn btn-success" style="width:100%;" data-kc="previa"${KC.carrito.length ? '' : ' disabled'}>Vista previa y guardar</button>
                ${KC.carrito.length ? '<button type="button" class="btn btn-secondary" style="width:100%;margin-top:8px;" data-kc="vaciar">Vaciar carrito</button>' : ''}`;
        }

        // ---------- Vista previa ----------
        function kcIrAPrevia() {
            const planta = kcEl('kcPlanta').value;
            const fecha = kcEl('kcFecha').value;
            if (planta && !fecha) { mostrarNotificacion('Elige la fecha de ingreso', 'warning'); return; }
            KC.planta = planta;
            KC.fecha = fecha;
            KC.vista = 'previa';
            kcRenderPrevia();
        }

        function kcEtiquetaPlanta(p) {
            if (p === 'san_jacinto') return 'San Jacinto';
            if (p === 'la_bellota') return 'La Bellota';
            return 'columna C (Cant. inicial)';
        }

        function kcRenderPrevia() {
            const grupos = new Map();
            KC.carrito.forEach(c => {
                const k = `${c.producto}||${c.medidaTexto}`;
                if (!grupos.has(k)) grupos.set(k, { producto: c.producto, medida: c.medidaTexto, lineas: [] });
                grupos.get(k).lineas.push(c);
            });
            const total = KC.carrito.reduce((s, c) => s + c.cantidad, 0);
            const nuevas = KC.carrito.filter(c => c.tipo === 'nueva').length;
            kcEl('kcCuerpo').innerHTML = `
                <div class="kc-previa-cab">
                    Hoja <strong>${kcEsc(KC.hoja)}</strong> · ${KC.planta ? 'ingreso de' : 'se suma en la'} <strong>${kcEtiquetaPlanta(KC.planta)}</strong>${KC.planta ? ` · fecha <strong>${kcEsc(KC.fecha.split('-').reverse().join('/'))}</strong>` : ''} ·
                    <strong>${KC.carrito.length}</strong> línea(s), <strong>${kcNum(total)}</strong> unidades${nuevas ? ` · ${nuevas} variante(s) nueva(s) al final del Kardex` : ''}
                </div>
                ${[...grupos.values()].map(g => {
                    const sub = g.lineas.reduce((s, c) => s + c.cantidad, 0);
                    return `<div class="kc-previa-grupo"><div class="kc-grupo-t">${kcEsc(g.producto)} · ${kcEsc(g.medida)} <span class="kc-tenue">— ${kcNum(sub)} unidades</span></div>
                    <div class="kc-tabla-scroll"><table class="kc-tabla"><thead><tr><th>Color / variante</th><th class="num">Saldo antes</th><th class="num">Ingreso</th><th class="num">Saldo después</th></tr></thead><tbody>
                    ${g.lineas.map(c => {
                        const antes = c.tipo === 'nueva' ? 0 : c.saldo;
                        return `<tr><td>${kcEsc(c.color)}${c.tipo === 'nueva' ? ' <span class="kc-chip kc-chip-info">NUEVA · fila al final</span>' : ` <span class="kc-tenue">fila ${c.fila}</span>`}</td><td class="num">${kcNum(antes)}</td><td class="num">+${kcNum(c.cantidad)}</td><td class="num"><strong>${kcNum(antes + c.cantidad)}</strong></td></tr>`;
                    }).join('')}
                    </tbody></table></div></div>`;
                }).join('')}
                <p class="kc-tenue" style="margin-top:10px;">Se guarda todo junto en una sola operación: si algo falla, no se guarda nada. Los saldos se vuelven a leer del Kardex al guardar, así que si alguien más lo modificó entre tanto se suma sobre lo último.</p>
                <div class="modal-buttons">
                    <button type="button" class="btn btn-secondary" data-kc="volver"${KC.guardando ? ' disabled' : ''}>Volver</button>
                    <button type="button" class="btn btn-success" id="kcBtnGuardar" data-kc="guardar"${KC.guardando ? ' disabled' : ''}>Guardar en el Kardex</button>
                </div>`;
        }

        // ---------- Guardado ----------
        function kcItemsParaGuardar() {
            return KC.carrito.map(c => c.tipo === 'existente'
                ? { tipo: 'existente', fila: c.fila, productoClave: c.productoClave, descClave: c.descClave, descripcion: c.descripcion, cantidad: c.cantidad }
                : { tipo: 'nueva', producto: c.producto, medida: c.medida, color: c.color, cantidad: c.cantidad });
        }

        async function kcGuardar() {
            if (KC.guardando || !KC.carrito.length) return;
            const total = KC.carrito.reduce((s, c) => s + c.cantidad, 0);
            if (!await confirmarAccion({
                titulo: 'Guardar la carga en el Kardex',
                mensaje: KC.planta
                    ? `¿Registrar ${KC.carrito.length} línea(s) (${kcNum(total)} unidades) como ingreso de ${kcEtiquetaPlanta(KC.planta)} en la hoja "${KC.hoja}"?\n\nSe guarda todo en una sola operación directamente en Dropbox.`
                    : `¿Sumar ${KC.carrito.length} línea(s) (${kcNum(total)} unidades) en la ${kcEtiquetaPlanta(KC.planta)} de la hoja "${KC.hoja}"?\n\nNo se elegió planta, por eso NO va a INGRESO SJ/BELLOTA ni a FECHA INGRESO. SALDO se recalcula con su fórmula. Se guarda todo en una sola operación directamente en Dropbox.`,
                confirmarTexto: 'Guardar'
            })) return;

            KC.guardando = true;
            const btn = kcEl('kcBtnGuardar');
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando en el Kardex…'; }
            try {
                const resultado = await kcGuardarCargaMasiva(kcItemsParaGuardar(), { planta: KC.planta, fechaISO: KC.fecha });
                KC.resultado = resultado;
                KC.carrito = [];
                KC.pegado = [];
                KC.vista = 'resultado';
                KC.indice = null;   // el índice quedó viejo: se vuelve a leer
                KC.guardando = false;
                kcRenderResultado();
                try { await cargarKardex(false); } catch (errRefresco) { console.warn('No se pudo refrescar el stock visible', errRefresco); }
            } catch (e) {
                console.error('Carga masiva: error al guardar', e);
                KC.guardando = false;
                if (e && e.incierto) {
                    mostrarAlerta({ titulo: 'Revisa el Kardex antes de repetir', mensaje: e.message, tipo: 'warning' });
                } else {
                    mostrarAlerta({ titulo: 'No se guardó la carga', mensaje: 'El Kardex de Dropbox no se modificó. Puedes reintentar.', tipo: 'error', detalle: e.message });
                }
                if (KC.vista === 'previa') kcRenderPrevia();
            }
        }

        function kcRenderResultado() {
            const r = KC.resultado;
            if (!r) { KC.vista = 'editor'; kcRenderTodo(); return; }
            const total = r.lineas.reduce((s, l) => s + l.cantidad, 0);
            kcEl('kcCuerpo').innerHTML = `
                <div class="kc-exito">
                    <strong>Carga guardada en el Kardex</strong> — hoja ${kcEsc(r.hoja)}, ${r.planta === 'inicial' ? 'sumado en la' : 'planta'} ${kcEtiquetaPlanta(r.planta)}: ${r.lineas.length} línea(s), ${kcNum(total)} unidades.
                    ${r.yaAplicado ? '<br>Hubo un corte de conexión; se comprobó que los cambios ya estaban guardados y <strong>no se repitieron</strong>.' : ''}
                    ${r.intentos > 1 && !r.yaAplicado ? `<br>Alguien más guardó al mismo tiempo; se aplicó sobre la versión más reciente (intento ${r.intentos}).` : ''}
                </div>
                <div class="kc-tabla-scroll"><table class="kc-tabla"><thead><tr><th>Fila</th><th>Producto</th><th>Variante</th><th class="num">Saldo antes</th><th class="num">Ingreso</th><th class="num">Saldo después</th></tr></thead><tbody>
                ${r.lineas.map(l => `<tr><td>${l.fila}</td><td>${kcEsc(l.producto)}</td><td>${kcEsc(l.descripcion)}${l.nueva ? ' <span class="kc-chip kc-chip-info">NUEVA</span>' : ''}</td><td class="num">${kcNum(l.antes)}</td><td class="num">+${kcNum(l.cantidad)}</td><td class="num"><strong>${kcNum(l.despues)}</strong></td></tr>`).join('')}
                </tbody></table></div>
                <div class="modal-buttons">
                    <button type="button" class="btn btn-secondary" data-kc="cerrar">Cerrar</button>
                    <button type="button" class="btn btn-success" data-kc="nueva-carga">Hacer otra carga</button>
                </div>`;
        }
