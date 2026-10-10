// Turbo Karts — 1 a 4 jugadores en pantalla dividida, con karts CPU de relleno.
// Render pseudo-3D estilo "Mode 7" sobre Canvas 2D: el suelo se proyecta en perspectiva
// píxel a píxel y los karts, cajas y plátanos se dibujan como sprites ordenados por distancia.
import { defineGame, L } from '/sdk/gamehub-sdk.js';
import { buildTrack, WORLD, ROAD_HALF } from './track.js';

const W = 1280, H = 720;
const TOTAL_KARTS = 4;
const CPU_COLORS = ['#ff9a3c', '#b67dff', '#2ee6d6', '#e0e0e0'];
const MAX_SPEED = 230, BOOST_SPEED = 340, GRASS_SPEED = 105;
const CAM_BACK = 46, CAM_H = 20;

let s;

// ───────────────────────── Configuración ─────────────────────────
function padLayout() {
  return L.layout({
    orientation: 'landscape',
    areas: ['steer steer item gas', 'steer steer brake gas'],
    controls: [
      L.tilt('steer', { mode: 'wheel', range: 30, fallback: 'joystick' }),
      L.button('gas', { label: '▲', color: '#5be37d', shape: 'pill', haptic: 8 }),
      L.button('brake', { label: '▼', color: '#9aa0c0' }),
      L.button('item', { label: '·', color: '#ffd23f', disabled: true }),
    ],
  });
}

function makeKart(i, player, cpu) {
  const t = s.track;
  const row = Math.floor(i / 2), col = i % 2 ? 1 : -1;
  const [tx, ty] = t.tangent[0];
  const back = 22 + row * 26;
  const [sx, sy] = t.points[0];
  return {
    id: player?.id ?? `cpu${i}`, name: player?.name ?? `CPU ${i}`, color: player?.color ?? CPU_COLORS[i % CPU_COLORS.length],
    human: !!player, cpu,
    x: sx - tx * back + -ty * col * 16, y: sy - ty * back + tx * col * 16,
    angle: Math.atan2(ty, tx), speed: 0, steer: 0,
    idx: 0, lapProgress: 0, lap: 0, cp: 0, finished: false, finishTime: 0,
    item: null, boost: 0, spin: 0, bump: 0,
    cpuSkill: 0.88 + Math.random() * 0.09, cpuItemAt: 0, lane: [-18, 18, -6, 6][i % 4],
  };
}

