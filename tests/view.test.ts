import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { BoardView } from '../src/renderer/view';

test('spatial view keeps a horizontal service row level without diagonal roll', () => {
  const view = new BoardView();
  view.resize(1440, 1000);
  view.fit({ minX: -470, maxX: 470, minZ: -305, maxZ: 305, maxY: 80 });
  const a = new Vector3(-200, 20, 0).project(view.camera);
  const b = new Vector3(200, 20, 0).project(view.camera);
  expect(a.y).toBeCloseTo(b.y, 8);
  expect(a.x).toBeLessThan(b.x);
});
test('spatial fit leaves room for the tool rail and Layers panel', () => {
  const view = new BoardView();
  view.resize(1440, 1000);
  const bounds = { minX: -470, maxX: 470, minZ: -305, maxZ: 305, maxY: 80 };
  view.fit(bounds);
  for (const x of [-470, 470])
    for (const y of [0, 80])
      for (const z of [-305, 305]) {
        const p = new Vector3(x, y, z).project(view.camera);
        expect((p.x + 1) * 720).toBeGreaterThanOrEqual(99);
        expect((p.x + 1) * 720).toBeLessThanOrEqual(1143);
        expect((1 - p.y) * 500).toBeGreaterThanOrEqual(134);
        expect((1 - p.y) * 500).toBeLessThanOrEqual(861);
      }
});

test('a narrow tiled window retains a usable board instead of shrinking behind Layers', () => {
  const view = new BoardView();
  view.resize(513, 918);
  view.fit({ minX: -390, maxX: 390, minZ: -75, maxZ: 145, maxY: 45 });
  const left = new Vector3(-390, 20, 0).project(view.camera);
  const right = new Vector3(390, 20, 0).project(view.camera);
  const width = ((right.x - left.x) * 513) / 2;
  expect(width).toBeGreaterThan(260);
  expect(((left.x + 1) * 513) / 2).toBeGreaterThan(90);
  expect(((right.x + 1) * 513) / 2).toBeLessThan(485);
});
