import type { DiagramEdge, DiagramNode, Port } from './document';
import { worldPosition } from './document';
export interface Point {
  x: number;
  z: number;
}
export function portPosition(
  node: DiagramNode,
  port: Port,
  nodes: ReadonlyMap<string, DiagramNode>,
): Point {
  const p = worldPosition(node, nodes);
  return {
    x:
      p.x +
      (port === 'east'
        ? node.width / 2
        : port === 'west'
          ? -node.width / 2
          : 0),
    z:
      p.z +
      (port === 'south'
        ? node.depth / 2
        : port === 'north'
          ? -node.depth / 2
          : 0),
  };
}
/** The side of a node facing a world point; used when a connection is dropped. */
export function nearestPort(
  node: DiagramNode,
  point: Point,
  nodes: ReadonlyMap<string, DiagramNode>,
): Port {
  const p = worldPosition(node, nodes);
  // Normalize by size so wide tiles still offer their north/south sides.
  const dx = (point.x - p.x) / Math.max(node.width, 1);
  const dz = (point.z - p.z) / Math.max(node.depth, 1);
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'east' : 'west';
  return dz >= 0 ? 'south' : 'north';
}
/** Automatic ports face each other along the dominant axis between nodes. */
function automaticPorts(
  a: Point,
  b: Point,
  routing: DiagramEdge['routing'],
): [Port, Port] {
  const horizontal = routing
    ? routing === 'horizontal'
    : Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
  const forward = horizontal ? b.x >= a.x : b.z >= a.z;
  return horizontal
    ? forward
      ? ['east', 'west']
      : ['west', 'east']
    : forward
      ? ['south', 'north']
      : ['north', 'south'];
}
export interface Obstacle extends Rect {
  id: string;
}
/** Tiles that routes steer around; compute once and reuse across many routes. */
export function obstaclesOf(
  nodes: ReadonlyMap<string, DiagramNode>,
): Obstacle[] {
  const result: Obstacle[] = [];
  for (const node of nodes.values())
    if (node.kind !== 'group')
      result.push({ id: node.id, ...rect(node, nodes) });
  return result;
}
/** The sides a connection leaves and enters by, fixed or automatic. */
export function resolvePorts(
  edge: DiagramEdge,
  nodes: ReadonlyMap<string, DiagramNode>,
): [Port, Port] {
  const source = nodes.get(edge.source),
    target = nodes.get(edge.target);
  if (!source || !target) throw Error('Missing connection endpoint');
  const a = worldPosition(source, nodes),
    b = worldPosition(target, nodes);
  const [autoSource, autoTarget] = automaticPorts(a, b, edge.routing);
  let sourcePort = edge.sourcePort ?? autoSource;
  let targetPort = edge.targetPort ?? autoTarget;
  // With one fixed side, pick the free side relative to that fixed endpoint.
  if (edge.sourcePort && !edge.targetPort)
    targetPort = nearestPort(
      target,
      portPosition(source, sourcePort, nodes),
      nodes,
    );
  if (!edge.sourcePort && edge.targetPort)
    sourcePort = nearestPort(
      source,
      portPosition(target, targetPort, nodes),
      nodes,
    );
  return [sourcePort, targetPort];
}
/** Connections sharing a node side, keyed "node:port"; shared sides fork at the node. */
export type Fans = ReadonlyMap<string, number>;
export function fansOf(
  edges: Iterable<DiagramEdge>,
  nodes: ReadonlyMap<string, DiagramNode>,
): Map<string, number> {
  const fans = new Map<string, number>();
  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const [out, into] = resolvePorts(edge, nodes);
    for (const key of [`${edge.source}:${out}`, `${edge.target}:${into}`])
      fans.set(key, (fans.get(key) ?? 0) + 1);
  }
  return fans;
}
export function routeEdge(
  edge: DiagramEdge,
  nodes: ReadonlyMap<string, DiagramNode>,
  obstacles: readonly Obstacle[] = obstaclesOf(nodes),
  fans?: Fans,
): { points: Point[]; sourcePort: Port; targetPort: Port } {
  const source = nodes.get(edge.source),
    target = nodes.get(edge.target);
  if (!source || !target) throw Error('Missing connection endpoint');
  const [sourcePort, targetPort] = resolvePorts(edge, nodes);
  const fork = (fans?.get(`${edge.source}:${sourcePort}`) ?? 0) > 1;
  const merge = (fans?.get(`${edge.target}:${targetPort}`) ?? 0) > 1;
  const start = portPosition(source, sourcePort, nodes),
    end = portPosition(target, targetPort, nodes);
  const first = offset(start, sourcePort, 24),
    last = offset(end, targetPort, 24);
  return {
    sourcePort,
    targetPort,
    points: [
      start,
      ...bestPath(
        first,
        last,
        sourcePort,
        targetPort,
        edge,
        source,
        target,
        nodes,
        obstacles,
        fork && !merge ? 'source' : merge && !fork ? 'target' : 'middle',
      ),
      end,
    ],
  };
}
const offset = (point: Point, port: Port, distance: number): Point => ({
  x: point.x + (port === 'east' ? distance : port === 'west' ? -distance : 0),
  z: point.z + (port === 'south' ? distance : port === 'north' ? -distance : 0),
});
interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
function rect(
  node: DiagramNode,
  nodes: ReadonlyMap<string, DiagramNode>,
): Rect {
  const p = worldPosition(node, nodes);
  return {
    minX: p.x - node.width / 2,
    maxX: p.x + node.width / 2,
    minZ: p.z - node.depth / 2,
    maxZ: p.z + node.depth / 2,
  };
}
const PAD = 6;
/** Axis-aligned segment against a box, with a small clearance. */
function crosses(a: Point, b: Point, box: Rect): boolean {
  const pad = PAD;
  return (
    Math.max(a.x, b.x) > box.minX - pad &&
    Math.min(a.x, b.x) < box.maxX + pad &&
    Math.max(a.z, b.z) > box.minZ - pad &&
    Math.min(a.z, b.z) < box.maxZ + pad
  );
}
/**
 * Uniform grid over an obstacle list so a segment only tests nearby tiles.
 * Built once per list (lists are rebuilt, never mutated, when tiles move).
 * Cell keys may collide far from the origin; that only adds candidates,
 * since every candidate still gets the exact `crosses` test.
 */
