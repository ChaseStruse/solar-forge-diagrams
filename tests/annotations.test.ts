import { expect, test } from 'bun:test';
import {
  type DiagramDocument,
  parseDocument,
  serializeDocument,
} from '../src/domain/document';
import { fontSize, wrapText } from '../src/domain/text';

const measure = (text: string) => text.length * 10;

test('wrapping keeps words whole, honours newlines and splits long words', () => {
  expect(wrapText('one two three four', 100, measure)).toEqual([
    'one two',
    'three four',
  ]);
  expect(wrapText('a\nb', 100, measure)).toEqual(['a', 'b']);
  expect(wrapText('abcdefghijkl', 50, measure)).toEqual([
    'abcde',
    'fghij',
    'kl',
  ]);
});

test('text and sticky notes roundtrip with their font size', () => {
  const doc: DiagramDocument = {
    version: 1,
    title: 'Notes',
    nodes: [
      {
        id: 'heading',
        kind: 'text',
        label: 'Checkout\nflow',
        x: 0,
        z: 0,
        width: 280,
        depth: 60,
        color: '#ffffff',
        fontSize: 40,
      },
      {
        id: 'memo',
        kind: 'note',
        label: 'Idempotency keys',
        x: 300,
        z: 0,
        width: 220,
        depth: 170,
        color: '#ffd84d',
      },
    ],
    edges: [],
  };
  const roundtrip = parseDocument(serializeDocument(doc));
  expect(roundtrip).toEqual(doc);
  const memo = roundtrip.nodes[1];
  if (!memo) throw Error('Missing note');
  expect(fontSize(memo)).toBe(18);
  const invalid = structuredClone(doc);
  (invalid.nodes[0] as { fontSize: number }).fontSize = 9000;
  expect(() => parseDocument(serializeDocument(invalid))).toThrow();
});
