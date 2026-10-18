import { expect, test } from 'bun:test';
import {
  parseDocument,
  serializeDocument,
  starterDocument,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { defaultScenarios } from '../src/domain/scenarios';

test('saved scenarios, hop captions, and linked boards round trip', () => {
  const root = starterDocument();
  const node = root.nodes[0];
  if (!node) throw Error('Missing starter');
  node.detailId = 'backend';
  node.journeyCaption = 'Accept TLS, then authenticate';
  root.scenarios = structuredClone(defaultScenarios);
  root.details = [{ id: 'backend', document: starterDocument() }];
  expect(parseDocument(serializeDocument(root))).toEqual(root);
  root.details = [];
  expect(() => parseDocument(serializeDocument(root))).toThrow(
    'Missing detail',
  );
});

test('one history preserves board identity across navigation and undo', () => {
  const root = starterDocument();
  const detail = starterDocument();
  const history = new DocumentHistory(root);
  history.execute({ type: 'detail', root, id: 'child', board: detail });
  history.document = detail;
  history.execute({
    type: 'rename',
    id: detail.nodes[0]?.id ?? '',
    label: 'Inside',
  });
  history.document = root;
  history.execute({
    type: 'scenarios',
    scenarios: structuredClone(defaultScenarios),
  });
  history.undo();
  expect(root.scenarios).toBeUndefined();
  history.undo();
  expect(history.document).toBe(detail);
  expect(detail.nodes[0]?.label).not.toBe('Inside');
  history.redo();
  expect(root.details?.[0]?.document.nodes[0]?.label).toBe('Inside');
  history.undo();
  history.undo();
  expect(root.details).toEqual([]);
  history.redo();
  expect(root.details?.[0]?.document).toBe(detail);
});

test('malformed and unbounded scenario/detail data is rejected', () => {
  const root = starterDocument();
  const scenario = defaultScenarios[0];
  if (!scenario) throw Error('Missing default');
  root.scenarios = [{ ...scenario, traffic: { ...scenario.traffic, port: 0 } }];
  expect(() => parseDocument(serializeDocument(root))).toThrow();
  delete root.scenarios;
  root.details = [
    { id: 'child', document: { ...starterDocument(), details: [] } },
  ];
  expect(() => parseDocument(serializeDocument(root))).toThrow('flat');
});
