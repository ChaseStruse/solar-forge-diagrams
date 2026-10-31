import { expect, test } from 'bun:test';
import { recognizeSketch, type SketchPoint } from '../src/editor/sketch';

/** Deterministic wobble so the shapes look hand-drawn. */
function wobble(points: SketchPoint[], amount: number): SketchPoint[] {
  return points.map((p, i) => ({
    x: p.x + Math.sin(i * 1.7) * amount,
    z: p.z + Math.cos(i * 2.3) * amount,
  }));
}
function polygon(corners: SketchPoint[], perSide = 20): SketchPoint[] {
  const points: SketchPoint[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as SketchPoint;
    const b = corners[(i + 1) % corners.length] as SketchPoint;
    for (let s = 0; s < perSide; s++) {
      const t = s / perSide;
      points.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    }
  }
  points.push({ ...(corners[0] as SketchPoint) });
  return points;
}
function ellipse(cx: number, cz: number, rx: number, rz: number, turn = 1) {
  return Array.from({ length: 80 }, (_, i) => {
    const angle = (i / 79) * Math.PI * 2 * turn;
    return { x: cx + rx * Math.cos(angle), z: cz + rz * Math.sin(angle) };
  });
}

test('a hand-drawn box becomes a process node covering it', () => {
  const box = wobble(
    polygon([
      { x: 0, z: 0 },
      { x: 200, z: 0 },
      { x: 200, z: 100 },
      { x: 0, z: 100 },
    ]),
    3,
  );
  const result = recognizeSketch(box);
  expect(result.kind).toBe('shape');
  if (result.kind !== 'shape') return;
  expect(result.shape).toBe('process');
  expect(result.x).toBeCloseTo(100, -1);
  expect(result.z).toBeCloseTo(50, -1);
  expect(result.width).toBeGreaterThan(190);
  expect(result.depth).toBeGreaterThan(90);
});

test('a diamond becomes a decision and an oval a terminal', () => {
  const diamond = wobble(
    polygon([
      { x: 100, z: 0 },
      { x: 200, z: 80 },
      { x: 100, z: 160 },
      { x: 0, z: 80 },
    ]),
    3,
  );
  expect(recognizeSketch(diamond)).toMatchObject({
    kind: 'shape',
    shape: 'decision',
  });
  expect(recognizeSketch(wobble(ellipse(0, 0, 120, 60), 3))).toMatchObject({
    kind: 'shape',
    shape: 'terminal',
  });
});

test('a stroke that does not close is a line between its ends', () => {
  const stroke = wobble(
    Array.from({ length: 30 }, (_, i) => ({ x: i * 10, z: i * 4 })),
    2,
  );
  const result = recognizeSketch(stroke);
  expect(result.kind).toBe('line');
  if (result.kind !== 'line') return;
  expect(result.from.x).toBeCloseTo(stroke[0]?.x ?? 0);
  expect(result.to.x).toBeCloseTo(stroke.at(-1)?.x ?? 0);
});

test('an open arc is a line, not a shape', () => {
  expect(recognizeSketch(ellipse(0, 0, 100, 100, 0.5)).kind).toBe('line');
});

test('taps, slivers and scribbles are not recognised', () => {
  expect(recognizeSketch([{ x: 0, z: 0 }]).kind).toBe('none');
  expect(
    recognizeSketch([
      { x: 0, z: 0 },
      { x: 3, z: 2 },
    ]).kind,
  ).toBe('none');
  // A closed loop squashed almost flat.
  expect(
    recognizeSketch(
      polygon([
        { x: 0, z: 0 },
        { x: 300, z: 0 },
        { x: 300, z: 8 },
        { x: 0, z: 8 },
      ]),
    ).kind,
  ).toBe('none');
  // A star: closed, but no box, diamond or oval.
  const star = Array.from({ length: 11 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 40 : 150;
    return { x: r * Math.cos(angle), z: r * Math.sin(angle) };
  });
  expect(recognizeSketch(polygon(star.slice(0, 10), 8)).kind).toBe('none');
});
