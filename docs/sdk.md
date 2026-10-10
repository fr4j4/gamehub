# GameHub SDK v1 — guía para desarrolladores

Un juego de GameHub es una carpeta con un manifiesto y un módulo JavaScript. Corre en la consola (navegador o APK), dibuja en pantalla con la tecnología que prefieras y recibe las entradas de los teléfonos ya normalizadas.

## 1. Estructura de un juego

```
games/mi-juego/
├─ game.json      manifiesto (obligatorio)
├─ index.js       módulo de entrada: export default defineGame({...})
├─ icon.svg       portada 3:4 para el carrusel de la consola
└─ ...            otros módulos, imágenes, sonidos, modelos
```

```json
{
  "id": "mi-juego",
  "name": "Mi Juego",
  "version": "1.0.0",
  "sdk": "^1.0.0",
  "description": "Una línea que aparece en la consola.",
  "players": { "min": 1, "max": 4 },
  "logic": "screen",
  "entry": "index.js",
  "icon": "icon.svg",
  "controls": "Joystick y 2 botones",
  "tags": ["Arcade"],
  "options": [{ "id": "rondas", "type": "int", "label": "Rondas", "default": 3, "min": 1, "max": 9 }]
}
```

El `id` debe coincidir con el nombre de la carpeta. Tras copiar la carpeta, usa «Buscar juegos nuevos» en Administración (o reinicia el servidor).

## 2. Ciclo de vida

```js
import { defineGame, L } from '/sdk/gamehub-sdk.js';

export default defineGame({
  async setup(ctx) {},          // escena, estado inicial, layouts de los mandos
  update(ctx, dt) {},           // lógica a paso fijo: 60 veces por segundo, dt = 1/60
  render(ctx, alpha) {},        // dibujo en cada frame; alpha sirve para interpolar
  onInput(ctx, e) {},           // cada entrada, en cuanto llega
  onPlayerLeave(ctx, player) {},// si no lo defines, el juego se pausa hasta que vuelva
  onPlayerJoin(ctx, player) {}, // reconexión de un jugador de la partida
  dispose(ctx) {},              // liberar WebGL, audio, listeners
});
```

La lógica corre a paso fijo y el dibujo a la tasa de refresco de la pantalla. Si un frame tarda, el host ejecuta hasta 5 pasos de lógica para ponerse al día. Una excepción en cualquier hook termina la partida con un error y la consola vuelve al lobby.

## 3. Contexto (`ctx`)

| Miembro | Para qué |
| --- | --- |
| `ctx.players` | `[{ id, name, color, slot, connected, local }]` en orden de llegada |
| `ctx.player(id)` | Un jugador por id |
| `ctx.options` | Opciones elegidas en el lobby (por ahora, los `default` del manifiesto) |
| `ctx.root`, `ctx.width`, `ctx.height`, `ctx.onResize(fn)` | Contenedor DOM a pantalla completa y su tamaño |
| `ctx.createCanvas({ width, height, fit, pixelated })` | Canvas 2D con resolución lógica fija, escalado y centrado |
| `ctx.input.axis(p, c)` · `value` · `down` · `pressed` · `released` | Estado consultable de los mandos |
| `ctx.controllers.set(target, layout)` | Define el mando de un jugador o de `'all'` |
| `ctx.controllers.patch(target, id, props)` | Cambia propiedades de un control (texto, cartas, deshabilitado) |
| `ctx.controllers.vibrate(target, ms o patrón)` | Vibración en el teléfono (o rumble en gamepads locales) |
| `ctx.audio.tone` · `noise` · `engine` | Sonido sintetizado sin archivos |
| `ctx.timer.after(seg, fn)` · `every` · `cancel` | Temporizadores en tiempo de juego (se detienen en pausa) |
| `ctx.random` | Aleatorio con semilla: `next`, `range`, `int`, `pick`, `shuffle` |
| `ctx.viewports(n, w, h)` | Rectángulos de pantalla dividida para 1–4 jugadores |
| `ctx.ui.banner(texto, seg, sub)` | Texto grande animado sobre el juego |
| `ctx.storage.get/set` | Datos persistentes del juego en esa consola (récords) |
| `ctx.assets.url('ruta')` | URL absoluta de un archivo del juego |
| `ctx.pause(motivo)` · `ctx.resume()` | Pausa con mensaje |
| `ctx.end({ ranking, scores, title })` | Termina la partida y muestra el podio |

Los tipos completos están en `sdk/gamehub-sdk.d.ts`. En TypeScript, mapea `/sdk/*` en `tsconfig.json` y compila a un módulo ES.

## 4. Mandos

Un layout es una grilla CSS (`areas`) y una lista de controles. Cada control ocupa el área con su `id` (o la que indiques en `area`). `"."` deja una celda vacía.

