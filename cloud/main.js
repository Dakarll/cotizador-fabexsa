// ============================================
// CLOUD CODE — Asignación de correlativos (Cotización / Orden de Compra / Despacho / Producto genérico)
// ============================================
// Este archivo mueve al servidor la lógica que antes vivía en el navegador (ver, en index.html,
// el historial de comentarios sobre "obtenerYAvanzarNumeroDocumento" / "existeCorrelativoEnUso").
// El problema original: el navegador hacía un PUT con {__op:'Increment'} y, como Parse REST no
// devuelve el valor ya incrementado, hacía un SEGUNDO fetch por separado para leerlo. Entre esos
// dos requests HTTP (con la latencia real de internet de por medio) dos usuarios guardando casi
// al mismo tiempo podían terminar leyendo el mismo número. Eso ya pasó en producción (correlativos
// 582 y 518 duplicados en `cotizacion`, mismo timestamp).
//
// ⚠️ MECANISMO DE ATOMICIDAD — LEER ANTES DE TOCAR ESTE ARCHIVO ⚠️
// Mover el incremento+lectura a Cloud Code acorta MUCHÍSIMO la ventana de carrera (pasa de "dos
// round-trips HTTPS entre el navegador de dos usuarios distintos" a "dos operaciones de base de
// datos ejecutadas una detrás de otra dentro del mismo proceso del servidor"), pero es importante
// ser honesto sobre lo que este mecanismo garantiza y lo que no:
//
//   1) `contador.increment('siguienteNumero'); await contador.save(null, {useMasterKey:true})`
//      SÍ es atómico a nivel de base de datos (Mongo aplica $inc de forma serializada sobre el
//      mismo documento: nunca se "pierde" un incremento). Pero el valor que el SDK de Parse deja
//      en el objeto localmente tras el save() se calcula como "valor que este mismo proceso leyó
//      antes de guardar" + 1 — NO es una relectura fresca post-escritura. Si dos invocaciones de
//      esta función corren en paralelo y ambas leen el contador ANTES de que la otra guarde, en
//      teoría ambas podrían calcular localmente el mismo "próximo número". Esta es una limitación
//      conocida y documentada de Parse Server (no hay, en la API pública de Parse, un equivalente
//      a un "findOneAndUpdate" que devuelva el valor post-incremento garantizado). Por eso este
//      mecanismo por sí solo NO es la garantía final — es la primera capa, y reduce la ventana de
//      milisegundos-de-red a microsegundos-de-proceso-único.
//   2) Como SEGUNDA capa, antes de entregar el número se verifica que ningún documento ACTIVO
//      (`activo: true`) de ese mismo `tipoDocumento` lo esté usando ya en la clase `Cotizaciones`
//      (o, para `producto_generico`, en `Productos`). Si ya está en uso, se reintenta con el
//      siguiente número (hasta 5 veces). Esto atrapa el caso en que la carrera SÍ se dio y el otro
//      proceso ya alcanzó a guardar su documento.
//   3) Como TERCERA capa y garantía FINAL (la que de verdad cierra el 100% del problema): la base
//      de datos tiene un ÍNDICE ÚNICO compuesto sobre (tipoDocumento, correlativo, sufijoDespacho)
//      en la clase `Cotizaciones` (ver instrucciones de configuración en el dashboard de Back4App).
//      Aunque las capas 1 y 2 fallaran por una coincidencia extrema, el INSERT final del documento
//      con un correlativo duplicado sería rechazado por Mongo con un error de clave duplicada
//      (Parse.Error.DUPLICATE_VALUE, código 137) — nunca puede llegar a existir en la base de datos
//      un documento activo duplicado, pase lo que pase en las capas anteriores. El frontend, ante
//      ese error puntual, vuelve a pedir un correlativo y reintenta el guardado (ver index.html,
//      guardarEnHistorial). Por qué el índice es (tipoDocumento, correlativo, sufijoDespacho) y NO
//      solo (tipoDocumento, correlativo): un Despacho reutiliza a propósito el mismo N° que su
//      Orden de Compra, y una misma OC puede tener varios despachos (sufijos "B", "C"...) que
//      comparten ese N° legítimamente — el sufijo es lo que los distingue.
//
// En resumen: la garantía real no depende de una sola de estas 3 capas, sino de las 3 juntas.
// ============================================

const CLASE_CONTADORES = 'Contadores';
const CLASE_COTIZACIONES = 'Cotizaciones';
const CLASE_PRODUCTOS = 'Productos';
const NUMERO_INICIAL_CORRELATIVO = 450; // igual que en index.html — aplica a cotizacion/orden_compra (y sus *_prueba)
const NUMERO_INICIAL_PRODUCTO_GENERICO = 1;
const MAX_INTENTOS_ANTICOLISION = 5;

function numeroInicialPara(tipo) {
    return tipo === 'producto_generico' ? NUMERO_INICIAL_PRODUCTO_GENERICO : NUMERO_INICIAL_CORRELATIVO;
}

