import { expect, test } from 'bun:test';
import { quantizeFrame } from '../src/export/palette';

test('adaptive palettes preserve dark themed gradients much better than RGB332', () => {
  const width = 128,
    height = 64,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rgba.set([x / 2, y / 2, 20 + x / 4, 255], (y * width + x) * 4);
  const { palette, indices } = quantizeFrame(rgba, width, height);
  let adaptiveError = 0,
    fixedError = 0;
  for (let i = 0; i < indices.length; i++)
    for (let c = 0; c < 3; c++) {
      const source = rgba[i * 4 + c] ?? 0;
      const actual = palette[(indices[i] ?? 0) * 3 + c] ?? 0;
      const fixed =
        c === 2 ? (source >> 6) * 85 : Math.round(((source >> 5) * 255) / 7);
      adaptiveError += (source - actual) ** 2;
      fixedError += (source - fixed) ** 2;
    }
  expect(adaptiveError).toBeLessThan(fixedError / 4);
  expect(new Set(indices).size).toBeGreaterThan(64);
});
test('error diffusion is deterministic and can be switched off', () => {
  const width = 64,
    height = 64,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rgba.set([x * 4, y * 4, (x + y) * 2, 255], (y * width + x) * 4);
  const a = quantizeFrame(rgba, width, height, true);
  const b = quantizeFrame(rgba, width, height, true);
  const plain = quantizeFrame(rgba, width, height, false);
  expect(a.indices).toEqual(b.indices);
  expect(a.indices).not.toEqual(plain.indices);
  expect(a.palette.length).toBe(768);
});
