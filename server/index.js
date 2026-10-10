// GameHub — servidor (Hub). Node.js >= 20, sin dependencias externas.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import { acceptUpgrade } from './ws.js';
import { qrSvg } from './qr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PROTOCOL = 1;
const PORT = Number(process.env.PORT || 7777);

// ───────────────────────── Persistencia (JSON) ─────────────────────────
mkdirSync(DATA, { recursive: true });
const configPath = path.join(DATA, 'config.json');
const devicesPath = path.join(DATA, 'devices.json');

function hashPassword(pass, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(pass, salt, 32).toString('hex') };
}
function checkPassword(pass, rec) {
  const h = scryptSync(pass, rec.salt, 32);
  return timingSafeEqual(h, Buffer.from(rec.hash, 'hex'));
}

let config;
if (existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} else {
  const pass = process.env.GAMEHUB_ADMIN_PASSWORD || randomBytes(6).toString('base64url');
  config = { name: os.hostname() || 'GameHub', publicUrl: null, disabledGames: [], admin: { user: 'admin', ...hashPassword(pass) } };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  Primer arranque. Credenciales de administración → usuario: admin  contraseña: ${pass}\n`);
}
let devices = existsSync(devicesPath) ? JSON.parse(readFileSync(devicesPath, 'utf8')) : [];
const saveConfig = () => fs.writeFile(configPath, JSON.stringify(config, null, 2));
const saveDevices = () => fs.writeFile(devicesPath, JSON.stringify(devices, null, 2));

// ───────────────────────── Juegos instalados ─────────────────────────
let games = [];
function scanGames() {
  const dir = path.join(ROOT, 'games');
  games = [];
  for (const id of readdirSync(dir)) {
    const mf = path.join(dir, id, 'game.json');
    if (!existsSync(mf)) continue;
    try {
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      if (m.id !== id) { console.warn(`Juego ${id}: el id del manifiesto no coincide con la carpeta`); continue; }
      games.push({ ...m, path: `/games/${id}/` });
    } catch (e) { console.warn(`Juego ${id}: manifiesto inválido (${e.message})`); }
  }
  games.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}
scanGames();
const enabledGames = () => games.filter((g) => !config.disabledGames.includes(g.id));

// ───────────────────────── Red ─────────────────────────
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  const host = (req?.headers.host || '').split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${req.headers.host}`;
  const ip = lanAddresses()[0] || 'localhost';
  return `http://${ip}:${PORT}`;
}

// ───────────────────────── Sesiones ─────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const COLORS = ['#ff4d6d', '#3ec1ff', '#ffd23f', '#5be37d', '#b67dff', '#ff9a3c', '#2ee6d6', '#ff7ad9'];
const MAX_PLAYERS = 8;
const sessions = new Map();
const newCode = () => {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (sessions.has(c));
  return c;
};
const token = () => randomBytes(18).toString('base64url');