// Incrementa (o crea, si es la primerísima vez que se usa este "tipo") la fila del contador y
// devuelve el número recién asignado. Ver el comentario de cabecera para el análisis honesto de
// qué tan atómico es esto por sí solo.
async function obtenerYAvanzarContador(tipo) {
    const numeroInicial = numeroInicialPara(tipo);
    const Contador = Parse.Object.extend(CLASE_CONTADORES);
    const query = new Parse.Query(Contador);
    query.equalTo('tipo', tipo);
    query.ascending('createdAt'); // si por una carrera llegaran a crearse 2 filas, todos convergen en la más vieja
    let fila = await query.first({ useMasterKey: true });

    if (!fila) {
        fila = new Contador();
        fila.set('tipo', tipo);
        fila.set('siguienteNumero', numeroInicial - 1);
        try {
            await fila.save(null, { useMasterKey: true });
        } catch (errorCrear) {
            // Alguien más pudo haber creado la fila de este mismo "tipo" justo en este instante
            // (más aún si ya existe el índice único sobre "tipo" recomendado en el dashboard, en
            // cuyo caso este catch es exactamente lo que atrapa ese choque). Se vuelve a buscar en
            // vez de fallar de una.
            fila = await query.first({ useMasterKey: true });
            if (!fila) throw errorCrear;
        }
    }

    fila.increment('siguienteNumero');
    const guardado = await fila.save(null, { useMasterKey: true });
    return guardado.get('siguienteNumero');
}

// Segunda capa de protección (ver comentario de cabecera): confirma que el número que se está por
// entregar no esté ya en uso por un documento activo. Cada "tipo" de la clase Contadores tiene su
// propio dominio de colisión: los correlativos de documentos se verifican contra Cotizaciones
// (tipoDocumento + correlativo), y los códigos de producto genérico contra Productos (codigo).
async function existeEnUso(tipoDocumento, numero) {
    if (tipoDocumento === 'producto_generico') {
        const codigo = 'NP-' + String(numero).padStart(4, '0');
        const Producto = Parse.Object.extend(CLASE_PRODUCTOS);
        const query = new Parse.Query(Producto);
        query.equalTo('codigo', codigo);
        query.equalTo('activo', true);
        const cantidad = await query.count({ useMasterKey: true });
        return cantidad > 0;
    }
    const Cotizacion = Parse.Object.extend(CLASE_COTIZACIONES);
    const query = new Parse.Query(Cotizacion);
    query.equalTo('tipoDocumento', tipoDocumento);
    query.equalTo('correlativo', numero);
    query.equalTo('activo', true);
    const cantidad = await query.count({ useMasterKey: true });
    return cantidad > 0;
}

// Punto de entrada único para asignar el próximo correlativo de CUALQUIER "tipo" de la clase
// Contadores: 'cotizacion', 'orden_compra', 'producto_generico', y también las variantes de modo
// prueba ('cotizacion_prueba', 'orden_compra_prueba', 'despacho_prueba'), etc. El Despacho REAL no
// usa esta función para su numeración normal (toma prestado el N° de su Orden de Compra — ver
// asignarCorrelativoDespacho más abajo); si en algún momento no hay una OC vinculada conocida, el
// frontend igual puede pedir aquí un número nuevo de tipo 'orden_compra' (comportamiento heredado).
Parse.Cloud.define('asignarCorrelativo', async (request) => {
    const { tipoDocumento } = request.params || {};
    if (!tipoDocumento || typeof tipoDocumento !== 'string') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'Falta el parámetro "tipoDocumento"');
    }

    let numero = await obtenerYAvanzarContador(tipoDocumento);
    let intentos = 0;
    while (intentos < MAX_INTENTOS_ANTICOLISION && await existeEnUso(tipoDocumento, numero)) {
        intentos++;
        console.warn(`⚠️ Correlativo ${numero} (${tipoDocumento}) ya estaba en uso — pidiendo otro (intento ${intentos})`);
        numero = await obtenerYAvanzarContador(tipoDocumento);
    }

    return { numero };
});

// Guía de Despacho: NO genera un número propio. Confirma, leyendo directamente la Orden de Compra
// vinculada con master key, cuál es el correlativo que le corresponde usar (el mismo de la OC). No
// toca el contador de "orden_compra" ni crea nada — es una simple lectura confirmada del servidor.
Parse.Cloud.define('asignarCorrelativoDespacho', async (request) => {
    const { ordenCompraObjectId } = request.params || {};
    if (!ordenCompraObjectId || typeof ordenCompraObjectId !== 'string') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'Falta el parámetro "ordenCompraObjectId"');
    }

    const Cotizacion = Parse.Object.extend(CLASE_COTIZACIONES);
    const query = new Parse.Query(Cotizacion);
    let oc;
    try {
        oc = await query.get(ordenCompraObjectId, { useMasterKey: true });
    } catch (e) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, `No se encontró la Orden de Compra vinculada (${ordenCompraObjectId})`);
    }

    const correlativo = oc.get('correlativo');
    if (typeof correlativo !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, `La Orden de Compra ${ordenCompraObjectId} no tiene un correlativo asignado`);
    }

    return { correlativo };
});
