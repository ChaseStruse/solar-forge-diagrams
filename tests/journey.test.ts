import { expect, test } from 'bun:test';
import type { DiagramDocument, DiagramNode } from '../src/domain/document';
import { journeyStarts } from '../src/domain/journey';

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
