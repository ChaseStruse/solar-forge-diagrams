import { expect, test } from 'bun:test';
import { flowLayers, flowPositions } from '../src/domain/flow-layout';
import { layoutDocument } from '../src/domain/layout';
import { importMermaid } from '../src/import/mermaid';

const graph = (pairs: [string, string][]) => {
  const links = new Map<string, Set<string>>();
  const ids = new Set<string>();
  for (const [a, b] of pairs) {
    ids.add(a);
    ids.add(b);
    links.set(a, new Set([...(links.get(a) ?? []), b]));
  }
  return { ids: [...ids], links };
};
const real = (layers: { id: string; virtual: boolean }[][]) =>
  layers.map((layer) => layer.filter((s) => !s.virtual).map((s) => s.id));

test('steps are ranked after their furthest predecessor', () => {
  const { ids, links } = graph([
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'c'],
  ]);
  expect(real(flowLayers(ids, links).layers)).toEqual([['a'], ['b'], ['c']]);
});

test('a link that skips a layer gets a lane there', () => {
  const { ids, links } = graph([
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'c'],
  ]);
  const { layers } = flowLayers(ids, links);
  expect(layers[1]?.filter((s) => s.virtual)).toHaveLength(1);
});

test('a loop back does not collapse the cycle into one layer', () => {
  // pay -> check -> retry -> pay, entered from outside at pay.
  const { ids, links } = graph([
    ['pay', 'check'],
    ['check', 'retry'],
    ['retry', 'pay'],
  ]);
  const { layers } = flowLayers(ids, links, new Set(['pay']));
  expect(real(layers)).toEqual([['pay'], ['check'], ['retry']]);
});

test('placement keeps order and spacing, and long links straight', () => {
  const { ids, links } = graph([
    ['top', 'side'],
    ['side', 'bottom'],
    ['top', 'bottom'],
  ]);
  const flow = flowLayers(ids, links);
  const at = flowPositions(flow, (s) => (s.virtual ? 60 : 200), 120);
  for (const layer of flow.layers)
    for (let i = 1; i < layer.length; i++) {
      const a = layer[i - 1],
        b = layer[i];
      if (!a || !b) continue;
      const need = ((a.virtual ? 60 : 200) + (b.virtual ? 60 : 200)) / 2 + 120;
      expect((at.get(b.id) ?? 0) - (at.get(a.id) ?? 0)).toBeGreaterThanOrEqual(
        need - 1e-9,
      );
    }
  // The skipping link runs straight: top, its lane and bottom line up.
  const lane = flow.layers[1]?.find((s) => s.virtual);
  expect(at.get('top')).toBe(at.get(lane?.id ?? ''));
  expect(at.get('bottom')).toBe(at.get('top'));
  expect(at.get('side')).not.toBe(at.get('top'));
});

test('flow layout is deterministic and keeps nested groups around members', () => {
  const { document } = importMermaid(`flowchart TD
    a --> b
    subgraph g [Group]
      b --> c --> d
      d --> b
    end
    d --> e
    a --> e`);
  expect(layoutDocument(document, 'down', 'flow')).toEqual(
    layoutDocument(document, 'down', 'flow'),
  );
  const group = document.nodes.find((n) => n.id === 'g');
  for (const n of document.nodes.filter((n) => n.parentId === 'g')) {
    expect(Math.abs(n.x) + n.width / 2).toBeLessThanOrEqual(
      (group?.width ?? 0) / 2,
    );
    expect(Math.abs(n.z) + n.depth / 2).toBeLessThanOrEqual(
      (group?.depth ?? 0) / 2,
    );
  }
  // Siblings never overlap.
  const top = document.nodes.filter((n) => !n.parentId);
  for (const a of top)
    for (const b of top)
      if (a.id < b.id)
        expect(
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
            Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2,
        ).toBe(true);
});
