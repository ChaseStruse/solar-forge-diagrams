import { expect, test } from 'bun:test';
import {
  exampleCategories,
  findExamples,
} from '../src/catalog/example-library';
import { privateWorkerExample } from '../src/catalog/more-examples';
import { templates } from '../src/catalog/templates';
import { checkReachability } from '../src/domain/reachability';

test('every example is discoverable in a subcategory with at least two distinct examples', () => {
  expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  const listed = new Set<string>();
  for (const category of exampleCategories) {
    for (const subcategory of category.subcategories) {
      const examples = findExamples('', category.name, subcategory);
      expect(examples.length).toBeGreaterThanOrEqual(2);
      expect(
        new Set(examples.map((t) => JSON.stringify(t.create()))).size,
      ).toBe(examples.length);
      for (const example of examples) {
        expect(example.description.length).toBeGreaterThan(30);
        listed.add(example.id);
      }
    }
  }
  expect(listed.size).toBe(templates.length);
});

test('example search matches names, descriptions and taxonomy with combined terms', () => {
  expect(
    findExamples('AWS security')
      .map((t) => t.id)
      .sort(),
  ).toEqual(['private-worker', 'security-demo']);
  expect(findExamples('  IAM  ', 'AWS', 'Security').map((t) => t.id)).toEqual([
    'security-demo',
  ]);
  expect(findExamples('APP', 'Kubernetes', 'Applications').length).toBe(2);
  expect(findExamples('nothing matches this')).toEqual([]);
});

test('private worker examples enforce outbound-only HTTPS and trace the NAT route', () => {
  const doc = privateWorkerExample();
  for (const scenario of doc.scenarios ?? []) {
    if (!scenario.sourceId || !scenario.targetId)
      throw Error('Missing endpoints');
    const result = checkReachability(
      doc,
      scenario.sourceId,
      scenario.targetId,
      scenario.traffic,
    );
    expect(result.status).toBe(
      scenario.id === 'worker-https' ? 'allowed' : 'denied',
    );
    if (scenario.id === 'worker-https')
      expect(result.path).toEqual(['worker', 'nat', 'igw', 'external']);
  }
});
