// GameHub Pad — cliente de mando (web y dentro de la APK GameHub Pad).
// Puente nativo opcional: window.GameHubNative (ver docs/android.md).

const $ = (id) => document.getElementById(id);
const native = window.GameHubNative || null;
const params = new URLSearchParams(location.search);

const state = {
  ws: null, code: null, name: null, playerId: null, color: null,
  session: null, games: [], layout: null, retry: 0, closedByServer: false,
};

// ───────────────────────── Pantallas ─────────────────────────
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}
function status(text) {
  $('status').hidden = !text;
  $('status').textContent = text || '';
}

// ───────────────────────── Unirse ─────────────────────────
$('code').value = (params.get('code') || localStorage.getItem('gh.lastCode') || '').toUpperCase();
$('name').value = localStorage.getItem('gh.name') || '';
if (native?.scanQr) $('scanBtn').hidden = false;
$('scanBtn').onclick = () => native.scanQr(); // la APK llama a window.ghOnQr(texto)
window.ghOnQr = (text) => {
  const m = String(text).match(/\/j\/([A-Z0-9]{4,6})/i);
  if (m) { $('code').value = m[1].toUpperCase(); }
};

$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  state.code = $('code').value.trim().toUpperCase();
  state.name = $('name').value.trim() || 'Jugador';
  localStorage.setItem('gh.name', state.name);
  localStorage.setItem('gh.lastCode', state.code);
  goFullscreen();
  connect();
};
if (params.get('code') && $('name').value) {
  // Llegó por QR y ya tiene nombre guardado: entra directo
  state.code = $('code').value; state.name = $('name').value; connect();
}

function goFullscreen() {
  if (native) return;
  document.documentElement.requestFullscreen?.().catch(() => {});
  navigator.wakeLock?.request('screen').catch(() => {});
}

