// ============================================
// AUTENTICACIÓN — Parse User (Back4App)
// ============================================
let usuarioActual = null; // { objectId, username, nombre, sessionToken }

function headersBack4App(extra = {}) {
    return Object.assign({
        'X-Parse-Application-Id': BACK4APP_CONFIG.appId,
        'X-Parse-REST-API-Key': BACK4APP_CONFIG.restApiKey,
        'Content-Type': 'application/json'
    }, extra);
}

function mostrarErrorAuth(mensaje) {
    const el = document.getElementById('authError');
    el.textContent = mensaje;
    el.style.display = 'block';
}

function ocultarErrorAuth() {
    document.getElementById('authError').style.display = 'none';
}

async function iniciarSesion(event) {
    event.preventDefault();
    ocultarErrorAuth();
    const btn = document.getElementById('btnLogin');
    const usuario = document.getElementById('loginUsuario').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        btn.disabled = true;
        btn.textContent = 'Ingresando...';

        const url = `${BACK4APP_CONFIG.serverUrl}/login?username=${encodeURIComponent(usuario)}&password=${encodeURIComponent(password)}`;
        const resp = await fetch(url, { headers: headersBack4App() });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Usuario o contraseña incorrectos');

        guardarSesion(data);
        mostrarApp();
    } catch (e) {
        console.error('Error al iniciar sesión:', e);
        mostrarErrorAuth(e.message || 'No se pudo iniciar sesión');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
    }
}

// Traduce el campo "categoria" del usuario (Back4App) a un nivel interno.
// 'master'        -> acceso total (como hasta ahora).
// 'control_diario' -> usuario creado SOLO para registrar/consultar el Control Diario;
//                     solo ve las pestañas Control Diario y Kardex (ver aplicarPermisosPorNivel()).
// cualquier otro valor -> 'estandar' (uso normal del cotizador, como hasta ahora).
function traducirNivelUsuario(categoria) {
    // Se normaliza (sin tildes, minúsculas, sin espacios/guiones) para que no dependa de
    // que el campo "categoria" en Back4App esté escrito EXACTAMENTE igual
    // (p.ej. "Control_Diario", "control diario" o "control-diario" también deben funcionar).
    const valor = normalizarTexto(categoria || '').replace(/[\s_-]+/g, '');
    if (valor === 'master') return 'master';
    if (valor === 'controldiario') return 'control_diario';
    return 'estandar';
}

function guardarSesion(data) {
    usuarioActual = {
        objectId: data.objectId,
        username: data.username,
        nombre: data.nombre || data.username,
        nivel: traducirNivelUsuario(data.categoria),
        sessionToken: data.sessionToken
    };
    localStorage.setItem('sesionUsuario', JSON.stringify(usuarioActual));
}

// Verifica si hay una sesión guardada y si el token todavía es válido en Back4App
async function verificarSesionGuardada() {
    const guardada = localStorage.getItem('sesionUsuario');
    if (!guardada) { mostrarLogin(); return; }

    const sesion = JSON.parse(guardada);

    try {
        const resp = await fetch(`${BACK4APP_CONFIG.serverUrl}/users/me`, {
            headers: headersBack4App({ 'X-Parse-Session-Token': sesion.sessionToken })
        });
        const data = await resp.json();

        if (!resp.ok) {
            // Solo cerramos sesión si el servidor confirma que el token ya no es válido (código 209/401).
            // Cualquier otro problema (servidor caído, etc.) no debe expulsar al usuario.
            if (resp.status === 401 || data.code === 209) throw new Error('Sesión expirada');
            console.warn('No se pudo validar la sesión (posible problema de red), se continúa con los datos guardados.');
            usuarioActual = sesion;
            mostrarApp();
            return;
        }

        // Refresca nombre/nivel por si el admin los cambió desde el dashboard
        usuarioActual = {
            objectId: data.objectId,
            username: data.username,
            nombre: data.nombre || data.username,
            nivel: traducirNivelUsuario(data.categoria),
            sessionToken: sesion.sessionToken
        };
        localStorage.setItem('sesionUsuario', JSON.stringify(usuarioActual));
        mostrarApp();
    } catch (e) {
        if (e.message === 'Sesión expirada') {
            console.warn('Sesión inválida, se pide iniciar sesión de nuevo.');
            localStorage.removeItem('sesionUsuario');
            mostrarLogin();
        } else {
            // Error de red u otro imprevisto: mantenemos la sesión abierta con los datos que ya teníamos
            console.warn('No se pudo contactar al servidor, se continúa con la sesión guardada localmente:', e.message);
            usuarioActual = sesion;
            mostrarApp();
        }
    }
}

