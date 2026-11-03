import { expect, test } from 'bun:test';
import { wrapCaption } from '../src/renderer/caption';
import { snapToNeighbours } from '../src/renderer/smart-guides';

const box = { minX: 0, maxX: 100, minZ: 0, maxZ: 50 };

test('a drag within the threshold snaps an edge onto a neighbour', () => {
  const other = { minX: 203, maxX: 303, minZ: 200, maxZ: 250 };
  // Moving right by 200 leaves the left edge 3 units short of the other's.
  const result = snapToNeighbours(box, [other], 200, 0, 8);
  expect(result.dx).toBe(203);
  expect(result.dz).toBe(0);
  // One vertical guide at x = 203, running past both boxes.
  expect(result.segments).toEqual([203, 16, -30, 203, 16, 280]);
});

test('centres align as well as edges', () => {
  const other = { minX: 500, maxX: 600, minZ: 0, maxZ: 100 };
  // Box centre z = 25 + dz; other centre z = 50.
  const result = snapToNeighbours(box, [other], 0, 22, 8);
  expect(result.dz).toBe(25);
});

test('the nearest line wins and far neighbours are ignored', () => {
  const near = { minX: 104, maxX: 200, minZ: 400, maxZ: 450 };
  const nearer = { minX: 101, maxX: 200, minZ: 600, maxZ: 650 };
  const far = { minX: 150, maxX: 250, minZ: 800, maxZ: 850 };
  const result = snapToNeighbours(box, [near, nearer, far], 0, 300, 8);
  expect(result.dx).toBe(1);
});

test('nothing within reach means no snap and no guides', () => {
  const other = { minX: 1000, maxX: 1100, minZ: 1000, maxZ: 1100 };
  expect(snapToNeighbours(box, [other], 7, 9, 8)).toEqual({
    dx: 7,
    dz: 9,
    segments: [],
  });
});

test('captions wrap to the width and keep their line breaks', () => {
  const measure = (text: string) => text.length * 10;
  expect(wrapCaption('abcdefghij', 40, measure)).toEqual([
    'abcd',
    'efgh',
    'ij',
  ]);
  expect(wrapCaption('ab\ncd', 40, measure)).toEqual(['ab', 'cd']);
  expect(wrapCaption('', 40, measure)).toEqual(['']);
});
