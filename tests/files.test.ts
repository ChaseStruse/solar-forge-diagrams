import { expect, test } from 'bun:test';
import { exportGif } from '../src/platform/files';

test('native GIF transfer passes a binary buffer instead of a JSON number array', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  let payload: unknown, command: unknown;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: unknown, args: unknown) => {
          command = cmd;
          payload = args;
          return true;
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'isTauri', {
    configurable: true,
    value: true,
  });
  try {
    const bytes = new Uint8Array(1024 * 1024).fill(42);
    expect(await exportGif(new Blob([bytes], { type: 'image/gif' }))).toBe(
      true,
    );
    expect(command).toBe('export_gif');
    expect(payload).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(payload as ArrayBuffer)).toEqual(bytes);
  } finally {
    for (const [key, descriptor] of [
      ['window', originalWindow],
      ['isTauri', originalTauri],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
