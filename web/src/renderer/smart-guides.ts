import type { Rect } from '../domain/document';

/** Height above the board at which guide lines are drawn. */
const GUIDE_Y = 16;
/** How far guide lines run past the boxes they align. */
const OVERHANG = 30;

/**
 * Smart guides: pull a dragged box's edges or centre onto a neighbour's when
 * they come within `threshold` board units, and return the guide lines to
 * draw as flat x, y, z segment pairs.
 */
export function snapToNeighbours(
  box: Rect,
  others: readonly Rect[],
  dx: number,
  dz: number,
  threshold: number,
): { dx: number; dz: number; segments: number[] } {
  const lines = (min: number, max: number) => [min, (min + max) / 2, max];
  let bestX: { diff: number; at: number; other: Rect } | undefined;
  let bestZ: { diff: number; at: number; other: Rect } | undefined;
  for (const other of others) {
    for (const a of lines(box.minX + dx, box.maxX + dx))
      for (const b of lines(other.minX, other.maxX)) {
        const diff = b - a;
        if (
          Math.abs(diff) < threshold &&
          (!bestX || Math.abs(diff) < Math.abs(bestX.diff))
        )
          bestX = { diff, at: b, other };
      }
    for (const a of lines(box.minZ + dz, box.maxZ + dz))
      for (const b of lines(other.minZ, other.maxZ)) {
        const diff = b - a;
        if (
          Math.abs(diff) < threshold &&
          (!bestZ || Math.abs(diff) < Math.abs(bestZ.diff))
        )
          bestZ = { diff, at: b, other };
      }
  }
  if (bestX) dx += bestX.diff;
  if (bestZ) dz += bestZ.diff;
  const segments: number[] = [];
  if (bestX) {
    const from = Math.min(box.minZ + dz, bestX.other.minZ) - OVERHANG;
    const to = Math.max(box.maxZ + dz, bestX.other.maxZ) + OVERHANG;
    segments.push(bestX.at, GUIDE_Y, from, bestX.at, GUIDE_Y, to);
  }
  if (bestZ) {
    const from = Math.min(box.minX + dx, bestZ.other.minX) - OVERHANG;
    const to = Math.max(box.maxX + dx, bestZ.other.maxX) + OVERHANG;
    segments.push(from, GUIDE_Y, bestZ.at, to, GUIDE_Y, bestZ.at);
  }
  return { dx, dz, segments };
}
