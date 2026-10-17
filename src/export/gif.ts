/** Small offline GIF89a encoder: RGB332 palette with bounded 9-bit LZW blocks. */
export class GifEncoder {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  private frames = 0;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 1024 ||
      height > 1024
    )
      throw Error('Invalid GIF dimensions');
    const header = [
      71,
      73,
      70,
      56,
      57,
      97,
      ...word(width),
      ...word(height),
      0xf7,
      0,
      0,
    ];
    for (let i = 0; i < 256; i++)
      header.push(
        Math.round((((i >> 5) & 7) * 255) / 7),
        Math.round((((i >> 2) & 7) * 255) / 7),
        Math.round(((i & 3) * 255) / 3),
      );
    // Loop forever.
    header.push(
      0x21,
      0xff,
      11,
      ...new TextEncoder().encode('NETSCAPE2.0'),
      3,
      1,
      0,
      0,
      0,
    );
    this.parts.push(new Uint8Array(header));
  }
  addFrame(rgba: Uint8ClampedArray, delay = 12): void {
    if (rgba.length !== this.width * this.height * 4)
      throw Error('GIF frame size mismatch');
    if (++this.frames > 96) throw Error('GIF export is limited to 96 frames');
    this.parts.push(
      new Uint8Array([
        0x21,
        0xf9,
        4,
        4,
        ...word(delay),
        0,
        0,
        0x2c,
        0,
        0,
        0,
        0,
        ...word(this.width),
        ...word(this.height),
        0,
        8,
      ]),
    );
    // Reset before the decoder's dictionary grows beyond 9 bits. No large
    // dictionary or additional dependencies; predictable memory even offline.
    const bytes: number[] = [];
    let bits = 0,
      buffer = 0;
    const code = (value: number) => {
      buffer |= value << bits;
      bits += 9;
      while (bits >= 8) {
        bytes.push(buffer & 255);
        buffer >>>= 8;
        bits -= 8;
      }
    };
    for (let pixel = 0; pixel < this.width * this.height; pixel++) {
      if (pixel % 250 === 0) code(256);
      const i = pixel * 4;
      code(
        ((rgba[i] ?? 0) & 0xe0) |
          (((rgba[i + 1] ?? 0) >> 3) & 0x1c) |
          ((rgba[i + 2] ?? 0) >> 6),
      );
    }
    code(257);
    if (bits) bytes.push(buffer & 255);
    const blocks = new Uint8Array(
      bytes.length + Math.ceil(bytes.length / 255) + 1,
    );
    let offset = 0;
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255);
      blocks[offset++] = chunk.length;
      blocks.set(chunk, offset);
      offset += chunk.length;
    }
    this.parts.push(blocks);
  }
  finish(): Blob {
    if (!this.frames) throw Error('No GIF frames');
    return new Blob([...this.parts, new Uint8Array([0x3b])], {
      type: 'image/gif',
    });
  }
}
function word(value: number): number[] {
  return [value & 255, (value >> 8) & 255];
}

/** Capture the visible scene, including the journeyman, pulses and data flow. */
export async function recordJourney(
  frame: () => HTMLCanvasElement,
  progress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const first = frame();
  const context = first.getContext('2d');
  if (!context) throw Error('GIF canvas unavailable');
  const encoder = new GifEncoder(first.width, first.height);
  const started = performance.now();
  for (let i = 0; i < 96; i++) {
    if (signal?.aborted) throw Error('GIF recording cancelled');
    const canvas = i === 0 ? first : frame();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('GIF canvas unavailable');
    encoder.addFrame(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      i % 2 ? 13 : 12,
    );
    progress(Math.round(((i + 1) / 96) * 100));
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, started + (i + 1) * 125 - performance.now()),
      ),
    );
  }
  return encoder.finish();
}
