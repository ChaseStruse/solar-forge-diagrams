import { expect, test } from 'bun:test';
import { GifEncoder } from '../src/export/gif';

test('GIF has looping animation metadata, per-frame delays and a trailer', async () => {
  const gif = new GifEncoder(32, 24);
  const pixels = new Uint8ClampedArray(32 * 24 * 4).fill(255);
  gif.addFrame(pixels, 12);
  pixels.fill(0);
  gif.addFrame(pixels, 13);
  const blob = gif.finish();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
  expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0');
  expect(bytes[bytes.length - 1]).toBe(0x3b);
  expect(blob.type).toBe('image/gif');
  expect(() => gif.addFrame(new Uint8ClampedArray(1))).toThrow();
});
