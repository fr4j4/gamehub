// Pong — 2 jugadores. Ejemplo de juego de acción con control analógico absoluto (slider).
import { defineGame, L } from '/sdk/gamehub-sdk.js';

const W = 1280, H = 720;
const PAD_W = 18, PAD_H = 120, MARGIN = 48;
const TOP = 70, BOTTOM = H - 20; // zona de juego
const POINTS_TO_WIN = 7;
const BALL_R = 11;

let s;

function serve(ctx, towards) {
  s.ball = { x: W / 2, y: (TOP + BOTTOM) / 2, vx: 0, vy: 0, r: BALL_R };
  s.trail = [];
  s.serving = true;
  ctx.timer.after(1.0, () => {
    const angle = ctx.random.range(-0.45, 0.45);
    const speed = 560;
    s.ball.vx = Math.cos(angle) * speed * (towards === 0 ? -1 : 1);
    s.ball.vy = Math.sin(angle) * speed;
    s.serving = false;
    ctx.audio.tone(330, 0.06, { type: 'square', vol: 0.3 });
  });
}

function updatePads(ctx) {
  s.paddles.forEach((p, i) => {
    ctx.controllers.patch(p.player.id, 'score', { text: `${s.score[i]} – ${s.score[1 - i]}`, sub: i === 0 ? 'Paleta izquierda' : 'Paleta derecha' });
  });
}

