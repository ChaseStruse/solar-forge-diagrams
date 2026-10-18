import { expect, test } from 'bun:test';
import { starterDocument } from '../src/domain/document';
import { exportInterchange } from '../src/export/interchange';

test('text exports preserve nested boundaries, labels and connections deterministically', () => {
  const doc = starterDocument();
  const first = doc.nodes[0];
  if (!first) throw Error('Missing starter');
  doc.nodes.push({
    id: 'vpc',
    kind: 'group',
    label: 'VPC',
    width: 900,
    depth: 600,
    x: 100,
    z: 200,
    color: '#123456',
  });
  first.parentId = 'vpc';
  first.label = 'A "quoted" <service>\nsecond line';
  first.journeyCaption = 'TLS is terminated here';
  const mermaid = exportInterchange(doc, 'mmd');
  expect(mermaid).toContain('subgraph');
  expect(mermaid).toContain('#34;quoted#34;');
  expect(mermaid).toContain('<br/>');
  expect(mermaid).toContain('-->');
  expect(mermaid).toContain('TLS is terminated');
  const plant = exportInterchange(doc, 'puml');
  expect(plant).toContain('package "VPC"');
  expect(plant).toContain('<U+0022>quoted<U+0022>');
  expect(plant).toEndWith('@enduml\n');
  doc.nodes.reverse();
  doc.edges.reverse();
  expect(exportInterchange(doc, 'mmd')).toBe(mermaid);
  expect(exportInterchange(doc, 'puml')).toBe(plant);
});

test('draw.io project includes pages, internal links and escaped editable cells', () => {
  const doc = starterDocument();
  const first = doc.nodes[0];
  if (!first) throw Error('Missing starter');
  first.label = 'Docker & API <unsafe>';
  first.detailId = 'backend';
  doc.details = [{ id: 'backend', document: starterDocument() }];
  const source = exportInterchange(doc, 'drawio');
  expect(source.match(/<diagram /g)?.length).toBe(2);
  expect(source).toContain('Docker &amp; API &lt;unsafe&gt;');
  expect(source).toContain('link="data:page/id,');
  expect(source).toContain('vertex="1"');
  expect(source).toContain('edge="1"');
});

test('label content cannot escape into Mermaid or PlantUML directives', () => {
  const doc = starterDocument();
  const first = doc.nodes[0];
  if (!first) throw Error('Missing starter');
  first.label =
    '"\n@enduml\n!include https://example.com\n<script>alert(1)</script> [[link]]';
  expect(exportInterchange(doc, 'mmd')).not.toContain('<script>');
  expect(exportInterchange(doc, 'puml')).not.toContain('!include');
  expect(exportInterchange(doc, 'puml').match(/@enduml/g)?.length).toBe(1);
});