interface ObstacleGrid {
  cells: Map<number, number[]>;
  /** Per-obstacle query stamp, so a box spanning several cells counts once. */
  seen: Uint32Array;
  query: number;
}
const CELL = 256;
const grids = new WeakMap<readonly Obstacle[], ObstacleGrid>();
const cellKey = (ix: number, iz: number) =>
  ((ix & 0xffff) << 16) | (iz & 0xffff);
function addToCell(
  cells: Map<number, number[]>,
  key: number,
  index: number,
): void {
  const bucket = cells.get(key);
  if (bucket) bucket.push(index);
  else cells.set(key, [index]);
}
function gridOf(all: readonly Obstacle[]): ObstacleGrid {
  let grid = grids.get(all);
  if (grid) return grid;
  const cells = new Map<number, number[]>();
  for (let index = 0; index < all.length; index++) {
    const box = all[index];
    if (!box) continue;
    const x0 = Math.floor(box.minX / CELL),
      x1 = Math.floor(box.maxX / CELL);
    const z0 = Math.floor(box.minZ / CELL),
      z1 = Math.floor(box.maxZ / CELL);
    // Degenerate or absurdly large boxes go in one shared bucket.
    if (!(x1 - x0 <= 64 && z1 - z0 <= 64)) {
      addToCell(cells, -1, index);
      continue;
    }
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++)
        addToCell(cells, cellKey(ix, iz), index);
  }
  grid = { cells, seen: new Uint32Array(all.length), query: 0 };
  grids.set(all, grid);
  return grid;
}
/** Obstacles a segment passes through, excluding the two endpoint tiles. */
function countCrossings(
  a: Point,
  b: Point,
  all: readonly Obstacle[],
  grid: ObstacleGrid,
  sourceId: string,
  targetId: string,
): number {
  if (++grid.query === 0xffffffff) {
    grid.seen.fill(0);
    grid.query = 1;
  }
  const x0 = Math.floor((Math.min(a.x, b.x) - PAD) / CELL),
    x1 = Math.floor((Math.max(a.x, b.x) + PAD) / CELL);
  const z0 = Math.floor((Math.min(a.z, b.z) - PAD) / CELL),
    z1 = Math.floor((Math.max(a.z, b.z) + PAD) / CELL);
  let count = countBucket(
    grid.cells.get(-1),
    a,
    b,
    all,
    grid,
    sourceId,
    targetId,
  );
  if (x1 - x0 > 0xffff || z1 - z0 > 0xffff) {
    // Unbounded segment: fall back to every bucket.
    for (const [key, bucket] of grid.cells)
      if (key !== -1)
        count += countBucket(bucket, a, b, all, grid, sourceId, targetId);
    return count;
  }
  for (let ix = x0; ix <= x1; ix++)
    for (let iz = z0; iz <= z1; iz++)
      count += countBucket(
        grid.cells.get(cellKey(ix, iz)),
        a,
        b,
        all,
        grid,
        sourceId,
        targetId,
      );
  return count;
}
function countBucket(
  bucket: readonly number[] | undefined,
  a: Point,
  b: Point,
  all: readonly Obstacle[],
  grid: ObstacleGrid,
  sourceId: string,
  targetId: string,
): number {
  if (!bucket) return 0;
  let count = 0;
  for (const index of bucket) {
    if (grid.seen[index] === grid.query) continue;
    grid.seen[index] = grid.query;
    const box = all[index];
    if (box && box.id !== sourceId && box.id !== targetId && crosses(a, b, box))
      count++;
  }
  return count;
}
/**
 * Orthogonal routing between two port stubs: try a handful of three-segment
 * paths and keep the one that avoids tiles, never doubles back over a stub,
 * and stays short with few bends.
 */
