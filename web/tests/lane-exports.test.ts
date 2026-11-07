import { expect, test } from 'bun:test';
import type { DiagramDocument, DiagramNode } from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { laneBands, lanesEdit } from '../src/domain/lanes';
import { exportInterchange } from '../src/export/interchange';
import { laneSvg } from '../src/export/svg';

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
const board = (direction?: 'right' | 'down'): DiagramDocument => {
  const doc: DiagramDocument = {
    version: 1,
    title: 'Checkout',
    nodes: [
      step('cart', 'Customer'),
      step('pay', 'Payments & <Risk>'),
      step('ship'),
      {
        id: 'memo',
        kind: 'note',
        label: 'Not a step',
        x: 900,
        z: 900,
        width: 200,
        depth: 120,
        color: '#ffe98a',
      },
    ],
    edges: [
      { id: 'e0', source: 'cart', target: 'pay', label: '' },
      { id: 'e1', source: 'pay', target: 'ship', label: '' },
    ],
  };
  if (direction)
    new DocumentHistory(doc).execute(lanesEdit(doc, direction, 'Show lanes'));
  return doc;
};
const measure = (text: string, size: number) => text.length * size * 0.55;

test('Mermaid wraps each lane in a subgraph that records its owner', () => {
  const source = exportInterchange(board('right'), 'mmd');
  expect(source.split('\n')[0]).toBe('flowchart LR');
  expect(source.match(/^ {2}subgraph lane\d/gm)?.length).toBe(3);
  expect(source).toContain('%% Lane lane0: "Customer"');
  expect(source).toContain('%% Lane lane2: ""');
  expect(source).toContain('subgraph lane2["Unassigned"]');
  // Owner text is escaped like any label, and kept verbatim in the comment.
  expect(source).toContain('Payments #38; #60;Risk#62;');
  expect(source).toContain('%% Lane lane1: "Payments & <Risk>"');
  // Steps sit inside their lane; the note stays outside every lane.
  const lines = source.split('\n');
  const lane0 = lines.indexOf('  subgraph lane0["Customer"]');
  const end0 = lines.indexOf('  end', lane0);
  expect(lines.slice(lane0, end0).some((l) => l.includes('["cart"]'))).toBe(
    true,
  );
  const memo = lines.findIndex((l) => l.includes('Not a step'));
  expect(lines[memo]?.startsWith('  n')).toBe(true);
  expect(exportInterchange(board('down'), 'mmd').split('\n')[0]).toBe(
    'flowchart TB',
  );
});

test('boards without lanes export as before, keeping owners as comments', () => {
  const source = exportInterchange(board(), 'mmd');
  expect(source).not.toContain('lane0');
  expect(source).toContain('%% Owner');
  expect(source).toContain('"Customer"');
});

test('PlantUML draws lanes as rectangles around their steps', () => {
  const source = exportInterchange(board('right'), 'puml');
  expect(source).toContain('rectangle "Customer" <<lane>> as lane0 {');
  expect(source).toContain('\' Lane lane2: ""');
  expect(source).toContain('left to right direction');
  expect(exportInterchange(board('down'), 'puml')).not.toContain(
    'left to right direction',
  );
});

test('draw.io lanes are swimlane containers holding their steps', () => {
  const doc = board('right');
  const source = exportInterchange(doc, 'drawio');
  const lanes = source.match(/<mxCell id="lane\d"[^>]*>/g) ?? [];
  expect(lanes.length).toBe(3);
  expect(lanes[0]).toContain('swimlane;horizontal=0;');
  expect(source).toContain('value="Payments &amp; &lt;Risk&gt;"');
  // Steps are parented to their lane, at positions relative to it.
  const bands = laneBands(doc);
  const customer = bands?.bands.find((b) => b.owner === 'Customer');
  const cart = doc.nodes.find((n) => n.id === 'cart');
  if (!bands || !customer || !cart) throw Error('Missing lane');
  const cell =
    /<mxCell id="n63617274"[^>]*parent="(\w+)"><mxGeometry x="([-\d.]+)" y="([-\d.]+)"/.exec(
      source,
    );
  expect(cell?.[1]).toBe('lane0');
  expect(Number(cell?.[2])).toBe(cart.x - cart.width / 2 - bands.from);
  expect(Number(cell?.[3])).toBe(cart.z - cart.depth / 2 - customer.start);
  // The note isn't in a lane.
  expect(source).toMatch(/value="Not a step"[^>]*parent="1"/);
  expect(
    exportInterchange(board('down'), 'drawio').match(/horizontal=1;/g)?.length,
  ).toBe(3);
});

test('SVG lanes cover their steps and name each owner', () => {
  const doc = board('right');
  const { markup, xs, zs } = laneSvg(doc, measure);
  expect(markup.match(/<title>/g)?.length).toBe(3);
  expect(markup).toContain('<title>Unassigned</title>');
  expect(markup).toContain('Payments &amp; &lt;Risk&gt;');
  expect(markup).not.toContain('<Risk>');
  for (const node of doc.nodes.filter((n) => n.kind === 'service')) {
    expect(node.x - node.width / 2).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(node.x + node.width / 2).toBeLessThanOrEqual(Math.max(...xs));
    expect(node.z - node.depth / 2).toBeGreaterThanOrEqual(Math.min(...zs));
    expect(node.z + node.depth / 2).toBeLessThanOrEqual(Math.max(...zs));
  }
  expect(laneSvg(board(), measure).markup).toBe('');
});
