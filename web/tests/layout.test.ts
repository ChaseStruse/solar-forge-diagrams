import { expect, test } from 'bun:test';
import { vpcExample } from '../src/catalog/networking';
import { worldPosition } from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { layoutDocument, layoutEdit } from '../src/domain/layout';

test('layered layout packs nested boundaries without overlaps and is deterministic', () => {
  const doc = vpcExample(true),
    result = layoutDocument(doc);
  const nodes = new Map(result.nodes.map((n) => [n.id, n]));
  for (const n of result.nodes) {
    if (n.parentId) {
      const p = nodes.get(n.parentId);
      if (!p) throw Error('Missing parent');
      expect(Math.abs(n.x) + n.width / 2).toBeLessThanOrEqual(p.width / 2);
      expect(Math.abs(n.z) + n.depth / 2).toBeLessThanOrEqual(p.depth / 2);
    }
    for (const b of result.nodes)
      if (n.id < b.id && n.parentId === b.parentId)
        expect(
          Math.abs(n.x - b.x) >= (n.width + b.width) / 2 + 60 ||
            Math.abs(n.z - b.z) >= (n.depth + b.depth) / 2 + 60,
        ).toBe(true);
    expect(Number.isFinite(worldPosition(n, nodes).x)).toBe(true);
  }
  expect(layoutDocument(result)).toEqual(result);
  const history = new DocumentHistory(doc),
    before = structuredClone(doc);
  history.execute(layoutEdit(doc));
  history.undo();
  expect(doc).toEqual(before);
  history.redo();
  expect(doc).toEqual(result);
});
test('layered layout tolerates cycles, empty groups and empty boards', () => {
  const doc = vpcExample();
  doc.edges.push({ id: 'cycle', source: 'db-a', target: 'user', label: '' });
  expect(layoutDocument(doc).nodes.length).toBe(doc.nodes.length);
  expect(
    layoutDocument({ version: 1, title: '', nodes: [], edges: [] }).nodes,
  ).toEqual([]);
});
