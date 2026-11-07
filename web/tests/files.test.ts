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

test('native video export also uses a raw binary payload', async () => {
  const { exportVideo } = await import('../src/platform/files');
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
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    expect(
      await exportVideo(new Blob([bytes], { type: 'video/webm' }), 'webm'),
    ).toBe(true);
    expect(command).toBe('export_video');
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

test('browser saves and exports download files instead of failing', async () => {
  const { exportPng, saveDocumentFile, saveSvg } = await import(
    '../src/platform/files'
  );
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const downloads: string[] = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        set download(name: string) {
          downloads.push(name);
        },
        click: () => {},
      }),
    },
  });
  try {
    expect(await saveDocumentFile('{}', undefined, 'Prod: VPC/East')).toEqual({
      name: 'Prod- VPC-East.sforge.json',
    });
    expect(await exportPng(new Blob([]))).toBe(true);
    expect(await saveSvg('<svg/>')).toBe(true);
    expect(downloads).toEqual([
      'Prod- VPC-East.sforge.json',
      'diagram.png',
      'diagram.svg',
    ]);
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('browser recovery snapshots round-trip through localStorage', async () => {
  const { readRecovery, writeRecovery } = await import('../src/platform/files');
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    expect(await readRecovery()).toBeNull();
    await writeRecovery('{"version":1}');
    expect(await readRecovery()).toBe('{"version":1}');
    await writeRecovery(null);
    expect(await readRecovery()).toBeNull();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