function sessionState(s) {
  return {
    code: s.code, phase: s.phase, gameId: s.gameId, leaderId: s.leaderId, localPlayers: s.localPlayers || 0,
    players: [...s.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
  };
}
function broadcastState(s) {
  const msg = { t: 'session.state', state: sessionState(s) };
  s.console?.send(msg);
  for (const p of s.players.values()) p.conn?.send(msg);
}
function toPads(s, target, msg) {
  if (target === 'all') { for (const p of s.players.values()) p.conn?.send(msg); return; }
  s.players.get(target)?.conn?.send(msg);
}
function pickLeader(s) {
  const next = [...s.players.values()].find((p) => p.connected);
  s.leaderId = next ? next.id : null;
}
function closeSession(s, reason = 'La sesión terminó') {
  for (const p of s.players.values()) { p.conn?.send({ t: 'session.closed', reason }); p.conn?.close(); }
  s.console?.send({ t: 'session.closed', reason });
  sessions.delete(s.code);
}

function handleConnection(conn) {
  let s = null, me = null, role = null;
  conn.lastSeen = Date.now();

  conn.on('message', (m) => {
    conn.lastSeen = Date.now();
    if (m.t === 'pong') return;
    if (!role) {
      if (m.t !== 'hello') return conn.send({ t: 'error', code: 'hello_required' });
      if (m.role === 'console') {
        const prev = m.resume && sessions.get(m.resume.code);
        if (prev && prev.consoleToken === m.resume.token) {
          s = prev; clearTimeout(s.consoleTimer);
        } else {
          s = { code: newCode(), consoleToken: token(), players: new Map(), leaderId: null, phase: 'lobby', gameId: null, createdAt: Date.now(), deviceId: m.deviceId || null, nextId: 1 };
          sessions.set(s.code, s);
        }
        role = 'console'; s.console = conn; s.lastActivity = Date.now();
        conn.send({ t: 'welcome', role, code: s.code, token: s.consoleToken, joinUrl: `${baseUrl(conn.req)}/j/${s.code}`, state: sessionState(s) });
        return;
      }
      if (m.role === 'pad') {
        s = sessions.get(String(m.code || '').toUpperCase());
        if (!s) { conn.send({ t: 'error', code: 'no_session', message: 'No existe una sesión con ese código' }); return conn.close(); }
        me = m.token && [...s.players.values()].find((p) => p.token === m.token);
        if (!me) {
          if (s.players.size >= MAX_PLAYERS) { conn.send({ t: 'error', code: 'full', message: 'La sesión está llena' }); return conn.close(); }
          const used = new Set([...s.players.values()].map((p) => p.color));
          me = { id: `p${s.nextId++}`, token: token(), color: COLORS.find((c) => !used.has(c)) || COLORS[0] };
          s.players.set(me.id, me);
        }
        me.name = String(m.name || 'Jugador').slice(0, 16);
        me.conn?.close();
        me.conn = conn; me.connected = true;
        role = 'pad';
        if (!s.leaderId || !s.players.get(s.leaderId)?.connected) pickLeader(s);
        conn.send({ t: 'welcome', role, playerId: me.id, token: me.token, color: me.color, state: sessionState(s) });
        s.console?.send({ t: 'player.joined', player: { id: me.id, name: me.name, color: me.color } });
        broadcastState(s);
        return;
      }
      return conn.send({ t: 'error', code: 'bad_role' });
    }

    s.lastActivity = Date.now();
    const isLeader = role === 'console' || (me && s.leaderId === me.id);

    switch (m.t) {
      case 'input': // mando → consola
        if (role === 'pad' && s.phase === 'playing') s.console?.send({ t: 'input', p: me.id, c: m.c, k: m.k, v: m.v });
        break;
      case 'to': // consola → mando(s)
        if (role === 'console' && m.msg) toPads(s, m.target, m.msg);
        break;
      case 'lobby.select':
        if (isLeader && s.phase === 'lobby' && enabledGames().some((g) => g.id === m.gameId)) { s.gameId = m.gameId; broadcastState(s); }
        break;
      case 'lobby.start': {
        const g = enabledGames().find((x) => x.id === s.gameId);
        const n = [...s.players.values()].filter((p) => p.connected).length + (s.localPlayers || 0);
        if (!isLeader || s.phase !== 'lobby' || !g) break;
        if (n < g.players.min || n > g.players.max) {
          conn.send({ t: 'error', code: 'players', message: `${g.name} necesita entre ${g.players.min} y ${g.players.max} jugadores` });
          break;
        }
        s.phase = 'playing'; broadcastState(s);
        break;
      }
      case 'match.end':
        if (role === 'console' && s.phase === 'playing') {
          s.phase = 'lobby';
          toPads(s, 'all', { t: 'match.results', results: m.results || {} });
          broadcastState(s);
        }
        break;
      case 'kick':
        if (role === 'console' && s.players.has(m.playerId)) {
          const p = s.players.get(m.playerId);
          p.conn?.send({ t: 'session.closed', reason: 'Fuiste expulsado de la sesión' });
          p.conn?.close(); s.players.delete(p.id);
          if (s.leaderId === p.id) pickLeader(s);
          s.console?.send({ t: 'player.left', playerId: p.id, temporary: false });
          broadcastState(s);
        }
        break;
      case 'local.players': // jugadores de teclado / gamepad conectados a la consola
        if (role === 'console') { s.localPlayers = Math.max(0, Math.min(4, Number(m.count) || 0)); broadcastState(s); }
        break;
      case 'leader.set':
        if (isLeader && s.players.get(m.playerId)?.connected) { s.leaderId = m.playerId; broadcastState(s); }
        break;
    }
  });

  conn.on('close', () => {
    if (!s) return;
    if (role === 'console' && s.console === conn) {
      s.console = null;
      for (const p of s.players.values()) p.conn?.send({ t: 'console.status', online: false });
      s.consoleTimer = setTimeout(() => closeSession(s, 'La consola se desconectó'), 60_000);
    }
    if (role === 'pad' && me && me.conn === conn) {
      me.connected = false; me.conn = null;
      s.console?.send({ t: 'player.left', playerId: me.id, temporary: true });
      if (s.leaderId === me.id) {
        const leaving = me;
        setTimeout(() => { if (!leaving.connected && s.leaderId === leaving.id) { pickLeader(s); broadcastState(s); } }, 30_000);
      }
      broadcastState(s);
    }
  });
}

// Latido, limpieza de conexiones muertas y sesiones inactivas
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    for (const c of [s.console, ...[...s.players.values()].map((p) => p.conn)]) {
      if (!c) continue;
      if (now - c.lastSeen > 45_000) c.close(); else c.send({ t: 'ping', ts: now });
    }
    for (const p of [...s.players.values()]) {
      if (!p.connected && s.phase === 'lobby' && now - s.lastActivity > 5 * 60_000) s.players.delete(p.id);
    }
    if (now - s.lastActivity > 30 * 60_000) closeSession(s, 'Sesión cerrada por inactividad');
  }
}, 15_000).unref();

