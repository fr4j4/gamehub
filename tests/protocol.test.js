// Prueba de extremo a extremo del protocolo: una consola y dos mandos simulados.
// Uso: npm test   (arranca el servidor en un puerto libre y lo detiene al terminar)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 17000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

// Copia temporal para no tocar data/ real
const work = mkdtempSync(path.join(tmpdir(), 'gamehub-test-'));
for (const d of ['server', 'sdk', 'games', 'public', 'apk', 'package.json']) cpSync(path.join(ROOT, d), path.join(work, d), { recursive: true });

const srv = spawn(process.execPath, ['server/index.js'], { cwd: work, env: { ...process.env, PORT: String(PORT), GAMEHUB_ADMIN_PASSWORD: 'secreto123' } });
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer() {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/hub/info`); return; } catch { await sleep(100); } }
  throw new Error('El servidor no arrancó:\n' + log);
}

function client(hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rt`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }));
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  const ready = new Promise((r) => { ws.onopen = () => { ws.send(JSON.stringify(hello)); r(); }; });
  return {
    ws, inbox, ready,
    send: (o) => ws.send(JSON.stringify(o)),
    next(pred, ms = 2000) {
      const found = inbox.find(pred);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        waiters.push(w);
        setTimeout(() => reject(new Error('Timeout esperando mensaje')), ms);
      });
    },
  };
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
}

