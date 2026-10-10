// GameHub Console — interfaz de consola (navegador o APK GameHub Console).
import { GameHost, L } from '/sdk/gamehub-sdk.js';
import { mountAdmin } from '/admin/admin.js';

const $ = (id) => document.getElementById(id);
const LOCAL_COLORS = ['#e8e8f0', '#c8a46e', '#9ad1ff', '#ffb3c7'];

const app = {
  ws: null, info: null, games: [], session: null, code: null, joinUrl: '',
  focusIndex: 0, view: 'home', host: null, match: null, localCount: 0, retry: 0,
  adminHandle: null, escArmed: false,
};

// ───────────────────────── Arranque ─────────────────────────
async function boot() {
  app.info = await (await fetch('/api/hub/info')).json();
  $('hubName').textContent = app.info.name;
  app.games = await (await fetch('/api/games')).json();
  renderCarousel();
  try {
    const r = await fetch('/api/devices', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: localStorage.getItem('gh.deviceId'), name: window.GameHubNative?.deviceName?.() || navigator.userAgentData?.platform || 'Consola web', kind: window.GameHubNative ? 'android' : 'web' }),
    });
    localStorage.setItem('gh.deviceId', (await r.json()).deviceId);
  } catch { /* opcional */ }
  connect();
  setInterval(tickClock, 1000); tickClock();
  showView('home');
}
function tickClock() { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// ───────────────────────── Red ─────────────────────────
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rt`);
  app.ws = ws;
  ws.onopen = () => {
    const resume = JSON.parse(sessionStorage.getItem('gh.console') || 'null');
    ws.send(JSON.stringify({ t: 'hello', role: 'console', deviceId: localStorage.getItem('gh.deviceId'), resume }));
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (app.ws !== ws) return;
    $('netState').textContent = 'Reconectando'; $('netState').classList.add('off');
    setTimeout(connect, Math.min(5000, 500 * 2 ** app.retry++));
  };
}
const send = (obj) => { if (app.ws?.readyState === 1) app.ws.send(JSON.stringify(obj)); };

function onMessage(m) {
  switch (m.t) {
    case 'ping': send({ t: 'pong' }); break;
    case 'welcome': {
      app.retry = 0;
      $('netState').textContent = 'En línea'; $('netState').classList.remove('off');
      if (app.code && app.code !== m.code && app.host) abortMatch();
      app.code = m.code; app.joinUrl = m.joinUrl;
      sessionStorage.setItem('gh.console', JSON.stringify({ code: m.code, token: m.token }));
      $('joinCode').textContent = m.code;
      $('joinUrl').textContent = m.joinUrl.replace(/^https?:\/\//, '');
      $('joinQr').src = `/api/qr?text=${encodeURIComponent(m.joinUrl)}`;
      send({ t: 'local.players', count: app.localCount });
      onSession(m.state);
      break;
    }
    case 'session.state': onSession(m.state); break;
    case 'player.joined':
      if (app.host) {
        if (app.host.players.some((p) => p.id === m.player.id)) app.host.playerJoined(m.player.id);
        else send({ t: 'to', target: m.player.id, msg: { t: 'layout.set', layout: L.message('Partida en curso', 'Entrarás en la próxima') } });
      } else toast(`${m.player.name} se unió`);
      break;
    case 'player.left': if (app.host) app.host.playerLeft(m.playerId); break;
    case 'input': app.host?.handleInput({ player: m.p, control: m.c, kind: m.k, value: m.v }); break;
    case 'error': toast(m.message || 'Error'); break;
    case 'session.closed':
      sessionStorage.removeItem('gh.console');
      if (app.host) abortMatch();
      app.ws?.close();
      break;
  }
}

// ───────────────────────── Sesión y lobby ─────────────────────────
function onSession(s) {
  const prev = app.session;
  app.session = s;
  renderPlayers();
  if (s.gameId && s.gameId !== prev?.gameId) {
    const i = app.games.findIndex((g) => g.id === s.gameId);
    if (i >= 0 && app.view === 'home') { app.focusIndex = i; focusTile(i); }
  }
  renderCarouselState();
  if (s.phase === 'lobby') app.awaitingLobby = false;
  // Tras terminar, ignora estados 'playing' que ya venían en camino hasta que el servidor confirme el lobby
  if (s.phase === 'playing' && !app.host && !app.match && !app.awaitingLobby) startMatch();
}

function renderPlayers() {
  const s = app.session; if (!s) return;
  const items = s.players.map((p) => {
    const li = document.createElement('li');
    li.className = p.connected ? '' : 'off';
    li.innerHTML = '<i></i><span></span><small></small>';
    li.children[0].style.background = p.color; li.children[0].style.color = p.color;
    li.children[1].textContent = p.name;
    li.children[2].textContent = p.id === s.leaderId ? '★ líder' : '';
    return li;
  });
  for (let i = 0; i < app.localCount; i++) {
    const li = document.createElement('li');
    li.innerHTML = '<i></i><span></span><small>local</small>';
    li.children[0].style.background = LOCAL_COLORS[i];
    li.children[1].textContent = localName(i);
    items.push(li);
  }
  $('players').replaceChildren(...items);
  const leader = s.players.find((p) => p.id === s.leaderId);
  $('leaderNote').textContent = leader ? `${leader.name} elige el juego desde su teléfono, o elígelo aquí.` : 'El primer jugador en entrar será el líder.';
}
const localName = (i) => {
  const pads = navigator.getGamepads?.() || [];
  return pads[i] ? `Gamepad ${i + 1}` : `Teclado ${i + 1}`;
};
const playerCount = () => (app.session?.players.filter((p) => p.connected).length || 0) + app.localCount;

// ───────────────────────── Carrusel ─────────────────────────
function renderCarousel() {
  $('carousel').replaceChildren(...app.games.map((g, i) => {
    const b = document.createElement('button');
    b.className = 'tile nav';
    b.dataset.index = i;
    b.innerHTML = `<img alt=""><div class="badge"></div><div class="label"></div>`;
    b.querySelector('img').src = g.path + (g.icon || 'icon.svg');
    b.querySelector('.label').textContent = g.name;
    b.onfocus = () => { app.focusIndex = i; showGameInfo(g); };
    b.onclick = () => selectAndStart(g);
    return b;
  }));
  renderCarouselState();
  showGameInfo(app.games[0]);
}
function renderCarouselState() {
  const n = playerCount();
  document.querySelectorAll('.tile').forEach((t) => {
    const g = app.games[t.dataset.index];
    t.classList.toggle('selected', g.id === app.session?.gameId);
    t.classList.toggle('unavailable', n < g.players.min || n > g.players.max);
    t.querySelector('.badge').textContent = g.id === app.session?.gameId ? 'Elegido' : playersLabel(g);
  });
}
const playersLabel = (g) => (g.players.min === g.players.max ? `${g.players.min} jugador${g.players.min > 1 ? 'es' : ''}` : `${g.players.min}–${g.players.max} jugadores`);
function showGameInfo(g) {
  if (!g) return;
  $('gameName').textContent = g.name;
  $('gameDesc').textContent = g.description || '';
  $('gameMeta').innerHTML = '';
  for (const t of [playersLabel(g), ...(g.controls ? [g.controls] : []), ...(g.tags || [])]) {
    const s = document.createElement('span'); s.textContent = t; $('gameMeta').append(s);
  }
}
function focusTile(i) { document.querySelectorAll('.tile')[i]?.focus(); }

function selectAndStart(g) {
  const n = playerCount();
  if (n < g.players.min || n > g.players.max) {
    toast(`${g.name} necesita ${playersLabel(g)} (hay ${n})`);
    send({ t: 'lobby.select', gameId: g.id });
    return;
  }
  send({ t: 'lobby.select', gameId: g.id });
  send({ t: 'lobby.start' });
}

$('playBtn').onclick = () => selectAndStart(app.games[app.focusIndex]);
$('localBtn').onclick = () => {
  app.localCount = (app.localCount + 1) % 3;
  $('localCount').textContent = app.localCount;
  send({ t: 'local.players', count: app.localCount });
  renderPlayers(); renderCarouselState();
};
$('settingsBtn').onclick = () => showView('settings');
$('settingsBack').onclick = () => showView('home');
$('adminBtn').onclick = () => showView('admin');
$('fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

// ───────────────────────── Vistas ─────────────────────────
async function showView(v) {
  if (app.view === 'admin' && v !== 'admin') { app.adminHandle?.unmount(); app.adminHandle = null; }
  app.view = v;
  for (const id of ['home', 'game', 'settings', 'admin']) $(id).hidden = id !== v;
  if (v === 'home') setTimeout(() => focusTile(app.focusIndex), 0);
  if (v === 'settings') {
    $('srvInfo').innerHTML = `<b></b><br><span class="muted"></span>`;
    $('srvInfo').firstChild.textContent = app.info.name;
    $('srvInfo').lastChild.textContent = `${app.info.baseUrl} · v${app.info.version}`;
    $('regQr').src = `/api/qr?text=${encodeURIComponent(app.info.registerUri)}`;
    $('getQr').src = `/api/qr?text=${encodeURIComponent(app.info.baseUrl + '/get')}`;
    const d = await (await fetch('/api/downloads')).json();
    $('apkLinks').textContent = `${d.pad.available ? 'GameHub Pad disponible' : 'GameHub Pad aún no publicado en este servidor'} · ${d.console.available ? 'GameHub Console disponible' : 'GameHub Console aún no publicado'}`;
    $('settingsBack').focus();
  }
  if (v === 'admin') {
    app.adminHandle = mountAdmin($('admin'), { onExit: () => showView('home') });
  }
}

// ───────────────────────── Partida ─────────────────────────
async function startMatch() {
  const s = app.session;
  const g = app.games.find((x) => x.id === s.gameId);
  if (!g) return;
  app.match = { game: g };
  const players = [
    ...s.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    ...Array.from({ length: app.localCount }, (_, i) => ({ id: `local${i + 1}`, name: localName(i), color: LOCAL_COLORS[i], local: true })),
  ];
  showView('game');
  const stage = $('stage');
  stage.replaceChildren();
  const isLocal = (id) => id.startsWith('local');
  const bridge = {
    setLayout: (target, layout) => { if (target === 'all' || !isLocal(target)) send({ t: 'to', target, msg: { t: 'layout.set', layout } }); },
    patch: (target, id, props) => { if (target === 'all' || !isLocal(target)) send({ t: 'to', target, msg: { t: 'layout.patch', id, props } }); },
    vibrate: (target, pattern) => {
      if (target === 'all' || !isLocal(target)) send({ t: 'to', target, msg: { t: 'vibrate', pattern } });
      if (target === 'all' || isLocal(target)) rumbleLocal(target, pattern);
    },
    end: (results) => finishMatch(results),
  };
  try {
    const mod = await import(g.path + g.entry);
    const options = Object.fromEntries((g.options || []).map((o) => [o.id, o.default]));
    app.host = new GameHost(mod.default, { root: stage, manifest: g, players, bridge, options });
    await app.host.start();
    local.start();
  } catch (e) {
    console.error(e);
    finishMatch({ error: String(e.message || e) });
  }
}

function finishMatch(results) {
  local.stop();
  app.host = null;
  const g = app.match?.game;
  app.match = null;
  app.awaitingLobby = true;
  send({ t: 'match.end', results });
  const all = [...(app.session?.players || []), ...Array.from({ length: app.localCount }, (_, i) => ({ id: `local${i + 1}`, name: localName(i), color: LOCAL_COLORS[i] }))];
  $('resultsTitle').textContent = results.error ? 'El juego se detuvo por un error' : results.title || `Fin de ${g?.name || 'la partida'}`;
  $('podium').replaceChildren(...(results.ranking || []).map((id, i) => {
    const p = all.find((x) => x.id === id) || { name: id, color: '#888' };
    const li = document.createElement('li');
    li.innerHTML = `<b>${i + 1}°</b><i></i><span></span><span class="score"></span>`;
    li.children[1].style.background = p.color;
    li.children[2].textContent = p.name;
    li.children[3].textContent = results.scores?.[id] != null ? results.scores[id] : '';
    return li;
  }));
  if (results.error) toast(results.error);
  showView('home');
  $('results').hidden = false;
  $('resultsOk').focus();
  clearTimeout(app.resultsTimer);
  app.resultsTimer = setTimeout(closeResults, 12000);
}
function closeResults() { $('results').hidden = true; focusTile(app.focusIndex); }
$('resultsOk').onclick = closeResults;
function abortMatch() { app.host?.end({ title: 'Partida cancelada' }); }

// ───────────────────────── Jugadores locales (teclado y gamepad) ─────────────────────────
const KEYMAP = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', buttons: ['KeyF', 'KeyG', 'KeyH'], digits: (c) => c.startsWith('Digit') && c !== 'Digit0' ? Number(c.slice(5)) : null },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', buttons: ['KeyK', 'KeyL', 'KeyJ'], digits: (c) => c.startsWith('Numpad') && /\d$/.test(c) && c !== 'Numpad0' ? Number(c.slice(6)) : null },
];
const local = {
  keys: new Set(), timer: null, prev: new Map(), sliders: new Map(), buttons: new Map(),
  start() { this.keys.clear(); this.prev.clear(); this.sliders.clear(); this.buttons.clear(); this.timer = setInterval(() => this.tick(), 16); },
  stop() { clearInterval(this.timer); this.timer = null; },
  emit(player, control, kind, value) { app.host?.handleInput({ player, control, kind, value }); },
  tick() {
    if (!app.host) return;
    const pads = navigator.getGamepads?.() || [];
    for (let i = 0; i < app.localCount; i++) {
      const id = `local${i + 1}`;
      const lay = app.host.ctx.controllers.layoutOf(id);
      if (!lay) continue;
      const km = KEYMAP[i];
      let x = (this.keys.has(km.right) ? 1 : 0) - (this.keys.has(km.left) ? 1 : 0);
      let y = (this.keys.has(km.down) ? 1 : 0) - (this.keys.has(km.up) ? 1 : 0);
      const pressed = km.buttons.map((k) => this.keys.has(k));
      const gp = pads[i];
      if (gp) {
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        if (Math.abs(ax) > 0.2) x = ax; if (Math.abs(ay) > 0.2) y = ay;
        if (gp.buttons[14]?.pressed) x = -1; if (gp.buttons[15]?.pressed) x = 1;
        if (gp.buttons[12]?.pressed) y = -1; if (gp.buttons[13]?.pressed) y = 1;
        [0, 1, 2].forEach((b) => { if (gp.buttons[b]?.pressed) pressed[b] = true; });
        if (gp.buttons[7]?.pressed) pressed[0] = true; // gatillo derecho = acelerar
      }
      let bi = 0;
      for (const c of lay.controls) {
        const k = `${id}:${c.id}`;
        if (c.disabled || c.hidden) continue;
        if (c.type === 'dpad' || c.type === 'joystick' || c.type === 'tilt') {
          const v = c.type === 'dpad' ? [Math.round(x), Math.round(y)] : c.type === 'tilt' || c.axis === 'x' ? [x, 0] : [x, y];
          const sv = v.join(',');
          if (this.prev.get(k) !== sv) { this.prev.set(k, sv); this.emit(id, c.id, 'axis', v); }
        } else if (c.type === 'slider') {
          if (gp && Math.abs(gp.axes[1] || 0) > 0.05) {
            const v = ((gp.axes[1] || 0) + 1) / 2;
            this.emit(id, c.id, 'value', v);
          } else if (y) {
            const v = Math.max(0, Math.min(1, (this.sliders.get(k) ?? c.value ?? 0.5) + y * 0.025));
            this.sliders.set(k, v); this.emit(id, c.id, 'value', v);
          }
        } else if (c.type === 'button') {
          const on = !!pressed[bi++];
          if ((this.buttons.get(k) || false) !== on) { this.buttons.set(k, on); this.emit(id, c.id, on ? 'down' : 'up'); }
        }
      }
    }
  },
  key(e, down) {
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (!down || !app.host) return;
    for (let i = 0; i < app.localCount; i++) {
      const d = KEYMAP[i].digits(e.code);
      if (d == null) continue;
      const id = `local${i + 1}`;
      const grid = app.host.ctx.controllers.layoutOf(id)?.controls.find((c) => c.type === 'grid' && !c.disabled);
      if (grid && d <= grid.rows * grid.cols) {
        // Teclado numérico: 7 8 9 arriba, como la grilla en pantalla
        const idx = e.code.startsWith('Numpad') ? [6, 7, 8, 3, 4, 5, 0, 1, 2][d - 1] : d - 1;
        this.emit(id, grid.id, 'press', idx);
      }
    }
  },
};
function rumbleLocal(target, pattern) {
  const ms = Array.isArray(pattern) ? pattern[0] : pattern;
  const pads = navigator.getGamepads?.() || [];
  pads.forEach((gp, i) => {
    if (!gp?.vibrationActuator || (target !== 'all' && target !== `local${i + 1}`)) return;
    gp.vibrationActuator.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: 0.6, weakMagnitude: 0.4 }).catch?.(() => {});
  });
}

// ───────────────────────── Navegación tipo consola ─────────────────────────
function moveFocus(dx, dy) {
  const items = [...document.querySelectorAll('.view:not([hidden]) .nav')].filter((el) => el.offsetParent !== null);
  const cur = document.activeElement?.classList.contains('nav') ? document.activeElement : null;
  if (!cur) return items[0]?.focus();
  const r0 = cur.getBoundingClientRect();
  const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const ddx = c.x - c0.x, ddy = c.y - c0.y;
    const along = dx ? ddx * dx : ddy * dy;
    if (along <= 4) continue;
    const across = dx ? Math.abs(ddy) : Math.abs(ddx);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }
}

addEventListener('keydown', (e) => {
  if (app.view === 'game') {
    if (e.code === 'Escape') {
      if (app.escArmed) { app.escArmed = false; $('exitHint').hidden = true; abortMatch(); }
      else { app.escArmed = true; $('exitHint').hidden = false; setTimeout(() => { app.escArmed = false; $('exitHint').hidden = true; }, 2500); }
      return;
    }
    local.key(e, true);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    return;
  }
  const typing = e.target.tagName === 'INPUT';
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[e.key] && !(typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) { e.preventDefault(); moveFocus(...dirs[e.key]); return; }
  if (e.key === 'Escape' || e.key === 'Backspace' && !typing || e.key === 'GoBack' || e.key === 'BrowserBack') {
    if (!$('results').hidden) return closeResults();
    if (app.view !== 'home') { e.preventDefault(); showView('home'); }
    return;
  }
  if (!$('results').hidden && e.key === 'Enter') { e.preventDefault(); closeResults(); }
  if (app.view === 'home' && e.key.toLowerCase() === 'l' && !typing) $('localBtn').click();
});
addEventListener('keyup', (e) => { if (app.view === 'game') local.key(e, false); });

// Gamepad como mando de navegación de la consola (Android TV, mandos Bluetooth)
let gpPrev = {};
function pollMenuGamepad() {
  requestAnimationFrame(pollMenuGamepad);
  if (app.view === 'game') return;
  const gp = (navigator.getGamepads?.() || []).find(Boolean);
  if (!gp) return;
  const now = performance.now();
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const dir = gp.buttons[14]?.pressed || ax < -0.6 ? 'l' : gp.buttons[15]?.pressed || ax > 0.6 ? 'r' : gp.buttons[12]?.pressed || ay < -0.6 ? 'u' : gp.buttons[13]?.pressed || ay > 0.6 ? 'd' : null;
  if (dir && (gpPrev.dir !== dir || now - gpPrev.t > 220)) {
    gpPrev = { dir, t: now };
    moveFocus(...{ l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[dir]);
  } else if (!dir) gpPrev.dir = null;
  const a = gp.buttons[0]?.pressed, b = gp.buttons[1]?.pressed;
  if (a && !gpPrev.a) document.activeElement?.click();
  if (b && !gpPrev.b) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
  gpPrev.a = a; gpPrev.b = b;
}
requestAnimationFrame(pollMenuGamepad);
addEventListener('gamepadconnected', () => { toast('Gamepad conectado'); renderPlayers(); });

// ───────────────────────── Utilidades ─────────────────────────
let toastTimer;
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

boot().catch((e) => { console.error(e); toast('No se pudo conectar con el servidor'); });
