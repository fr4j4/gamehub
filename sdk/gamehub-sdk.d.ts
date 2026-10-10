// Tipos del GameHub SDK v1.
// En TypeScript:  import { defineGame, L } from '/sdk/gamehub-sdk.js';
// (con "paths": { "/sdk/*": ["<ruta>/sdk/*"] } en tsconfig.json)

export declare const SDK_VERSION: string;

// ───────── Jugadores ─────────
export type PlayerId = string;
export interface Player {
  id: PlayerId;
  name: string;
  /** Color asignado (hex). Úsalo para identificar al jugador en pantalla. */
  color: string;
  /** Posición 0..n-1 según el orden de entrada a la partida. */
  slot: number;
  connected: boolean;
  /** true si juega con el teclado o un gamepad conectado a la consola. */
  local?: boolean;
}

// ───────── Mandos ─────────
export type Orientation = 'portrait' | 'landscape' | 'any';
interface ControlBase {
  id: string;
  /** Nombre del área de la grilla del layout. Por defecto = id. */
  area?: string;
  label?: string;
  color?: string;
  disabled?: boolean;
  hidden?: boolean;
}
export interface ButtonControl extends ControlBase { type: 'button'; /** Emite down/up */ shape?: 'round' | 'pill' | 'square'; haptic?: number; }
export interface DpadControl extends ControlBase { type: 'dpad'; /** Emite axis [x,y] con valores −1, 0, 1 */ diagonals?: boolean; }
export interface JoystickControl extends ControlBase { type: 'joystick'; /** Emite axis [x,y] en −1..1 */ deadzone?: number; axis?: 'xy' | 'x' | 'y'; }
export interface SliderControl extends ControlBase { type: 'slider'; /** Emite value 0..1 */ orientation?: 'vertical' | 'horizontal'; value?: number; }
export interface TiltControl extends ControlBase {
  type: 'tilt';
  /** Emite axis [x,y] en −1..1 desde los sensores del teléfono. Sin sensores se reemplaza por `fallback`. */
  mode?: 'wheel' | 'tilt';
  /** Grados que equivalen a 1.0. Por defecto 35. */
  range?: number;
  fallback?: 'joystick' | 'slider';
}
export interface GridControl extends ControlBase {
  type: 'grid';
  /** Emite press con el índice de la celda. */
  rows: number; cols: number;
  cells?: string[];
  cellColors?: (string | null)[];
  disabledCells?: number[];
}
export interface TextControl extends ControlBase { type: 'text'; text: string; sub?: string; size?: 's' | 'm' | 'l'; }
export type Control = ButtonControl | DpadControl | JoystickControl | SliderControl | TiltControl | GridControl | TextControl;

export interface Layout {
  orientation?: Orientation;
  /** Filas de grid-template-areas, ej. ["stick . a", "stick . b"]. "." = vacío. */
  areas: string[];
  controls: Control[];
  /** Color de acento del mando; por defecto, el color del jugador. */
  accent?: string;
}

type Opts<T> = Omit<T, 'id' | 'type'>;
export declare const L: {
  layout(spec: Partial<Layout> & Pick<Layout, 'areas' | 'controls'>): Layout;
  button(id: string, opts?: Opts<ButtonControl>): ButtonControl;
  dpad(id: string, opts?: Opts<DpadControl>): DpadControl;
  joystick(id: string, opts?: Opts<JoystickControl>): JoystickControl;
  slider(id: string, opts?: Opts<SliderControl>): SliderControl;
  tilt(id: string, opts?: Opts<TiltControl>): TiltControl;
  grid(id: string, opts: Opts<GridControl>): GridControl;
  text(id: string, opts: Opts<TextControl>): TextControl;
  message(text: string, sub?: string): Layout;
};

// ───────── Entradas ─────────
export type InputKind = 'down' | 'up' | 'axis' | 'value' | 'press';
export interface InputEvent {
  player: PlayerId;
  control: string;
  kind: InputKind;
  value?: number | [number, number] | unknown;
}
export interface InputApi {
  axis(player: PlayerId, control: string): [number, number];
  value(player: PlayerId, control: string, def?: number): number;
  down(player: PlayerId, control: string): boolean;
  pressed(player: PlayerId, control: string): boolean;
  released(player: PlayerId, control: string): boolean;
}

