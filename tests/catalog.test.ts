import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { services } from '../src/catalog/services';
import { templates } from '../src/catalog/templates';
import { parseDocument, serializeDocument } from '../src/domain/document';

test('every architecture template has valid graph references and portable metadata', () => {
  for (const template of templates) {
    const doc = template.create();
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  }
});
test('curated catalog IDs are stable and official icon files are present', () => {
  expect(new Set(services.map((service) => service.id)).size).toBe(
    services.length,
  );
  expect(services.filter((s) => s.id.startsWith('aws.')).length).toBe(16);
  for (const service of services.filter((s) => s.asset)) {
    const source = readFileSync(
      new URL(`../assets/${service.asset}`, import.meta.url),
      'utf8',
    );
    expect(source).toContain('<svg');
    expect(source).not.toContain('<script');
  }
});

test('VPC shared services stay inside the VPC and outside both AZs', async () => {
  const { vpcExample } = await import('../src/catalog/networking');
  const { worldPosition } = await import('../src/domain/document');
  for (const demo of [false, true]) {
    const doc = vpcExample(demo);
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    const bounds = (id: string) => {
      const n = nodes.get(id);
      if (!n) throw Error('Missing template node');
      const p = worldPosition(n, nodes);
      return {
        left: p.x - n.width / 2,
        right: p.x + n.width / 2,
        top: p.z - n.depth / 2,
        bottom: p.z + n.depth / 2,
      };
    };
    const vpc = bounds('vpc');
    for (const id of demo ? ['igw', 'routes', 'security'] : ['igw']) {
      const b = bounds(id);
      expect(b.left).toBeGreaterThanOrEqual(vpc.left);
      expect(b.right).toBeLessThanOrEqual(vpc.right);
      expect(b.top).toBeGreaterThanOrEqual(vpc.top);
      expect(b.bottom).toBeLessThanOrEqual(vpc.bottom);
      for (const zone of ['az-a', 'az-b'])
        expect(b.right).toBeLessThan(bounds(zone).left);
    }
  }
});