// ───────────────────────── Administración ─────────────────────────
const adminTokens = new Map(); // token → expira
const loginCodes = new Map(); // código 6 dígitos → expira
const ADMIN_TTL = 60 * 60_000;
function isAdmin(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const exp = adminTokens.get(t);
  if (!exp || exp < Date.now()) return false;
  adminTokens.set(t, Date.now() + ADMIN_TTL);
  return true;
}
function issueAdminToken() { const t = token(); adminTokens.set(t, Date.now() + ADMIN_TTL); return t; }
const loginAttempts = new Map();
function rateLimited(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now); loginAttempts.set(ip, list);
  return list.length > 10;
}

// ───────────────────────── HTTP ─────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.apk': 'application/vnd.android.package-archive',
  '.webmanifest': 'application/manifest+json', '.ts': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const STATIC = [
  ['/sdk/', path.join(ROOT, 'sdk')],
  ['/games/', path.join(ROOT, 'games')],
  ['/apk/', path.join(ROOT, 'apk')],
  ['/', path.join(ROOT, 'public')],
];

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 1e6) throw new Error('too large'); }
  try { return data ? JSON.parse(data) : {}; } catch { return {}; }
}
async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let file = path.normalize(path.join(dir, decodeURIComponent(pathname.slice(prefix.length))));
    if (!file.startsWith(dir)) break;
    try {
      if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return res.end(data);
    } catch { /* sigue */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('No encontrado');
}
function apkInfo(name) {
  const file = path.join(ROOT, 'apk', name);
  return { available: existsSync(file), url: `/apk/${name}` };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // Atajos
    const join = p.match(/^\/j\/([A-Za-z0-9]{4,6})$/);
    if (join) { res.writeHead(302, { location: `/pad/?code=${join[1].toUpperCase()}` }); return res.end(); }
    if (p === '/get') { res.writeHead(302, { location: '/get.html' }); return res.end(); }

    // API pública
    if (p === '/api/hub/info') {
      const b = baseUrl(req);
      return json(res, 200, {
        name: config.name, version: VERSION, protocol: PROTOCOL, baseUrl: b,
        registerUri: `gamehub://hub?url=${encodeURIComponent(b)}&name=${encodeURIComponent(config.name)}`,
        lan: lanAddresses().map((ip) => `http://${ip}:${PORT}`),
      });
    }
    if (p === '/api/qr') {
      const text = url.searchParams.get('text') || '';
      if (!text || text.length > 200) return json(res, 400, { error: 'text inválido' });
      res.writeHead(200, { 'content-type': MIME['.svg'], 'cache-control': 'max-age=3600' });
      return res.end(qrSvg(text));
    }
    if (p === '/api/games') return json(res, 200, enabledGames());
    if (p === '/api/downloads') return json(res, 200, { console: apkInfo('gamehub-console.apk'), pad: apkInfo('gamehub-pad.apk') });
    if (p === '/api/devices' && req.method === 'POST') {
      const b = await body(req);
      let d = b.deviceId && devices.find((x) => x.id === b.deviceId);
      if (!d) { d = { id: `d_${token().slice(0, 10)}`, createdAt: new Date().toISOString() }; devices.push(d); }
      d.name = String(b.name || 'Consola').slice(0, 40);
      d.kind = b.kind === 'android' ? 'android' : 'web';
      d.lastSeen = new Date().toISOString();
      await saveDevices();
      return json(res, 200, { deviceId: d.id });
    }

    // API de administración
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (rateLimited(req)) return json(res, 429, { error: 'Demasiados intentos, espera un minuto' });
      const b = await body(req);
      if (b.code) {
        const exp = loginCodes.get(String(b.code));
        if (!exp || exp < Date.now()) return json(res, 401, { error: 'Código inválido o vencido' });
        loginCodes.delete(String(b.code));
        return json(res, 200, { token: issueAdminToken() });
      }
      if (b.user !== config.admin.user || !checkPassword(String(b.pass || ''), config.admin)) return json(res, 401, { error: 'Usuario o contraseña incorrectos' });
      return json(res, 200, { token: issueAdminToken() });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
      const b = req.method === 'GET' ? {} : await body(req);
      if (p === '/api/admin/state') {
        return json(res, 200, {
          name: config.name, version: VERSION, publicUrl: config.publicUrl,
          sessions: [...sessions.values()].map((s) => ({ ...sessionState(s), consoleOnline: !!s.console, createdAt: s.createdAt })),
          games: games.map((g) => ({ id: g.id, name: g.name, version: g.version, players: g.players, enabled: !config.disabledGames.includes(g.id) })),
          devices,
        });
      }
      if (p === '/api/admin/code' && req.method === 'POST') {
        const code = String(randomInt(100000, 1000000));
        loginCodes.set(code, Date.now() + 5 * 60_000);
        return json(res, 200, { code, expiresIn: 300 });
      }
      const gm = p.match(/^\/api\/admin\/games\/([\w.-]+)$/);
      if (gm && req.method === 'POST') {
        config.disabledGames = config.disabledGames.filter((x) => x !== gm[1]);
        if (b.enabled === false) config.disabledGames.push(gm[1]);
        await saveConfig(); return json(res, 200, { ok: true });
      }
      const sm = p.match(/^\/api\/admin\/sessions\/(\w+)$/);
      if (sm && req.method === 'DELETE') {
        const s = sessions.get(sm[1]);
        if (s) closeSession(s, 'Un administrador cerró la sesión');
        return json(res, 200, { ok: true });
      }
      const dm = p.match(/^\/api\/admin\/devices\/([\w-]+)$/);
      if (dm && req.method === 'DELETE') {
        devices = devices.filter((d) => d.id !== dm[1]); await saveDevices();
        return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/settings' && req.method === 'POST') {
        if (typeof b.name === 'string' && b.name.trim()) config.name = b.name.trim().slice(0, 40);
        if (b.publicUrl !== undefined) config.publicUrl = b.publicUrl ? String(b.publicUrl) : null;
        await saveConfig(); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/password' && req.method === 'POST') {
        if (!checkPassword(String(b.old || ''), config.admin)) return json(res, 400, { error: 'La contraseña actual no es correcta' });
        if (String(b.new || '').length < 8) return json(res, 400, { error: 'Mínimo 8 caracteres' });
        config.admin = { user: config.admin.user, ...hashPassword(String(b.new)) };
        await saveConfig(); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/rescan' && req.method === 'POST') { scanGames(); return json(res, 200, { count: games.length }); }
      return json(res, 404, { error: 'Ruta desconocida' });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Ruta desconocida' });

    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Error interno' });
  }
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/rt') return socket.destroy();
  const conn = acceptUpgrade(req, socket);
  if (conn) handleConnection(conn);
});

server.listen(PORT, () => {
  console.log(`GameHub ${VERSION} escuchando en el puerto ${PORT}`);
  for (const u of [`http://localhost:${PORT}`, ...lanAddresses().map((ip) => `http://${ip}:${PORT}`)]) console.log(`  ${u}`);
  console.log(`  Juegos instalados: ${games.map((g) => g.id).join(', ') || '(ninguno)'}`);
});

export { server };