// ───────────────────────── Juego ─────────────────────────
export default defineGame({
  setup(ctx) {
    const { g } = ctx.createCanvas({ width: W, height: H });
    const track = buildTrack();
    const humans = ctx.players.slice(0, 4);
    // autopilot: los humanos conducen solos (modo demostración y pruebas automáticas)
    s = { g, track, laps: Number(ctx.options.laps) || 3, autopilot: !!ctx.options.autopilot, karts: [], bananas: [], boxes: [], state: 'countdown', raceTime: 0, finishOrder: [], endAt: 0, views: [] };
    humans.forEach((p, i) => s.karts.push(makeKart(i, p, false)));
    for (let i = humans.length; i < Math.max(TOTAL_KARTS, humans.length); i++) s.karts.push(makeKart(i, null, true));
    // Cajas de ítems: 4 por fila, de lado a lado de la pista
    for (const idx of track.itemRows) {
      const [px, py] = track.points[idx], [tx, ty] = track.tangent[idx];
      for (const k of [-27, -9, 9, 27]) s.boxes.push({ x: px - ty * k, y: py + tx * k, hiddenUntil: 0 });
    }
    // Vistas de pantalla dividida, cada una con su buffer de baja resolución
    const vps = ctx.viewports(humans.length, W, H, 6);
    s.views = humans.map((p, i) => {
      const vp = vps[i];
      const rw = Math.round(humans.length >= 3 ? 320 : 480);
      const rh = Math.round(rw * vp.h / vp.w);
      const buf = new OffscreenCanvas(rw, rh);
      const bg = buf.getContext('2d');
      const img = bg.createImageData(rw, rh);
      // Horizonte al 34 % y distancia focal elegida para que el kart propio quede al 84 % de la altura
      const hz = Math.round(rh * 0.34);
      const f = ((rh * 0.84 - hz) * CAM_BACK) / CAM_H;
      return { kart: s.karts[i], vp, rw, rh, hz, f, buf, bg, img, px: new Uint32Array(img.data.buffer) };
    });
    s.minimap = vps.length === 3 ? { x: W / 2 + 3, y: H / 2 + 3, w: W / 2 - 3, h: H / 2 - 3, big: true } : { x: W - 170, y: 10, w: 160, h: 160, big: false };
    s.engines = humans.map(() => ctx.audio.engine('sawtooth'));

    ctx.controllers.set('all', padLayout());
    const seq = [['3', 330], ['2', 330], ['1', 330], ['¡YA!', 660]];
    seq.forEach(([txt, f], i) => ctx.timer.after(0.6 + i, () => {
      ctx.ui.banner(txt, 0.9);
      ctx.audio.tone(f, i === 3 ? 0.4 : 0.18, { type: 'square', vol: 0.5 });
      if (i === 3) { s.state = 'race'; ctx.controllers.vibrate('all', 80); }
    }));
  },

  onInput(ctx, e) {
    if (e.control === 'item' && e.kind === 'down') {
      const k = s.karts.find((x) => x.id === e.player);
      if (k) useItem(ctx, k);
    }
  },

  update(ctx, dt) {
    if (s.state === 'race' || s.state === 'finishing') s.raceTime += dt;
    for (const k of s.karts) driveKart(ctx, k, dt);
    collideKarts();
    for (const b of s.boxes) {
      if (b.hiddenUntil > ctx.time) continue;
      for (const k of s.karts) {
        if (Math.hypot(k.x - b.x, k.y - b.y) < 11 && !k.item && !k.finished) {
          b.hiddenUntil = ctx.time + 3;
          giveItem(ctx, k);
          break;
        }
      }
    }
    for (const bn of s.bananas) {
      if (bn.armedAt > ctx.time) continue;
      for (const k of s.karts) {
        if (!bn.gone && Math.hypot(k.x - bn.x, k.y - bn.y) < 9) {
          bn.gone = true; k.spin = 0.9; k.speed *= 0.3;
          if (k.human) { ctx.controllers.vibrate(k.id, [150, 50, 150]); ctx.audio.tone(180, 0.3, { type: 'sawtooth', slide: -100 }); }
        }
      }
    }
    s.bananas = s.bananas.filter((b) => !b.gone);
    // Sonido de motor por jugador
    s.views.forEach((v, i) => s.engines[i].set(60 + Math.abs(v.kart.speed) * 0.9 + (v.kart.boost > 0 ? 60 : 0), s.state === 'countdown' ? 0.02 : 0.05 / s.views.length));

    // Fin de carrera: todos los humanos llegaron, o 15 s tras el primero
    // (si solo terminan CPUs, se espera 30 s; si termina un humano, 15 s)
    const humans = s.karts.filter((k) => k.human);
    if (s.state === 'race' && s.karts.some((k) => k.finished)) {
      s.state = 'finishing'; s.endAt = ctx.time + (humans.some((k) => k.finished) ? 15 : 30);
    }
    if (s.state === 'finishing' && humans.some((k) => k.finished)) s.endAt = Math.min(s.endAt, ctx.time + 15);
    if (s.state === 'finishing' && (humans.every((k) => k.finished) || ctx.time > s.endAt)) {
      s.state = 'done';
      ctx.timer.after(1.5, () => endRace(ctx));
    }
  },

  render(ctx) {
    const g = s.g;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const order = standings();
    for (const v of s.views) drawView(ctx, v, order);
    drawMinimap(ctx, order);
  },

  dispose() {
    s.engines.forEach((e) => e.stop());
  },
});

// ───────────────────────── Física ─────────────────────────
function controlsFor(ctx, k) {
  if (k.cpu || s.autopilot) {
    const t = s.track;
    // Cada CPU usa su propio carril para no chocar siempre con los demás
    const ai = (k.idx + 12) % t.N, ahead = t.points[ai], [tx2, ty2] = t.tangent[ai];
    const lane = k.lane * (1 + 0.3 * Math.sin(ctx.time * 0.5 + k.lane));
    const want = Math.atan2(ahead[1] + tx2 * lane - k.y, ahead[0] - ty2 * lane - k.x);
    let diff = want - k.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // Frena antes de las curvas cerradas: compara la dirección actual de la pista con la de más adelante
    const [ax, ay] = t.tangent[k.idx], [bx, by] = t.tangent[(k.idx + 22) % t.N];
    const bend = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by)));
    const cap = k.cpuSkill * Math.max(0.42, 1 - bend * 0.5);
    const tooFast = k.speed > MAX_SPEED * cap + 10;
    if (k.item && ctx.time > k.cpuItemAt) useItem(ctx, k);
    return { steer: Math.max(-1, Math.min(1, diff * 2.5)), gas: !tooFast, brake: tooFast && k.speed > MAX_SPEED * cap + 40, cap };
  }
  const [ax] = ctx.input.axis(k.id, 'steer');
  return { steer: ax, gas: ctx.input.down(k.id, 'gas'), brake: ctx.input.down(k.id, 'brake'), cap: 1 };
}

