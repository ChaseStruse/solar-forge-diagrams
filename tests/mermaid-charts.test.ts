import { expect, test } from 'bun:test';
import {
  type DiagramDocument,
  type DiagramNode,
  type Port,
  parseDocument,
  serializeDocument,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { laneBands, lanesEdit } from '../src/domain/lanes';
import { exportInterchange } from '../src/export/interchange';
import { importInfrastructure } from '../src/import/infrastructure';
import { importMermaid, looksLikeMermaid } from '../src/import/mermaid';
import { cssColor } from '../src/import/mermaid-styles';

const node = (doc: DiagramDocument, id: string) => {
  const found = doc.nodes.find((n) => n.id === id);
  if (!found) throw Error(`No node ${id}`);
  return found;
};
const byLabel = (doc: DiagramDocument, label: string) => {
  const found = doc.nodes.find((n) => n.label === label);
  if (!found) throw Error(`No node labelled ${label}`);
  return found;
};
const links = (doc: DiagramDocument) =>
  doc.edges.map(
    (e) => `${e.source}>${e.target}${e.label ? `:${e.label}` : ''}`,
  );
/** Imports must always be documents the app can save and open. */
const valid = (doc: DiagramDocument) =>
  expect(parseDocument(serializeDocument(doc))).toBeTruthy();

test('CSS colours become board colours', () => {
  expect(cssColor('#F96')).toBe('#ff9966');
  expect(cssColor('#f96a')).toBe('#ff9966');
  expect(cssColor('#12345678')).toBe('#123456');
  expect(cssColor('rgb(255, 0, 128)')).toBe('#ff0080');
  expect(cssColor('rgba(0,0,0,0.5)')).toBe('#000000');
  expect(cssColor(' Teal ')).toBe('#008080');
  expect(cssColor('var(--x)')).toBeUndefined();
});

test('flowchart classes, styles and defaults colour tiles and groups', () => {
  const { document: doc, warnings } = importMermaid(`flowchart LR
  subgraph box[Box]
    A:::hot --> B
  end
  B --> C & D
  classDef hot,warm fill:#f96,stroke:#333
  classDef cool stroke:navy
  classDef default fill:lightgray
  class C cool
  class D missing
  style box fill:#123456
  style C stroke-width:4px
  linkStyle 0 stroke:red`);
  expect(node(doc, 'A').color).toBe('#ff9966');
  // C's class only sets a stroke, so the default fill wins.
  expect(node(doc, 'C').color).toBe('#d3d3d3');
  expect(node(doc, 'B').color).toBe('#d3d3d3');
  expect(node(doc, 'box').color).toBe('#123456');
  const text = warnings.join(' | ');
  expect(text).toContain('(linkStyle)');
  expect(text).toContain('1 style line(s) set no fill or stroke');
  expect(text).toContain('Classes used but never defined: missing');
  valid(doc);
});

test('owner comments and lane subgraphs from an export come back as lanes', () => {
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
  const original: DiagramDocument = {
    version: 1,
    title: 'Checkout',
    nodes: [
      step('cart', 'Customer'),
      step('pay', 'Payments & <Risk>'),
      step('ship'),
    ],
    edges: [
      { id: 'e0', source: 'cart', target: 'pay', label: '' },
      { id: 'e1', source: 'pay', target: 'ship', label: '' },
    ],
  };
  new DocumentHistory(original).execute(
    lanesEdit(original, 'down', 'Show lanes'),
  );
  const { document: doc, warnings } = importMermaid(
    exportInterchange(original, 'mmd'),
  );
  expect(warnings).toEqual([]);
  expect(doc.lanes).toEqual({
    direction: 'down',
    order: ['Customer', 'Payments & <Risk>', ''],
  });
  expect(doc.nodes.map((n) => n.id).sort()).toEqual(['cart', 'pay', 'ship']);
  expect(node(doc, 'pay').owner).toBe('Payments & <Risk>');
  expect(node(doc, 'ship').owner).toBeUndefined();
  expect(node(doc, 'cart').parentId).toBeUndefined();
  expect(laneBands(doc)?.bands.length).toBe(3);
  valid(doc);
});

test('owners without lanes are kept, and the board stays lane-free', () => {
  const { document: doc } = importMermaid(`flowchart LR
  a --> b
  %% Owner a: "Ops"`);
  expect(node(doc, 'a').owner).toBe('Ops');
  expect(doc.lanes).toBeUndefined();
});

test('top-level subgraphs become lanes when asked', () => {
  const source = `flowchart LR
  start([Order]) --> pick
  subgraph Warehouse
    pick[Pick items] --> pack
    subgraph Line two
      pack[Pack box]
    end
  end
  subgraph shop [Storefront team]
    confirm[Confirm]
  end
  pack --> confirm
  start --> Warehouse`;
  const plain = importMermaid(source);
  expect(plain.document.lanes).toBeUndefined();
  expect(byLabel(plain.document, 'Warehouse').kind).toBe('group');
  const { document: doc, warnings } = importMermaid(source, 'x', {
    subgraphLanes: true,
  });
  expect(doc.lanes?.direction).toBe('right');
  expect(doc.lanes?.order).toEqual(['Warehouse', 'Storefront team', '']);
  expect(node(doc, 'pick').owner).toBe('Warehouse');
  expect(node(doc, 'pick').parentId).toBeUndefined();
  // A nested subgraph stays a group, owned by its lane.
  const inner = byLabel(doc, 'Line two');
  expect(inner.kind).toBe('group');
  expect(inner.owner).toBe('Warehouse');
  expect(node(doc, 'pack').parentId).toBe(inner.id);
  expect(node(doc, 'confirm').owner).toBe('Storefront team');
  expect(node(doc, 'start').owner).toBeUndefined();
  expect(doc.nodes.some((n) => n.label === 'Warehouse')).toBe(false);
  expect(warnings.join(' ')).toContain('1 link(s) to a whole lane');
  valid(doc);
  // The option reaches the importer through the infrastructure entry point.
  expect(
    importInfrastructure([{ name: 'a.mmd', content: source }], 'auto', {
      subgraphLanes: true,
    }).document.lanes?.order,
  ).toEqual(['Warehouse', 'Storefront team', '']);
});

test('state diagrams: start and end, labels, choices, composites and notes', () => {
  const source = `---
title: Order states
---
stateDiagram-v2
  direction LR
  [*] --> Draft
  state "Waiting for payment" as Waiting
  Draft --> Waiting : submit
  Waiting --> check
  state check <<choice>>
  check --> Paid : ok
  check --> Draft : declined
  Paid : Money captured
  Paid : Receipt sent
  state Fulfilment {
    [*] --> Packing
    Packing --> Shipped
    --
    [*] --> Invoicing
    Shipped --> [*]
  }
  Paid --> Fulfilment
  Fulfilment --> [*]
  Shipped:::done
  classDef done fill:#58e39b
  note right of Waiting : Times out after a day
  note left of Packing
    Gift wrap
    on request
  end note
  state split <<fork>>
  Paid --> split
  Done <-- split
  hide empty description`;
  expect(looksLikeMermaid(source)).toBe(true);
  const { document: doc, warnings, format } = importMermaid(source);
  expect(format).toBe('Mermaid state diagram');
  expect(doc.title).toBe('Order states');
  const start = node(doc, '[*]start:');
  expect(start.shape).toBe('terminal');
  expect(start.label).toBe('Start');
  expect(node(doc, '[*]end:').label).toBe('End');
  expect(node(doc, 'Waiting').label).toBe('Waiting for payment');
  expect(node(doc, 'check').shape).toBe('decision');
  expect(node(doc, 'Paid').label).toBe('Paid\nMoney captured\nReceipt sent');
  expect(links(doc)).toContain('Draft>Waiting:submit');
  expect(links(doc)).toContain('check>Draft:declined');
  expect(links(doc)).toContain('split>Done');
  // A composite is a group with its own Start and End inside.
  expect(node(doc, 'Fulfilment').kind).toBe('group');
  expect(node(doc, 'Packing').parentId).toBe('Fulfilment');
  expect(node(doc, '[*]start:Fulfilment').parentId).toBe('Fulfilment');
  expect(links(doc)).toContain('Shipped>[*]end:Fulfilment');
  expect(links(doc)).toContain('Fulfilment>[*]end:');
  expect(node(doc, 'Shipped').color).toBe('#58e39b');
  expect(node(doc, 'split').label).toBe('Fork');
  const notes = doc.nodes.filter((n) => n.kind === 'note');
  expect(notes.map((n) => n.label).sort()).toEqual([
    'Gift wrap\non request',
    'Times out after a day',
  ]);
  expect(notes.find((n) => n.label.startsWith('Gift'))?.parentId).toBe(
    'Fulfilment',
  );
  expect(warnings).toEqual([
    'Concurrent regions (--) are shown together in one group',
  ]);
  // LR runs across: the end is to the right of the start.
  expect(node(doc, '[*]end:').x).toBeGreaterThan(start.x);
  valid(doc);
});

test('state diagrams report what they could not read', () => {
  const { warnings } = importMermaid(`stateDiagram
  A --> B
  this is not a state line
  state Open {
    A --> C`);
  expect(warnings).toContain(
    'Skipped unreadable line: this is not a state line',
  );
  expect(warnings).toContain('A composite state was missing its "}"');
});

test('architecture diagrams: groups, icons, junctions and sides', () => {
  const source = `architecture-beta
  group cloud(cloud)[Cloud]
  group api(logos:aws-vpc)[API tier] in cloud
  service users(internet)[Users]
  service fn(logos:aws-lambda)[Order function] in api
  service db(database)[Orders DB] in cloud
  service box(logos:docker-icon)[Worker] in cloud
  service odd(logos:not-a-real-thing)[Mystery]
  junction hub in cloud
  users:R --> L:fn
  fn:R -[writes]- L:db
  db:B <-- T:hub
  hub:L <--> R:box
  fn{group}:B --> T:odd
  ghost:R --> L:db`;
  const { document: doc, warnings, format } = importMermaid(source);
  expect(format).toBe('Mermaid architecture diagram');
  expect(node(doc, 'cloud').kind).toBe('group');
  expect(node(doc, 'api').parentId).toBe('cloud');
  expect(node(doc, 'fn').serviceId).toBe('aws.lambda');
  expect(node(doc, 'fn').parentId).toBe('api');
  expect(node(doc, 'users').serviceId).toBe('actor.internet');
  expect(node(doc, 'box').serviceId).toBe('component.docker');
  expect(node(doc, 'db').serviceId).toBe('flow.process');
  expect(node(doc, 'hub').width).toBe(40);
  expect(node(doc, 'hub').label).toBe('');
  expect(links(doc)).toEqual([
    'users>fn',
    'fn>db:writes',
    'hub>db',
    'hub>box',
    'box>hub',
    'api>odd',
  ]);
  // users sits left of fn, so the named sides are kept.
  const first = doc.edges[0];
  expect(first?.sourcePort).toBe('east');
  expect(first?.targetPort).toBe('west');
  expect(node(doc, 'fn').x).toBeGreaterThan(node(doc, 'users').x);
  // Kept sides always face each other.
  const opposite: Record<Port, Port> = {
    east: 'west',
    west: 'east',
    north: 'south',
    south: 'north',
  };
  for (const edge of doc.edges)
    if (edge.sourcePort)
      expect(edge.targetPort).toBe(opposite[edge.sourcePort]);
  const text = warnings.join(' | ');
  expect(text).toContain('1 link(s) name a service');
  expect(text).toContain('Links without arrowheads');
  expect(text).toContain('no matching icon): logos:not-a-real-thing');
  valid(doc);
});
