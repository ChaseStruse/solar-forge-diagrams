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
  expect(services.filter((s) => s.id.startsWith('aws.')).length).toBe(14);
  for (const service of services.filter((s) => s.asset)) {
    const source = readFileSync(
      new URL(`../assets/aws/${service.asset}`, import.meta.url),
      'utf8',
    );
    expect(source).toContain('<svg');
    expect(source).not.toContain('<script');
  }
});
