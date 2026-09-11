        // ============================================
        // GESTIÓN DE SUCURSALES (alta / edición / baja manual)
        // ============================================
        // El catálogo Shalom lo sincroniza el bot en la nube (ver js/sucursales-nube.js).
        // Acá solo se maneja el CRUD MANUAL: sucursales que el usuario agrega en su
        // propio catálogo local. Se persisten en localStorage (clave
        // sucursales_manuales_<usuario>) vía persistirSucursalesManuales(), no en el
        // "estado" de la cotización. Editar o borrar una sucursal oficial (oficial:true)
        // es un cambio efímero: la próxima sincronización la vuelve a traer.

        function agregarNuevaSucursal(event) {
            event.preventDefault();

            const nombre = document.getElementById('newSucursalNombre').value.trim();
            const direccion = document.getElementById('newSucursalDireccion').value.trim();
            const ciudad = document.getElementById('newSucursalCiudad').value.trim();
            const provincia = document.getElementById('newSucursalProvincia').value.trim();
            const tipo = document.getElementById('newSucursalTipo').value;

            const existe = sucursalesDB.find(s => (s.nombre || '').toLowerCase() === nombre.toLowerCase());
            if (existe) {
                mostrarNotificacion('Ya existe una sucursal con ese nombre', 'warning');
                return;
            }

            sucursalesDB.push({ nombre, direccion, ciudad, provincia, tipo, telefono: '', horario: '' });
            persistirSucursalesManuales();
            renderSucursalList();
            renderSucursales();
            poblarListaProvincias();

            document.getElementById('newSucursalForm').reset();
            mostrarNotificacion('Sucursal agregada correctamente', 'success');
        }

        function renderSucursalList() {
            const tbody = document.getElementById('sucursalListBody');
            if (!tbody) return;
            const searchValue = document.getElementById('searchSucursalGestion').value.toLowerCase();

            document.getElementById('sucursalCount').textContent = sucursalesDB.length;

            // Estado de error de carga (sin caché utilizable): mensaje claro, sin tabla.
            if (typeof sucursalesCargaError !== 'undefined' && sucursalesCargaError && !sucursalesCargadas && sucursalesDB.filter(s => s.oficial).length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--gray-600);">
                    No se pudo cargar el catálogo de sucursales Shalom.
                    <button type="button" class="btn btn-small" style="margin-left:10px;" onclick="reintentarCargaSucursales()">↻ Reintentar</button>
                </td></tr>`;
                return;
            }

            let filtered = sucursalesDB;
            if (searchValue.length >= 2) {
                filtered = sucursalesDB.filter(s =>
                    (s.nombre || '').toLowerCase().includes(searchValue) ||
                    (s.ciudad || '').toLowerCase().includes(searchValue) ||
                    (s.provincia || '').toLowerCase().includes(searchValue)
                );
            }

            const bannerError = (typeof sucursalesCargaError !== 'undefined' && sucursalesCargaError)
                ? `<tr><td colspan="6" style="padding:10px 12px; background:#fffbea; color:#92400e; font-size:0.85em;">⚠️ No se pudo actualizar el catálogo desde la nube. Mostrando la última sincronización guardada.</td></tr>`
                : '';

            tbody.innerHTML = bannerError + filtered.map((sucursal) => {
                const realIndex = sucursalesDB.findIndex(s => s.nombre === sucursal.nombre);
                const origen = sucursal.oficial
                    ? '<span class="sucursal-oficial-badge">✓ Shalom</span>'
                    : '<span class="sucursal-manual-badge">✎ Manual</span>';
                return `
                    <tr>
                        <td class="producto-cell">${sucursal.nombre} ${origen}</td>
                        <td>${sucursal.direccion || ''}</td>
                        <td>${sucursal.ciudad || ''}</td>
                        <td>${sucursal.provincia || ''}</td>
                        <td><span class="sucursal-tipo">${sucursal.tipo || ''}</span></td>
                        <td>
                            <button class="btn-edit" onclick="editarSucursal(${realIndex})">✏️</button>
                            <button class="btn-remove" onclick="eliminarSucursal(${realIndex})">🗑️</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('searchSucursalGestion').addEventListener('input', renderSucursalList);

        function editarSucursal(index) {
            sucursalEditandoIndex = index;
            const sucursal = sucursalesDB[index];
            if (!sucursal) return;

            document.getElementById('editSucursalNombre').value = sucursal.nombre || '';
            document.getElementById('editSucursalDireccion').value = sucursal.direccion || '';
            document.getElementById('editSucursalCiudad').value = sucursal.ciudad || '';
            document.getElementById('editSucursalProvincia').value = sucursal.provincia || '';
            document.getElementById('editSucursalTipo').value = sucursal.tipo || '';

            document.getElementById('editSucursalModal').classList.add('active');
        }

        function closeEditSucursalModal() {
            document.getElementById('editSucursalModal').classList.remove('active');
            sucursalEditandoIndex = -1;
        }

        document.getElementById('editSucursalForm').addEventListener('submit', function(e) {
            e.preventDefault();

            if (sucursalEditandoIndex === -1) return;

            const anterior = sucursalesDB[sucursalEditandoIndex] || {};
            const eraSeleccionada = sucursalSeleccionada && anterior && sucursalSeleccionada.nombre === anterior.nombre;

            const actualizada = {
                nombre: document.getElementById('editSucursalNombre').value.trim(),
                direccion: document.getElementById('editSucursalDireccion').value.trim(),
                ciudad: document.getElementById('editSucursalCiudad').value.trim(),
                provincia: document.getElementById('editSucursalProvincia').value.trim(),
                tipo: document.getElementById('editSucursalTipo').value,
                telefono: anterior.telefono || '',
                horario: anterior.horario || '',
                // Se conserva el origen. OJO: si editas una sucursal oficial (de la nube),
                // el cambio dura hasta la próxima sincronización, que la vuelve a traer.
                oficial: anterior.oficial || undefined,
                objectId: anterior.objectId || undefined
            };

            sucursalesDB[sucursalEditandoIndex] = actualizada;
            if (eraSeleccionada) sucursalSeleccionada = { ...actualizada };

            persistirSucursalesManuales();
            renderSucursalList();
            renderSucursales();
            poblarListaProvincias();
            if (eraSeleccionada) mostrarSucursalSeleccionada();
            closeEditSucursalModal();
            mostrarNotificacion('Sucursal actualizada', 'success');
        });

        function eliminarSucursal(index) {
            if (!confirm('¿Eliminar esta sucursal permanentemente?')) return;
            const eliminada = sucursalesDB[index];
            sucursalesDB.splice(index, 1);

            if (eliminada && sucursalSeleccionada && sucursalSeleccionada.nombre === eliminada.nombre) {
                sucursalSeleccionada = null;
                const sel = document.getElementById('sucursalSeleccionada');
                if (sel) sel.style.display = 'none';
                if (typeof actualizarPanelEnvioCotizar === 'function') actualizarPanelEnvioCotizar();
            }

            persistirSucursalesManuales();
            renderSucursalList();
            renderSucursales();
            poblarListaProvincias();
            mostrarNotificacion(eliminada && eliminada.oficial
                ? 'Sucursal quitada (volverá en la próxima sincronización con Shalom)'
                : 'Sucursal eliminada', 'success');
        }
