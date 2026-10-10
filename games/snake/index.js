// Snake — 1 jugador. Ejemplo de juego arcade con lógica a paso fijo e interpolación.
import { defineGame, L } from '/sdk/gamehub-sdk.js';

const COLS = 36, ROWS = 20, CELL = 32;
const OX = (1280 - COLS * CELL) / 2, OY = 64;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let s;

function spawnFood(ctx, golden = false) {
  const occupied = new Set(s.snake.map(([x, y]) => `${x},${y}`));
  if (s.food) occupied.add(`${s.food.x},${s.food.y}`);
  let x, y;
  do { x = ctx.random.int(0, COLS - 1); y = ctx.random.int(0, ROWS - 1); } while (occupied.has(`${x},${y}`));
  return { x, y, golden, born: ctx.time };
}

function updatePad(ctx) {
  ctx.controllers.patch(s.player.id, 'score', { text: `${s.score} puntos`, sub: `Récord: ${Math.max(s.best, s.score)}` });
}

export default defineGame({
  setup(ctx) {
    const { g } = ctx.createCanvas({ width: 1280, height: 720 });
    const player = ctx.players[0];
    s = {
      g, player,
      snake: [[8, 10], [7, 10], [6, 10], [5, 10]],
      prev: null,
      dir: [1, 0], queue: [],
      step: 0.13, acc: 0,
      score: 0, eaten: 0,
      best: ctx.storage.get('best', 0),
      food: null, gold: null,
      state: 'ready', deadAt: 0, grow: 0,
    };
    s.prev = s.snake.map((c) => [...c]);
    s.food = spawnFood(ctx);
    ctx.controllers.set(player.id, L.layout({
      orientation: 'portrait',
      areas: ['score', 'pad', 'pad', 'pad'],
      controls: [L.text('score', { text: '0 puntos', sub: `Récord: ${s.best}`, size: 'm' }), L.dpad('pad')],
    }));
    [3, 2, 1].forEach((n, i) => ctx.timer.after(i * 0.8, () => { ctx.ui.banner(String(n), 0.75); ctx.audio.tone(440, 0.1); }));
    ctx.timer.after(2.4, () => { s.state = 'play'; ctx.ui.banner('¡Ya!', 0.7); ctx.audio.tone(880, 0.15); });
  },

  onInput(ctx, e) {
    if (e.control !== 'pad' || e.kind !== 'axis') return;
    const [x, y] = e.value;
    if (!x && !y) return;
    const d = x ? [Math.sign(x), 0] : [0, Math.sign(y)];
    const last = s.queue.at(-1) || s.dir;
    if (d[0] === -last[0] && d[1] === -last[1]) return; // no puede darse vuelta
    if (d[0] === last[0] && d[1] === last[1]) return;
    if (s.queue.length < 2) s.queue.push(d);
  },

  update(ctx, dt) {
    if (s.state !== 'play') return;
    s.acc += dt;
    if (s.acc < s.step) return;
    s.acc -= s.step;
    if (s.queue.length) s.dir = s.queue.shift();

    s.prev = s.snake.map((c) => [...c]);
    const [hx, hy] = s.snake[0];
    const nx = hx + s.dir[0], ny = hy + s.dir[1];
    const hitsWall = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS;
    const body = s.grow > 0 ? s.snake : s.snake.slice(0, -1);
    const hitsSelf = body.some(([x, y]) => x === nx && y === ny);
    if (hitsWall || hitsSelf) return die(ctx);

    s.snake.unshift([nx, ny]);
    if (s.grow > 0) { s.grow--; s.prev.push(s.prev.at(-1)); } else s.snake.pop();

    if (s.food && nx === s.food.x && ny === s.food.y) {
      s.score += 1; s.eaten++; s.grow += 1;
      s.step = Math.max(0.055, s.step * 0.97);
      ctx.audio.tone(660 + Math.min(400, s.eaten * 10), 0.07, { type: 'square', vol: 0.4 });
      ctx.controllers.vibrate(s.player.id, 15);
      s.food = spawnFood(ctx);
      if (s.eaten % 5 === 0 && !s.gold) s.gold = spawnFood(ctx, true);
      updatePad(ctx);
    }
    if (s.gold && nx === s.gold.x && ny === s.gold.y) {
      s.score += 5; s.grow += 3; s.gold = null;
      [880, 1100, 1320].forEach((f, i) => ctx.timer.after(i * 0.06, () => ctx.audio.tone(f, 0.08, { type: 'triangle' })));
      ctx.controllers.vibrate(s.player.id, [30, 30, 30]);
      ctx.ui.banner('+5', 0.8);
      updatePad(ctx);
    }
    if (s.gold && ctx.time - s.gold.born > 6) s.gold = null;
  },

  render(ctx, alpha) {
    const g = s.g;
    g.fillStyle = '#04140e'; g.fillRect(0, 0, 1280, 720);
    // Tablero
    g.fillStyle = '#0a2a1d'; g.fillRect(OX, OY, COLS * CELL, ROWS * CELL);
    g.fillStyle = '#0d3324';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) g.fillRect(OX + x * CELL, OY + y * CELL, CELL, CELL);
    g.strokeStyle = '#5be37d55'; g.lineWidth = 3; g.strokeRect(OX - 2, OY - 2, COLS * CELL + 4, ROWS * CELL + 4);

    // HUD
    g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = '800 30px system-ui'; g.textAlign = 'left';
    g.fillText(`${s.score}`, OX, 32);
    g.fillStyle = '#9fd8b4'; g.font = '600 22px system-ui';
    g.fillText(s.player.name, OX + 70, 33);
    g.textAlign = 'right'; g.fillText(`Récord ${Math.max(s.best, s.score)}`, OX + COLS * CELL, 33);

    // Comida
    const pulse = 1 + Math.sin(ctx.time * 8) * 0.08;
    const drawFood = (f, color, r) => {
      g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 18;
      g.beginPath(); g.arc(OX + f.x * CELL + CELL / 2, OY + f.y * CELL + CELL / 2, r * pulse, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    };
    if (s.food) drawFood(s.food, '#ff4d6d', CELL * 0.34);
    if (s.gold && (ctx.time - s.gold.born < 4.5 || Math.floor(ctx.time * 8) % 2)) drawFood(s.gold, '#ffd23f', CELL * 0.4);

    // Serpiente interpolada
    const t = s.state === 'play' ? Math.min(1, s.acc / s.step) : 1;
    const pts = s.snake.map(([x, y], i) => {
      const [px, py] = s.prev[i] || [x, y];
      return [OX + (px + (x - px) * t) * CELL + CELL / 2, OY + (py + (y - py) * t) * CELL + CELL / 2];
    });
    const dead = s.state === 'dead';
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = dead ? '#7a8f84' : '#5be37d';
    g.shadowColor = dead ? 'transparent' : '#5be37d'; g.shadowBlur = 14;
    g.lineWidth = CELL * 0.72;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.shadowBlur = 0;
    // Cabeza
    const [hx, hy] = pts[0];
    g.fillStyle = dead ? '#9aa' : '#8dffab';
    g.beginPath(); g.arc(hx, hy, CELL * 0.42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#04140e';
    const [dx, dy] = s.dir;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(hx + dx * 6 + -dy * side * 7, hy + dy * 6 + dx * side * 7, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    if (dead && Math.floor((ctx.time - s.deadAt) * 6) % 2 === 0) {
      g.fillStyle = '#ff4d6d55'; g.fillRect(OX, OY, COLS * CELL, ROWS * CELL);
    }
  },
});

function die(ctx) {
  s.state = 'dead'; s.deadAt = ctx.time;
  ctx.audio.noise(0.35, 0.5);
  ctx.audio.tone(200, 0.5, { type: 'sawtooth', slide: -150, vol: 0.4 });
  ctx.controllers.vibrate(s.player.id, [120, 60, 200]);
  const record = s.score > s.best;
  if (record) ctx.storage.set('best', s.score);
  ctx.ui.banner(record ? '¡Nuevo récord!' : 'Fin', 2, `${s.score} puntos`);
  ctx.controllers.patch(s.player.id, 'score', { text: record ? '¡Nuevo récord!' : 'Fin del juego', sub: `${s.score} puntos` });
  ctx.timer.after(2.5, () => ctx.end({
    ranking: [s.player.id],
    scores: { [s.player.id]: s.score },
    title: record ? `¡Nuevo récord: ${s.score}!` : `${s.score} puntos · récord ${s.best}`,
  }));
}
