// GameHub SDK v1 — runtime para juegos que corren en la consola (modo `screen`).
// Uso en un juego:  import { defineGame, L } from '/sdk/gamehub-sdk.js';
// Tipos: /sdk/gamehub-sdk.d.ts

export const SDK_VERSION = '1.0.0';

/** Declara un juego. Devuelve la definición tal cual (sirve para tipado y validación). */
export function defineGame(def) {
  if (typeof def?.setup !== 'function') throw new Error('defineGame: falta setup(ctx)');
  return Object.freeze({ ...def, __gamehub: SDK_VERSION });
}

// ───────────────────────── Layouts de mando ─────────────────────────
const control = (type) => (id, opts = {}) => ({ id, type, area: opts.area ?? id, ...opts });

/** Constructores de layouts y componentes estándar. */
export const L = {
  layout: (spec) => ({ orientation: 'any', areas: [], controls: [], ...spec }),
  button: control('button'),
  dpad: control('dpad'),
  joystick: control('joystick'),
  slider: control('slider'),
  tilt: control('tilt'),
  grid: control('grid'),
  text: control('text'),
  /** Layout de espera con un mensaje. */
  message: (text, sub = '') => ({ orientation: 'any', areas: ['msg'], controls: [{ id: 'msg', type: 'text', area: 'msg', text, sub, size: 'l' }] }),
};

// ───────────────────────── Utilidades ─────────────────────────
/** Generador aleatorio con semilla (mulberry32). */
export function createRandom(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => { const a2 = [...arr]; for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; },
  };
}

/** Rectángulos para pantalla dividida: 1 completo, 2 arriba/abajo, 3–4 en cuadrícula 2×2. */
export function viewports(n, width, height, gap = 4) {
  if (n <= 1) return [{ x: 0, y: 0, w: width, h: height }];
  if (n === 2) {
    const h = (height - gap) / 2;
    return [{ x: 0, y: 0, w: width, h }, { x: 0, y: h + gap, w: width, h }];
  }
  const w = (width - gap) / 2, h = (height - gap) / 2;
  return [0, 1, 2, 3].slice(0, n).map((i) => ({ x: (i % 2) * (w + gap), y: Math.floor(i / 2) * (h + gap), w, h }));
}

