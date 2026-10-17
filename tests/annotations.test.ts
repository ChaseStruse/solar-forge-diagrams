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

test('auto fit preserves all text inside narrow and short boxes', async () => {
  const { fitText, resizedFont } = await import('../src/domain/text');
  const text = 'A long label\nwith unbreakablewords and many more lines';
  const result = fitText(
    text,
    60,
    25,
    40,
    (line, size) => line.length * size * 0.6,
  );
  expect(result.size).toBeLessThan(40);
  expect(result.lines.length * result.size * 1.28).toBeLessThanOrEqual(25);
  expect(
    result.lines.every((line) => line.length * result.size * 0.6 <= 60),
  ).toBe(true);
  expect(result.lines.join('').replace(/\s/g, '')).toBe(
    text.replace(/\s/g, ''),
  );
  const node = {
    kind: 'text',
    fontSize: 20,
  } as import('../src/domain/document').DiagramNode;
  expect(
    resizedFont(node, { width: 100, depth: 60 }, { width: 200, depth: 120 }),
  ).toBe(40);
});

test('service captions wrap long labels without flattening the font', async () => {
  const { serviceCaption } = await import('../src/domain/text');
  const caption = serviceCaption(
    { label: 'Public route · 0.0.0.0/0 → IGW', width: 160, depth: 100 },
    (text, size) => text.length * size * 0.6,
  );
  expect(caption.lines.length).toBeGreaterThan(1);
  expect(caption.size).toBeGreaterThan(16);
  expect(
    caption.lines.every(
      (line) => line.length * caption.size * 0.6 <= 160 * 0.82,
    ),
  ).toBe(true);
  expect(caption.lines.length * caption.size * 1.28).toBeLessThanOrEqual(75);
});
