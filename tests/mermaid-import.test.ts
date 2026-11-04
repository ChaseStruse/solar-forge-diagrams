import { expect, test } from 'bun:test';
import { dataPipelineExample } from '../src/catalog/data-pipeline';
import {
  type DiagramDocument,
  parseDocument,
  serializeDocument,
} from '../src/domain/document';
import { exportInterchange } from '../src/export/interchange';
import { importInfrastructure } from '../src/import/infrastructure';
import {
  importMermaid,
  looksLikeMermaid,
  mermaidText,
} from '../src/import/mermaid';

const byLabel = (doc: DiagramDocument, label: string) => {
  const node = doc.nodes.find((n) => n.label === label);
  if (!node) throw Error(`No node labelled ${label}`);
  return node;
};
const links = (doc: DiagramDocument) =>
  doc.edges.map(
    (e) => `${e.source}>${e.target}${e.label ? `:${e.label}` : ''}`,
  );

test('shapes map to flowchart process, decision and start/end', () => {
  const { document } = importMermaid(`flowchart TD
    A([Start]) --> B[Fill in form]
    B --> C{Valid?}
    C -->|Yes| D((Done))
    C -->|No| B
    E[(Orders DB)]
    F{{Prepare}} ; G>Flag]
    H[/Input/] --- I[\\Output\\]`);
  const shape = (id: string) => document.nodes.find((n) => n.id === id)?.shape;
  expect(shape('A')).toBe('terminal');
  expect(shape('B')).toBe('process');
  expect(shape('C')).toBe('decision');
  expect(shape('D')).toBe('terminal');
  for (const id of ['E', 'F', 'G', 'H', 'I']) expect(shape(id)).toBe('process');
  expect(byLabel(document, 'Valid?').serviceId).toBe('flow.decision');
  expect(byLabel(document, 'Orders DB').id).toBe('E');
});

test('every link form, labels, chains and ampersands', () => {
  const { document } = importMermaid(`graph LR
    a --> b
    b --- c
    c -.-> d
    d ==> e
    e -- sends mail --> f
    f -. maybe .-> g
    g == loud ==> h
    h -->|"piped #quot;label#quot;"| i
    i --> j --> k
    l & m --> n & o
    p-->q`);
  expect(links(document)).toEqual([
    'a>b',
    'b>c',
    'c>d',
    'd>e',
    'e>f:sends mail',
    'f>g:maybe',
    'g>h:loud',
    'h>i:piped "label"',
    'i>j',
    'j>k',
    'l>n',
    'l>o',
    'm>n',
    'm>o',
    'p>q',
  ]);
  const dotted = document.edges.filter((e) => e.relationship === 'dependency');
  expect(dotted.map((e) => `${e.source}>${e.target}`)).toEqual(['c>d', 'f>g']);
});

test('hyphenated and dotted ids stay whole; arrows still split', () => {
  const { document } = importMermaid(`flowchart LR
    api-gateway --> order.service
    x-->y`);
  expect(links(document)).toEqual(['api-gateway>order.service', 'x>y']);
});

test('subgraphs nest as groups and own the nodes declared inside', () => {
  const { document } = importMermaid(`flowchart TB
    subgraph cloud [AWS account]
      subgraph vpc["Private network"]
        api[API] --> db[(Database)]
      end
      queue[Queue]
    end
    user[User] --> api`);
  const cloud = byLabel(document, 'AWS account');
  const vpc = byLabel(document, 'Private network');
  expect(cloud.kind).toBe('group');
  expect(vpc.parentId).toBe('cloud');
  expect(byLabel(document, 'API').parentId).toBe('vpc');
  expect(byLabel(document, 'Queue').parentId).toBe('cloud');
  expect(byLabel(document, 'User').parentId).toBeUndefined();
  // Boundaries grow around what they contain after layout.
  expect(vpc.width).toBeGreaterThan(byLabel(document, 'API').width);
  expect(cloud.width).toBeGreaterThan(vpc.width);
});

test('a node mentioned inside a subgraph moves into it, as in Mermaid', () => {
  const { document } = importMermaid(`flowchart LR
    a --> b
    subgraph box [Box]
      b
      box2[Inner] --> a
    end`);
  expect(document.nodes.find((n) => n.id === 'b')?.parentId).toBe('box');
  expect(document.nodes.find((n) => n.id === 'a')?.parentId).toBe('box');
  // Linking to a subgraph by name connects to the group itself.
  const linked = importMermaid(
    'flowchart LR\n subgraph g [G]\n x\n end\n y --> g',
  );
  expect(links(linked.document)).toEqual(['y>g']);
});

