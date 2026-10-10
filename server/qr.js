// Generador de códigos QR sin dependencias (modo byte, corrección M, versiones 1–10).
// Basado en el algoritmo de referencia de Project Nayuki (MIT).

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_M = 0; // bits de nivel M

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
const numDataCodewords = (ver) => Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];

function rsMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= rsMul(coef, factor); });
  }
  return result;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

export function encodeQR(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  let ver = 1;
  for (; ver <= 10; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= numDataCodewords(ver) * 8) break;
  }
  if (ver > 10) throw new Error('Texto demasiado largo para el QR');

  // Flujo de bits
  const bb = [];
  const append = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
  append(0x4, 4);
  append(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  const capacity = numDataCodewords(ver) * 8;
  append(0, Math.min(4, capacity - bb.length));
  append(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const dataCw = [];
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bb[i + j];
    dataCw.push(v);
  }

  // Bloques + ECC + intercalado
  const numBlocks = NUM_BLOCKS_M[ver];
  const blockEccLen = ECC_PER_BLOCK_M[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const blocks = [];
  const div = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = dataCw.slice(k, k + shortLen - blockEccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const allCw = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEccLen || j >= numShort) allCw.push(block[i]);
    });
  }

  // Matriz
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignmentPositions(ver);
  for (let i = 0; i < align.length; i++) for (let j = 0; j < align.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask) => {
    const data = (FORMAT_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setFn(a, c, b); setFn(c, a, b);
    }
  }

  // Datos en zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vert : vert;
      if (!isFn[y][x] && i < allCw.length * 8) {
        modules[y][x] = ((allCw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }

  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
      if (!isFn[y][x] && inv) modules[y][x] = !modules[y][x];
    }
  };

  const penalty = () => {
    let result = 0;
    const runPenalty = (line) => {
      let p = 0, runColor = line[0], run = 1;
      for (let k = 1; k <= line.length; k++) {
        if (k < line.length && line[k] === runColor) run++;
        else { if (run >= 5) p += 3 + (run - 5); if (k < line.length) { runColor = line[k]; run = 1; } }
      }
      const s = line.map((b) => (b ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) {
        let idx = s.indexOf(pat);
        while (idx !== -1) { p += 40; idx = s.indexOf(pat, idx + 1); }
      }
      return p;
    };
    for (let y = 0; y < size; y++) result += runPenalty(modules[y]);
    for (let x = 0; x < size; x++) result += runPenalty(modules.map((r) => r[x]));
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
    let dark = 0;
    for (const row of modules) for (const c of row) if (c) dark++;
    const total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  };

  let best = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestPenalty) { best = m; bestPenalty = p; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return modules;
}

/** Devuelve un SVG del QR. */
export function qrSvg(text, { margin = 4, dark = '#000', light = '#fff' } = {}) {
  const m = encodeQR(text);
  const size = m.length + margin * 2;
  let path = '';
  m.forEach((row, y) => row.forEach((c, x) => { if (c) path += `M${x + margin},${y + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