```js
ctx.controllers.set('all', L.layout({
  orientation: 'landscape',
  areas: ['stick . jump', 'stick . fire'],
  controls: [
    L.joystick('stick', { deadzone: 0.15 }),
    L.button('jump', { label: 'A', color: '#5be37d' }),
    L.button('fire', { label: 'B' }),
  ],
}));
```

| Control | Evento que recibe el juego | Opciones |
| --- | --- | --- |
| `button` | `down` / `up` | `label`, `color`, `shape: round·pill·square`, `haptic` |
| `dpad` | `axis` [x, y] con −1, 0, 1 | `diagonals` |
| `joystick` | `axis` [x, y] en −1..1 (máx. 60 Hz) | `deadzone`, `axis: x·y·xy` |
| `slider` | `value` 0..1 | `orientation`, `value` inicial |
| `tilt` | `axis` [x, 0] en −1..1 desde los sensores | `range` (grados), `fallback: joystick·slider` |
| `grid` | `press` con el índice de la celda | `rows`, `cols`, `cells`, `cellColors`, `disabledCells` |
| `text` | — (solo muestra) | `text`, `sub`, `size` |

Reglas útiles:

- Cada jugador tiene su copia del layout; `patch` a un jugador no afecta a los demás (estado privado: cartas, roles secretos).
- Al reconectarse, el jugador recibe automáticamente su último layout.
- Sin sensores (o sin permiso), `tilt` se convierte en `fallback` sin que el juego lo note.
- Los jugadores locales (teclado y gamepad de la consola) reciben los mismos eventos: el host traduce teclas y sticks según el layout.

## 5. Tecnologías recomendadas

La v1 no impone motor: el juego recibe un `div` a pantalla completa. Estas son las opciones probadas o recomendadas, de menor a mayor complejidad.

| Tipo de juego | Tecnología | Cómo integrarla |
| --- | --- | --- |
| 2D simple (tablero, trivia, arcade) | Canvas 2D con `ctx.createCanvas` | Sin dependencias; así están Tres en Raya, Snake y Pong |
| 2D con muchos sprites, partículas, cámaras | PixiJS 8 | Copia `pixi.min.mjs` dentro de la carpeta del juego e impórtalo relativo |
| 2D con física y escenas | Phaser 3 | Igual que Pixi; crea el juego con `parent: ctx.root` y tu propio loop |
| 2.5D (Mode 7, isométrico, sprites en 3D) | Canvas 2D o PixiJS | Turbo Karts es la referencia: suelo proyectado + sprites ordenados |
| 3D completo | Three.js r16x o Babylon.js 7 | Renderer sobre un canvas dentro de `ctx.root`; render en `render()`, lógica en `update()`; `dispose()` libera el contexto WebGL |
| Física 3D | Rapier (WASM) o Cannon-es | Paso de física dentro de `update(dt)` |
| Audio con archivos | Web Audio o Howler.js | `ctx.assets.url('sfx/golpe.ogg')` |
| Modelos y texturas | glTF/GLB (Blender), KTX2, WebP | Servidos desde la carpeta del juego |
| Mapas 2D | Tiled (JSON) | `fetch(ctx.assets.url('mapa.json'))` |

Las dependencias se copian dentro de la carpeta del juego: el servidor funciona sin internet y cada juego queda autocontenido.

## 6. Calidad: lista de verificación

- Lógica en `update` y dibujo en `render`; nunca avanzar la física en `render`.
- Resolución lógica fija (1280×720 recomendada) y escalado: se ve igual en un proyector y en un TV 4K.
- Pensado para distancia de sofá: texto mínimo de 24 px lógicos, colores de jugador siempre visibles.
- Cada acción tiene respuesta: sonido corto, vibración en el teléfono y efecto en pantalla.
- Cuenta regresiva antes de empezar y podio claro al terminar (`ctx.end` con `title`).
- Pantalla dividida con `ctx.viewports`; con 3 jugadores, aprovecha el cuarto espacio (mapa, marcador).
- Funciona con jugadores locales (teclado o gamepad) para probar sin teléfonos.
- Presupuesto: 60 fps en un Android TV de gama media; carga inicial menor a 10 MB.

## 7. Probar

1. `npm start` y abre `/console/`.
2. Agrega jugadores locales con la tecla `L` o el botón «Jugadores locales», o abre `/pad/` en varias pestañas o teléfonos.
3. Pruebas automáticas: agrega tu juego a `tests/games.test.js`; el arnés corre la partida en Node con DOM y canvas falsos, inyecta entradas y verifica que termine con resultados.

## 8. Lo que viene (Fase 2)

- `logic: "server"`: la lógica corre aislada en el servidor (turnos, cartas, varias pantallas remotas). La API de `defineGame` no cambia.
- Paquetes `.ghpkg` firmados, repositorios e instalación desde la administración.
- Componentes de mando personalizados (`custom`) como Web Components.
- CLI `gh-dev`: plantillas por motor, simulador de mandos y empaquetado.
