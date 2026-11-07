import { expect, test } from 'bun:test';
import {
  CameraKeys,
  FAST_PAN_MULTIPLIER,
  isPanKey,
  PAN_SPEED,
  panDirection,
} from '../src/editor/camera-keys';

test('WASD and arrows are pan keys, in either case', () => {
  for (const key of ['w', 'A', 's', 'D', 'ArrowUp', 'ArrowLeft'])
    expect(isPanKey(key)).toBe(true);
  for (const key of ['q', 'b', 'Enter', ' ']) expect(isPanKey(key)).toBe(false);
});

test('opposite keys cancel and diagonals keep unit speed', () => {
  expect(panDirection(['a', 'd'])).toEqual({ x: 0, y: 0 });
  expect(panDirection(['w'])).toEqual({ x: 0, y: -1 });
  expect(panDirection(['w', 'ArrowUp'])).toEqual({ x: 0, y: -1 });
  const diagonal = panDirection(['s', 'ArrowRight']);
  expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  expect(diagonal.x).toBeGreaterThan(0);
  expect(diagonal.y).toBeGreaterThan(0);
});

function harness() {
  const pans: [number, number][] = [];
  let pending: ((now: number) => void) | undefined;
  const keys = new CameraKeys(
    (dx, dy) => pans.push([dx, dy]),
    (tick) => {
      pending = tick;
      return 1;
    },
    () => {
      pending = undefined;
    },
  );
  const frame = (now: number) => {
    const tick = pending;
    pending = undefined;
    tick?.(now);
  };
  return { keys, pans, frame, running: () => pending !== undefined };
}

test('a held key pans by speed × elapsed time, Shift faster', () => {
  const { keys, pans, frame } = harness();
  keys.press('d', false);
  frame(1000);
  frame(1010);
  expect(pans).toHaveLength(1);
  expect(pans[0]?.[0]).toBeCloseTo(PAN_SPEED * 0.01);
  keys.press('D', true);
  frame(1020);
  expect(pans[1]?.[0]).toBeCloseTo(PAN_SPEED * FAST_PAN_MULTIPLIER * 0.01);
});

test('releasing every key stops the frame loop; long stalls are capped', () => {
  const { keys, pans, frame, running } = harness();
  keys.press('w', false);
  frame(0.5);
  frame(5000);
  expect(pans[0]?.[1]).toBeCloseTo(-PAN_SPEED * 0.05);
  keys.release('W');
  expect(running()).toBe(false);
  expect(keys.active).toBe(false);
});

test('stop forgets held keys, e.g. on window blur', () => {
  const { keys, running } = harness();
  keys.press('a', false);
  keys.press('ArrowDown', false);
  keys.stop();
  expect(keys.active).toBe(false);
  expect(running()).toBe(false);
});