function driveKart(ctx, k, dt) {
  const t = s.track;
  const near = t.nearest(k.x, k.y, k.idx);
  k.idx = near.index;
  const surface = t.surface(near.dist);
  const racing = s.state === 'race' || s.state === 'finishing';
  const c = racing && !k.finished ? controlsFor(ctx, k) : { steer: 0, gas: false, brake: !racing, cap: 1 };
  if (k.finished && k.human) c.gas = false;

  k.boost = Math.max(0, k.boost - dt);
  k.spin = Math.max(0, k.spin - dt);
  k.bump = Math.max(0, k.bump - dt);
  if (surface === 'road' && t.turboPads.some((i) => Math.abs(i - k.idx) < 4) && k.boost < 0.5) {
    k.boost = 0.8;
    if (k.human) { ctx.controllers.vibrate(k.id, 60); ctx.audio.tone(520, 0.25, { type: 'triangle', slide: 400, vol: 0.35 }); }
  }

  let top = (k.boost > 0 ? BOOST_SPEED : MAX_SPEED) * c.cap;
  if (surface === 'grass' && k.boost <= 0) top = GRASS_SPEED;
  if (k.spin > 0) { k.angle += dt * 14; k.speed *= 0.95; return move(k, dt); }

  if (c.gas) k.speed += (k.boost > 0 ? 520 : 260) * dt;
  else if (c.brake) k.speed -= 380 * dt;
  else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), 90 * dt);
  if (k.speed > top) k.speed = Math.max(top, k.speed - 300 * dt);
  k.speed = Math.max(-70, k.speed);

  const grip = Math.min(1, Math.abs(k.speed) / 70);
  k.steer += (c.steer - k.steer) * Math.min(1, dt * 12);
  k.angle += k.steer * 2.8 * grip * Math.sign(k.speed || 1) * dt;
  move(k, dt);

  // Vueltas: 4 sectores en orden; cruzar del 3 al 0 suma una vuelta
  const sector = Math.floor(k.idx / (t.N / 4));
  if (sector === (k.cp + 1) % 4) {
    k.cp = sector;
    if (sector === 0) {
      k.lap++;
      if (k.lap >= s.laps && !k.finished) {
        k.finished = true; k.finishTime = s.raceTime;
        s.finishOrder.push(k.id);
        if (k.human) {
          const pos = s.finishOrder.length;
          ctx.controllers.vibrate(k.id, [100, 60, 100, 60, 300]);
          ctx.controllers.patch(k.id, 'item', { label: `${pos}°`, disabled: true });
          [523, 659, 784, 1046].forEach((f, i) => ctx.timer.after(i * 0.1, () => ctx.audio.tone(f, 0.15, { type: 'square', vol: 0.35 })));
        }
      } else if (k.human && k.lap === s.laps - 1) {
        ctx.audio.tone(880, 0.3, { type: 'triangle' });
      }
    }
  }
  k.lapProgress = k.lap * t.N + ((k.idx - (k.cp === 0 && k.idx > t.N * 0.75 ? t.N : 0)));
}

function move(k, dt) {
  k.x += Math.cos(k.angle) * k.speed * dt;
  k.y += Math.sin(k.angle) * k.speed * dt;
  k.x = Math.max(12, Math.min(WORLD - 12, k.x));
  k.y = Math.max(12, Math.min(WORLD - 12, k.y));
}

function collideKarts() {
  for (let i = 0; i < s.karts.length; i++) for (let j = i + 1; j < s.karts.length; j++) {
    const a = s.karts[i], b = s.karts[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 13) {
      const push = (13 - d) / 2 + 0.5, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      // Solo frena en el impacto, no mientras siguen en contacto
      if (a.bump <= 0 && b.bump <= 0) { a.speed *= 0.85; b.speed *= 0.85; }
      a.bump = b.bump = 0.25;
    }
  }
}

