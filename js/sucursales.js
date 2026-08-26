        // ============================================
        // GESTIÓN DE SUCURSALES
        // ============================================

        function agregarNuevaSucursal(event) {
            event.preventDefault();
            
            const nombre = document.getElementById('newSucursalNombre').value.trim();
            const direccion = document.getElementById('newSucursalDireccion').value.trim();
            const ciudad = document.getElementById('newSucursalCiudad').value.trim();
            const provincia = document.getElementById('newSucursalProvincia').value.trim();
            const tipo = document.getElementById('newSucursalTipo').value;
            
            const existe = sucursalesDB.find(s => s.nombre === nombre);
            if (existe) {
                mostrarNotificacion('Ya existe una sucursal con ese nombre', 'warning');
                return;
            }
            
            sucursalesDB.push({ nombre, direccion, ciudad, provincia, tipo });
            guardarEstado();
            renderSucursalList();
            
            document.getElementById('newSucursalForm').reset();
            mostrarNotificacion('Sucursal agregada correctamente', 'success');
        }

        function renderSucursalList() {
            const tbody = document.getElementById('sucursalListBody');
            const searchValue = document.getElementById('searchSucursalGestion').value.toLowerCase();
            
            document.getElementById('sucursalCount').textContent = sucursalesDB.length;
            
            let filtered = sucursalesDB;
            if (searchValue.length >= 2) {
                filtered = sucursalesDB.filter(s => 
                    s.nombre.toLowerCase().includes(searchValue) ||
                    s.ciudad.toLowerCase().includes(searchValue) ||
                    s.provincia.toLowerCase().includes(searchValue)
                );
            }
            
            tbody.innerHTML = filtered.map((sucursal, index) => {
                const realIndex = sucursalesDB.findIndex(s => s.nombre === sucursal.nombre);
                return `
                    <tr>
                        <td class="producto-cell">${sucursal.nombre}</td>
                        <td>${sucursal.direccion}</td>
                        <td>${sucursal.ciudad}</td>
                        <td>${sucursal.provincia}</td>
                        <td><span class="sucursal-tipo">${sucursal.tipo}</span></td>
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
            
            document.getElementById('editSucursalNombre').value = sucursal.nombre;
            document.getElementById('editSucursalDireccion').value = sucursal.direccion;
            document.getElementById('editSucursalCiudad').value = sucursal.ciudad;
            document.getElementById('editSucursalProvincia').value = sucursal.provincia;
            document.getElementById('editSucursalTipo').value = sucursal.tipo;
            
            document.getElementById('editSucursalModal').classList.add('active');
        }

        function closeEditSucursalModal() {
            document.getElementById('editSucursalModal').classList.remove('active');
            sucursalEditandoIndex = -1;
        }

        document.getElementById('editSucursalForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (sucursalEditandoIndex === -1) return;

            const nuevoNombre = document.getElementById('editSucursalNombre').value.trim();
            const nuevaDireccion = document.getElementById('editSucursalDireccion').value.trim();
            const nuevaCiudad = document.getElementById('editSucursalCiudad').value.trim();
            const nuevaProvincia = document.getElementById('editSucursalProvincia').value.trim();
            const nuevoTipo = document.getElementById('editSucursalTipo').value;

            sucursalesDB[sucursalEditandoIndex] = {
                nombre: nuevoNombre,
                direccion: nuevaDireccion,
                ciudad: nuevaCiudad,
                provincia: nuevaProvincia,
                tipo: nuevoTipo
            };

            renderSucursalList();
            closeEditSucursalModal();
            guardarEstado();
            mostrarNotificacion('Sucursal actualizada', 'success');
        });

        function eliminarSucursal(index) {
            if (confirm('¿Eliminar esta sucursal permanentemente?')) {
                sucursalesDB.splice(index, 1);
                guardarEstado();
                renderSucursalList();
                mostrarNotificacion('Sucursal eliminada', 'success');
            }
        }

