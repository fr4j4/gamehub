// Pista: línea central suavizada, textura del suelo y consultas de posición.

export const WORLD = 1024;
export const ROAD_HALF = 44;   // medio ancho del asfalto
export const KERB = 6;         // ancho del borde rojo/blanco

// Puntos de control del circuito (sentido de carrera)
const CONTROL = [
  [180, 800], [160, 560], [200, 320], [330, 170], [520, 150], [640, 250], [600, 400], [470, 470],
  [460, 600], [580, 690], [760, 640], [820, 470], [880, 260], [960, 480], [900, 800], [700, 900], [420, 890],
];

function catmullRom(points, samplesPerSeg) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  return out;
}

function resample(points, spacing) {
  const closed = [...points, points[0]];
  const seg = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const d = Math.hypot(closed[i + 1][0] - closed[i][0], closed[i + 1][1] - closed[i][1]);
    seg.push(d); total += d;
  }
  const n = Math.round(total / spacing);
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i] < target) { acc += seg[i]; i++; }
    const t = (target - acc) / seg[i];
    out.push([closed[i][0] + (closed[i + 1][0] - closed[i][0]) * t, closed[i][1] + (closed[i + 1][1] - closed[i][1]) * t]);
  }
  return { points: out, length: total };
}

export function buildTrack() {
  const { points, length } = resample(catmullRom(CONTROL, 24), 6);
  const N = points.length;
  const tangent = points.map((p, i) => {
    const a = points[(i - 2 + N) % N], b = points[(i + 2) % N];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  });
  const at = (f) => Math.floor(((f % 1) + 1) % 1 * N);
  const track = {
    points, tangent, N, length,
    turboPads: [0.17, 0.52, 0.8].map(at),
    itemRows: [0.3, 0.66, 0.9].map(at),
    /** Índice más cercano; con `hint` busca solo en una ventana alrededor. */
    nearest(x, y, hint = -1) {
      let best = 0, bd = Infinity;
      const scan = (i) => { const p = points[i]; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } };
      if (hint >= 0) for (let k = -30; k <= 30; k++) scan((hint + k + N) % N);
      // Sin pista o lejos de la ventana (atajo, salida de pista): búsqueda completa
      if (hint < 0 || bd > (ROAD_HALF * 2) ** 2) for (let i = 0; i < N; i++) scan(i);
      return { index: best, dist: Math.sqrt(bd) };
    },
    surface(dist) { return dist < ROAD_HALF ? 'road' : dist < ROAD_HALF + KERB ? 'kerb' : 'grass'; },
  };
  track.texture = paintTexture(track);
  return track;
}

function paintTexture(track) {
  const c = new OffscreenCanvas(WORLD, WORLD);
  const g = c.getContext('2d');
  // Pasto a cuadros
  for (let y = 0; y < WORLD; y += 32) for (let x = 0; x < WORLD; x += 32) {
    g.fillStyle = ((x + y) / 32) % 2 ? '#3f9a4a' : '#47a853';
    g.fillRect(x, y, 32, 32);
  }
  // Arbustos decorativos
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * WORLD, y = rnd() * WORLD;
    if (track.nearest(x, y).dist < ROAD_HALF + 30) continue;
    g.fillStyle = rnd() > 0.5 ? '#2f7d3a' : '#357f3f';
    g.beginPath(); g.arc(x, y, 6 + rnd() * 10, 0, Math.PI * 2); g.fill();
  }
  const path = () => {
    g.beginPath();
    track.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  g.lineJoin = 'round';
  // Borde de tierra, cordón rojo/blanco y asfalto
  path(); g.strokeStyle = '#b8935a'; g.lineWidth = (ROAD_HALF + KERB) * 2 + 18; g.stroke();
  path(); g.strokeStyle = '#ffffff'; g.lineWidth = (ROAD_HALF + KERB) * 2; g.stroke();
  path(); g.strokeStyle = '#e8384f'; g.setLineDash([12, 12]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = '#5a6270'; g.lineWidth = ROAD_HALF * 2; g.stroke();
  path(); g.strokeStyle = '#656d7c'; g.lineWidth = ROAD_HALF * 1.2; g.stroke();
  path(); g.strokeStyle = '#ffffff55'; g.lineWidth = 2; g.setLineDash([14, 18]); g.stroke(); g.setLineDash([]);

  // Línea de meta a cuadros
  const [sx, sy] = track.points[0], [tx, ty] = track.tangent[0];
  const nx = -ty, ny = tx;
  for (let row = 0; row < 2; row++) for (let k = -ROAD_HALF; k < ROAD_HALF; k += 8) {
    g.fillStyle = ((k / 8) + row) % 2 ? '#111' : '#fff';
    const bx = sx + nx * k + tx * row * 8, by = sy + ny * k + ty * row * 8;
    g.save(); g.translate(bx, by); g.rotate(Math.atan2(ty, tx)); g.fillRect(0, 0, 8, 8); g.restore();
  }
  // Turbos: chevrones amarillos
  for (const idx of track.turboPads) {
    const [px, py] = track.points[idx], [dx, dy] = track.tangent[idx];
    g.save(); g.translate(px, py); g.rotate(Math.atan2(dy, dx));
    g.fillStyle = '#ff9a3c'; g.fillRect(-18, -20, 36, 40);
    g.fillStyle = '#ffe14d';
    for (let k = -12; k <= 6; k += 9) { g.beginPath(); g.moveTo(k, -14); g.lineTo(k + 8, 0); g.lineTo(k, 14); g.lineTo(k + 4, 14); g.lineTo(k + 12, 0); g.lineTo(k + 4, -14); g.fill(); }
    g.restore();
  }
  const img = g.getImageData(0, 0, WORLD, WORLD);
  return { canvas: c, pixels: new Uint32Array(img.data.buffer) };
}
