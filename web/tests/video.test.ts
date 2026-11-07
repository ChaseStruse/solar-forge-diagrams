import { expect, test } from 'bun:test';
import {
  recordVideo,
  validateVideoOptions,
  videoMime,
} from '../src/export/video';

test('video records selected duration and releases tracks on success, cancellation and failure', async () => {
  let now = 0,
    stopped = 0,
    failure = false;
  const frame = () => ({ width: 3, height: 3 }) as HTMLCanvasElement;
  class Recorder {
    static isTypeSupported(mime: string) {
      return mime.startsWith('video/webm');
    }
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['webm']) });
        this.onstop?.();
      });
    }
  }
  const replacements = [
    [globalThis, 'MediaRecorder', Recorder],
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
    [
      globalThis,
      'document',
      {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {
              if (failure) throw Error('capture failed');
            },
          }),
          captureStream: () => ({
            getTracks: () => [
              {
                stop: () => {
                  stopped++;
                },
              },
            ],
          }),
        }),
      },
    ],
  ] as const;
  const originals = replacements.map(([target, key]) =>
    Object.getOwnPropertyDescriptor(target, key),
  );
  for (const [target, key, value] of replacements)
    Object.defineProperty(target, key, { configurable: true, value });
  try {
    expect(videoMime('mp4')).toBeUndefined();
    expect(videoMime('webm')).toContain('webm');
    let percent = 0;
    const blob = await recordVideo(
      frame,
      (p) => {
        percent = p;
      },
      new AbortController().signal,
      { duration: 2, format: 'webm' },
    );
    expect(blob.size).toBe(4);
    expect(percent).toBe(100);
    expect(now).toBeGreaterThanOrEqual(2000);
    expect(now).toBeLessThan(2050);
    expect(stopped).toBe(1);
    const controller = new AbortController();
    await expect(
      recordVideo(frame, () => controller.abort(), controller.signal, {
        duration: 2,
        format: 'webm',
      }),
    ).rejects.toThrow('cancelled');
    expect(stopped).toBe(2);
    let count = 0;
    await expect(
      recordVideo(
        () => {
          if (++count === 2) failure = true;
          return frame();
        },
        () => {},
        new AbortController().signal,
        { duration: 2, format: 'webm' },
      ),
    ).rejects.toThrow('capture failed');
    expect(stopped).toBe(3);
  } finally {
    for (const [i, [target, key]] of replacements.entries()) {
      const descriptor = originals[i];
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  }
});

test('video rejects invalid durations and formats', () => {
  expect(() =>
    validateVideoOptions({ duration: 121, format: 'webm' }),
  ).toThrow();
  expect(() =>
    validateVideoOptions({ duration: NaN, format: 'mp4' }),
  ).toThrow();
  expect(validateVideoOptions({ duration: 12, format: 'mp4' }).duration).toBe(
    12,
  );
});
