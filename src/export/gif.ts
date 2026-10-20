import {
  createPaletteMapper,
  type PaletteMapper,
  quantizeFrame,
} from './palette';
import {
  defaultRecordingOptions,
  type RecordingOptions,
  validateRecordingOptions,
} from './recording-options';

export {
  defaultRecordingOptions,
  type RecordingOptions,
  validateRecordingOptions,
} from './recording-options';
/** Small offline GIF89a encoder: adaptive palettes and dithering with bounded 12-bit LZW compression. */
export class GifEncoder {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  private frames = 0;
  private mapper: PaletteMapper | undefined;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly dither = true,
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
      0x70,
      0,
      0,
    ];
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
    if (++this.frames > 960)
      throw Error('GIF export is limited to 120 seconds');
    this.mapper ??= createPaletteMapper(rgba, true);
    const { palette, indices } = quantizeFrame(
      rgba,
      this.width,
      this.height,
      this.dither,
      this.mapper,
    );
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
        0x87,
        ...palette,
        8,
      ]),
    );
    const { bytes } = encodeLzw(indices);
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
    if (this.parts.reduce((sum, part) => sum + part.byteLength, 0) > 49_000_000)
      throw Error('GIF exceeds 49 MB; shorten the duration');
  }
  finish(): Blob {
    if (!this.frames) throw Error('No GIF frames');
    return new Blob([...this.parts, new Uint8Array([0x3b])], {
      type: 'image/gif',
    });
  }
}
/** Encode GIF's LZW stream; EOF never grows past the 12-bit dictionary limit. */
export function encodeLzw(indices: Uint8Array): {
  bytes: number[];
  bitLength: number;
} {
  if (!indices.length) throw Error('Empty LZW stream');
  let bitLength = 0;
  // GIF LZW grows from 9 to 12 bits, then resets its bounded dictionary.
  const bytes: number[] = [];
  let bits = 0,
    buffer = 0,
    codeSize = 9,
    nextCode = 258;
  const dictionary = new Map<number, number>();
  const code = (value: number) => {
    bitLength += codeSize;
    buffer |= value << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  code(256);
  let prefix = indices[0] ?? 0;
  for (let pixel = 1; pixel < indices.length; pixel++) {
    const value = indices[pixel] ?? 0;
    const key = prefix * 256 + value;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    code(prefix);
    if (nextCode === 4096) {
      code(256);
      dictionary.clear();
      nextCode = 258;
      codeSize = 9;
    } else {
      // The decoder creates a dictionary entry one emitted code later.
      if (nextCode === 1 << codeSize) codeSize++;
      dictionary.set(key, nextCode++);
    }
    prefix = value;
  }
  code(prefix);
  if (codeSize < 12 && nextCode === 1 << codeSize) codeSize++;
  code(257);
  if (bits) bytes.push(buffer & 255);
  return { bytes, bitLength };
}

function word(value: number): number[] {
  return [value & 255, (value >> 8) & 255];
}

/** Capture the visible scene, including the journeyman, pulses and data flow. */
export async function recordJourney(
  frame: () => HTMLCanvasElement,
  progress: (percent: number) => void,
  signal?: AbortSignal,
  options: RecordingOptions = defaultRecordingOptions,
): Promise<Blob> {
  validateRecordingOptions(options);
  const first = frame();
  const context = first.getContext('2d');
  if (!context) throw Error('GIF canvas unavailable');
  // Encoding runs off the UI thread so the journeyman keeps moving smoothly.
  const worker = new Worker(new URL('./gif-worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectPending: ((reason: Error) => void) | undefined;
  const aborted = () => rejectPending?.(Error('GIF recording cancelled'));
  signal?.addEventListener('abort', aborted);
  const request = (
    message: unknown,
    transfer: Transferable[] = [],
  ): Promise<{ blob?: Blob }> =>
    new Promise((resolve, reject) => {
      rejectPending = reject;
      worker.onmessage = (event) => {
        rejectPending = undefined;
        if (event.data.error) reject(Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = (event) => {
        rejectPending = undefined;
        reject(Error(event.message || 'GIF encoder failed'));
      };
      worker.postMessage(message, transfer);
    });
  const capture = (
    canvas: HTMLCanvasElement,
  ): Uint8ClampedArray<ArrayBuffer> => {
    if (canvas.width !== first.width || canvas.height !== first.height)
      throw Error('View size changed during recording; try again');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('GIF canvas unavailable');
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const started = performance.now(),
    duration = options.duration * 1000;
  let previous = capture(first),
    encodedUntil = 0,
    nextCapture = 125;
  try {
    for (;;) {
      if (signal?.aborted) throw Error('GIF recording cancelled');
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(
            0,
            started + Math.min(duration, nextCapture) - performance.now(),
          ),
        ),
      );
      if (signal?.aborted) throw Error('GIF recording cancelled');
      const elapsed = Math.min(duration, performance.now() - started);
      const until = Math.round(elapsed / 10);
      const last = elapsed >= duration;
      const next = last ? undefined : capture(frame());
      // Delay reflects actual capture time, so slower CPUs never accelerate
      // playback or stretch the requested recording into a longer journey.
      await request(
        {
          type: 'frame',
          width: first.width,
          height: first.height,
          dither: options.dither,
          delay: Math.max(1, until - encodedUntil),
          buffer: previous.buffer,
        },
        [previous.buffer],
      );
      progress(Math.round((elapsed / duration) * 100));
      if (!next) break;
      previous = next;
      encodedUntil = until;
      nextCapture += 125;
    }
    if (signal?.aborted) throw Error('GIF recording cancelled');
    const result = await request({ type: 'finish' });
    if (!result.blob) throw Error('GIF encoder returned no animation');
    return result.blob;
  } finally {
    signal?.removeEventListener('abort', aborted);
    worker.terminate();
  }
}