// ───────────────────────── Red ─────────────────────────
function connect() {
  $('joinError').textContent = '';
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rt`);
  state.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'hello', role: 'pad', code: state.code, name: state.name, token: localStorage.getItem('gh.token.' + state.code) }));
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    if (state.ws !== ws) return;
    if (state.closedByServer || !state.playerId) return;
    status('Reconectando…');
    const delay = Math.min(5000, 500 * 2 ** state.retry++);
    setTimeout(connect, delay);
  };
}
function send(obj) { if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(obj)); }

function onMessage(m) {
  switch (m.t) {
    case 'ping': send({ t: 'pong' }); break;
    case 'error':
      if (!state.playerId) { $('joinError').textContent = m.message || 'No se pudo entrar'; show('join'); state.closedByServer = true; }
      else { $('lobbyError').textContent = m.message || ''; }
      break;
    case 'welcome':
      state.retry = 0; state.closedByServer = false; status('');
      state.playerId = m.playerId; state.color = m.color;
      localStorage.setItem('gh.token.' + state.code, m.token);
      document.documentElement.style.setProperty('--accent', m.color);
      $('meChip').textContent = state.name;
      $('sessionCode').textContent = state.code;
      loadGames();
      onSession(m.state);
      break;
    case 'session.state': onSession(m.state); break;
    case 'console.status': status(m.online ? '' : 'La consola se desconectó…'); break;
    case 'layout.set': state.layout = m.layout; renderLayout(); break;
    case 'layout.patch': patchControl(m.id, m.props); break;
    case 'vibrate': vibrate(m.pattern); break;
    case 'match.results': showResults(m.results); break;
    case 'session.closed':
      state.closedByServer = true; state.playerId = null;
      $('joinError').textContent = m.reason || 'La sesión terminó';
      localStorage.removeItem('gh.token.' + state.code);
      show('join');
      break;
  }
}

async function loadGames() {
  try { state.games = await (await fetch('/api/games')).json(); renderLobby(); } catch { /* reintenta al próximo estado */ }
}

// ───────────────────────── Lobby ─────────────────────────
function onSession(s) {
  const prevPhase = state.session?.phase;
  state.session = s;
  if (s.phase === 'playing') {
    if (prevPhase !== 'playing') { state.layout = null; renderLayout(); }
    if ($('results').hidden) show('pad');
  } else if ($('results').hidden) {
    show('lobby');
  }
  renderLobby();
}

function renderLobby() {
  const s = state.session; if (!s) return;
  const leader = s.leaderId === state.playerId;
  const leaderName = s.players.find((p) => p.id === s.leaderId)?.name;
  $('lobbyTitle').textContent = leader ? 'Eres el líder' : 'En el lobby';
  $('playerList').replaceChildren(...s.players.map((p) => {
    const li = document.createElement('li');
    li.className = p.connected ? '' : 'off';
    li.innerHTML = '<i></i><span></span>';
    li.firstChild.style.background = p.color;
    li.lastChild.textContent = p.name + (p.id === s.leaderId ? ' ★' : '');
    return li;
  }));
  if (s.localPlayers) {
    const li = document.createElement('li');
    li.textContent = `+${s.localPlayers} en la consola`;
    $('playerList').append(li);
  }
  $('leaderPanel').hidden = !leader;
  const g = state.games.find((x) => x.id === s.gameId);
  $('waitText').textContent = leader ? '' : g ? `${leaderName || 'El líder'} eligió ${g.name}. Esperando a que inicie…` : `Esperando a que ${leaderName || 'el líder'} elija un juego…`;
  if (leader) {
    const n = s.players.filter((p) => p.connected).length + (s.localPlayers || 0);
    $('gameList').replaceChildren(...state.games.map((game) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      const ok = n >= game.players.min && n <= game.players.max;
      b.className = game.id === s.gameId ? 'sel' : '';
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = game.name;
      b.lastChild.textContent = game.players.min === game.players.max ? `${game.players.min} jug.` : `${game.players.min}–${game.players.max} jug.`;
      if (!ok) b.style.opacity = .5;
      b.onclick = () => { $('lobbyError').textContent = ''; send({ t: 'lobby.select', gameId: game.id }); };
      li.append(b);
      return li;
    }));
    $('startBtn').disabled = !g;
    $('startBtn').textContent = g ? `Iniciar ${g.name}` : 'Iniciar';
  }
}
$('startBtn').onclick = () => { $('lobbyError').textContent = ''; send({ t: 'lobby.start' }); };

function showResults(r) {
  const idx = (r.ranking || []).indexOf(state.playerId);
  $('resultPlace').textContent = idx === 0 ? '🏆 1°' : idx > 0 ? `${idx + 1}°` : '🎮';
  $('resultTitle').textContent = r.error ? 'El juego terminó con un error' : r.title || 'Fin de la partida';
  show('results');
  vibrate(idx === 0 ? [80, 60, 80, 60, 200] : 60);
}
$('resultsOk').onclick = () => { $('results').hidden = true; onSession(state.session); };

// ───────────────────────── Feedback ─────────────────────────
function vibrate(pattern = 30) {
  if (native?.vibrate) return native.vibrate(JSON.stringify(pattern));
  navigator.vibrate?.(pattern);
}

// ───────────────────────── Render del layout ─────────────────────────
const controlsEl = $('controls');
const renderers = {};
let cleanups = [];

function renderLayout() {
  for (const c of cleanups) c();
  cleanups = [];
  controlsEl.replaceChildren();
  const lay = state.layout;
  if (!lay) {
    controlsEl.style.gridTemplateAreas = '"m"';
    controlsEl.append(textEl({ text: 'Cargando juego…', size: 'm' }));
    return;
  }
  if (lay.accent) document.documentElement.style.setProperty('--accent', lay.accent);
  controlsEl.style.gridTemplateAreas = (lay.areas || []).map((r) => `"${r}"`).join(' ');
  for (const c of lay.controls) {
    if (c.hidden) continue;
    const wrap = document.createElement('div');
    wrap.className = 'ctl' + (c.disabled ? ' disabled' : '');
    wrap.dataset.id = c.id;
    wrap.style.gridArea = c.area || c.id;
    if (c.color) wrap.style.setProperty('--c', c.color);
    (renderers[c.type] || renderers.text)(wrap, c);
    controlsEl.append(wrap);
  }
  checkOrientation();
  if (native?.setOrientation) native.setOrientation(lay.orientation || 'any');
  else if (lay.orientation && lay.orientation !== 'any') screen.orientation?.lock?.(lay.orientation).catch(() => {});
}

function patchControl(id, props) {
  const c = state.layout?.controls.find((x) => x.id === id);
  if (!c) return;
  Object.assign(c, props);
  const wrap = controlsEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return renderLayout();
  wrap.className = 'ctl' + (c.disabled ? ' disabled' : '');
  wrap.replaceChildren();
  (renderers[c.type] || renderers.text)(wrap, c);
}

function checkOrientation() {
  const want = state.layout?.orientation;
  const portrait = innerHeight > innerWidth;
  $('rotateHint').hidden = !want || want === 'any' || (want === 'portrait') === portrait;
}
addEventListener('resize', checkOrientation);

const input = (c, k, v) => send({ t: 'input', c, k, v });

function textEl(c) {
  const d = document.createElement('div');
  d.className = `text ${c.size || 'm'}`;
  d.innerHTML = '<div class="main"></div><div class="sub"></div>';
  d.firstChild.textContent = c.text || '';
  d.lastChild.textContent = c.sub || '';
  return d;
}
renderers.text = (wrap, c) => wrap.append(textEl(c));

renderers.button = (wrap, c) => {
  const b = document.createElement('div');
  b.className = `btn ${c.shape || ''}`;
  b.textContent = c.label ?? c.id.toUpperCase();
  let pid = null;
  b.onpointerdown = (e) => {
    if (pid !== null) return;
    pid = e.pointerId; b.setPointerCapture(pid); b.classList.add('on');
    vibrate(c.haptic ?? 12); input(c.id, 'down');
  };
  const up = (e) => { if (e.pointerId !== pid) return; pid = null; b.classList.remove('on'); input(c.id, 'up'); };
  b.onpointerup = up; b.onpointercancel = up;
  wrap.append(b);
};

renderers.dpad = (wrap, c) => {
  const d = document.createElement('div');
  d.className = 'dpad';
  d.innerHTML = '<span class="u">▲</span><span class="d">▼</span><span class="l">◀</span><span class="r">▶</span>';
  let last = '0,0', pid = null;
  const set = (x, y) => {
    const key = `${x},${y}`;
    if (key === last) return;
    last = key;
    d.querySelector('.u').classList.toggle('on', y < 0); d.querySelector('.d').classList.toggle('on', y > 0);
    d.querySelector('.l').classList.toggle('on', x < 0); d.querySelector('.r').classList.toggle('on', x > 0);
    if (x || y) vibrate(8);
    input(c.id, 'axis', [x, y]);
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    const r = d.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
    if (Math.hypot(dx, dy) < 0.12) return set(0, 0);
    const a = Math.atan2(dy, dx);
    const oct = Math.round(a / (Math.PI / 4));
    if (c.diagonals) {
      set(Math.round(Math.cos(oct * Math.PI / 4)), Math.round(Math.sin(oct * Math.PI / 4)));
    } else if (Math.abs(dx) > Math.abs(dy)) set(Math.sign(dx), 0); else set(0, Math.sign(dy));
  };
  d.onpointerdown = (e) => { pid = e.pointerId; d.setPointerCapture(pid); move(e); };
  d.onpointermove = move;
  d.onpointerup = d.onpointercancel = (e) => { if (e.pointerId === pid) { pid = null; set(0, 0); } };
  wrap.append(d);
};

renderers.joystick = (wrap, c) => {
  const base = document.createElement('div');
  base.className = 'stick';
  base.innerHTML = '<div class="knob"></div>';
  const knob = base.firstChild;
  const dz = c.deadzone ?? 0.12;
  let pid = null, last = [0, 0], lastSent = 0, pending = null;
  const emit = (v) => {
    const now = performance.now();
    if (Math.abs(v[0] - last[0]) < 0.02 && Math.abs(v[1] - last[1]) < 0.02 && (v[0] || v[1])) return;
    if (now - lastSent < 16 && (v[0] || v[1])) { clearTimeout(pending); pending = setTimeout(() => emit(v), 16); return; }
    last = v; lastSent = now; input(c.id, 'axis', v);
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    const r = base.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (c.axis === 'x') y = 0; if (c.axis === 'y') x = 0;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    knob.style.transform = `translate(${x * 70}%, ${y * 70}%)`;
    const m = Math.hypot(x, y);
    emit(m < dz ? [0, 0] : [+x.toFixed(3), +y.toFixed(3)]);
  };
  base.onpointerdown = (e) => { pid = e.pointerId; base.setPointerCapture(pid); move(e); };
  base.onpointermove = move;
  base.onpointerup = base.onpointercancel = (e) => {
    if (e.pointerId !== pid) return;
    pid = null; knob.style.transform = ''; clearTimeout(pending); last = [9, 9]; emit([0, 0]);
  };
  wrap.append(base);
};

renderers.slider = (wrap, c) => {
  const vertical = c.orientation !== 'horizontal';
  const s = document.createElement('div');
  s.className = 'slider' + (vertical ? '' : ' h');
  s.innerHTML = '<div class="thumb"></div>';
  const thumb = s.firstChild;
  let pid = null, last = -1;
  const place = (v) => {
    if (vertical) thumb.style.top = `${v * 82}%`; else thumb.style.left = `${v * 82}%`;
  };
  place(c.value ?? 0.5);
  const move = (e) => {
    if (e.pointerId !== pid) return;
    const r = s.getBoundingClientRect();
    let v = vertical ? (e.clientY - r.top - r.height * 0.09) / (r.height * 0.82) : (e.clientX - r.left - r.width * 0.09) / (r.width * 0.82);
    v = Math.max(0, Math.min(1, v));
    place(v);
    if (Math.abs(v - last) >= 0.004) { last = v; input(c.id, 'value', +v.toFixed(4)); }
  };
  s.onpointerdown = (e) => { pid = e.pointerId; s.setPointerCapture(pid); move(e); };
  s.onpointermove = move;
  s.onpointerup = s.onpointercancel = (e) => { if (e.pointerId === pid) pid = null; };
  wrap.append(s);
};

renderers.grid = (wrap, c) => {
  const g = document.createElement('div');
  g.className = 'grid';
  g.style.gridTemplateColumns = `repeat(${c.cols}, 1fr)`;
  g.style.gridTemplateRows = `repeat(${c.rows}, 1fr)`;
  g.style.setProperty('--ar', `${c.cols} / ${c.rows}`);
  const disabled = new Set(c.disabledCells || []);
  for (let i = 0; i < c.rows * c.cols; i++) {
    const b = document.createElement('button');
    b.textContent = c.cells?.[i] ?? '';
    if (c.cellColors?.[i]) b.style.color = c.cellColors[i];
    b.disabled = disabled.has(i);
    b.onclick = () => { vibrate(15); input(c.id, 'press', i); };
    g.append(b);
  }
  wrap.append(g);
};

// Inclinación: sensores nativos (APK) o DeviceOrientation (navegador). Sin sensores → joystick.
let tiltCalib = Number(localStorage.getItem('gh.tiltCalib') || 0);
let tiltInvert = localStorage.getItem('gh.tiltInvert') === '1';
renderers.tilt = (wrap, c) => {
  const range = c.range || 35;
  const box = document.createElement('div');
  box.className = 'wheel-wrap';
  const wheel = document.createElement('div');
  wheel.className = 'wheel';
  const row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '8px';
  const center = document.createElement('button'); center.textContent = 'Centrar';
  const inv = document.createElement('button'); inv.textContent = 'Invertir';
  const fb = document.createElement('button'); fb.textContent = 'Usar joystick';
  row.append(center, inv, fb);
  box.append(wheel, row);
  wrap.append(box);

  let raw = 0, last = 9, active = false;
  const emit = () => {
    let x = (raw - tiltCalib) / range;
    if (tiltInvert) x = -x;
    x = Math.max(-1, Math.min(1, x));
    wheel.style.transform = `rotate(${x * 90}deg)`;
    if (Math.abs(x - last) > 0.015) { last = x; input(c.id, 'axis', [+x.toFixed(3), 0]); }
  };
  const onOrient = (e) => {
    if (e.beta == null) return;
    active = true;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    // Teléfono en horizontal como volante: el giro se lee en beta; en vertical, en gamma.
    raw = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : e.gamma;
    emit();
  };
  center.onclick = () => { tiltCalib = raw; localStorage.setItem('gh.tiltCalib', String(raw)); emit(); };
  inv.onclick = () => { tiltInvert = !tiltInvert; localStorage.setItem('gh.tiltInvert', tiltInvert ? '1' : '0'); emit(); };
  const toFallback = () => {
    stop();
    wrap.replaceChildren();
    renderers[c.fallback === 'slider' ? 'slider' : 'joystick'](wrap, { ...c, type: c.fallback || 'joystick', axis: 'x', orientation: 'horizontal' });
  };
  fb.onclick = toFallback;

  let stop = () => {};
  if (native?.startTilt) {
    window.ghNativeTilt = (angleDeg) => { active = true; raw = angleDeg; emit(); };
    native.startTilt();
    stop = () => native.stopTilt?.();
  } else if ('DeviceOrientationEvent' in window) {
    const start = () => { addEventListener('deviceorientation', onOrient); };
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      center.textContent = 'Activar sensores';
      center.onclick = () => DeviceOrientationEvent.requestPermission().then((r) => {
        if (r === 'granted') { start(); center.textContent = 'Centrar'; center.onclick = () => { tiltCalib = raw; emit(); }; } else toFallback();
      }).catch(toFallback);
    } else start();
    stop = () => removeEventListener('deviceorientation', onOrient);
    setTimeout(() => { if (!active) toFallback(); }, 1500);
  } else {
    toFallback();
  }
  cleanups.push(() => stop());
};
