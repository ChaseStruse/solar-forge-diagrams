import { expect, test } from 'bun:test';
import { escapeXml } from '../src/export/xml';

test('XML escaping covers markup and drops characters XML forbids', () => {
  expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
  );
  // Tab, newline and carriage return are allowed; other C0 controls break parsers.
  expect(escapeXml('a\u0000b\u0007c\td\ne\rf\u001fg')).toBe('abc\td\ne\rfg');
  expect(escapeXml('Ünïcødé · 日本')).toBe('Ünïcødé · 日本');
});
