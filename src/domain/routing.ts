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
export function routeEdge(
  edge: DiagramEdge,
  nodes: ReadonlyMap<string, DiagramNode>,
): { points: Point[]; sourcePort: Port; targetPort: Port } {
  const source = nodes.get(edge.source),
    target = nodes.get(edge.target);
  if (!source || !target) throw Error('Missing connection endpoint');
  const a = worldPosition(source, nodes),
    b = worldPosition(target, nodes);
  const horizontal = edge.routing
    ? edge.routing === 'horizontal'
    : Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
  const forward = horizontal ? b.x >= a.x : b.z >= a.z;
  const sourcePort =
    edge.sourcePort ??
    (horizontal ? (forward ? 'east' : 'west') : forward ? 'south' : 'north');
  const targetPort =
    edge.targetPort ??
    (horizontal ? (forward ? 'west' : 'east') : forward ? 'north' : 'south');
  const start = portPosition(source, sourcePort, nodes),
    end = portPosition(target, targetPort, nodes);
  const stub = (point: Point, port: Port): Point => ({
    x: point.x + (port === 'east' ? 24 : port === 'west' ? -24 : 0),
    z: point.z + (port === 'south' ? 24 : port === 'north' ? -24 : 0),
  });
  const first = stub(start, sourcePort),
    last = stub(end, targetPort);
  const mid = horizontal
    ? (first.x + last.x) / 2 + (edge.bend ?? 0)
    : (first.z + last.z) / 2 + (edge.bend ?? 0);
  return {
    sourcePort,
    targetPort,
    points: horizontal
      ? [start, first, { x: mid, z: first.z }, { x: mid, z: last.z }, last, end]
      : [
          start,
          first,
          { x: first.x, z: mid },
          { x: last.x, z: mid },
          last,
          end,
        ],
  };
}
