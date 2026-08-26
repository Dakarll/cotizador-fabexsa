        // ============================================
        // BASE DE DATOS DE CLIENTES (Back4App — misma nube que Cotizaciones)
        // ============================================
        const CLASE_CLIENTES = 'Clientes';
        let clientesDBCache = [];       // copia en memoria, para que el buscador responda al instante mientras escribes
        let clientesDBCargando = null;  // evita disparar la misma carga varias veces en paralelo

        // SWITCH: controla si al entrar a Historial se ejecuta la migración que sube los clientes
        // de las cotizaciones ya existentes hacia la clase "Clientes" en la nube (ver
        // migrarClientesDesdeHistorialSiHaceFalta más abajo). Una vez que confirmes que tus
        // clientes ya quedaron importados, cambia esto a "false" y súbelo — así ese proceso deja de
        // ejecutarse por completo (ni siquiera revisa si la clase está vacía) en cada entrada a
        // Historial, en cualquier dispositivo.
        const MIGRAR_CLIENTES_DESDE_HISTORIAL = false;

        // Trae todos los clientes desde Back4App a la caché en memoria. Se llama al iniciar la
        // app y también se refresca cada vez que se guarda una cotización, para que el resto de
        // dispositivos/usuarios vayan viendo los clientes nuevos de otros.
        async function cargarClientesDesdeNube() {
            if (clientesDBCargando) return clientesDBCargando;
            clientesDBCargando = (async () => {
                try {
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CLIENTES}?order=-updatedAt&limit=1000`, {
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken })
                    });
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const data = await resp.json();
                    clientesDBCache = data.results || [];
                } catch (e) {
                    console.error('No se pudo cargar la base de datos de clientes desde la nube:', e);
                }
            })();
            await clientesDBCargando;
            clientesDBCargando = null;
        }

        function getClientesDB() {
            return clientesDBCache;
        }

        // Busca en la caché en memoria si ya existe un cliente con ese nombre+empresa (para
        // decidir si se debe crear un registro nuevo en Back4App o actualizar el existente).
        function buscarClienteDBCachePorNombreEmpresa(nombre, empresa) {
            return clientesDBCache.findIndex(c =>
                (c.nombre || '').toLowerCase() === (nombre || '').toLowerCase() &&
                (c.empresa || '').toLowerCase() === (empresa || '').toLowerCase()
            );
        }

        // Cola de guardados de cliente: obliga a que dos guardados casi simultáneos (por ejemplo,
        // click en "💾 Guardar cliente en base de datos" seguido de inmediato por "Generar imagen"
        // o "Generar PDF", antes de que el primero termine de responder) se ejecuten uno DESPUÉS
        // del otro y nunca en paralelo. Sin esto, ambos podrían arrancar sin saber todavía el
        // objectId que el otro está a punto de crear, y terminar creando 2 clientes duplicados.
        let colaGuardadoCliente = Promise.resolve();

        // Guarda/actualiza un cliente DIRECTAMENTE en la base de datos en la nube (Back4App, clase
        // "Clientes") — la misma base donde ya se guardan las Cotizaciones. Antes esto se guardaba
        // solo en el navegador (localStorage), por lo que no se compartía entre dispositivos ni
        // usuarios, y encima solo se activaba si alguien apretaba a propósito el botón "💾 Guardar
        // cliente en base de datos". Ahora se llama automáticamente cada vez que se guarda una
        // cotización/OC/despacho, y queda disponible para cualquiera que use la app.
        //
        // usarSeguimientoFormulario (default true): cuando es true, usa (y actualiza) la variable
        // global clienteDBObjectIdEnCurso — el vínculo con el cliente que se está editando ahora
        // mismo en el formulario de "Cotizar". Se pone en false para guardados que NO tienen
        // relación con el formulario actual (p.ej. la migración masiva del historial, que recorre
        // muchos clientes distintos uno por uno) — así no se confunde ni se sobreescribe el cliente
        // que el usuario pueda tener cargado en el formulario en ese momento.
        //
        // Cuando sí se usa el seguimiento del formulario, el objectId se relee justo antes de
        // decidir qué hacer, DESPUÉS de esperar su turno en la cola. Así, si dos llamadas se
        // disparan casi al mismo tiempo (p.ej. "Guardar cliente" y luego "Generar imagen" antes de
        // que la primera termine), la segunda ve el objectId que acaba de crear la primera en vez de
        // una copia vieja (null), y actualiza ese mismo registro en vez de crear otro.
        //
        // Devuelve el objectId del registro guardado/actualizado, o null si falló.
        function guardarClienteDBSilencioso(cliente, usarSeguimientoFormulario = true) {
            if (!cliente || !cliente.nombre) return Promise.resolve(null);

            const miTurno = colaGuardadoCliente.then(() => guardarClienteDBSilenciosoInterno(cliente, usarSeguimientoFormulario));
            // Se encadena aunque el turno actual falle, para que un error no deje trabada la cola
            // y bloquee para siempre los guardados de cliente que vengan después.
            colaGuardadoCliente = miTurno.catch(() => null);
            return miTurno;
        }

        async function guardarClienteDBSilenciosoInterno(cliente, usarSeguimientoFormulario) {
            // Antes: si ya había una carga en curso (clientesDBCargando), esta función seguía de
            // largo sin esperarla y comparaba contra una caché todavía vacía — podía duplicar un
            // cliente que en realidad ya existía. Ahora siempre espera a que la caché esté lista
            // (cargarClientesDesdeNube reutiliza la carga en curso si ya hay una, no dispara una
            // segunda) antes de decidir si crea o actualiza.
            if (clientesDBCache.length === 0) await cargarClientesDesdeNube();

            // Se relee AHORA (ya con el turno ganado en la cola) — puede haber sido actualizada por
            // el guardado anterior, que era exactamente el mismo cliente. Si este guardado no tiene
            // relación con el formulario (migración), se ignora esta variable por completo.
            const objectIdConocido = usarSeguimientoFormulario ? clienteDBObjectIdEnCurso : null;

            // Si se conoce el objectId exacto, se usa ese en vez de buscar por nombre+empresa.
            const idx = objectIdConocido
                ? clientesDBCache.findIndex(c => c.objectId === objectIdConocido)
                : buscarClienteDBCachePorNombreEmpresa(cliente.nombre, cliente.empresa);
            try {
                let resultado = null;
                // Caso 1: el objectId venía marcado como conocido, pero ya no está en la caché
                // (por ejemplo, alguien lo borró desde el Dashboard de Back4App). Se actualiza
                // directo contra ese objectId igual — si de verdad ya no existe, Back4App
                // devolverá error y se cae al catch de abajo sin romper nada.
                if (objectIdConocido && idx < 0) {
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CLIENTES}/${objectIdConocido}`, {
                        method: 'PUT',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(cliente)
                    });
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const data = await resp.json();
                    clientesDBCache.unshift({ ...cliente, objectId: objectIdConocido, updatedAt: data.updatedAt || new Date().toISOString() });
                    resultado = objectIdConocido;
                } else if (idx >= 0) {
                    const existente = clientesDBCache[idx];
                    // Se combinan los datos: los campos nuevos no vacíos reemplazan a los viejos,
                    // pero si el usuario dejó algún campo en blanco esta vez (p.ej. borró el
                    // teléfono sin querer) no se pierde el dato que ya se tenía guardado.
                    const combinado = { ...existente };
                    Object.keys(cliente).forEach(campo => { if (cliente[campo]) combinado[campo] = cliente[campo]; });
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CLIENTES}/${existente.objectId}`, {
                        method: 'PUT',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(cliente)
                    });
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const data = await resp.json();
                    clientesDBCache[idx] = { ...combinado, updatedAt: data.updatedAt || new Date().toISOString() };
                    resultado = existente.objectId;
                } else {
                    const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/classes/${CLASE_CLIENTES}`, {
                        method: 'POST',
                        headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual?.sessionToken }),
                        body: JSON.stringify(cliente)
                    });
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const data = await resp.json();
                    clientesDBCache.unshift({ ...cliente, objectId: data.objectId, createdAt: data.createdAt, updatedAt: data.createdAt });
                    resultado = data.objectId;
                }
                // Se deja constancia inmediatamente del vínculo, ANTES de que el llamador retome el
                // control — así, si otro guardado ya está esperando su turno en la cola, lo ve.
                // Solo aplica cuando este guardado sí representa al formulario actual (ver arriba).
                if (resultado && usarSeguimientoFormulario) clienteDBObjectIdEnCurso = resultado;
                return resultado;
            } catch (e) {
                console.error('No se pudo guardar el cliente en la nube:', e);
                return null;
            }
        }

        async function guardarClienteDB() {
            const cliente = getClienteData();
            if (!cliente.nombre) { mostrarNotificacion('Ingresa al menos el nombre del cliente', 'warning'); return; }
            if (clientesDBCache.length === 0) await cargarClientesDesdeNube();
            const yaExistia = !!clienteDBObjectIdEnCurso || buscarClienteDBCachePorNombreEmpresa(cliente.nombre, cliente.empresa) >= 0;
            const idGuardado = await guardarClienteDBSilencioso(cliente);
            if (idGuardado) {
                mostrarNotificacion(yaExistia ? 'Cliente actualizado en la base de datos' : 'Cliente guardado en la base de datos', 'success');
            } else {
                mostrarNotificacion('No se pudo guardar el cliente en la nube. Revisa tu conexión.', 'warning');
            }
        }

        // MIGRACIÓN (una sola vez, para toda la empresa): antes de este fix no existía una clase
        // "Clientes" en la nube — los datos de cliente solo vivían dentro de cada Cotización. Esta
        // función toma los documentos ya guardados (historialCache, hasta 200 más recientes
        // visibles para este usuario) y crea/actualiza sus clientes correspondientes en la clase
        // "Clientes" de Back4App, para que el buscador funcione de inmediato con el historial real
        // y no solo "desde ahora en adelante".
        //
        // SWITCH (MIGRAR_CLIENTES_DESDE_HISTORIAL, arriba): mientras esté en "true", además revisa
        // que la clase "Clientes" siga vacía antes de migrar (para no duplicar si se te olvidó
        // apagar el switch). Pero la forma recomendada de dejar de usar esto para siempre, una vez
        // confirmado que tus clientes ya se importaron, es poner el switch en "false" — así ni
        // siquiera se hace esa revisión en cada entrada a Historial.
        async function migrarClientesDesdeHistorialSiHaceFalta() {
            if (!MIGRAR_CLIENTES_DESDE_HISTORIAL) return;

            if (clientesDBCache.length === 0) await cargarClientesDesdeNube();
            if (clientesDBCache.length > 0) return; // ya hay clientes en la nube: la migración ya se hizo (aquí o en otro lugar)

            for (const entry of (historialCache || [])) {
                const nombre = (entry.cliente || '').trim();
                if (!nombre || nombre.toLowerCase() === 'sin nombre') continue;
                await guardarClienteDBSilencioso({
                    nombre,
                    empresa: entry.empresaCliente || '',
                    ruc: entry.ruc || '',
                    telefono: entry.telefono || '',
                    email: entry.email || '',
                    direccion: entry.direccion || '',
                    notas: ''
                }, false); // false = no usar/tocar el vínculo del formulario; cada cliente de esta lista es independiente
            }

        }

        function buscarClienteDB(query) {
            const dropdown = document.getElementById('clienteDBDropdown');
            if (!query || query.length < 2) { dropdown.classList.remove('visible'); return; }
            const clientes = getClientesDB();
            const q = query.toLowerCase();
            const matches = clientes.filter(c =>
                (c.nombre || '').toLowerCase().includes(q) ||
                (c.empresa || '').toLowerCase().includes(q) ||
                (c.ruc || '').includes(q)
            ).slice(0, 6);

            if (matches.length === 0) { dropdown.classList.remove('visible'); return; }

            dropdown.innerHTML = matches.map((c, i) => `
                <div class="cliente-db-item" onclick="cargarClienteDB(${clientes.indexOf(c)})">
                    <div class="cliente-db-item-name">${c.nombre}</div>
                    <div class="cliente-db-item-sub">${[c.empresa, c.telefono, c.ruc].filter(Boolean).join(' · ')}</div>
                </div>
            `).join('');
            dropdown.classList.add('visible');
        }

        function cargarClienteDB(index) {
            const clientes = getClientesDB();
            const c = clientes[index];
            if (!c) return;
            document.getElementById('clienteNombre').value = c.nombre || '';
            document.getElementById('clienteEmpresa').value = c.empresa || '';
            document.getElementById('clienteRUC').value = c.ruc || '';
            document.getElementById('clienteTelefono').value = c.telefono || '';
            document.getElementById('clienteEmail').value = c.email || '';
            document.getElementById('clienteDireccion').value = c.direccion || '';
            document.getElementById('clienteNotas').value = c.notas || '';
            document.getElementById('clienteDBDropdown').classList.remove('visible');
            // Queda vinculado a ESTE registro exacto de la base de clientes: cualquier corrección
            // posterior (aunque sea al nombre) actualizará este mismo registro en vez de crear uno
            // nuevo por no encontrar coincidencia de nombre+empresa.
            clienteDBObjectIdEnCurso = c.objectId || null;
            actualizarResumenCliente();
            mostrarNotificacion(`${c.nombre} cargado`, 'success');
        }

        // Cerrar dropdown de clientes al click fuera
        document.addEventListener('click', function(e) {
            const dropdown = document.getElementById('clienteDBDropdown');
            const input = document.getElementById('clienteNombre');
            if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
                dropdown.classList.remove('visible');
            }
        });

