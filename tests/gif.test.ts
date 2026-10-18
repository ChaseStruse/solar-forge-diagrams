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

test('GIF compression keeps repeated-color frames small and bounds export size', async () => {
  const gif = new GifEncoder(640, 480);
  const pixels = new Uint8ClampedArray(640 * 480 * 4).fill(255);
  gif.addFrame(pixels);
  expect(gif.finish().size).toBeLessThan(2500);
  expect(() => new GifEncoder(0, 480)).toThrow();
  expect(() => new GifEncoder(640, 2000)).toThrow();
  expect(() => new GifEncoder(1, 1).finish()).toThrow();
});

/** Independent GIF decoder, including code-size changes and dictionary clears. */
function decodeLzw(bytes: number[]): {
  pixels: number[];
  bits: number;
  fullAtEnd: boolean;
} {
  let bit = 0,
    width = 9,
    next = 258,
    previous: number[] | undefined;
  let table: number[][] = [];
  const pixels: number[] = [];
  const read = () => {
    let value = 0;
    for (let i = 0; i < width; i++) {
      if (bit >> 3 >= bytes.length) throw Error('Missing LZW end code');
      value |= (((bytes[bit >> 3] ?? 0) >> (bit & 7)) & 1) << i;
      bit++;
    }
    return value;
  };
  for (;;) {
    const code = read();
    if (code === 256) {
      table = Array.from({ length: 256 }, (_, i) => [i]);
      width = 9;
      next = 258;
      previous = undefined;
      continue;
    }
    if (code === 257) return { pixels, bits: bit, fullAtEnd: next === 4096 };
    const entry =
      table[code] ??
      (code === next && previous ? [...previous, previous[0] ?? 0] : undefined);
    if (!entry) throw Error(`Invalid LZW code ${code}`);
    pixels.push(...entry);
    if (previous && next < 4096) {
      table[next++] = [...previous, entry[0] ?? 0];
      if (next === 1 << width && width < 12) width++;
    }
    previous = entry;
  }
}
function noise(length: number): Uint8Array<ArrayBuffer> {
  let seed = 123;
  return Uint8Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  });
}
test('LZW EOF remains 12 bits when the dictionary fills on the final pixel', async () => {
  const { encodeLzw } = await import('../src/export/gif');
  const pixels = noise(3949);
  const { bytes, bitLength } = encodeLzw(pixels);
  const decoded = decodeLzw(bytes);
  expect(decoded.fullAtEnd).toBe(true);
  expect(bitLength).toBe(decoded.bits);
  expect(Uint8Array.from(decoded.pixels)).toEqual(pixels);
  expect(bytes.length).toBe(Math.ceil(decoded.bits / 8));
});
test('LZW decodes code-width boundaries and repeated full-dictionary resets', async () => {
  const { encodeLzw } = await import('../src/export/gif');
  for (const length of [1, 2, 255, 256, 257, 767, 1791, 3948, 3950, 20000]) {
    const pixels = noise(length);
    expect(Uint8Array.from(decodeLzw(encodeLzw(pixels).bytes).pixels)).toEqual(
      pixels,
    );
  }
});
test('GIF duration accepts longer journeys and rejects invalid limits', async () => {
  const { validateRecordingOptions } = await import('../src/export/gif');
  expect(
    validateRecordingOptions({ duration: 120, dither: true }).duration,
  ).toBe(120);
  for (const duration of [0, 1, 121, 12.5, Infinity])
    expect(() =>
      validateRecordingOptions({ duration, dither: true }),
    ).toThrow();
});
