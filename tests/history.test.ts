import { expect, test } from 'bun:test';
import {
  parseDocument,
  sampleDocument,
  serializeDocument,
  starterDocument,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';

test('a completed drag is one undo step and returning to saved revision clears dirty state', () => {
  const doc = starterDocument();
  const history = new DocumentHistory(doc);
  const node = doc.nodes[0];
  if (!node) throw new Error('Missing fixture');
  const from = { x: node.x, z: node.z };
  node.x += 50; // Renderer previews mutate only the gesture position.
  const to = { x: node.x, z: node.z };
  history.execute({ type: 'move', id: node.id, from, to });
  expect(history.isDirty).toBe(true);
  history.undo();
  expect({ x: node.x, z: node.z }).toEqual(from);
  expect(history.canUndo).toBe(false);
  expect(history.isDirty).toBe(false);
  history.redo();
  expect({ x: node.x, z: node.z }).toEqual(to);
  history.markSaved();
  history.undo();
  expect(history.isDirty).toBe(true);
  history.redo();
  expect(history.isDirty).toBe(false);
});

test('deleting a nested boundary restores graph references and exact document order', () => {
  const doc = sampleDocument();
  const parent = doc.nodes.find((n) => n.kind === 'group');
  if (!parent) throw new Error('Missing group');
  doc.nodes.push({ ...parent, id: 'nested', parentId: parent.id });
  const service = doc.nodes.find((node) => node.kind === 'service');
  if (!service) throw new Error('Missing service');
  doc.nodes.push({ ...service, id: 'nested-service', parentId: 'nested' });
  doc.edges.push({
    id: 'nested-edge',
    source: 'nested-service',
    target: service.id,
    label: 'Nested connection',
  });
  const original = serializeDocument(doc);
  const history = new DocumentHistory(doc);
  history.execute({ type: 'delete', id: parent.id });
  expect(doc.nodes.some((n) => n.parentId === parent.id)).toBe(false);
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
  history.undo();
  expect(serializeDocument(doc)).toBe(original);
  history.redo();
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
});

test('insert, rename, delete, and repeated undo preserve the same node record', () => {
  const doc = starterDocument();
  const template = doc.nodes[0];
  if (!template) throw new Error('Missing fixture');
  const history = new DocumentHistory(doc);
  history.execute({ type: 'insert', node: { ...template, id: 'new' } });
  history.execute({ type: 'rename', id: 'new', label: 'Worker' });
  history.execute({ type: 'delete', id: 'new' });
  history.undo();
  history.undo();
  history.undo();
  expect(doc.nodes.find((n) => n.id === 'new')).toBeUndefined();
  history.redo();
  history.redo();
  expect(doc.nodes.find((n) => n.id === 'new')?.label).toBe('Worker');
  history.undo();
  history.execute({ type: 'rename', id: 'new', label: 'Queue' });
  expect(history.canRedo).toBe(false);
});

test('history limits retained actions and tracks asynchronous save revisions', () => {
  const doc = starterDocument();
  const node = doc.nodes[0];
  if (!node) throw new Error('Missing fixture');
  const history = new DocumentHistory(doc, 2);
  for (const label of ['a', 'b', 'c'])
    history.execute({ type: 'rename', id: node.id, label });
  const savedToken = history.token;
  history.execute({ type: 'rename', id: node.id, label: 'd' });
  history.markSaved(savedToken);
  expect(history.isDirty).toBe(true);
  history.undo();
  expect(history.isDirty).toBe(false);
  history.undo();
  history.undo();
  expect(node.label).toBe('b');
  const tiny = new DocumentHistory(doc, 100, 1);
  tiny.execute({ type: 'rename', id: node.id, label: 'large edit' });
  expect(tiny.canUndo).toBe(false);
  expect(tiny.isDirty).toBe(true);
});
