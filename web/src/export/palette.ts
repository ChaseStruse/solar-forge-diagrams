interface Color {
  r: number;
  g: number;
  b: number;
  count: number;
}
interface Box {
  colors: Color[];
  count: number;
  axis: 'r' | 'g' | 'b';
  range: number;
}
function box(colors: Color[]): Box {
  let count = 0;
  const low = { r: 255, g: 255, b: 255 },
    high = { r: 0, g: 0, b: 0 };
  for (const c of colors) {
    count += c.count;
    for (const axis of ['r', 'g', 'b'] as const) {
      low[axis] = Math.min(low[axis], c[axis]);
      high[axis] = Math.max(high[axis], c[axis]);
    }
  }
  const axis = (['r', 'g', 'b'] as const).reduce((a, b) =>
    high[a] - low[a] >= high[b] - low[b] ? a : b,
  );
  return { colors, count, axis, range: high[axis] - low[axis] };
}
/** Weighted median cut preserves each frame's theme and artwork colours. */
export function adaptivePalette(
  rgba: Uint8ClampedArray,
  limit = 256,
): Uint8Array<ArrayBuffer> {
  const counts = new Uint32Array(262144),
    sums = new Float64Array(262144 * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0,
      g = rgba[i + 1] ?? 0,
      b = rgba[i + 2] ?? 0;
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    counts[key] = (counts[key] ?? 0) + 1;
    sums[key * 3] = (sums[key * 3] ?? 0) + r;
    sums[key * 3 + 1] = (sums[key * 3 + 1] ?? 0) + g;
    sums[key * 3 + 2] = (sums[key * 3 + 2] ?? 0) + b;
  }
  const colors: Color[] = [];
  for (let key = 0; key < counts.length; key++) {
    const count = counts[key] ?? 0;
    if (count)
      colors.push({
        r: (sums[key * 3] ?? 0) / count,
        g: (sums[key * 3 + 1] ?? 0) / count,
        b: (sums[key * 3 + 2] ?? 0) / count,
        count,
      });
  }
  const boxes = [box(colors)];
  while (boxes.length < limit) {
    let selected = -1,
      score = -1;
    for (const [i, b] of boxes.entries())
      if (b.colors.length > 1 && b.range * Math.sqrt(b.count) > score) {
        selected = i;
        score = b.range * Math.sqrt(b.count);
      }
    if (selected < 0) break;
    const current = boxes[selected];
    if (!current) break;
    current.colors.sort((a, b) => a[current.axis] - b[current.axis]);
    let count = 0,
      cut = 0;
    do {
      count += current.colors[cut]?.count ?? 0;
      cut++;
    } while (count < current.count / 2 && cut < current.colors.length - 1);
    boxes.splice(
      selected,
      1,
      box(current.colors.slice(0, cut)),
      box(current.colors.slice(cut)),
    );
  }
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const b = boxes[i] ?? boxes[boxes.length - 1];
    if (!b) continue;
    for (const [channel, axis] of (['r', 'g', 'b'] as const).entries())
      palette[i * 3 + channel] = Math.round(
        b.colors.reduce((sum, c) => sum + c[axis] * c.count, 0) /
          Math.max(1, b.count),
      );
  }
  return palette;
}
export interface PaletteMapper {
  palette: Uint8Array<ArrayBuffer>;
  cache: Int16Array;
}
/** A stable image-adaptive palette avoids frame-to-frame colour flicker. */
export function createPaletteMapper(
  rgba: Uint8ClampedArray,
  reserveMarkers = false,
): PaletteMapper {
  const palette = adaptivePalette(rgba, reserveMarkers ? 248 : 256);
  if (reserveMarkers)
    palette.set(
      [
        255, 77, 94, 0, 229, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0,
        0, 0, 255, 255, 255, 0,
      ],
      248 * 3,
    );
  return { palette, cache: new Int16Array(262144).fill(-1) };
}
/** Floyd–Steinberg error diffusion avoids hard colour bands in gradients. */
export function quantizeFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dither = true,
  mapper = createPaletteMapper(rgba),
): { palette: Uint8Array<ArrayBuffer>; indices: Uint8Array<ArrayBuffer> } {
  const { palette, cache } = mapper;
  const indices = new Uint8Array(width * height);
  let errors = new Float32Array((width + 2) * 3),
    next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    next.fill(0);
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x,
        offset = (x + 1) * 3;
      const r = Math.max(
        0,
        Math.min(
          255,
          (rgba[pixel * 4] ?? 0) + (dither ? (errors[offset] ?? 0) : 0),
        ),
      );
      const g = Math.max(
        0,
        Math.min(
          255,
          (rgba[pixel * 4 + 1] ?? 0) + (dither ? (errors[offset + 1] ?? 0) : 0),
        ),
      );
      const b = Math.max(
        0,
        Math.min(
          255,
          (rgba[pixel * 4 + 2] ?? 0) + (dither ? (errors[offset + 2] ?? 0) : 0),
        ),
      );
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let best = cache[key] ?? -1;
      if (best < 0) {
        let distance = Infinity;
        // Cache a deterministic representative of the 6-bit cell.
        const cr = ((key >> 12) & 63) * 4 + 2,
          cg = ((key >> 6) & 63) * 4 + 2,
          cb = (key & 63) * 4 + 2;
        for (let i = 0; i < 256; i++) {
          const dr = cr - (palette[i * 3] ?? 0),
            dg = cg - (palette[i * 3 + 1] ?? 0),
            db = cb - (palette[i * 3 + 2] ?? 0);
          const d = 2 * dr * dr + 3 * dg * dg + db * db;
          if (d < distance) {
            distance = d;
            best = i;
          }
        }
        cache[key] = best;
      }
      indices[pixel] = best;
      if (dither)
        for (let c = 0; c < 3; c++) {
          const error =
            (c === 0 ? r : c === 1 ? g : b) - (palette[best * 3 + c] ?? 0);
          errors[offset + 3 + c] =
            (errors[offset + 3 + c] ?? 0) + (error * 7) / 16;
          next[offset - 3 + c] = (next[offset - 3 + c] ?? 0) + (error * 3) / 16;
          next[offset + c] = (next[offset + c] ?? 0) + (error * 5) / 16;
          next[offset + 3 + c] = (next[offset + 3 + c] ?? 0) + error / 16;
        }
    }
    [errors, next] = [next, errors];
  }
  return { palette, indices };
}
