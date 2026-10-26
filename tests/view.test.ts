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

const largeBoard = { minX: -300, maxX: 2700, minZ: -600, maxZ: 4500, maxY: 45 };
test('a large board keeps full colour instead of fading into the fog', () => {
  const small = new BoardView();
  small.resize(1440, 1000);
  small.fit({ minX: -470, maxX: 470, minZ: -305, maxZ: 305, maxY: 80 });
  // Small boards keep their existing atmosphere.
  expect(small.fogScale).toBeGreaterThan(0.95);
  const large = new BoardView();
  large.resize(1440, 1000);
  large.fit(largeBoard);
  const distance = large.camera.position.distanceTo(large.target);
  // FogExp2: fog factor = 1 - exp(-(density * distance)^2).
  const fog = 1 - Math.exp(-((0.00012 * large.fogScale * distance) ** 2));
  expect(fog).toBeLessThan(0.12);
});
test('zoom-in reach grows with the board instead of capping at 4x the fit', () => {
  const view = new BoardView();
  view.resize(1440, 1000);
  view.fit(largeBoard);
  const fitted = view.camera.zoom;
  for (let step = 0; step < 200; step++) view.zoomBy(1.2);
  const tileWidth = (zoom: number) => {
    view.camera.zoom = zoom;
    view.update();
    const a = new Vector3(view.target.x - 80, 0, view.target.z).project(
      view.camera,
    );
    const b = new Vector3(view.target.x + 80, 0, view.target.z).project(
      view.camera,
    );
    return ((b.x - a.x) * 1440) / 2;
  };
  const maxed = view.camera.zoom;
  expect(maxed / fitted).toBeGreaterThan(20);
  // A 160-unit tile can be magnified to fill a large part of the screen.
  expect(tileWidth(maxed)).toBeGreaterThan(600);
  view.setMode('top');
  expect(view.clampZoom(1000)).toBe(4);
  expect(view.clampZoom(0)).toBe(0.05);
});