async function cerrarSesion() {
    try {
        if (usuarioActual?.sessionToken) {
            await fetch(`${BACK4APP_CONFIG.serverUrl}/logout`, {
                method: 'POST',
                headers: headersBack4App({ 'X-Parse-Session-Token': usuarioActual.sessionToken })
            });
        }
    } catch (e) {
        console.warn('No se pudo cerrar sesión en el servidor:', e);
    }
    localStorage.removeItem('sesionUsuario');
    usuarioActual = null;
    // FIX: inicializarAppPostLogin() solo corría una vez por carga de página (appYaInicializada).
    // Si alguien cerraba sesión y OTRO usuario iniciaba sesión sin recargar la pestaña (algo normal
    // en un equipo/tablet compartido), la app nunca volvía a cargar el estado del nuevo usuario y
    // seguía con lo que había quedado en memoria del anterior (carrito, cliente, registroEnCurso con
    // sus objectId). Al cerrar sesión, se limpia todo ese estado en memoria para que el siguiente
    // login arranque de cero y sí vuelva a inicializar todo para el usuario correcto.
    appYaInicializada = false;
    productosEnTabla = [];
    modoDesarrollador = false;
    const bannerPrueba = document.getElementById('bannerModoPrueba');
    if (bannerPrueba) bannerPrueba.style.display = 'none';
    const btnPrueba = document.getElementById('btnToggleModoPrueba');
    if (btnPrueba) btnPrueba.style.display = 'none';
    sucursalSeleccionada = null;
    registroEnCurso = { cotizacion: null, orden_compra: null, despacho: null };
    tipoContadorCargadoExplicitamente = null;
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('userBadge').style.display = 'none';
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('loginUsuario').value = '';
    document.getElementById('loginPassword').value = '';
}

function mostrarLogin() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appContainer').style.display = 'none';
}

function mostrarApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appContainer').style.display = 'block';

    const badge = document.getElementById('userBadge');
    badge.style.display = 'flex';
    document.getElementById('userBadgeNombre').textContent = usuarioActual.nombre;
    document.getElementById('userBadgeAvatar').textContent = (usuarioActual.nombre || '?').trim().charAt(0).toUpperCase();

    if (typeof inicializarAppPostLogin === 'function') inicializarAppPostLogin();
}

        // ============================================
        // PERMISOS POR NIVEL (categoría 'control_diario' -> solo ve Control Diario + Kardex)
        // ============================================
        function aplicarPermisosPorNivel() {
            const esControlDiario = usuarioActual?.nivel === 'control_diario';
            console.log('🔐 aplicarPermisosPorNivel -> nivel detectado:', usuarioActual?.nivel);

            // Para este rol, "Más" deja de ser un desplegable/hoja flotante: el panel pasa a
            // mostrarse siempre, en el flujo normal (ver reglas .forced-open en el CSS).
            document.querySelectorAll('.tabs-more, .tabs-mobile-more').forEach(el => {
                el.classList.toggle('forced-open', esControlDiario);
            });

            document.querySelectorAll('[data-tab]').forEach(btn => {
                const tab = btn.getAttribute('data-tab');
                const permitidoParaControlDiario = tab === 'controldiario' || tab === 'kardex';
                btn.style.display = (!esControlDiario || permitidoParaControlDiario) ? '' : 'none';
            });

            if (esControlDiario) {
                document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelectorAll('[data-tab="controldiario"]').forEach(t => t.classList.add('active'));
                const contenidoCD = document.getElementById('tab-controldiario');
                if (contenidoCD) contenidoCD.classList.add('active');
                tabActual = 'controldiario';
                cargarMovimientosControlDiario();
            }
        }

