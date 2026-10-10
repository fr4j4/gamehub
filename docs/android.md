# Apps Android: GameHub Console y GameHub Pad

Las dos apps son contenedores nativos ligeros (Kotlin) que cargan la interfaz web servida por el propio servidor (`/console/` y `/pad/`) en un WebView, y le añaden lo que el navegador no da: sensores sin HTTPS, vibración con intensidad, cámara para QR, pantalla siempre encendida, orientación, modo kiosco y arranque en Android TV. Así la interfaz se actualiza con el servidor y las apps casi nunca necesitan una versión nueva.

## Tecnología

| Aspecto | Elección |
| --- | --- |
| Lenguaje y UI nativa | Kotlin, Jetpack Compose solo para las pantallas propias (vincular servidor, ajustes) |
| Contenido | `WebView` (Chromium del sistema, WebGL 2), `JavascriptInterface` como puente |
| Versión mínima | Android 8.0 (API 26); objetivo: la API vigente de Play |
| QR | CameraX + ML Kit Barcode Scanning |
| Descubrimiento | `NsdManager` buscando `_gamehub._tcp` (el servidor lo anunciará en la Fase 2) |
| Sensores | `SensorManager`, `TYPE_GAME_ROTATION_VECTOR` (respaldo: acelerómetro) a ~60 Hz |
| Vibración | `VibrationEffect.createWaveform` con amplitudes |
| Distribución | APK firmado servido por el Hub (`apk/`), y opcionalmente Play Store |

## Vincular el servidor

1. Pantalla inicial «Conectar a un servidor»: lista de servidores encontrados en la red, botón **Escanear QR** y formulario (dirección, puerto, nombre).
2. QR de registro: `gamehub://hub?url=http%3A%2F%2F192.168.1.20%3A7777&name=Casa`. Las apps registran el esquema `gamehub://` con un `intent-filter`, así que también se abren desde la página `/get` del servidor.
3. Validación: `GET <url>/api/hub/info` debe responder `protocol: 1`.
4. Se guardan varios servidores en `DataStore`; uno es el predeterminado.
5. GameHub Pad acepta además el **QR de una sesión** (`http://…/j/K7MPX`): vincula el servidor y entra a la sesión en un paso, cargando `<url>/pad/?code=K7MPX`.

GameHub Console carga `<url>/console/` en pantalla completa y se registra sola en `/api/devices` con `kind: "android"`.

## Puente `window.GameHubNative`

El código web detecta la app por la existencia de este objeto. Todos los métodos son síncronos y reciben o devuelven strings.

### GameHub Pad

| Método | Qué hace |
| --- | --- |
| `vibrate(patternJson)` | `"40"` o `"[80,40,120]"` (ms); usa amplitud media |
| `startTilt()` | Empieza a emitir la inclinación: la app llama `window.ghNativeTilt(grados)` ~60 veces por segundo |
| `stopTilt()` | Detiene los sensores |
| `setOrientation(o)` | `"portrait"`, `"landscape"` o `"any"` |
| `scanQr()` | Abre la cámara; al leer, la app llama `window.ghOnQr(texto)` |
| `deviceName()` | Nombre del dispositivo |

Grados de `ghNativeTilt`: giro del teléfono sostenido en horizontal como un volante, positivo hacia la derecha. El mando web aplica centrado, inversión y rango (`range` del control `tilt`).

### GameHub Console

| Método | Qué hace |
| --- | --- |
| `deviceName()` | Nombre que aparece en Administración → Dispositivos |
| `openServerSettings()` | Vuelve a la pantalla nativa de servidores (Fase 2) |

Además, la app de consola:

- Se declara como launcher de Android TV (`LEANBACK_LAUNCHER`) con banner propio.
- Convierte el control remoto (D-pad, OK, Atrás) en teclas `Arrow*`, `Enter` y `Escape` para la navegación de la consola.
- Deja pasar los gamepads Bluetooth al WebView: la consola los usa vía Gamepad API como jugadores locales.
- Mantiene la pantalla encendida y oculta las barras del sistema.

## Permisos

| App | Permiso | Motivo |
| --- | --- | --- |
| Ambas | `INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_WIFI_MULTICAST_STATE` | Conexión y descubrimiento en la LAN |
| Ambas | `android:usesCleartextTraffic="true"` limitado por `network_security_config` a IPs privadas | Servidores locales sin HTTPS |
| Pad | `CAMERA` (en tiempo de uso) | Escanear QR |
| Pad | `VIBRATE` | Vibración |

## Estructura propuesta del proyecto

```
android/
├─ settings.gradle.kts
├─ core/        servidores guardados, descubrimiento mDNS, validación de /api/hub/info, WebView configurado
├─ pad/         MainActivity, PadBridge (sensores, vibración, QR), pantallas de vinculación
└─ console/     MainActivity (Leanback), ConsoleBridge, mapeo del control remoto
```

Al compilar, `pad-release.apk` y `console-release.apk` se copian a `apk/gamehub-pad.apk` y `apk/gamehub-console.apk` en el servidor.