// ───────── Contexto ─────────
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Random {
  seed: number;
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[];
}
export interface Timer { at: number; fn(): void; every?: number; }
export interface GameResults {
  /** Ids de jugadores del primero al último. */
  ranking?: PlayerId[];
  scores?: Record<PlayerId, number>;
  /** Texto principal del podio, ej. "¡Gana Ana!". */
  title?: string;
  error?: string;
}
export interface Manifest {
  id: string; name: string; version: string; sdk: string;
  description?: string;
  players: { min: number; max: number };
  logic: 'screen' | 'server';
  entry: string;
  icon?: string;
  tags?: string[];
  options?: { id: string; type: 'int' | 'bool' | 'choice'; label: string; default: unknown; min?: number; max?: number; choices?: string[] }[];
  /** Ruta base donde el servidor sirve el juego. */
  path: string;
}
export interface GameContext {
  readonly sdkVersion: string;
  readonly manifest: Manifest;
  readonly options: Record<string, unknown>;
  /** Contenedor DOM del juego (pantalla completa). */
  readonly root: HTMLElement;
  readonly width: number;
  readonly height: number;
  /** Segundos de juego transcurridos (no avanza en pausa). */
  readonly time: number;
  readonly players: Player[];
  player(id: PlayerId): Player | undefined;
  input: InputApi;
  controllers: {
    set(target: PlayerId | 'all', layout: Layout): void;
    patch(target: PlayerId | 'all', controlId: string, props: Partial<Control>): void;
    vibrate(target: PlayerId | 'all', pattern?: number | number[]): void;
    layoutOf(player: PlayerId): Layout | undefined;
  };
  audio: {
    tone(freq?: number, dur?: number, opts?: { type?: OscillatorType; vol?: number; slide?: number }): void;
    noise(dur?: number, vol?: number): void;
    engine(type?: OscillatorType): { set(freq: number, vol: number): void; stop(): void };
  };
  random: Random;
  timer: {
    after(sec: number, fn: () => void): Timer;
    every(sec: number, fn: () => void): Timer;
    cancel(t: Timer): void;
  };
  ui: { banner(text: string, sec?: number, sub?: string): void };
  storage: { get<T>(key: string, def?: T): T; set(key: string, value: unknown): void };
  assets: { url(relativePath: string): string };
  viewports(n: number, width: number, height: number, gap?: number): Rect[];
  /** Crea un canvas con resolución lógica fija, escalado para llenar la pantalla. */
  createCanvas(opts?: { width?: number; height?: number; fit?: 'contain' | 'cover'; pixelated?: boolean }): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; width: number; height: number };
  onResize(fn: (width: number, height: number) => void): void;
  pause(reason?: string): void;
  resume(): void;
  end(results?: GameResults): void;
}

// ───────── Juego ─────────
export interface GameDefinition {
  /** Prepara el estado, la escena y los layouts de los mandos. Puede ser async (carga de assets). */
  setup(ctx: GameContext): void | Promise<void>;
  /** Lógica a paso fijo de 60 Hz. */
  update?(ctx: GameContext, dt: number): void;
  /** Dibujo en cada frame; alpha (0..1) sirve para interpolar entre ticks. */
  render?(ctx: GameContext, alpha: number): void;
  /** Cada entrada de un mando, en cuanto llega. */
  onInput?(ctx: GameContext, e: InputEvent): void;
  /** Si no se define, el juego se pausa hasta que el jugador vuelva. */
  onPlayerLeave?(ctx: GameContext, player: Player): void;
  onPlayerJoin?(ctx: GameContext, player: Player): void;
  onPause?(ctx: GameContext): void;
  onResume?(ctx: GameContext): void;
  /** Libera recursos (WebGL, audio, listeners). */
  dispose?(ctx: GameContext): void;
}
export declare function defineGame(def: GameDefinition): Readonly<GameDefinition>;
export declare function createRandom(seed?: number): Random;
export declare function viewports(n: number, width: number, height: number, gap?: number): Rect[];
