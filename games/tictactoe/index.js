// Tres en Raya — 2 jugadores, por turnos. Ejemplo de juego por turnos con estado por jugador.
import { defineGame, L } from '/sdk/gamehub-sdk.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const WINS_NEEDED = 2;
const MAX_ROUNDS = 7;
const MARKS = ['X', 'O'];

let s; // estado del juego

function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] != null && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
  }
  return board.every((x) => x != null) ? { draw: true } : null;
}

function layoutFor() {
  return L.layout({
    orientation: 'portrait',
    areas: ['status', 'board', 'board', 'board'],
    controls: [
      L.text('status', { text: '', size: 'm' }),
      L.grid('board', { rows: 3, cols: 3, cells: Array(9).fill(''), disabledCells: [0, 1, 2, 3, 4, 5, 6, 7, 8] }),
    ],
  });
}

function syncPads(ctx) {
  const cells = s.board.map((m) => (m == null ? '' : MARKS[m]));
  const cellColors = s.board.map((m) => (m == null ? null : ctx.players[m].color));
  s.players.forEach((p, i) => {
    const myTurn = s.phase === 'play' && s.turn === i;
    const disabledCells = myTurn ? s.board.flatMap((m, k) => (m != null ? [k] : [])) : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    ctx.controllers.patch(p.id, 'board', { cells, cellColors, disabledCells });
    const other = s.players[1 - i].name;
    const text = s.phase !== 'play' ? s.message : myTurn ? `Tu turno (${MARKS[i]})` : `Turno de ${other}`;
    ctx.controllers.patch(p.id, 'status', { text, sub: `${s.wins[i]} – ${s.wins[1 - i]}` });
  });
}

function newRound(ctx) {
  s.board = Array(9).fill(null);
  s.placedAt = Array(9).fill(0);
  s.result = null;
  s.round++;
  s.turn = s.starter;
  s.starter = 1 - s.starter;
  s.phase = 'play';
  ctx.ui.banner(`Ronda ${s.round}`, 1.2, `Empieza ${s.players[s.turn].name}`);
  syncPads(ctx);
  ctx.controllers.vibrate(s.players[s.turn].id, [40, 40, 40]);
}

function finishMatch(ctx) {
  const [a, b] = s.wins;
  const ranking = a >= b ? [s.players[0].id, s.players[1].id] : [s.players[1].id, s.players[0].id];
  const title = a === b ? 'Empate' : `¡Gana ${ctx.player(ranking[0]).name}!`;
  ctx.end({ ranking, scores: { [s.players[0].id]: a, [s.players[1].id]: b }, title });
}

