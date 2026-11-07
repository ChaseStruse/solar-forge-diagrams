import { expect, test } from 'bun:test';
import {
  type DiagramDocument,
  type DiagramNode,
  parseDocument,
  serializeDocument,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import {
  arrangeEdit,
  laneAt,
  laneBands,
  laneLayout,
  lanesEdit,
} from '../src/domain/lanes';

const step = (id: string, owner?: string): DiagramNode => ({
  id,
  kind: 'service',
  shape: 'process',
  serviceId: 'flow.process',
  label: id,
  x: 0,
  z: 0,
  width: 160,
  depth: 100,
  color: '#d9b677',
  ...(owner ? { owner } : {}),
});
const board = (): DiagramDocument => ({
  version: 1,
  title: 'Checkout',
  nodes: [
    step('cart', 'Customer'),
    step('check', 'Storefront'),
    step('pay', 'Customer'),
    step('charge', 'Payments'),
    step('ship'),
  ],
  edges: [
    ['cart', 'check'],
    ['check', 'pay'],
    ['pay', 'charge'],
    ['charge', 'ship'],
  ].map(([source, target], i) => ({
    id: `e${i}`,
    source: source as string,
    target: target as string,
    label: '',
    bend: 40,
  })),
});
const apply = (doc: DiagramDocument, direction: 'right' | 'down' = 'right') => {
  const history = new DocumentHistory(doc);
  history.execute(lanesEdit(doc, direction, 'Show lanes'));
  return history;
};
const at = (doc: DiagramDocument, id: string) => {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) throw Error(`No ${id}`);
  return node;
};

test('steps line up along the flow and sit in their owner lane', () => {
  const doc = board();
  apply(doc);
  const xs = ['cart', 'check', 'pay', 'charge', 'ship'].map(
    (id) => at(doc, id).x,
  );
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  // Same owner, same lane; different owners, different lanes.
  expect(at(doc, 'cart').z).toBe(at(doc, 'pay').z);
  expect(at(doc, 'check').z).not.toBe(at(doc, 'cart').z);
  // Lanes in the order the flow reaches them; Unassigned last.
  expect(doc.lanes).toEqual({
    direction: 'right',
    order: ['Customer', 'Storefront', 'Payments', ''],
  });
  expect(at(doc, 'cart').z).toBeLessThan(at(doc, 'check').z);
  expect(at(doc, 'ship').z).toBeGreaterThan(at(doc, 'charge').z);
  // Old manual bends are dropped.
  expect(doc.edges.every((e) => e.bend === undefined)).toBe(true);
});

test('columns flow downwards with lanes side by side', () => {
  const doc = board();
  apply(doc, 'down');
  expect(at(doc, 'cart').z).toBeLessThan(at(doc, 'check').z);
  expect(at(doc, 'cart').x).toBe(at(doc, 'pay').x);
  expect(at(doc, 'cart').x).toBeLessThan(at(doc, 'check').x);
});

test('bands cover their steps without overlapping and find drop lanes', () => {
  const doc = board();
  apply(doc);
  const bands = laneBands(doc);
  if (!bands) throw Error('No bands');
  expect(bands.bands.map((b) => b.owner)).toEqual([
    'Customer',
    'Storefront',
    'Payments',
    '',
  ]);
  for (let i = 1; i < bands.bands.length; i++)
    expect(bands.bands[i]?.start).toBe(bands.bands[i - 1]?.end ?? Number.NaN);
  for (const n of doc.nodes) {
    expect(laneAt(bands, n)).toBe(n.owner ?? '');
    expect(n.x - n.width / 2).toBeGreaterThan(bands.from);
  }
  expect(laneAt(bands, { x: 0, z: 1e6 })).toBeUndefined();
});

test('one undo restores positions and turns lanes off', () => {
  const doc = board();
  const before = structuredClone(doc);
  const history = apply(doc);
  history.undo();
  expect(doc).toEqual(before);
  history.redo();
  expect(doc.lanes?.direction).toBe('right');
  history.execute({ type: 'graph', label: 'Hide lanes', lanes: null });
  expect(doc.lanes).toBeUndefined();
  expect(laneBands(doc)).toBeUndefined();
});

test('lane order is kept when owners change and new owners join the end', () => {
  const doc = board();
  apply(doc);
  doc.lanes = {
    direction: 'right',
    order: ['Payments', 'Customer', 'Storefront', ''],
  };
  const next = structuredClone(doc);
  at(next, 'ship').owner = 'Warehouse';
  expect(laneLayout(next, 'right').order).toEqual([
    'Payments',
    'Customer',
    'Storefront',
    'Warehouse',
  ]);
});

test('arrange uses lanes only when the board shows them', () => {
  const doc = board();
  const plain = arrangeEdit(doc);
  expect(plain.type === 'graph' && plain.label).toBe('Automatic layout');
  apply(doc);
  const laned = arrangeEdit(doc);
  expect(laned.type === 'graph' && laned.lanes?.direction).toBe('right');
});

test('owners and lanes survive saving; bad values are refused', () => {
  const doc = board();
  apply(doc);
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  const json = (patch: object) => JSON.stringify({ ...doc, ...patch });
  expect(() =>
    parseDocument(json({ lanes: { direction: 'up', order: [] } })),
  ).toThrow();
  expect(() =>
    parseDocument(json({ lanes: { direction: 'right', order: ['a', 'a'] } })),
  ).toThrow();
  const long = {
    ...doc,
    edges: [],
    nodes: [{ ...step('x'), owner: 'x'.repeat(101) }],
  };
  expect(() => parseDocument(JSON.stringify(long))).toThrow();
  const blank = { ...doc, edges: [], nodes: [{ ...step('x'), owner: '   ' }] };
  expect(parseDocument(JSON.stringify(blank)).nodes[0]?.owner).toBeUndefined();
});

test('text and sticky notes stay put and are not given a lane', () => {
  const doc = board();
  doc.nodes.push({
    ...step('memo'),
    kind: 'note',
    serviceId: 'note.sticky',
    x: 5000,
    z: 5000,
  });
  apply(doc);
  expect(at(doc, 'memo')).toMatchObject({ x: 5000, z: 5000 });
  expect(laneBands(doc)?.bands.map((b) => b.owner)).toEqual([
    'Customer',
    'Storefront',
    'Payments',
    '',
  ]);
});
