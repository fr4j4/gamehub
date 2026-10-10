// Simula partidas completas de los juegos en Node, con DOM y canvas falsos.
// Detecta errores de ejecución y verifica que cada juego termine con resultados.
// Uso: node --import ./tests/register.mjs tests/games.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Entorno de navegador mínimo ──
const noop = () => {};
const ctx2d = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'createImageData' || k === 'getImageData') return (a, b, w, h) => ({ data: new Uint8ClampedArray((w ?? a) * (h ?? b) * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});
const el = () => {
  const e = { style: { setProperty: noop }, children: [], className: '', textContent: '', append: noop, prepend: noop, remove: noop, replaceChildren: noop,
    getContext: ctx2d, width: 0, height: 0, clientWidth: 1280, clientHeight: 720, firstChild: { textContent: '' }, lastChild: { textContent: '' } };
  Object.defineProperty(e, 'innerHTML', { set: noop, get: () => '' });
  return e;
};
globalThis.document = { createElement: el };
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.location = { href: 'http://localhost:7777/console/' };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };

const { GameHost } = await import('/sdk/gamehub-sdk.js');

async function run(id, players, script, maxSeconds, options = {}) {
  const manifest = { ...JSON.parse(readFileSync(new URL(`../games/${id}/game.json`, import.meta.url))), path: `/games/${id}/` };
  const def = (await import(`/games/${id}/${manifest.entry}`)).default;
  const layouts = new Map();
  let results = null;
  const bridge = {
    setLayout: (t, l) => { for (const p of players) if (t === 'all' || t === p.id) layouts.set(p.id, structuredClone(l)); },
    patch: noop, vibrate: noop, end: (r) => { results = r; },
  };
  const host = new GameHost(def, { root: el(), manifest, players, bridge, seed: 42, options });
  let now = 0;
  globalThis.performance = { now: () => now };
  await host.start();
  const send = (player, control, kind, value) => host.handleInput({ player, control, kind, value });
  for (let frame = 0; frame < maxSeconds * 60 && !results; frame++) {
    now += 1000 / 60;
    script(send, host.ctx, frame / 60);
    rafCb?.(now);
  }
  return { results, layouts, host };
}

const P = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}`, color: ['#f00', '#0f0', '#00f', '#ff0'][i] }));
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
}
console.log('GameHub · simulación de juegos');

await test('Tres en Raya: partida completa', async () => {
  // J1 juega siempre la primera casilla libre de una lista que le da victoria rápida
  const plan = [0, 4, 8, 2, 6, 1, 3, 5, 7];
  const { results, layouts } = await run('tictactoe', P(2), (send, ctx) => {
    for (const p of ctx.players) {
      const lay = ctx.controllers.layoutOf(p.id);
      const grid = lay?.controls.find((c) => c.id === 'board');
      if (!grid) continue;
      const free = plan.find((i) => !grid.disabledCells.includes(i));
      if (free !== undefined) send(p.id, 'board', 'press', free);
    }
  }, 60);
  assert.ok(results, 'el juego no terminó');
  assert.equal(results.ranking.length, 2);
  assert.ok(layouts.get('p1').controls.some((c) => c.type === 'grid'));
  console.log(`      → ${results.title}`);
});

await test('Snake: juega y muere contra la pared', async () => {
  const { results } = await run('snake', P(1), (send, ctx, t) => {
    if (Math.abs(t - 3) < 0.01) send('p1', 'pad', 'axis', [0, -1]);
  }, 30);
  assert.ok(results, 'el juego no terminó');
  assert.equal(results.ranking[0], 'p1');
  console.log(`      → ${results.title}`);
});

await test('Pong: los jugadores no se mueven y alguien llega a 7', async () => {
  const { results } = await run('pong', P(2), (send, ctx, t) => {
    if (t < 0.02) { send('p1', 'move', 'value', 0); send('p2', 'move', 'value', 1); }
  }, 120);
  assert.ok(results, 'el juego no terminó');
  assert.ok(Object.values(results.scores).includes(7));
  console.log(`      → ${results.title}`);
});

for (const n of [1, 2, 3, 4]) {
  await test(`Turbo Karts con ${n} jugador(es) en piloto automático: carrera completa`, async () => {
    const { results } = await run('kart', P(n), () => {}, 300, { autopilot: true });
    assert.ok(results, 'la carrera no terminó');
    assert.equal(results.ranking.length, n);
    assert.ok(Object.values(results.scores).every((v) => /^\d:\d\d\.\d\d$/.test(v)), 'algún humano no terminó');
    console.log(`      → ${results.title} · ${JSON.stringify(results.scores)}`);
  });
}

await test('Turbo Karts: un humano que no conduce no bloquea el final', async () => {
  const { results } = await run('kart', P(1), () => {}, 400);
  assert.ok(results, 'la carrera no terminó');
  assert.equal(results.scores.p1, 'no terminó');
});

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo bien');
process.exit(failures ? 1 : 0);