export default defineGame({
  setup(ctx) {
    const { g, width, height } = ctx.createCanvas({ width: 1280, height: 720 });
    s = { g, width, height, players: ctx.players.slice(0, 2), wins: [0, 0], round: 0, starter: 0, message: '', time: 0 };
    ctx.controllers.set('all', layoutFor());
    newRound(ctx);
  },

  onInput(ctx, e) {
    if (e.control !== 'board' || e.kind !== 'press' || s.phase !== 'play') return;
    const i = s.players.findIndex((p) => p.id === e.player);
    const idx = Number(e.value);
    if (i !== s.turn || !(idx >= 0 && idx < 9) || s.board[idx] != null) return;

    s.board[idx] = i;
    s.placedAt[idx] = ctx.time;
    ctx.audio.tone(i === 0 ? 520 : 390, 0.12, { type: 'triangle', vol: 0.5 });
    const r = winnerOf(s.board);
    if (!r) {
      s.turn = 1 - s.turn;
      syncPads(ctx);
      ctx.controllers.vibrate(s.players[s.turn].id, 30);
      return;
    }
    s.result = { ...r, at: ctx.time };
    s.phase = 'roundEnd';
    if (r.draw) {
      s.message = 'Empate';
      ctx.audio.tone(220, 0.3, { type: 'sawtooth', vol: 0.3 });
    } else {
      s.wins[r.mark]++;
      s.message = `Ronda para ${s.players[r.mark].name}`;
      ctx.controllers.vibrate(s.players[r.mark].id, [60, 50, 120]);
      [523, 659, 784].forEach((f, k) => ctx.timer.after(k * 0.12, () => ctx.audio.tone(f, 0.18, { type: 'square', vol: 0.4 })));
    }
    syncPads(ctx);
    const over = s.wins.some((w) => w >= WINS_NEEDED) || s.round >= MAX_ROUNDS;
    ctx.timer.after(2.2, () => (over ? finishMatch(ctx) : newRound(ctx)));
  },

  render(ctx) {
    const { g, width: W, height: H } = s;
    const t = ctx.time;
    // Fondo
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1d1446'); bg.addColorStop(1, '#09071c');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    // Tablero
    const size = 540, x0 = (W - size) / 2, y0 = (H - size) / 2 + 20, cell = size / 3;
    g.lineCap = 'round';
    g.strokeStyle = '#ffffff30'; g.lineWidth = 12;
    for (let k = 1; k < 3; k++) {
      g.beginPath(); g.moveTo(x0 + k * cell, y0 + 14); g.lineTo(x0 + k * cell, y0 + size - 14); g.stroke();
      g.beginPath(); g.moveTo(x0 + 14, y0 + k * cell); g.lineTo(x0 + size - 14, y0 + k * cell); g.stroke();
    }
    // Números de casilla (ayuda para teclado)
    g.fillStyle = '#ffffff22'; g.font = '600 20px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
    for (let k = 0; k < 9; k++) if (s.board[k] == null) g.fillText(String(k + 1), x0 + (k % 3) * cell + 14, y0 + Math.floor(k / 3) * cell + 12);

    // Marcas con animación de entrada
    for (let k = 0; k < 9; k++) {
      const m = s.board[k];
      if (m == null) continue;
      const cx = x0 + (k % 3) * cell + cell / 2, cy = y0 + Math.floor(k / 3) * cell + cell / 2;
      const p = Math.min(1, (t - s.placedAt[k]) / 0.18);
      const r = cell * 0.3 * (0.6 + 0.4 * p);
      g.strokeStyle = s.players[m].color; g.lineWidth = 20;
      g.shadowColor = s.players[m].color; g.shadowBlur = 24;
      g.beginPath();
      if (m === 0) { g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r); }
      else g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.shadowBlur = 0;
    }
    // Línea ganadora
    if (s.result?.line) {
      const [a, , c] = s.result.line;
      const p = Math.min(1, (t - s.result.at) / 0.35);
      const ax = x0 + (a % 3) * cell + cell / 2, ay = y0 + Math.floor(a / 3) * cell + cell / 2;
      const cx = x0 + (c % 3) * cell + cell / 2, cy = y0 + Math.floor(c / 3) * cell + cell / 2;
      g.strokeStyle = '#ffd23f'; g.lineWidth = 16; g.shadowColor = '#ffd23f'; g.shadowBlur = 30;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (cx - ax) * p, ay + (cy - ay) * p); g.stroke();
      g.shadowBlur = 0;
    }

    // Tarjetas de jugadores
    s.players.forEach((pl, i) => {
      const x = i === 0 ? 70 : W - 70 - 260, y = H / 2 - 100;
      const active = s.phase === 'play' && s.turn === i;
      g.fillStyle = active ? '#ffffff18' : '#ffffff08';
      g.strokeStyle = active ? pl.color : '#ffffff20'; g.lineWidth = active ? 4 : 2;
      roundRect(g, x, y, 260, 200, 24); g.fill(); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = pl.color; g.font = '900 64px system-ui'; g.fillText(MARKS[i], x + 130, y + 60);
      g.fillStyle = '#fff'; g.font = '700 28px system-ui'; g.fillText(pl.name, x + 130, y + 120, 230);
      g.fillStyle = '#ffd23f'; g.font = '800 34px system-ui'; g.fillText('●'.repeat(s.wins[i]) + '○'.repeat(Math.max(0, WINS_NEEDED - s.wins[i])), x + 130, y + 166);
    });

    // Título
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffffcc'; g.font = '800 34px system-ui';
    const msg = s.phase === 'play' ? `Turno de ${s.players[s.turn].name}` : s.message;
    g.fillText(msg, W / 2, 56);
  },
});

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
