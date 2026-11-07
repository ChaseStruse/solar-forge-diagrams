import { expect, test } from 'bun:test';
import { securityDemo } from '../src/catalog/security';
import { journeyBranches } from '../src/domain/journey';
import { checkReachability } from '../src/domain/reachability';

test('security demo scenarios distinguish permitted hops from blocked bypasses', () => {
  const doc = securityDemo();
  expect(doc.scenarios?.length).toBe(6);
  for (const scenario of doc.scenarios ?? []) {
    if (!scenario.sourceId || !scenario.targetId)
      throw Error('Missing scenario endpoints');
    const result = checkReachability(
      doc,
      scenario.sourceId,
      scenario.targetId,
      scenario.traffic,
    );
    expect(result.status).toBe(
      scenario.id.startsWith('https') ||
        ['elb-app', 'app-db'].includes(scenario.id)
        ? 'allowed'
        : 'denied',
    );
  }
});

test('security demo evaluates attached rules and keeps IAM out of network journeys', () => {
  const doc = securityDemo();
  const scenario = doc.scenarios?.find((s) => s.id === 'app-db');
  const dbGroup = doc.nodes.find((n) => n.id === 'db-sg')?.policy;
  if (!scenario || dbGroup?.kind !== 'security-group')
    throw Error('Missing database example');
  dbGroup.rules = [];
  expect(
    checkReachability(doc, 'app', 'database', scenario.traffic).status,
  ).toBe('denied');
  expect(journeyBranches(doc, 'operators').edges).toEqual([]);
  expect(journeyBranches(doc, 'app-role').edges).toEqual([]);
  expect(journeyBranches(doc, 'app').edges).toEqual(['app-database']);
});