test('top-down charts run downwards, left-right charts run across', () => {
  const chain = (way: string) =>
    importMermaid(`flowchart ${way}\n a --> b --> c`).document;
  const down = chain('TD');
  const [a, b, c] = ['a', 'b', 'c'].map((id) =>
    down.nodes.find((n) => n.id === id),
  );
  expect(a && b && c && a.z < b.z && b.z < c.z && a.x === c.x).toBe(true);
  const right = chain('LR');
  const [ra, rc] = ['a', 'c'].map((id) => right.nodes.find((n) => n.id === id));
  expect(ra && rc && ra.x < rc.x && ra.z === rc.z).toBe(true);
  expect(importMermaid('flowchart RL\n a --> b').warnings[0]).toContain('RL');
});

test('styling, comments and front matter are handled', () => {
  const result = importMermaid(`---
title: Checkout flow
---
flowchart LR
  %% a comment
  A:::hot --> B
  classDef hot fill:#f96
  style A stroke:#333
  click A "https://example.com"
  linkStyle 0 stroke:red`);
  expect(result.document.title).toBe('Checkout flow');
  expect(links(result.document)).toEqual(['A>B']);
  expect(result.warnings.join(' ')).toContain('(click, linkStyle)');
  // The class fill wins: `style` only set A's stroke.
  expect(result.document.nodes.find((n) => n.id === 'A')?.color).toBe(
    '#ff9966',
  );
});

test('text decoding: entities, line breaks and markdown strings', () => {
  expect(mermaidText('"Line one<br/>Line two"')).toBe('Line one\nLine two');
  expect(mermaidText('A #35; B #amp; C #x41;')).toBe('A # B & C A');
  expect(mermaidText('"`**Bold** move`"')).toBe('Bold move');
  expect(mermaidText('Fish &amp; chips')).toBe('Fish & chips');
});

test('other Mermaid diagrams and non-Mermaid text are refused clearly', () => {
  expect(() => importMermaid('sequenceDiagram\n A->>B: hi')).toThrow(
    'sequenceDiagram',
  );
  expect(() => importMermaid('hello world')).toThrow('flowchart');
  expect(() => importMermaid('classDiagram\n A <|-- B')).toThrow(
    'classDiagram',
  );
  expect(() => importMermaid('flowchart LR\n%% nothing')).toThrow('no nodes');
  expect(looksLikeMermaid('%% c\n\ngraph TD\n a-->b')).toBe(true);
  expect(looksLikeMermaid('erDiagram\n A ||--o{ B : has')).toBe(true);
  expect(looksLikeMermaid('services:\n  web: {}')).toBe(false);
});

test('a board exported to Mermaid imports back with the same structure', () => {
  const original = dataPipelineExample();
  original.nodes[0] = {
    ...(original.nodes[0] as (typeof original.nodes)[number]),
    journeyCaption: 'Raw events land here',
  };
  const source = exportInterchange(original, 'mmd');
  const { document } = importMermaid(source);
  expect(document.title).toBe(original.title);
  const strip = (doc: DiagramDocument) =>
    doc.nodes
      .map((n) => [
        n.id,
        n.label,
        n.kind,
        n.parentId ?? '',
        n.journeyCaption ?? '',
      ])
      .sort();
  // Groups without children export as plain boxes; compare the rest.
  const nested = new Set(original.nodes.map((n) => n.parentId));
  const expected = structuredClone(original);
  for (const n of expected.nodes)
    if (n.kind === 'group' && !nested.has(n.id)) n.kind = 'service';
  for (const n of expected.nodes) if (n.kind !== 'group') delete n.shape;
  const imported = structuredClone(document);
  expect(strip(imported)).toEqual(strip(expected));
  const pairs = (doc: DiagramDocument) =>
    doc.edges
      .map(
        (e) =>
          `${e.source}>${e.target}:${e.label}:${e.relationship === 'dependency'}`,
      )
      .sort();
  expect(pairs(document)).toEqual(pairs(original));
});

test('imports are valid documents and reachable through the importer', () => {
  const source = 'flowchart LR\n start([Go]) --> work[Do it] --> stop([Stop])';
  const viaFile = importInfrastructure([{ name: 'flow.mmd', content: source }]);
  const viaPaste = importInfrastructure([
    { name: 'pasted.yaml', content: source },
  ]);
  const viaChoice = importInfrastructure(
    [{ name: 'anything.txt', content: source }],
    'mermaid',
  );
  for (const result of [viaFile, viaPaste, viaChoice]) {
    expect(result.format).toBe('Mermaid flowchart');
    expect(result.document.nodes).toHaveLength(3);
    expect(parseDocument(serializeDocument(result.document))).toEqual(
      result.document,
    );
  }
  expect(() =>
    importInfrastructure([
      { name: 'a.mmd', content: source },
      { name: 'b.mmd', content: source },
    ]),
  ).toThrow('one Mermaid file');
});