// ───────────────────────── Audio sintetizado ─────────────────────────
class Audio {
  #ac = null;
  #master = null;
  get ctx() {
    if (!this.#ac) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      this.#ac = new AC();
      this.#master = this.#ac.createGain();
      this.#master.gain.value = 0.35;
      this.#master.connect(this.#ac.destination);
    }
    if (this.#ac.state === 'suspended') this.#ac.resume();
    return this.#ac;
  }
  /** Tono simple. */
  tone(freq = 440, dur = 0.1, { type = 'square', vol = 0.5, slide = 0 } = {}) {
    const ac = this.ctx; if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(this.#master); o.start(); o.stop(ac.currentTime + dur + 0.02);
  }
  /** Ruido blanco corto (choques, explosiones). */
  noise(dur = 0.2, vol = 0.4) {
    const ac = this.ctx; if (!ac) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(), g = ac.createGain();
    g.gain.value = vol; src.buffer = buf; src.connect(g).connect(this.#master); src.start();
  }
  /** Motor continuo: devuelve un objeto con set(freq, vol) y stop(). */
  engine(type = 'sawtooth') {
    const ac = this.ctx; if (!ac) return { set() {}, stop() {} };
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; g.gain.value = 0; o.connect(g).connect(this.#master); o.start();
    return {
      set: (freq, vol) => { o.frequency.setTargetAtTime(freq, ac.currentTime, 0.05); g.gain.setTargetAtTime(vol, ac.currentTime, 0.05); },
      stop: () => { g.gain.setTargetAtTime(0, ac.currentTime, 0.05); o.stop(ac.currentTime + 0.3); },
    };
  }
  dispose() { this.#ac?.close(); this.#ac = null; }
}

// ───────────────────────── Estado de entradas ─────────────────────────
class InputState {
  axes = new Map(); values = new Map(); down = new Set(); pressedSet = new Set(); releasedSet = new Set();
  key = (p, c) => `${p}\u0000${c}`;
  apply(e) {
    const k = this.key(e.player, e.control);
    switch (e.kind) {
      case 'down': if (!this.down.has(k)) this.pressedSet.add(k); this.down.add(k); break;
      case 'up': if (this.down.has(k)) this.releasedSet.add(k); this.down.delete(k); break;
      case 'axis': this.axes.set(k, Array.isArray(e.value) ? [Number(e.value[0]) || 0, Number(e.value[1]) || 0] : [0, 0]); break;
      case 'value': this.values.set(k, Number(e.value) || 0); break;
      case 'press': this.pressedSet.add(k); this.values.set(k, e.value); break;
    }
  }
  endTick() { this.pressedSet.clear(); this.releasedSet.clear(); }
  clearPlayer(p) {
    for (const m of [this.axes, this.values]) for (const k of [...m.keys()]) if (k.startsWith(p + '\u0000')) m.delete(k);
    for (const k of [...this.down]) if (k.startsWith(p + '\u0000')) this.down.delete(k);
  }
  api() {
    return {
      /** Vector [x, y] de un joystick, dpad o tilt (−1..1). */
      axis: (p, c) => this.axes.get(this.key(p, c)) ?? [0, 0],
      /** Valor de un slider (0..1) o el último valor de un grid. */
      value: (p, c, def = 0) => this.values.get(this.key(p, c)) ?? def,
      /** ¿El botón está presionado ahora? */
      down: (p, c) => this.down.has(this.key(p, c)),
      /** ¿Se presionó durante este tick? */
      pressed: (p, c) => this.pressedSet.has(this.key(p, c)),
      /** ¿Se soltó durante este tick? */
      released: (p, c) => this.releasedSet.has(this.key(p, c)),
    };
  }
}

// ───────────────────────── Host (lo usa la consola, no el juego) ─────────────────────────
/**
 * Ejecuta un juego dentro de un elemento DOM.
 * `bridge` lo provee la consola: { setLayout(target, layout), patch(target, id, props), vibrate(target, pattern), end(results) }
 */
export class GameHost {
  constructor(def, { root, manifest, players, options = {}, bridge, seed }) {
    this.def = def; this.root = root; this.manifest = manifest; this.bridge = bridge;
    this.input = new InputState();
    this.audio = new Audio();
    this.layouts = new Map();
    this.timers = [];
    this.running = false; this.paused = false; this.ended = false;
    this.time = 0; this.acc = 0; this.last = 0;
    this.resizeHandlers = [];
    this.players = players.map((p, i) => ({ ...p, slot: i, connected: true }));
    this.waitingFor = new Set();
    this.overlay = document.createElement('div');
    this.overlay.className = 'gh-overlay';
    root.append(this.overlay);
    this.ctx = this.#makeContext(options, seed);
    this.ro = new ResizeObserver(() => { for (const h of this.resizeHandlers) h(this.ctx.width, this.ctx.height); });
    this.ro.observe(root);
  }

  #makeContext(options, seed) {
    const host = this;
    const base = new URL(this.manifest.path, location.href);
    const storeKey = `gh:${this.manifest.id}:`;
    const ctx = {
      sdkVersion: SDK_VERSION,
      manifest: this.manifest,
      options,
      root: this.root,
      get width() { return host.root.clientWidth; },
      get height() { return host.root.clientHeight; },
      get time() { return host.time; },
      get players() { return host.players; },
      player: (id) => host.players.find((p) => p.id === id),
      input: this.input.api(),
      audio: this.audio,
      random: createRandom(seed),
      viewports,
      onResize: (fn) => { host.resizeHandlers.push(fn); },
      assets: { url: (rel) => new URL(rel, base).href },
      storage: {
        get: (k, def = null) => { try { const v = localStorage.getItem(storeKey + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
        set: (k, v) => { try { localStorage.setItem(storeKey + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
      },
      controllers: {
        set: (target, layout) => {
          // Copia por jugador: cada mando puede recibir patches distintos.
          for (const p of host.#targets(target)) host.layouts.set(p.id, structuredClone(layout));
          host.bridge.setLayout(target, layout);
        },
        patch: (target, controlId, props) => {
          for (const p of host.#targets(target)) {
            const lay = host.layouts.get(p.id);
            const c = lay?.controls.find((x) => x.id === controlId);
            if (c) Object.assign(c, props);
          }
          host.bridge.patch(target, controlId, props);
        },
        vibrate: (target, pattern = 40) => host.bridge.vibrate(target, pattern),
        layoutOf: (playerId) => host.layouts.get(playerId),
      },
      timer: {
        after: (sec, fn) => { const t = { at: host.time + sec, fn }; host.timers.push(t); return t; },
        every: (sec, fn) => { const t = { at: host.time + sec, fn, every: sec }; host.timers.push(t); return t; },
        cancel: (t) => { host.timers = host.timers.filter((x) => x !== t); },
      },
      ui: {
        banner: (text, sec = 1.5, sub = '') => host.#banner(text, sec, sub),
      },
      createCanvas: (opts) => host.#createCanvas(opts),
      pause: (reason = 'Pausa') => host.pause(reason),
      resume: () => host.resume(),
      end: (results = {}) => host.end(results),
    };
    return ctx;
  }

  #targets(target) {
    if (target === 'all') return this.players;
    return this.players.filter((p) => p.id === target);
  }

  #createCanvas({ width = 1280, height = 720, fit = 'contain', pixelated = false } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.className = 'gh-canvas';
    canvas.style.cssText = `position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;${fit === 'cover' ? 'width:100%;height:100%;object-fit:cover;' : 'width:100%;height:100%;object-fit:contain;'}${pixelated ? 'image-rendering:pixelated;' : ''}`;
    this.root.prepend(canvas);
    return { canvas, g: canvas.getContext('2d'), width, height };
  }

  #banner(text, sec, sub) {
    const el = document.createElement('div');
    el.className = 'gh-banner';
    el.innerHTML = `<div class="gh-banner-main"></div><div class="gh-banner-sub"></div>`;
    el.firstChild.textContent = text; el.lastChild.textContent = sub;
    this.overlay.append(el);
    setTimeout(() => el.remove(), sec * 1000);
  }

  async start() {
    await this.def.setup?.(this.ctx);
    this.running = true;
    this.last = performance.now();
    const STEP = 1 / 60;
    const frame = (now) => {
      if (!this.running) return;
      let dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < 5) {
          this.time += STEP;
          this.#runTimers();
          try { this.def.update?.(this.ctx, STEP); } catch (e) { this.#crash(e); return; }
          this.input.endTick();
          this.acc -= STEP; steps++;
        }
        if (steps === 5) this.acc = 0;
      }
      try { this.def.render?.(this.ctx, this.acc / STEP); } catch (e) { this.#crash(e); return; }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  #runTimers() {
    const due = this.timers.filter((t) => t.at <= this.time);
    for (const t of due) {
      if (t.every) t.at += t.every; else this.timers = this.timers.filter((x) => x !== t);
      t.fn();
    }
  }

  #crash(e) {
    console.error('[GameHub] el juego falló:', e);
    this.end({ error: String(e?.message || e) });
  }

  /** Entrada desde un mando (o del teclado de la consola). */
  handleInput(e) {
    if (this.ended) return;
    const player = this.players.find((p) => p.id === e.player);
    if (!player) return;
    this.input.apply(e);
    try { this.def.onInput?.(this.ctx, e); } catch (err) { this.#crash(err); }
  }

  playerLeft(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p || this.ended) return;
    p.connected = false;
    this.input.clearPlayer(id);
    if (this.def.onPlayerLeave) return this.def.onPlayerLeave(this.ctx, p);
    this.waitingFor.add(id);
    this.pause(`Esperando a ${p.name}…`);
  }

  playerJoined(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p || this.ended) return;
    p.connected = true;
    const lay = this.layouts.get(id);
    if (lay) this.bridge.setLayout(id, lay);
    this.def.onPlayerJoin?.(this.ctx, p);
    if (this.waitingFor.delete(id) && this.waitingFor.size === 0) this.resume();
  }

  pause(reason) {
    if (this.paused) return;
    this.paused = true;
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'gh-pause';
    this.pauseEl.textContent = reason;
    this.overlay.append(this.pauseEl);
    this.def.onPause?.(this.ctx);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseEl?.remove();
    this.last = performance.now();
    this.def.onResume?.(this.ctx);
  }

  end(results) {
    if (this.ended) return;
    this.ended = true;
    this.dispose();
    this.bridge.end(results);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    try { this.def.dispose?.(this.ctx); } catch (e) { console.error(e); }
    this.audio.dispose();
    this.root.replaceChildren();
  }
}
