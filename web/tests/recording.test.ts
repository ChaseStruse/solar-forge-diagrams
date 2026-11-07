import { expect, test } from 'bun:test';
import { recordJourney } from '../src/export/gif';

test('slow encoding preserves recording duration, frame timing, and cancellation cleanup', async () => {
  let now = 0,
    terminated = false;
  const delays: number[] = [];
  class EncoderWorker {
    onmessage: ((event: { data: { blob?: Blob } }) => void) | undefined;
    postMessage(message: { type: string; delay?: number }): void {
      queueMicrotask(() => {
        if (message.type === 'frame') {
          delays.push(message.delay ?? 0);
          now += 200;
          this.onmessage?.({ data: {} });
        } else this.onmessage?.({ data: { blob: new Blob(['GIF89a']) } });
      });
    }
    terminate(): void {
      terminated = true;
    }
  }
  const replacements = [
    [globalThis, 'Worker', EncoderWorker],
    [performance, 'now', () => now],
    [
      globalThis,
      'setTimeout',
      (callback: () => void, ms: number) => {
        now += ms;
        queueMicrotask(callback);
        return 1;
      },
    ],
  ] as const;
  const originals = replacements.map(([target, key]) =>
    Object.getOwnPropertyDescriptor(target, key),
  );
  for (const [target, key, value] of replacements)
    Object.defineProperty(target, key, { configurable: true, value });
  const frame = () =>
    ({
      width: 2,
      height: 2,
      getContext: () => ({
        getImageData: () => ({ data: new Uint8ClampedArray(16) }),
      }),
    }) as unknown as HTMLCanvasElement;
  try {
    let progress = 0;
    expect(
      await recordJourney(
        frame,
        (value) => {
          progress = value;
        },
        undefined,
        { duration: 2, dither: true },
      ),
    ).toBeInstanceOf(Blob);
    expect(delays.reduce((sum, n) => sum + n, 0)).toBe(200);
    expect(delays.length).toBeLessThan(16);
    expect(Math.max(...delays)).toBeGreaterThan(13);
    expect(now).toBeLessThan(2400);
    expect(progress).toBe(100);
    expect(terminated).toBe(true);
    terminated = false;
    const controller = new AbortController();
    await expect(
      recordJourney(frame, () => controller.abort(), controller.signal, {
        duration: 2,
        dither: true,
      }),
    ).rejects.toThrow('cancelled');
    expect(terminated).toBe(true);
  } finally {
    for (const [i, [target, key]] of replacements.entries()) {
      const descriptor = originals[i];
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  }
});
