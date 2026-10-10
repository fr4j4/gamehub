# GameHub

Consola de juegos abierta: una pantalla (TV, PC, proyector o Android TV) muestra el juego y los teléfonos son los mandos. El servidor corre en una máquina de la red local y no necesita internet.

Este repositorio es el prototipo v0.1: servidor, consola, mando, administración, SDK v1 y cuatro juegos.

| Juego | Jugadores | Mando |
| --- | --- | --- |
| Tres en Raya | 2 | Cuadrícula táctil |
| Snake | 1 | Cruceta |
| Pong | 2 | Deslizador |
| Turbo Karts | 1–4, pantalla dividida, con CPUs | Volante por inclinación (o joystick), acelerar, frenar, ítem |

## Arrancar

Requisitos: Node.js 20 o superior. No hay dependencias que instalar.

```bash
npm start            # puerto 7777; usa PORT=8080 npm start para cambiarlo
```

En el primer arranque se imprime la contraseña del usuario `admin` (o se toma de `GAMEHUB_ADMIN_PASSWORD`). La configuración vive en `data/`.

Con Docker:

```bash
docker build -t gamehub .
docker run -p 7777:7777 -v gamehub-data:/app/data gamehub
```

## Jugar

1. Abre `http://<ip-del-servidor>:7777/console/` en la TV o PC.
2. Escanea el QR de la consola con el teléfono (o abre `/pad/` y escribe el código).
3. El primer jugador es el líder: elige el juego desde su teléfono o con las flechas en la consola.

Sin teléfonos a mano: en la consola, «Jugadores locales» agrega hasta 2 jugadores con teclado (WASD + F G H, flechas + K L J) o gamepads USB/Bluetooth.

| Ruta | Qué es |
| --- | --- |
| `/` | Portada: enlaces a consola, mando, administración, APK y QR de descarga |
| `/console/` | Consola (interfaz tipo videoconsola, se maneja con flechas, mando o control remoto) |
| `/pad/` | Mando web |
| `/admin/` | Administración (también dentro de la consola, botón «Admin») |
| `/j/<CÓDIGO>` | Enlace del QR de una sesión |
| `/get` | Página para el teléfono: instalar GameHub Pad o jugar en el navegador |

Las APK se publican copiándolas a `apk/gamehub-pad.apk` y `apk/gamehub-console.apk`; el servidor las ofrece automáticamente. El contrato de las apps está en [docs/android.md](docs/android.md).

## Crear un juego

Copia una carpeta de `games/`, cambia el `id` en `game.json` y edita `index.js`. Guía completa: [docs/sdk.md](docs/sdk.md).

```js
import { defineGame, L } from '/sdk/gamehub-sdk.js';

export default defineGame({
  setup(ctx) {
    ctx.controllers.set('all', L.layout({ areas: ['a'], controls: [L.button('a', { label: '¡Toca!' })] }));
  },
  onInput(ctx, e) {
    if (e.kind === 'down') ctx.end({ ranking: [e.player], title: `¡${ctx.player(e.player).name} fue el más rápido!` });
  },
});
```

## Estructura

```
server/     Hub: HTTP, WebSocket propio, sesiones, administración, generador de QR
sdk/        gamehub-sdk.js (runtime) y gamehub-sdk.d.ts (tipos)
public/     console/, pad/, admin/, portada y página de descarga
games/      un juego por carpeta (game.json + index.js + icon.svg)
tests/      protocol.test.js (servidor) y games.test.js (simula partidas completas)
docs/       guía del SDK y contrato de las apps Android
apk/        aquí se dejan las APK para que el servidor las ofrezca
```

## Pruebas

```bash
npm test
```

Levanta un servidor temporal y prueba el protocolo con una consola y mandos simulados; luego juega partidas completas de los cuatro juegos en Node (Turbo Karts con 1 a 4 jugadores en piloto automático).

## Licencia

MIT.