function bestPath(
  first: Point,
  last: Point,
  sourcePort: Port,
  targetPort: Port,
  edge: DiagramEdge,
  source: DiagramNode,
  target: DiagramNode,
  nodes: ReadonlyMap<string, DiagramNode>,
  all: readonly Obstacle[],
  split: 'source' | 'middle' | 'target',
): Point[] {
  const ends = [rect(source, nodes), rect(target, nodes)];
  const bend = edge.bend ?? 0;
  const minX = Math.min(...ends.map((r) => r.minX)) - 30;
  const maxX = Math.max(...ends.map((r) => r.maxX)) + 30;
  const minZ = Math.min(...ends.map((r) => r.minZ)) - 30;
  const maxZ = Math.max(...ends.map((r) => r.maxZ)) + 30;
  // The endpoint tiles always count; other tiles come from the spatial grid.
  const grid = gridOf(all);
  const candidates: Point[][] = [];
  // Where the cross segment sits: halfway, or at a shared node so branches
  // visibly fork from (or merge into) it.
  const along = (a: number, b: number) =>
    (split === 'source' ? a : split === 'target' ? b : (a + b) / 2) + bend;
  for (const x of [along(first.x, last.x), minX + bend, maxX + bend])
    candidates.push([first, { x, z: first.z }, { x, z: last.z }, last]);
  for (const z of [along(first.z, last.z), minZ + bend, maxZ + bend])
    candidates.push([first, { x: first.x, z }, { x: last.x, z }, last]);
  const elbows = [
    { x: last.x, z: first.z },
    { x: first.x, z: last.z },
  ];
  const forked = candidates.length;
  for (const elbow of elbows)
    candidates.push([first, elbow, { ...elbow }, last]);
  const out = direction(sourcePort);
  const into = direction(targetPort);
  let best = candidates[0] ?? [first, last];
  let bestScore = Infinity;
  for (const path of candidates) {
    let score = 0;
    let bends = 0;
    let previous: Point | undefined;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      if (!a || !b) continue;
      const dx = Math.sign(b.x - a.x),
        dz = Math.sign(b.z - a.z);
      if (!dx && !dz) continue;
      score += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
      for (const box of ends) if (crosses(a, b, box)) score += 10_000;
      score += 10_000 * countCrossings(a, b, all, grid, source.id, target.id);
      // Leaving against the source stub or arriving against the target stub.
      if (!previous && dx === -out.x && dz === -out.z) score += 5_000;
      if (i === path.length - 1 && dx === into.x && dz === into.z)
        score += 5_000;
      if (previous) bends++;
      previous = b;
    }
    score += bends * 40;
    // Equal-length elbows tie with a fork; keep shared branches at the node.
    if (split !== 'middle' && candidates.indexOf(path) >= forked) score += 1;
    if (score < bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}
const direction = (port: Port): Point => offset({ x: 0, z: 0 }, port, 1);
/** The point halfway along a route, and whether that stretch runs along X. */
export function routeMidpoint(points: readonly Point[]): {
  point: Point;
  horizontal: boolean;
} {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a && b) total += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a || !b) continue;
    const length = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return {
        point: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
        horizontal: Math.abs(b.x - a.x) >= Math.abs(b.z - a.z),
      };
    }
    remaining -= length;
  }
  return { point: points[0] ?? { x: 0, z: 0 }, horizontal: true };
}
