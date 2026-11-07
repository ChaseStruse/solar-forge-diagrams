import { expect, test } from 'bun:test';
import type { DiagramDocument, DiagramNode } from '../src/domain/document';
import {
  branchName,
  inactiveEdges,
  journeyBranches,
  journeyStarts,
} from '../src/domain/journey';

const node = (id: string, serviceId?: string): DiagramNode => ({
  id,
  kind: 'service',
  label: id,
  x: 0,
  z: 0,
  width: 150,
  depth: 96,
  color: '#ed7100',
  ...(serviceId ? { serviceId } : {}),
});
const doc = (
  nodes: DiagramNode[],
  edges: [string, string][],
): DiagramDocument => ({
  version: 1,
  title: 'Journey',
  nodes,
  edges: edges.map(([source, target], i) => ({
    id: `e${i}`,
    source,
    target,
    label: '',
  })),
});

test('journeys start at the selection, then actors, then sources', () => {
  const graph = doc(
    [node('user', 'actor.user'), node('api'), node('fn'), node('cron')],
    [
      ['user', 'api'],
      ['api', 'fn'],
      ['cron', 'fn'],
    ],
  );
  expect(journeyStarts(graph, 'api')).toEqual(['api']);
  // A selection that leads nowhere falls back to actors.
  expect(journeyStarts(graph, 'fn')).toEqual(['user']);
  const noActors = doc(
    graph.nodes.slice(1),
    graph.edges.slice(1).map((e) => [e.source, e.target]),
  );
  expect(journeyStarts(noActors)).toEqual(['api', 'cron']);
});

test('a pure cycle still has somewhere to start, and an empty board has none', () => {
  expect(
    journeyStarts(
      doc(
        [node('a'), node('b')],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    ),
  ).toEqual(['a']);
  expect(journeyStarts(doc([node('a')], []))).toEqual([]);
});

test('forks walk every branch, decisions ask, and a fixed branch is followed alone', () => {
  const graph = doc(
    [node('ecr'), node('eks'), node('ecs')],
    [
      ['ecr', 'eks'],
      ['ecr', 'ecs'],
    ],
  );
  expect(journeyBranches(graph, 'ecr')).toEqual({
    mode: 'all',
    edges: ['e0', 'e1'],
  });
  const decision = graph.nodes[0];
  if (!decision) throw Error('Missing node');
  decision.shape = 'decision';
  expect(journeyBranches(graph, 'ecr').mode).toBe('ask');
  decision.journey = { mode: 'fixed', edge: 'e1' };
  expect(journeyBranches(graph, 'ecr')).toEqual({
    mode: 'fixed',
    edges: ['e1'],
  });
  // The fixed branch was deleted: fall back to asking.
  graph.edges.pop();
  graph.edges.push({ id: 'e2', source: 'ecr', target: 'ecs', label: '' });
  expect(journeyBranches(graph, 'ecr').mode).toBe('ask');
  // A single way out never needs a decision.
  expect(journeyBranches(graph, 'eks')).toEqual({ mode: 'all', edges: [] });
});

test('an active route switches off the other branches of its fork only', () => {
  const graph = doc(
    [node('ecr'), node('ecs'), node('eks'), node('fargate')],
    [
      ['ecr', 'ecs'],
      ['ecr', 'eks'],
      ['ecs', 'fargate'],
      ['eks', 'fargate'],
    ],
  );
  expect([...inactiveEdges(graph)]).toEqual([]);
  const ecr = graph.nodes[0];
  if (!ecr) throw Error('Missing node');
  ecr.journey = { mode: 'fixed', edge: 'e0' };
  // EKS is only reached through the switched-off branch, so its exit goes quiet.
  expect([...inactiveEdges(graph)].sort()).toEqual(['e1', 'e3']);
  ecr.journey = { mode: 'fixed', edge: 'gone' };
  expect([...inactiveEdges(graph)]).toEqual([]);
});

/** The original fixed-point version of inactiveEdges, kept as a reference. */
function inactiveReference(graph: DiagramDocument): Set<string> {
  const inactive = new Set<string>();
  for (const n of graph.nodes) {
    if (n.journey?.mode !== 'fixed') continue;
    const { mode, edges } = journeyBranches(graph, n.id);
    if (mode !== 'fixed') continue;
    for (const edge of graph.edges)
      if (edge.source === n.id && !edges.includes(edge.id))
        inactive.add(edge.id);
  }
  for (let changed = inactive.size > 0; changed; ) {
    changed = false;
    for (const n of graph.nodes) {
      const incoming = graph.edges.filter((e) => e.target === n.id);
      if (!incoming.length || !incoming.every((e) => inactive.has(e.id)))
        continue;
      for (const edge of graph.edges)
        if (edge.source === n.id && !inactive.has(edge.id)) {
          inactive.add(edge.id);
          changed = true;
        }
    }
  }
  return inactive;
}

test('inactive routes match the reference on random graphs with cycles', () => {
  let seed = 7;
  const random = (limit: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % limit;
  };
  for (let round = 0; round < 300; round++) {
    const count = 2 + random(12);
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
    const pairs: [string, string][] = Array.from(
      { length: random(count * 3) },
      () => [`n${random(count)}`, `n${random(count)}`],
    );
    const graph = doc(nodes, pairs);
    for (const edge of graph.edges)
      if (random(5) === 0) edge.relationship = 'dependency';
    for (const n of graph.nodes)
      if (random(3) === 0) {
        const exits = graph.edges.filter((e) => e.source === n.id);
        const pick = exits[random(exits.length + 1)];
        n.journey = { mode: 'fixed', edge: pick?.id ?? 'gone' };
      }
    expect([...inactiveEdges(graph)].sort()).toEqual(
      [...inactiveReference(graph)].sort(),
    );
  }
});

test('branch names use the connection label, else the destination', () => {
  const board = doc(
    [node('a'), node('b'), node('c')],
    [
      ['a', 'b'],
      ['a', 'c'],
    ],
  );
  const labelled = {
    ...board,
    edges: board.edges.map((e) => (e.id === 'e0' ? { ...e, label: 'Yes' } : e)),
  };
  expect(branchName(labelled, 'e0')).toBe('Yes → b');
  expect(branchName(labelled, 'e1')).toBe('→ c');
  expect(branchName(labelled, 'missing')).toBe('Connection');
});
