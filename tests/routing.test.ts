import { expect, test } from 'bun:test';
import type { DiagramEdge, DiagramNode } from '../src/domain/document';
import {
  fansOf,
  nearestPort,
  obstaclesOf,
  routeEdge,
  routeMidpoint,
} from '../src/domain/routing';

const tile = (id: string, x: number, z: number): DiagramNode => ({
  id,
  kind: 'service',
  label: id,
  x,
  z,
  width: 180,
  depth: 150,
  color: '#ff9900',
});
const board = (...nodes: DiagramNode[]) => new Map(nodes.map((n) => [n.id, n]));
const inside = (p: { x: number; z: number }, n: DiagramNode) =>
  Math.abs(p.x - n.x) < n.width / 2 && Math.abs(p.z - n.z) < n.depth / 2;

test('a dropped connection lands on the side facing the pointer', () => {
  const node = tile('db', 300, 0);
  const nodes = board(node);
  expect(nearestPort(node, { x: 300, z: -60 }, nodes)).toBe('north');
  expect(nearestPort(node, { x: 300, z: 70 }, nodes)).toBe('south');
  expect(nearestPort(node, { x: 220, z: 0 }, nodes)).toBe('west');
  expect(nearestPort(node, { x: 390, z: 10 }, nodes)).toBe('east');
});

test('routes between side-by-side tiles on vertical ports go around both', () => {
  const a = tile('a', -300, 0),
    b = tile('b', 300, 0);
  const edge: DiagramEdge = {
    id: 'e',
    source: 'a',
    target: 'b',
    label: '',
    sourcePort: 'south',
    targetPort: 'north',
  };
  const route = routeEdge(edge, board(a, b));
  expect(route.points).toHaveLength(6);
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1],
      q = route.points[i];
    if (!p || !q) throw Error('Missing route point');
    expect(p.x === q.x || p.z === q.z).toBe(true);
    // Sample along every interior segment; none may pass through a tile.
    if (i > 1 && i < route.points.length - 1)
      for (let t = 0; t <= 1; t += 0.1) {
        const sample = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
        expect(inside(sample, a) || inside(sample, b)).toBe(false);
      }
  }
});

test('automatic ports face each other and route through another tile only as a last resort', () => {
  const a = tile('a', -400, 0),
    blocker = tile('blocker', 0, 0),
    b = tile('b', 400, 0);
  const route = routeEdge(
    { id: 'e', source: 'a', target: 'b', label: '' },
    board(a, blocker, b),
  );
  expect(route.sourcePort).toBe('east');
  expect(route.targetPort).toBe('west');
  for (const point of route.points) expect(inside(point, blocker)).toBe(false);
});

test('labels sit halfway along a route', () => {
  const { point, horizontal } = routeMidpoint([
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 50 },
  ]);
  expect(point).toEqual({ x: 75, z: 0 });
  expect(horizontal).toBe(true);
});

test('branches sharing a side fork at their shared node and merge at the target', () => {
  const ecr = tile('ecr', 0, 0),
    eks = tile('eks', 400, -200),
    ecs = tile('ecs', 400, 200),
    fargate = tile('fargate', 800, 0);
  const nodes = board(ecr, eks, ecs, fargate);
  const edges: DiagramEdge[] = [
    { id: 'a', source: 'ecr', target: 'eks', label: '' },
    { id: 'b', source: 'ecr', target: 'ecs', label: '' },
    { id: 'c', source: 'eks', target: 'fargate', label: '' },
    { id: 'd', source: 'ecs', target: 'fargate', label: '' },
  ];
  const fans = fansOf(edges, nodes);
  const route = (id: string) => {
    const edge = edges.find((e) => e.id === id);
    if (!edge) throw Error('Missing edge');
    return routeEdge(edge, nodes, obstaclesOf(nodes), fans).points;
  };
  // ECR's right side is x=90; its stub ends at 114, where both branches turn.
  for (const id of ['a', 'b']) expect(route(id)[2]?.x).toBe(114);
  // Fargate's left side is x=710; both inputs turn into it at 686.
  for (const id of ['c', 'd']) expect(route(id)[3]?.x).toBe(686);
  // A lone connection does not turn at its source.
  const single = routeEdge(edges[0] as DiagramEdge, board(ecr, eks));
  expect(single.points[2]?.x).not.toBe(114);
});
