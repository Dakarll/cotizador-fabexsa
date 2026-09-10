# Robot de rastreo — Seguimiento Shalom

Portado del repo [`Dakarll/shalom-tracker`](https://github.com/Dakarll/shalom-tracker).
Resuelve el **estado real** de cada guía Shalom consultando la web pública
de rastreo. Sin este robot corriendo, cada envío Shalom se queda en
`pendiente` para siempre (los envíos **Lima** no dependen del robot: su
estado se cambia a mano desde la app).

## Qué hace

`scripts/check_shalom.js`, cada 30 min vía GitHub Actions
(`.github/workflows/check.yml`):

1. Lee de Back4App (clase `EnvioShalom`) las guías con `estado != "entregado"`
   que tengan `guia` **y** `codigo` (las `tipo:"lima"` no tienen `codigo`,
   así que quedan fuera — el robot nunca las toca).
2. Consulta cada una en `https://shalom.com.pe/rastrea` con un Chromium
   headless (Playwright): formulario público **N° de Orden + Código de
   Orden (4 dígitos)**.
3. Escribe el resultado de vuelta en Back4App con la **Master Key**
   (`X-Parse-Master-Key`, solo en GitHub Secrets — nunca en el frontend):
   - `estado`: `en_transito` | `entregado` | `error`
   - `detalleEstado`: texto libre del sitio de Shalom
   - `ultimaConsulta`: fecha ISO
   - al pasar por primera vez a `entregado`: `entregadoEn` + `notificado:false`
     (para que la app muestre el aviso "ya llegó").

## Puesta en marcha (obligatorio para que resuelva algo)

### 1. Crear la clase `EnvioShalom` en Back4App

En el **mismo** app de Back4App que usa el cotizador
(`appId FUvQmIkpBQRslJOaONps84g4RfBOVrwotiZTJx1r`), Dashboard → Database →
crear clase `EnvioShalom` con estas columnas:

| Columna | Tipo | Notas |
|---|---|---|
| `guia` | String | N° de Orden Shalom. Para `tipo:"lima"` se genera `LIMA-<8 díg.>` |
| `codigo` | String | Código de seguridad de 4 dígitos. `null` para `lima` |
| `cliente` | String | opcional |
| `destino` | String | opcional (dirección / referencia) |
| `numeroOrdenCompra` | String | N° de OC vinculada, formateado: `N° 000500` |
| `ordenCompraObjectId` | String | objectId de la OC en la clase `Cotizaciones` (vínculo estable) |
| `estado` | String | `pendiente` \| `en_transito` \| `entregado` \| `error` |
| `tipo` | String | `shalom` \| `lima` |
| `detalleEstado` | String | texto libre (a veces más preciso que `estado`) |
| `ultimaConsulta` | String | fecha ISO, la pone el robot |
| `entregadoEn` | String | fecha ISO, primera vez que pasa a `entregado` |
| `notificado` | Boolean | booleano viejo (compatibilidad) |
| `estadoNotificacion` | String | `sin_notificar` \| `notificado` |
| `notificadoEn` | String | fecha ISO del primer aviso al cliente |
| `notificadoPor` | String | username que hizo el primer aviso |
| `notificacionLog` | Array | `[{ usuario, fecha, tipo:"envio"|"reenvio" }]` |
| `oseId` | String | ID interno leído del QR (solo referencia) |
| `creadoPorUsername` | String | quién registró la guía |

**Permisos (CLP)** de la clase: se maneja igual que `Cotizaciones` /
`Clientes` en este proyecto (permisos a nivel de clase, **sin ACL por
objeto**). Ajusta el CLP de `EnvioShalom` a lo que ya uses en esas clases.
El robot escribe con Master Key, así que sus escrituras no dependen del CLP.

### 2. Secrets del repo de GitHub

`cotizador-fabexsa` → Settings → Secrets and variables → Actions →
**Repository secrets**:

- `BACK4APP_APP_ID` = `FUvQmIkpBQRslJOaONps84g4RfBOVrwotiZTJx1r`
- `BACK4APP_MASTER_KEY` = la Master Key de ese app (Dashboard → App Settings
  → Security & Keys → *Master Key*). **Nunca** la pongas en el código del
  frontend.

### 3. Activar Actions

Pestaña **Actions** del repo → habilitar workflows. El cron arranca solo;
para probar ya mismo: Actions → *Verificar envíos Shalom* → *Run workflow*.

## Probar en local

```bash
cd shalom-tracker/scripts
npm install
npx playwright install --with-deps chromium
BACK4APP_APP_ID=... BACK4APP_MASTER_KEY=... node check_shalom.js
```

## Si Shalom cambia su HTML

Los selectores de `consultarGuia()` en `scripts/check_shalom.js`
(`input[placeholder="N° de Orden"]`, `input[placeholder="Código de Orden"]`,
`button[type="submit"]:has-text("Buscar")`, `.text-4xl.font-bold.text-red-color-sidebar`,
`p.text-silver-title`) dependen del marcado actual de `shalom.com.pe/rastrea`.
Si el rastreo empieza a devolver siempre `error`, revisa esos selectores
contra el HTML real del sitio.
