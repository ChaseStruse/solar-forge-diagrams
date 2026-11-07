/**
 * Keyboard camera movement: WASD and the arrow keys glide the board while
 * held. Movement runs on animation frames rather than key repeat, so it starts
 * at once and stays smooth whatever the system repeat rate.
 */
const DIRECTIONS: Record<string, readonly [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};
/** Screen pixels per second; Shift moves faster. */
export const PAN_SPEED = 900;
export const FAST_PAN_MULTIPLIER = 2.5;

export function isPanKey(key: string): boolean {
  return key.toLowerCase() in DIRECTIONS;
}

/** Unit direction for the held keys; opposite keys cancel out. */
export function panDirection(held: Iterable<string>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const key of new Set([...held].map((k) => k.toLowerCase()))) {
    const direction = DIRECTIONS[key];
    if (!direction) continue;
    x += direction[0];
    y += direction[1];
  }
  // W and Up together must not double the speed.
  x = Math.sign(x);
  y = Math.sign(y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * Held-key tracker that calls `pan` with a pixel offset every frame while a
 * pan key is down. Screen right and down are positive.
 */
export class CameraKeys {
  private readonly held = new Set<string>();
  private fast = false;
  private frame = 0;
  private last = 0;
  public constructor(
    private readonly pan: (dx: number, dy: number) => void,
    private readonly requestFrame: (tick: (now: number) => void) => number = (
      tick,
    ) => requestAnimationFrame(tick),
    private readonly cancelFrame: (id: number) => void = (id) =>
      cancelAnimationFrame(id),
  ) {}
  public get active(): boolean {
    return this.held.size > 0;
  }
  public press(key: string, shift: boolean): void {
    this.fast = shift;
    this.held.add(key.toLowerCase());
    if (!this.frame) {
      this.last = 0;
      this.frame = this.requestFrame(this.tick);
    }
  }
  public release(key: string, shift = this.fast): void {
    this.fast = shift;
    this.held.delete(key.toLowerCase());
    if (!this.held.size) this.stop();
  }
  /** Forget every key, e.g. when the window loses focus mid-pan. */
  public stop(): void {
    this.held.clear();
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
  }
  private tick = (now: number): void => {
    // The first frame only takes a timestamp; long stalls are capped.
    const seconds = this.last ? Math.min((now - this.last) / 1000, 0.05) : 0;
    this.last = now;
    const { x, y } = panDirection(this.held);
    const distance =
      PAN_SPEED * (this.fast ? FAST_PAN_MULTIPLIER : 1) * seconds;
    if (distance && (x || y)) this.pan(x * distance, y * distance);
    this.frame = this.held.size ? this.requestFrame(this.tick) : 0;
  };
}
