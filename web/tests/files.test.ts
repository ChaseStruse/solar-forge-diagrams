import { expect, test } from 'bun:test';
import {
  copyPng,
  exportGif,
  exportPng,
  exportVideo,
} from '../src/platform/files';

/** Run `task` as if inside the desktop app, recording the native call it makes. */
async function nativeCall(
  task: () => Promise<unknown>,
): Promise<{ command: unknown; payload: unknown }> {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  const call: { command: unknown; payload: unknown } = {
    command: undefined,
    payload: undefined,
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: unknown, args: unknown) => {
          call.command = cmd;
          call.payload = args;
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
    await task();
    return call;
  } finally {
    for (const [key, descriptor] of [
      ['window', originalWindow],
      ['isTauri', originalTauri],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const binaryExports: [
  string,
  Uint8Array<ArrayBuffer>,
  (blob: Blob) => Promise<unknown>,
][] = [
  ['export_gif', new Uint8Array(1024 * 1024).fill(42), exportGif],
  [
    'export_video',
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    (blob) => exportVideo(blob, 'webm'),
  ],
  ['export_png', png, exportPng],
  ['copy_png', png, copyPng],
];

for (const [command, bytes, send] of binaryExports)
  test(`native ${command} passes a binary buffer instead of a JSON number array`, async () => {
    const call = await nativeCall(() => send(new Blob([bytes])));
    expect(call.command).toBe(command);
    expect(call.payload).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(call.payload as ArrayBuffer)).toEqual(bytes);
  });

test('browser saves and exports download files instead of failing', async () => {
  const { saveDocumentFile, saveSvg } = await import('../src/platform/files');
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
