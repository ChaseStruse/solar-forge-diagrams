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

test('service captions stay on one line, shrinking to fit the tile', async () => {
  const { serviceCaption } = await import('../src/domain/text');
  const measure = (text: string, size: number) => text.length * size * 0.6;
  const label = 'Public route · 0.0.0.0/0 → IGW';
  const caption = serviceCaption({ label, width: 160, depth: 100 }, measure);
  expect(caption.lines).toEqual([label]);
  expect(measure(label, caption.size)).toBeCloseTo(160 * 0.9);
  // Short labels keep the default size rather than growing.
  expect(
    serviceCaption({ label: 'S3', width: 160, depth: 100 }, measure).size,
  ).toBeCloseTo(160 * 0.13);
  // Explicit line breaks are kept.
  expect(
    serviceCaption({ label: 'Orders\nAPI', width: 160, depth: 100 }, measure)
      .lines,
  ).toEqual(['Orders', 'API']);
});

test('service captions honour a chosen size and opt-in wrapping', async () => {
  const { serviceCaption } = await import('../src/domain/text');
  const measure = (text: string, size: number) => text.length * size * 0.6;
  const label = 'Public route · 0.0.0.0/0 → IGW';
  const sized = serviceCaption(
    { label, width: 160, depth: 100, fontSize: 30 },
    measure,
  );
  expect(sized).toEqual({ size: 30, lines: [label] });
  const wrapped = serviceCaption(
    { label, width: 160, depth: 100, wrap: true },
    measure,
  );
  expect(wrapped.lines.length).toBeGreaterThan(1);
  expect(wrapped.size).toBeGreaterThan(16);
  expect(
    wrapped.lines.every((line) => measure(line, wrapped.size) <= 160 * 0.9),
  ).toBe(true);
  const both = serviceCaption(
    { label, width: 160, depth: 100, wrap: true, fontSize: 30 },
    measure,
  );
  expect(both.size).toBe(30);
  expect(both.lines.length).toBeGreaterThan(1);
});