export default defineGame({
  setup(ctx) {
    const { g } = ctx.createCanvas({ width: W, height: H });
    const [a, b] = ctx.players;
    s = {
      g,
      paddles: [
        { player: a, x: MARGIN, y: (TOP + BOTTOM) / 2, target: 0.5, flash: 0 },
        { player: b, x: W - MARGIN - PAD_W, y: (TOP + BOTTOM) / 2, target: 0.5, flash: 0 },
      ],
      score: [0, 0], particles: [], shake: 0, over: false, ball: null, trail: [],
    };
    s.paddles.forEach((p, i) => {
      ctx.controllers.set(p.player.id, L.layout({
        orientation: 'portrait',
        areas: ['score', 'move', 'move', 'move'],
        controls: [
          L.text('score', { text: '0 – 0', sub: i === 0 ? 'Paleta izquierda' : 'Paleta derecha', size: 'l' }),
          L.slider('move', { orientation: 'vertical', value: 0.5 }),
        ],
      }));
    });
    ctx.ui.banner('Primero a 7', 1.4);
    serve(ctx, ctx.random.int(0, 1));
  },

  onInput(ctx, e) {
    if (e.control !== 'move' || e.kind !== 'value') return;
    const p = s.paddles.find((x) => x.player.id === e.player);
    if (p) p.target = Math.max(0, Math.min(1, Number(e.value)));
  },

  update(ctx, dt) {
    // Paletas: siguen al dedo con suavizado y velocidad máxima
    for (const p of s.paddles) {
      const ty = TOP + PAD_H / 2 + p.target * (BOTTOM - TOP - PAD_H);
      const maxStep = 1600 * dt;
      p.y += Math.max(-maxStep, Math.min(maxStep, (ty - p.y) * 0.45));
      p.flash = Math.max(0, p.flash - dt * 4);
    }
    s.shake = Math.max(0, s.shake - dt * 30);
    for (const pt of s.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; }
    s.particles = s.particles.filter((pt) => pt.life > 0);

    const b = s.ball;
    if (!b || s.serving || s.over) return;
    b.x += b.vx * dt; b.y += b.vy * dt;
    s.trail.push([b.x, b.y]); if (s.trail.length > 12) s.trail.shift();

    if (b.y - b.r < TOP) { b.y = TOP + b.r; b.vy = Math.abs(b.vy); ctx.audio.tone(240, 0.04, { vol: 0.25 }); }
    if (b.y + b.r > BOTTOM) { b.y = BOTTOM - b.r; b.vy = -Math.abs(b.vy); ctx.audio.tone(240, 0.04, { vol: 0.25 }); }

    s.paddles.forEach((p, i) => {
      const top = p.y - PAD_H / 2;
      const inX = i === 0 ? b.x - b.r <= p.x + PAD_W && b.x > p.x : b.x + b.r >= p.x && b.x < p.x + PAD_W;
      const movingTowards = i === 0 ? b.vx < 0 : b.vx > 0;
      if (inX && movingTowards && b.y + b.r > top && b.y - b.r < top + PAD_H) {
        const offset = (b.y - p.y) / (PAD_H / 2); // −1..1
        const angle = offset * 1.0; // hasta ~57°
        const speed = Math.min(1500, Math.hypot(b.vx, b.vy) * 1.06);
        b.vx = Math.cos(angle) * speed * (i === 0 ? 1 : -1);
        b.vy = Math.sin(angle) * speed;
        b.x = i === 0 ? p.x + PAD_W + b.r : p.x - b.r;
        p.flash = 1; s.shake = 6;
        ctx.audio.tone(440 + speed / 4, 0.06, { type: 'square', vol: 0.4 });
        ctx.controllers.vibrate(p.player.id, 25);
        burst(b.x, b.y, p.player.color, 14);
      }
    });

    const scorer = b.x < -40 ? 1 : b.x > W + 40 ? 0 : -1;
    if (scorer >= 0) {
      s.score[scorer]++;
      s.shake = 14;
      ctx.audio.tone(scorer === 0 ? 660 : 520, 0.25, { type: 'triangle', vol: 0.5, slide: 200 });
      ctx.controllers.vibrate(s.paddles[1 - scorer].player.id, [80, 40, 80]);
      updatePads(ctx);
      if (s.score[scorer] >= POINTS_TO_WIN) {
        s.over = true; s.ball = null;
        const winner = s.paddles[scorer].player, loser = s.paddles[1 - scorer].player;
        ctx.ui.banner(`¡Gana ${winner.name}!`, 2.5);
        ctx.timer.after(2.6, () => ctx.end({
          ranking: [winner.id, loser.id],
          scores: { [winner.id]: s.score[scorer], [loser.id]: s.score[1 - scorer] },
          title: `¡Gana ${winner.name}! ${s.score[scorer]} – ${s.score[1 - scorer]}`,
        }));
      } else {
        serve(ctx, 1 - scorer);
      }
    }
  },

  render(ctx) {
    const g = s.g;
    g.save();
    if (s.shake) g.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b2240'); bg.addColorStop(1, '#050a18');
    g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);

    // Cancha
    g.strokeStyle = '#ffffff22'; g.lineWidth = 4;
    g.strokeRect(20, TOP, W - 40, BOTTOM - TOP);
    g.setLineDash([16, 18]);
    g.beginPath(); g.moveTo(W / 2, TOP + 10); g.lineTo(W / 2, BOTTOM - 10); g.stroke();
    g.setLineDash([]);

    // Marcador
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 52px system-ui';
    s.paddles.forEach((p, i) => {
      g.fillStyle = p.player.color;
      g.fillText(String(s.score[i]), W / 2 + (i === 0 ? -80 : 80), 38);
      g.font = '700 22px system-ui'; g.fillStyle = '#ffffffaa';
      g.textAlign = i === 0 ? 'left' : 'right';
      g.fillText(p.player.name, i === 0 ? 30 : W - 30, 38);
      g.textAlign = 'center'; g.font = '900 52px system-ui';
    });

    // Partículas
    for (const pt of s.particles) {
      g.globalAlpha = Math.max(0, pt.life / pt.max);
      g.fillStyle = pt.color; g.fillRect(pt.x - 3, pt.y - 3, 6, 6);
    }
    g.globalAlpha = 1;

    // Paletas
    s.paddles.forEach((p) => {
      g.fillStyle = p.player.color;
      g.shadowColor = p.player.color; g.shadowBlur = 20 + p.flash * 30;
      roundRect(g, p.x, p.y - PAD_H / 2, PAD_W, PAD_H, 9); g.fill();
      g.shadowBlur = 0;
    });

    // Pelota con estela
    const b = s.ball;
    if (b) {
      s.trail.forEach(([x, y], i) => {
        g.globalAlpha = (i / s.trail.length) * 0.35;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, b.r * (i / s.trail.length), 0, Math.PI * 2); g.fill();
      });
      g.globalAlpha = s.serving ? 0.5 + 0.5 * Math.sin(ctx.time * 12) : 1;
      g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 20;
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
    g.restore();
  },
});

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 100 + Math.random() * 300;
    s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4, max: 0.4, color });
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