try {
  await waitServer();
  console.log('GameHub · prueba de protocolo');

  const info = await (await fetch(`${BASE}/api/hub/info`)).json();
  await test('info del hub', () => { assert.equal(info.protocol, 1); assert.match(info.registerUri, /^gamehub:\/\/hub\?url=/); });

  const games = await (await fetch(`${BASE}/api/games`)).json();
  await test('juegos instalados', () => assert.deepEqual(games.map((g) => g.id).sort(), ['kart', 'pong', 'snake', 'tictactoe']));

  await test('QR en SVG', async () => {
    const r = await fetch(`${BASE}/api/qr?text=${encodeURIComponent('http://x/j/ABCDE')}`);
    assert.equal(r.headers.get('content-type'), 'image/svg+xml');
    assert.match(await r.text(), /^<svg/);
  });

  await test('archivos estáticos', async () => {
    for (const p of ['/', '/console/', '/pad/', '/admin/', '/get.html', '/sdk/gamehub-sdk.js', '/games/kart/index.js']) {
      const r = await fetch(BASE + p); assert.equal(r.status, 200, p);
    }
    const r = await fetch(`${BASE}/j/ABCDE`, { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/pad/?code=ABCDE');
    assert.equal((await fetch(`${BASE}/../package.json`)).status, 404);
  });

  const con = client({ t: 'hello', role: 'console' });
  const welcome = await con.next((m) => m.t === 'welcome');
  const code = welcome.code;
  await test('consola crea sesión', () => { assert.match(code, /^[A-Z2-9]{5}$/); assert.ok(welcome.joinUrl.endsWith(`/j/${code}`)); });

  const ana = client({ t: 'hello', role: 'pad', code, name: 'Ana' });
  const anaW = await ana.next((m) => m.t === 'welcome');
  const beto = client({ t: 'hello', role: 'pad', code, name: 'Beto' });
  const betoW = await beto.next((m) => m.t === 'welcome');
  await test('mandos se unen; el primero es líder', async () => {
    const st = await beto.next((m) => m.t === 'session.state' && m.state.players.length === 2);
    assert.equal(st.state.leaderId, anaW.playerId);
    assert.notEqual(anaW.color, betoW.color);
  });

  await test('código inválido se rechaza', async () => {
    const bad = client({ t: 'hello', role: 'pad', code: 'ZZZZZ', name: 'X' });
    const e = await bad.next((m) => m.t === 'error');
    assert.equal(e.code, 'no_session');
  });

  await test('solo el líder elige juego', async () => {
    beto.send({ t: 'lobby.select', gameId: 'pong' });
    await sleep(150);
    ana.send({ t: 'lobby.select', gameId: 'snake' });
    const st = await con.next((m) => m.t === 'session.state' && m.state.gameId);
    assert.equal(st.state.gameId, 'snake');
  });

  await test('validación de jugadores (Snake es de 1)', async () => {
    ana.send({ t: 'lobby.start' });
    const e = await ana.next((m) => m.t === 'error');
    assert.equal(e.code, 'players');
  });

  await test('iniciar Pong y relé de entradas y layouts', async () => {
    ana.send({ t: 'lobby.select', gameId: 'pong' });
    ana.send({ t: 'lobby.start' });
    await con.next((m) => m.t === 'session.state' && m.state.phase === 'playing');
    con.send({ t: 'to', target: betoW.playerId, msg: { t: 'layout.set', layout: { areas: ['a'], controls: [] } } });
    const lay = await beto.next((m) => m.t === 'layout.set');
    assert.deepEqual(lay.layout.areas, ['a']);
    ana.send({ t: 'input', c: 'move', k: 'value', v: 0.25 });
    const inp = await con.next((m) => m.t === 'input');
    assert.deepEqual(inp, { t: 'input', p: anaW.playerId, c: 'move', k: 'value', v: 0.25 });
  });

  await test('reconexión conserva el jugador', async () => {
    ana.ws.close();
    const left = await con.next((m) => m.t === 'player.left');
    assert.equal(left.temporary, true);
    const ana2 = client({ t: 'hello', role: 'pad', code, name: 'Ana', token: anaW.token });
    const w2 = await ana2.next((m) => m.t === 'welcome');
    assert.equal(w2.playerId, anaW.playerId);
    await con.next((m) => m.t === 'player.joined' && m.player.id === anaW.playerId);
  });

  await test('fin de partida vuelve al lobby y envía resultados', async () => {
    con.send({ t: 'match.end', results: { ranking: [betoW.playerId, anaW.playerId], title: 'Gana Beto' } });
    const r = await beto.next((m) => m.t === 'match.results');
    assert.equal(r.results.title, 'Gana Beto');
    await con.next((m) => m.t === 'session.state' && m.state.phase === 'lobby');
  });

  await test('administración: login, estado y desactivar juego', async () => {
    const bad = await fetch(`${BASE}/api/admin/login`, { method: 'POST', body: JSON.stringify({ user: 'admin', pass: 'mal' }) });
    assert.equal(bad.status, 401);
    const { token } = await (await fetch(`${BASE}/api/admin/login`, { method: 'POST', body: JSON.stringify({ user: 'admin', pass: 'secreto123' }) })).json();
    const auth = { authorization: `Bearer ${token}` };
    const st = await (await fetch(`${BASE}/api/admin/state`, { headers: auth })).json();
    assert.equal(st.sessions.length, 1);
    await fetch(`${BASE}/api/admin/games/snake`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false }) });
    const g2 = await (await fetch(`${BASE}/api/games`)).json();
    assert.ok(!g2.some((g) => g.id === 'snake'));
    const { code: c6 } = await (await fetch(`${BASE}/api/admin/code`, { method: 'POST', headers: auth })).json();
    const viaCode = await fetch(`${BASE}/api/admin/login`, { method: 'POST', body: JSON.stringify({ code: c6 }) });
    assert.equal(viaCode.status, 200);
    assert.equal((await fetch(`${BASE}/api/admin/state`)).status, 401);
  });

  await test('mensaje grande (fragmentado en 64 KB+)', async () => {
    con.send({ t: 'to', target: 'all', msg: { t: 'layout.set', layout: { areas: ['x'], controls: [{ id: 'x', type: 'text', text: 'a'.repeat(70000) }] } } });
    const lay = await beto.next((m) => m.t === 'layout.set' && m.layout.areas[0] === 'x');
    assert.equal(lay.layout.controls[0].text.length, 70000);
  });
} finally {
  srv.kill();
  rmSync(work, { recursive: true, force: true });
  console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo bien');
  process.exit(failures ? 1 : 0);
}