// ───────────────────────── Ítems ─────────────────────────
function giveItem(ctx, k) {
  k.item = Math.random() < 0.6 ? 'turbo' : 'banana';
  k.cpuItemAt = ctx.time + 1 + Math.random() * 3;
  if (k.human) {
    ctx.controllers.patch(k.id, 'item', { label: k.item === 'turbo' ? '⚡' : '🍌', disabled: false });
    ctx.controllers.vibrate(k.id, [30, 30, 30]);
    ctx.audio.tone(990, 0.08, { type: 'square', vol: 0.3 });
  }
}
function useItem(ctx, k) {
  if (!k.item || k.finished) return;
  if (k.item === 'turbo') { k.boost = 1.3; if (k.human) ctx.audio.tone(400, 0.4, { type: 'sawtooth', slide: 500, vol: 0.4 }); }
  else s.bananas.push({ x: k.x - Math.cos(k.angle) * 14, y: k.y - Math.sin(k.angle) * 14, armedAt: ctx.time + 0.4 });
  k.item = null;
  if (k.human) ctx.controllers.patch(k.id, 'item', { label: '·', disabled: true });
}

function standings() {
  const fin = s.finishOrder.map((id) => s.karts.find((k) => k.id === id));
  const rest = s.karts.filter((k) => !k.finished).sort((a, b) => b.lapProgress - a.lapProgress);
  return [...fin, ...rest];
}

function endRace(ctx) {
  const order = standings().filter((k) => k.human);
  const all = standings();
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  ctx.end({
    ranking: order.map((k) => k.id),
    scores: Object.fromEntries(order.map((k) => [k.id, k.finished ? fmt(k.finishTime) : 'no terminó'])),
    title: `¡${all[0].name} gana la carrera!`,
  });
}

