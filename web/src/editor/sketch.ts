/**
 * Sketch recognition for the pen: a closed stroke becomes a flowchart shape,
 * an open one a connector. Strokes are board-plane points, so the 2.5D view's
 * tilt is already undone; both views keep +X right and +Z down.
 */
export interface SketchPoint {
  x: number;
  z: number;
}
export type SketchShape = 'process' | 'decision' | 'terminal';
export type Sketch =
  | {
      kind: 'shape';
      shape: SketchShape;
      x: number;
      z: number;
      width: number;
      depth: number;
    }
  | { kind: 'line'; from: SketchPoint; to: SketchPoint }
  | { kind: 'none' };

/** Points spread evenly along the stroke, so slow drawing does not weigh more. */
const SAMPLES = 64;
/** Mean distance from the ideal outline, in half-box units, still accepted. */
const TOLERANCE = 0.14;

function pathLength(points: readonly SketchPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as SketchPoint;
    const b = points[i] as SketchPoint;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

function resample(
  points: readonly SketchPoint[],
  count: number,
): SketchPoint[] {
  const total = pathLength(points);
  const step = total / (count - 1);
  const first = points[0] as SketchPoint;
  const result: SketchPoint[] = [{ ...first }];
  let carried = 0;
  for (let i = 1; i < points.length && result.length < count; i++) {
    let a = points[i - 1] as SketchPoint;
    const b = points[i] as SketchPoint;
    let segment = Math.hypot(b.x - a.x, b.z - a.z);
    while (carried + segment >= step && result.length < count) {
      const t = (step - carried) / segment;
      a = { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) };
      result.push(a);
      segment = Math.hypot(b.x - a.x, b.z - a.z);
      carried = 0;
    }
    carried += segment;
  }
  while (result.length < count)
    result.push({ ...(points.at(-1) as SketchPoint) });
  return result;
}

/** Distance from a normalised point to each candidate outline of the unit box. */
const outlines: Record<SketchShape, (u: number, v: number) => number> = {
  process: (u, v) => Math.abs(Math.max(Math.abs(u), Math.abs(v)) - 1),
  terminal: (u, v) => Math.abs(Math.hypot(u, v) - 1),
  decision: (u, v) => Math.abs(Math.abs(u) + Math.abs(v) - 1) / Math.SQRT2,
};

/**
 * Classify one pen stroke. `minSize` is the smallest box, in board units,
 * worth turning into a shape; anything smaller is a tap or a slip.
 */
export function recognizeSketch(
  points: readonly SketchPoint[],
  minSize = 30,
): Sketch {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) return { kind: 'none' };
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const size = Math.max(width, depth);
  if (size < minSize / 2) return { kind: 'none' };
  const length = pathLength(points);
  const gap = Math.hypot(last.x - first.x, last.z - first.z);
  // Closed: the ends meet, relative to the shape, and it went most of the way
  // round (a diamond's outline, the shortest, is about 1.4 × (width + depth)).
  const closed = gap < 0.3 * size && length > 1.25 * (width + depth);
  if (!closed) return { kind: 'line', from: { ...first }, to: { ...last } };
  if (Math.min(width, depth) < minSize || Math.min(width, depth) < 0.15 * size)
    return { kind: 'none' };
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const samples = resample(points, SAMPLES);
  let best: { shape: SketchShape; error: number } | undefined;
  for (const shape of Object.keys(outlines) as SketchShape[]) {
    const distance = outlines[shape];
    let error = 0;
    for (const p of samples)
      error += distance((p.x - cx) / (width / 2), (p.z - cz) / (depth / 2));
    error /= samples.length;
    if (!best || error < best.error) best = { shape, error };
  }
  if (!best || best.error > TOLERANCE) return { kind: 'none' };
  return { kind: 'shape', shape: best.shape, x: cx, z: cz, width, depth };
}
