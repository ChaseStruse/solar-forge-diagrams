import { expect, test } from 'bun:test';
import {
  parseDocument,
  sampleDocument,
  serializeDocument,
  worldPosition,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { routeEdge } from '../src/domain/routing';
import {
  copyFragment,
  deleteNodes,
  groupNodes,
  pasteFragment,
  ungroupNodes,
} from '../src/editor/operations';

test('grouping across parents and ungrouping preserve world positions with undo', () => {
  const doc = sampleDocument();
  const history = new DocumentHistory(doc);
  const selected = new Set(
    doc.nodes
      .filter((n) => n.kind === 'service')
      .slice(0, 2)
      .map((n) => n.id),
  );
  const position = () => {
    const index = new Map(doc.nodes.map((n) => [n.id, n]));
    return doc.nodes
      .filter((n) => selected.has(n.id))
      .map((n) => ({
        id: n.id,
        x: worldPosition(n, index).x,
        z: worldPosition(n, index).z,
      }));
  };
  const original = serializeDocument(doc);
  const positions = position();
  history.execute(groupNodes(doc, selected, 'new-group'));
  expect(position()).toEqual(positions);
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
  history.execute(ungroupNodes(doc, new Set(['new-group'])));
  expect(position()).toEqual(positions);
  history.undo();
  history.undo();
  expect(serializeDocument(doc)).toBe(original);
  history.redo();
  history.redo();
  expect(position()).toEqual(positions);
});

test('clipboard remaps nested IDs and only internal connections; delete restores graph', () => {
  const doc = sampleDocument();
  const group = doc.nodes.find((n) => n.kind === 'group');
  if (!group) throw Error('Missing fixture');
  const original = serializeDocument(doc);
  const fragment = copyFragment(doc, new Set([group.id]));
  expect(() => parseDocument(serializeDocument(fragment))).not.toThrow();
  let sequence = 0;
  const edit = pasteFragment(fragment, () => `pasted-${sequence++}`);
  const history = new DocumentHistory(doc);
  history.execute(edit);
  expect(doc.nodes.length).toBe(
    parseDocument(original).nodes.length + fragment.nodes.length,
  );
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
  history.undo();
  expect(serializeDocument(doc)).toBe(original);
  history.execute(deleteNodes(doc, new Set([group.id])));
  history.undo();
  expect(serializeDocument(doc)).toBe(original);
  expect(history.canRedo).toBe(true);
});

test('graph edits retain object identity across prior rename undo', () => {
  const doc = sampleDocument();
  const node = doc.nodes[0];
  if (!node) throw Error('Missing fixture');
  const label = node.label;
  const history = new DocumentHistory(doc);
  history.execute({ type: 'rename', id: node.id, label: 'Renamed' });
  history.execute({
    type: 'graph',
    label: 'Resize',
    nodes: [{ id: node.id, value: { ...node, width: 900 } }],
  });
  history.undo();
  history.undo();
  expect(doc.nodes[0]).toBe(node);
  expect(node.label).toBe(label);
});

test('named ports and routing survive serialization and resolve endpoints', () => {
  const doc = sampleDocument();
  const edge = doc.edges[0];
  if (!edge) throw Error('Missing fixture');
  edge.sourcePort = 'north';
  edge.targetPort = 'south';
  edge.routing = 'vertical';
  edge.bend = 40;
  const roundtrip = parseDocument(serializeDocument(doc));
  expect(roundtrip.edges[0]).toEqual(edge);
  const route = routeEdge(edge, new Map(doc.nodes.map((n) => [n.id, n])));
  expect(route.sourcePort).toBe('north');
  expect(route.targetPort).toBe('south');
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    if (!a || !b) throw Error('Missing route');
    expect(a.x === b.x || a.z === b.z).toBe(true);
  }
});