// ───────────────────────── Render ─────────────────────────
function drawView(ctx, v, order) {
  const g = s.g, k = v.kart, { vp, rw, rh } = v;
  const tex = s.track.texture.pixels;
  const dirX = Math.cos(k.angle), dirY = Math.sin(k.angle);
  const camX = k.x - dirX * CAM_BACK, camY = k.y - dirY * CAM_BACK;
  const camH = CAM_H + (k.bump > 0 ? 1.5 : 0);
  const { f, hz } = v;
  const px = v.px;
  px.fill(0, 0, hz * rw);
  const fogR = 0x8f, fogG = 0xcf, fogB = 0xff;
  for (let y = hz + 1; y < rh; y++) {
    const dist = camH * f / (y - hz);
    const cx = camX + dirX * dist, cy = camY + dirY * dist;
    const stepX = -dirY * dist / f, stepY = dirX * dist / f;
    let wx = cx - stepX * rw / 2, wy = cy - stepY * rw / 2;
    const fog = Math.min(1, Math.max(0, (dist - 260) / 500));
    let row = y * rw;
    for (let x = 0; x < rw; x++, row++) {
      const ix = wx | 0, iy = wy | 0;
      let c;
      if (ix >= 0 && iy >= 0 && ix < WORLD && iy < WORLD) c = tex[iy * WORLD + ix];
      else c = (((ix >> 5) + (iy >> 5)) & 1) ? 0xff4a9a3f : 0xff53a847;
      if (fog > 0) {
        const r = c & 0xff, gg = (c >> 8) & 0xff, b = (c >> 16) & 0xff;
        c = 0xff000000 | ((b + (fogB - b) * fog) << 16) | ((gg + (fogG - gg) * fog) << 8) | (r + (fogR - r) * fog);
      }
      px[row] = c;
      wx += stepX; wy += stepY;
    }
  }
  v.bg.putImageData(v.img, 0, 0);

  g.save();
  g.beginPath(); g.rect(vp.x, vp.y, vp.w, vp.h); g.clip();
  // Cielo y montañas con paralaje según el ángulo
  const sy = vp.h / rh;
  const horizon = vp.y + hz * sy;
  const sky = g.createLinearGradient(0, vp.y, 0, horizon);
  sky.addColorStop(0, '#2b7bd6'); sky.addColorStop(1, '#8fcfff');
  g.fillStyle = sky; g.fillRect(vp.x, vp.y, vp.w, horizon - vp.y + 2);
  const off = (k.angle / (Math.PI * 2)) * vp.w * 2;
  for (const [amp, color, freq, base] of [[0.12, '#5b8fc4', 3, 0.9], [0.08, '#3d8b4f', 5, 0.98]]) {
    g.fillStyle = color; g.beginPath(); g.moveTo(vp.x, horizon);
    for (let x = 0; x <= vp.w; x += 8) {
      const a = ((x + off) / vp.w) * Math.PI * 2 * freq;
      g.lineTo(vp.x + x, vp.y + (hz * base) * sy - (Math.sin(a) * 0.5 + 0.5 + Math.sin(a * 2.3) * 0.3) * amp * vp.h);
    }
    g.lineTo(vp.x + vp.w, horizon); g.fill();
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(v.buf, 0, hz, rw, rh - hz, vp.x, horizon, vp.w, vp.h - (horizon - vp.y));

  // Sprites proyectados
  const sx = vp.w / rw;
  const project = (wx, wy) => {
    const rx = wx - camX, ry = wy - camY;
    const depth = rx * dirX + ry * dirY;
    if (depth < 6) return null;
    const lat = -rx * dirY + ry * dirX;
    return { x: vp.x + (rw / 2 + lat * f / depth) * sx, y: vp.y + (hz + camH * f / depth) * sy, scale: (f / depth) * sx, depth };
  };
  const sprites = [];
  for (const b of s.boxes) if (b.hiddenUntil <= ctx.time) { const p = project(b.x, b.y); if (p) sprites.push({ p, draw: () => drawBox(g, p, ctx.time) }); }
  for (const b of s.bananas) { const p = project(b.x, b.y); if (p) sprites.push({ p, draw: () => drawBanana(g, p) }); }
  for (const o of s.karts) {
    const p = project(o.x, o.y);
    if (p) sprites.push({ p, draw: () => drawKart(g, p, o, o.angle - k.angle, ctx.time) });
  }
  sprites.sort((a, b) => b.p.depth - a.p.depth).forEach((sp) => sp.draw());

  // HUD
  const pos = order.indexOf(k) + 1;
  const big = Math.max(26, vp.h * 0.12);
  g.textBaseline = 'top'; g.textAlign = 'left';
  g.font = `900 ${big}px system-ui`; g.fillStyle = '#fff'; g.strokeStyle = '#000a'; g.lineWidth = 6;
  const posText = `${pos}°`;
  g.strokeText(posText, vp.x + 16, vp.y + 12); g.fillText(posText, vp.x + 16, vp.y + 12);
  g.font = `700 ${big * 0.42}px system-ui`;
  const lapText = k.finished ? '¡Meta!' : `Vuelta ${Math.min(s.laps, k.lap + 1)}/${s.laps}`;
  g.strokeText(lapText, vp.x + 18, vp.y + 18 + big); g.fillText(lapText, vp.x + 18, vp.y + 18 + big);
  g.fillStyle = k.color;
  g.fillRect(vp.x, vp.y, vp.w, 5);
  g.textAlign = 'right'; g.fillStyle = '#fff';
  g.strokeText(k.name, vp.x + vp.w - 16 - (s.minimap.big ? 0 : vp.x === W - vp.w || s.views.length === 1 ? 170 : 0), vp.y + 16);
  g.fillText(k.name, vp.x + vp.w - 16 - (s.minimap.big ? 0 : vp.x === W - vp.w || s.views.length === 1 ? 170 : 0), vp.y + 16);
  // Ítem
  if (k.item) {
    const bx = vp.x + vp.w / 2 - 28, by = vp.y + 12;
    g.fillStyle = '#000a'; g.fillRect(bx, by, 56, 56);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.strokeRect(bx, by, 56, 56);
    g.font = '36px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(k.item === 'turbo' ? '⚡' : '🍌', bx + 28, by + 30);
  }
  // Velocímetro
  const sp = Math.max(0, k.speed) / BOOST_SPEED;
  g.fillStyle = '#0008'; g.fillRect(vp.x + 16, vp.y + vp.h - 26, vp.w * 0.25, 10);
  g.fillStyle = k.boost > 0 ? '#ff9a3c' : '#5be37d'; g.fillRect(vp.x + 16, vp.y + vp.h - 26, vp.w * 0.25 * sp, 10);
  if (s.state === 'countdown') {
    g.fillStyle = '#0006'; g.fillRect(vp.x, vp.y + vp.h - 60, vp.w, 44);
    g.font = `700 ${Math.max(16, vp.h * 0.05)}px system-ui`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Inclina el teléfono para girar · ▲ acelerar', vp.x + vp.w / 2, vp.y + vp.h - 38);
  }
  g.restore();
}

function drawKart(g, p, k, relAngle, time) {
  const size = 14 * p.scale; // ancho en píxeles
  if (size < 2) return;
  const spinA = k.spin > 0 ? time * 14 : 0;
  const side = Math.sin(relAngle + spinA), facing = Math.cos(relAngle + spinA);
  const w = size * (0.65 + 0.35 * Math.abs(facing)), h = size * 0.55;
  const x = p.x, y = p.y;
  g.fillStyle = '#0006';
  g.beginPath(); g.ellipse(x, y, w * 0.62, h * 0.18, 0, 0, Math.PI * 2); g.fill();
  // Ruedas
  g.fillStyle = '#111';
  g.fillRect(x - w * 0.55, y - h * 0.5, w * 0.22, h * 0.5);
  g.fillRect(x + w * 0.33, y - h * 0.5, w * 0.22, h * 0.5);
  // Carrocería
  g.fillStyle = k.color;
  roundRect(g, x - w * 0.42, y - h * 0.85, w * 0.84, h * 0.6, h * 0.18); g.fill();
  g.fillStyle = '#0005';
  g.fillRect(x - w * 0.42, y - h * 0.4, w * 0.84, h * 0.14);
  // Piloto
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(x + side * w * 0.12, y - h * 1.05, h * 0.32, 0, Math.PI * 2); g.fill();
  g.fillStyle = k.color;
  g.fillRect(x + side * w * 0.12 - h * 0.32, y - h * 1.12, h * 0.64, h * 0.12);
  // Llamas del turbo
  if (k.boost > 0 && facing > 0) {
    g.fillStyle = Math.floor(time * 20) % 2 ? '#ffd23f' : '#ff9a3c';
    g.beginPath(); g.moveTo(x - w * 0.15, y - h * 0.3); g.lineTo(x, y + h * (0.2 + Math.random() * 0.3)); g.lineTo(x + w * 0.15, y - h * 0.3); g.fill();
  }
  if (size > 30 && !k.human) {
    g.font = `700 ${Math.min(18, size * 0.22)}px system-ui`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText(k.name, x, y - h * 1.45);
  }
}

function drawBox(g, p, time) {
  const size = 12 * p.scale;
  if (size < 2) return;
  const sq = Math.abs(Math.cos(time * 3)) * 0.6 + 0.4;
  const y = p.y - size * 0.9 - Math.sin(time * 4) * size * 0.1;
  g.save(); g.translate(p.x, y); g.scale(sq, 1);
  const hue = (time * 120) % 360;
  g.fillStyle = `hsla(${hue},90%,60%,.85)`; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, size * 0.08);
  g.fillRect(-size / 2, -size / 2, size, size); g.strokeRect(-size / 2, -size / 2, size, size);
  g.fillStyle = '#fff'; g.font = `900 ${size * 0.7}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', 0, size * 0.04);
  g.restore();
}

function drawBanana(g, p) {
  const size = 9 * p.scale;
  if (size < 2) return;
  g.strokeStyle = '#ffd23f'; g.lineWidth = size * 0.35; g.lineCap = 'round';
  g.beginPath(); g.arc(p.x, p.y - size * 0.9, size * 0.6, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  g.fillStyle = '#6b4a12'; g.fillRect(p.x + size * 0.35, p.y - size * 0.75, size * 0.15, size * 0.15);
}

function drawMinimap(ctx, order) {
  const g = s.g, m = s.minimap, t = s.track;
  g.save();
  if (m.big) { g.fillStyle = '#0b1a12'; g.fillRect(m.x, m.y, m.w, m.h); }
  else { g.fillStyle = '#0008'; roundRect(g, m.x, m.y, m.w, m.h, 12); g.fill(); }
  const sc = Math.min(m.w, m.h) * 0.9 / WORLD;
  const ox = m.x + (m.w - WORLD * sc) / 2, oy = m.y + (m.h - WORLD * sc) / 2;
  g.strokeStyle = '#ffffffaa'; g.lineWidth = Math.max(3, ROAD_HALF * 2 * sc * 0.6); g.lineJoin = 'round';
  g.beginPath(); t.points.forEach(([x, y], i) => (i ? g.lineTo(ox + x * sc, oy + y * sc) : g.moveTo(ox + x * sc, oy + y * sc))); g.closePath(); g.stroke();
  for (const k of [...s.karts].reverse()) {
    g.fillStyle = k.color; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(ox + k.x * sc, oy + k.y * sc, m.big ? 8 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (m.big) {
    g.font = '700 20px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
    order.forEach((k, i) => { g.fillStyle = k.color; g.fillText(`${i + 1}° ${k.name}`, m.x + 16, m.y + 16 + i * 26); });
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
