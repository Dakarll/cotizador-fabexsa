// ============================================
// UI ALERTS — toasts, alertas y confirmaciones propias
// ============================================
// Reemplazan alert()/confirm() nativos (que bloquean el hilo, rompen la identidad visual y no
// se pueden estilizar) y renuevan mostrarNotificacion().
//
//   mostrarToast(mensaje, tipo, opciones)  → aviso NO bloqueante (success | info | warning | error)
//   mostrarAlerta({ titulo, mensaje, tipo, detalle, botonTexto })  → Promise<void>
//   confirmarAccion({ titulo, mensaje, confirmarTexto, cancelarTexto, destructivo, tipo })
//                                            → Promise<boolean>   (reemplazo directo de confirm())
//
// confirmarAccion es ASÍNCRONO: quien la llame debe usar `await` dentro de una función async.
// Estilos en css/ui-alerts.css. Sin dependencias.

(function () {
    'use strict';

    const SVG = p => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${p}</svg>`;
    const ICONOS = {
        success: SVG('<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>'),
        warning: SVG('<path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>'),
        error: SVG('<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>'),
        info: SVG('<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2"/>')
    };

    const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'; // mismo valor que --ease-out (para WAAPI)
    const SALIDA_TOAST_MS = 200;
    const SALIDA_DIALOGO_MS = 170;
    const MAX_TOASTS = 4;

    const prefiereMenosMovimiento = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const puedeHover = () =>
        window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // ------------------------------------------------------------------
    // TOASTS (no bloqueantes)
    // ------------------------------------------------------------------
    let region = null;

    function obtenerRegion() {
        if (region && region.isConnected) return region;
        region = document.createElement('div');
        region.className = 'toast-region';
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
        return region;
    }

    // Los errores y avisos suelen pedir una acción del usuario (revisar el Kardex, reintentar),
    // así que duran más que un "guardado" — y los mensajes largos necesitan más tiempo de lectura.
    function duracionToast(tipo, mensaje) {
        const base = { success: 3000, info: 3500, warning: 5500, error: 7000 }[tipo];
        return Math.min(9000, base + Math.max(0, mensaje.length - 50) * 35);
    }

    function programarCierre(el, ms) {
        clearTimeout(el._timer);
        if (!ms) return; // 0 = persistente (solo se cierra al tocarlo)
        el._restante = ms;
        el._inicio = Date.now();
        el._timer = setTimeout(() => cerrarToast(el), ms);
    }

    function mostrarToast(mensaje, tipo, opciones) {
        const t = ICONOS[tipo] ? tipo : 'info';
        const texto = String(mensaje == null ? '' : mensaje);
        const opts = opciones || {};
        const reg = obtenerRegion();
        const ms = opts.duracion !== undefined ? opts.duracion : duracionToast(t, texto);
        const clave = t + '|' + texto;

        // El mismo aviso repetido (p. ej. tocar "Guardar" tres veces con el mismo error) no apila
        // copias: reinicia el tiempo del existente y le da un pequeño pulso.
        const existente = Array.from(reg.children).find(el => el.dataset.clave === clave && !el.dataset.leaving);
        if (existente) {
            programarCierre(existente, ms);
            if (!prefiereMenosMovimiento() && existente.animate) {
                existente.animate(
                    [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
                    { duration: 220, easing: EASE_OUT }
                );
            }
            return existente;
        }

        const el = document.createElement('div');
        el.className = `toast toast--${t}`;
        el.dataset.clave = clave;
        el.setAttribute('role', t === 'error' || t === 'warning' ? 'alert' : 'status');

        const icono = document.createElement('span');
        icono.className = 'toast-icon';
        icono.innerHTML = ICONOS[t]; // constante interna, nunca texto del usuario

        const cuerpo = document.createElement('span');
        cuerpo.className = 'toast-text';
        cuerpo.textContent = texto; // textContent: el mensaje puede traer nombres de clientes/productos

        el.append(icono, cuerpo);
        reg.appendChild(el);

        // Los más antiguos salen primero si se acumulan demasiados
        const visibles = Array.from(reg.children).filter(x => !x.dataset.leaving);
        visibles.slice(0, Math.max(0, visibles.length - MAX_TOASTS)).forEach(cerrarToast);

        void el.offsetWidth; // confirma el estado inicial para que la transición de entrada corra
        el.dataset.mounted = 'true';

        el.addEventListener('click', () => cerrarToast(el));
        if (puedeHover()) {
            el.addEventListener('pointerenter', () => {
                clearTimeout(el._timer);
                el._restante = Math.max(1200, (el._restante || 0) - (Date.now() - (el._inicio || Date.now())));
            });
            el.addEventListener('pointerleave', () => programarCierre(el, el._restante));
        }
        programarCierre(el, ms);
        return el;
    }

    function cerrarToast(el) {
        if (!el || el.dataset.leaving || !el.isConnected) return;
        clearTimeout(el._timer);

        // FLIP: los toasts de abajo se deslizan a su nueva posición en vez de saltar
        const hermanos = Array.from(region.children).filter(x => x !== el && !x.dataset.leaving);
        const antes = new Map(hermanos.map(x => [x, x.getBoundingClientRect().top]));
        const caja = el.getBoundingClientRect();
        el.style.width = caja.width + 'px';
        el.style.position = 'absolute'; // sale del flujo pero conserva su lugar mientras se desvanece
        el.dataset.leaving = 'true';

        if (!prefiereMenosMovimiento()) {
            hermanos.forEach(x => {
                const delta = antes.get(x) - x.getBoundingClientRect().top;
                if (delta && x.animate) {
                    x.animate(
                        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
                        { duration: 240, easing: EASE_OUT }
                    );
                }
            });
        }
        setTimeout(() => el.remove(), SALIDA_TOAST_MS + 40);
    }

    // ------------------------------------------------------------------
    // DIÁLOGOS (alerta / confirmación) sobre <dialog>: foco atrapado, Esc, fondo inerte y
    // capa superior nativos. Se encolan: si hay uno abierto, el siguiente espera su turno.
    // ------------------------------------------------------------------
    let cola = Promise.resolve();
    let contadorId = 0;

    function abrirDialogo(cfg) {
        const turno = cola.then(() => mostrarDialogo(cfg));
        cola = turno.catch(() => {});
        return turno;
    }

    function mostrarDialogo(cfg) {
        return new Promise(resolve => {
            const id = 'uiDialog' + (++contadorId);
            const previo = document.activeElement;
            const dlg = document.createElement('dialog');
            dlg.className = 'ui-dialog' + (cfg.tipo ? ` ui-dialog--${cfg.tipo}` : '');
            dlg.setAttribute('aria-labelledby', id + 'T');
            dlg.setAttribute('aria-describedby', id + 'M');
            if (cfg.tipo === 'error') dlg.setAttribute('role', 'alertdialog');

            const cuerpo = document.createElement('div');
            cuerpo.className = 'ui-dialog-body';

            if (cfg.tipo && ICONOS[cfg.tipo]) {
                const ic = document.createElement('span');
                ic.className = 'ui-dialog-icon';
                ic.innerHTML = ICONOS[cfg.tipo];
                cuerpo.appendChild(ic);
            }
            const h = document.createElement('h2');
            h.className = 'ui-dialog-title';
            h.id = id + 'T';
            h.textContent = cfg.titulo;
            cuerpo.appendChild(h);

            if (cfg.mensaje) {
                const p = document.createElement('p');
                p.className = 'ui-dialog-message';
                p.id = id + 'M';
                p.textContent = cfg.mensaje;
                cuerpo.appendChild(p);
            }
            if (cfg.detalle) {
                const det = document.createElement('details');
                det.className = 'ui-dialog-detalle';
                const sum = document.createElement('summary');
                sum.textContent = 'Detalle técnico';
                const pre = document.createElement('pre');
                pre.textContent = cfg.detalle;
                det.append(sum, pre);
                cuerpo.appendChild(det);
            }

            const acciones = document.createElement('div');
            acciones.className = 'ui-dialog-actions';
            // Botones largos o más de dos: se apilan (como iOS), con la acción principal arriba
            const apilar = cfg.acciones.length > 2 || cfg.acciones.some(a => a.texto.length > 16);
            if (apilar) dlg.dataset.stack = 'true';
            const orden = apilar ? cfg.acciones.slice().reverse() : cfg.acciones;

            let cerrado = false;
            function cerrar(valor) {
                if (cerrado) return;
                cerrado = true;
                delete dlg.dataset.open;
                dlg.dataset.closing = 'true';
                setTimeout(() => {
                    dlg.close();
                    dlg.remove();
                    if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus({ preventScroll: true });
                    resolve(valor);
                }, prefiereMenosMovimiento() ? 0 : SALIDA_DIALOGO_MS);
            }

            const botones = orden.map(a => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `ui-dialog-btn ui-dialog-btn--${a.rol}`;
                b.textContent = a.texto;
                b.addEventListener('click', () => cerrar(a.valor));
                acciones.appendChild(b);
                return b;
            });

            dlg.append(cuerpo, acciones);
            dlg.addEventListener('cancel', e => { e.preventDefault(); cerrar(cfg.valorCancelar); }); // tecla Esc

            const shell = document.getElementById('appShell');
            // Dentro de #appShell hereda los tokens de modo oscuro (que solo viven ahí); antes del
            // login (shell oculto) va directo al body.
            (shell && shell.offsetParent !== null ? shell : document.body).appendChild(dlg);
            dlg.showModal();
            void dlg.offsetWidth;
            dlg.dataset.open = 'true';

            // Foco seguro: en acciones destructivas arranca en "Cancelar", nunca en "Eliminar"
            const objetivo = orden.findIndex(a => a.rol === cfg.rolFoco);
            (botones[objetivo] || botones[0]).focus({ preventScroll: true });
        });
    }

    function normalizar(op) {
        return typeof op === 'string' ? { mensaje: op } : (op || {});
    }

    function mostrarAlerta(op) {
        const o = normalizar(op);
        return abrirDialogo({
            tipo: o.tipo || 'info',
            titulo: o.titulo || 'Aviso',
            mensaje: o.mensaje,
            detalle: o.detalle,
            acciones: [{ texto: o.botonTexto || 'Entendido', valor: true, rol: 'primary' }],
            valorCancelar: true,
            rolFoco: 'primary'
        });
    }

    function confirmarAccion(op) {
        const o = normalizar(op);
        return abrirDialogo({
            tipo: o.tipo || (o.destructivo ? 'warning' : null),
            titulo: o.titulo || '¿Confirmar acción?',
            mensaje: o.mensaje,
            detalle: o.detalle,
            acciones: [
                { texto: o.cancelarTexto || 'Cancelar', valor: false, rol: 'cancel' },
                { texto: o.confirmarTexto || 'Confirmar', valor: true, rol: o.destructivo ? 'destructive' : 'primary' }
            ],
            valorCancelar: false,
            rolFoco: o.destructivo ? 'cancel' : 'primary'
        });
    }

    window.mostrarToast = mostrarToast;
    window.mostrarAlerta = mostrarAlerta;
    window.confirmarAccion = confirmarAccion;
})();
