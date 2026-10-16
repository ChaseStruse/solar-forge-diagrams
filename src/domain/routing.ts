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
export function routeEdge(
  edge: DiagramEdge,
  nodes: ReadonlyMap<string, DiagramNode>,
  obstacles: readonly Obstacle[] = obstaclesOf(nodes),
): { points: Point[]; sourcePort: Port; targetPort: Port } {
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
/** Axis-aligned segment against a box, with a small clearance. */
function crosses(a: Point, b: Point, box: Rect): boolean {
  const pad = 6;
  return (
    Math.max(a.x, b.x) > box.minX - pad &&
    Math.min(a.x, b.x) < box.maxX + pad &&
    Math.max(a.z, b.z) > box.minZ - pad &&
    Math.min(a.z, b.z) < box.maxZ + pad
  );
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
): Point[] {
  const ends = [rect(source, nodes), rect(target, nodes)];
  const bend = edge.bend ?? 0;
  const minX = Math.min(...ends.map((r) => r.minX)) - 30;
  const maxX = Math.max(...ends.map((r) => r.maxX)) + 30;
  const minZ = Math.min(...ends.map((r) => r.minZ)) - 30;
  const maxZ = Math.max(...ends.map((r) => r.maxZ)) + 30;
  // Only tiles inside the area any candidate can reach are worth testing.
  const reach = Math.abs(bend) + 10;
  const area = {
    minX: Math.min(minX, first.x, last.x) - reach,
    maxX: Math.max(maxX, first.x, last.x) + reach,
    minZ: Math.min(minZ, first.z, last.z) - reach,
    maxZ: Math.max(maxZ, first.z, last.z) + reach,
  };
  const obstacles: Rect[] = [...ends];
  for (const box of all)
    if (
      box.id !== source.id &&
      box.id !== target.id &&
      box.maxX > area.minX &&
      box.minX < area.maxX &&
      box.maxZ > area.minZ &&
      box.minZ < area.maxZ
    )
      obstacles.push(box);
  const candidates: Point[][] = [];
  for (const x of [(first.x + last.x) / 2 + bend, minX + bend, maxX + bend])
    candidates.push([first, { x, z: first.z }, { x, z: last.z }, last]);
  for (const z of [(first.z + last.z) / 2 + bend, minZ + bend, maxZ + bend])
    candidates.push([first, { x: first.x, z }, { x: last.x, z }, last]);
  const elbows = [
    { x: last.x, z: first.z },
    { x: first.x, z: last.z },
  ];
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
      for (const box of obstacles) if (crosses(a, b, box)) score += 10_000;
      // Leaving against the source stub or arriving against the target stub.
      if (!previous && dx === -out.x && dz === -out.z) score += 5_000;
      if (i === path.length - 1 && dx === into.x && dz === into.z)
        score += 5_000;
      if (previous) bends++;
      previous = b;
    }
    score += bends * 40;
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
