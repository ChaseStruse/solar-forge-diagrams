import { expect, test } from 'bun:test';
import { starterDocument } from '../src/domain/document';
import { importInWorker } from '../src/import/client';

test('import workers terminate on completion, parser failure, crash, cancellation and post failure', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const workers: ImportWorker[] = [];
  let failPost = false;
  class ImportWorker {
    terminated = false;
    message: unknown;
    onmessage: ((event: { data: unknown }) => void) | undefined;
    onerror: ((event: { message: string }) => void) | undefined;
    onmessageerror: (() => void) | undefined;
    constructor() {
      workers.push(this);
    }
    postMessage(value: unknown) {
      if (failPost) throw Error('clone failure');
      this.message = value;
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: ImportWorker,
  });
  const last = () => {
    const worker = workers.at(-1);
    if (!worker) throw Error('Missing worker');
    return worker;
  };
  const files = [{ name: 'main.tf', content: 'resource "aws_vpc" "main" {}' }];
  try {
    const pending = importInWorker(files, 'terraform');
    expect(last().message).toEqual({ files, requested: 'terraform' });
    const result = {
      document: starterDocument(),
      warnings: [],
      format: 'Terraform HCL',
    };
    last().onmessage?.({ data: { result } });
    expect(await pending).toEqual(result);
    expect(last().terminated).toBe(true);
    const invalid = importInWorker(files, 'auto');
    last().onmessage?.({ data: { error: 'Invalid HCL' } });
    await expect(invalid).rejects.toThrow('Invalid HCL');
    expect(last().terminated).toBe(true);
    const crash = importInWorker(files, 'auto');
    last().onerror?.({ message: 'worker failed' });
    await expect(crash).rejects.toThrow('worker failed');
    expect(last().terminated).toBe(true);
    const unreadable = importInWorker(files, 'auto');
    last().onmessageerror?.();
    await expect(unreadable).rejects.toThrow('Could not read');
    expect(last().terminated).toBe(true);
    const controller = new AbortController();
    const cancelled = importInWorker(files, 'terraform', controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    expect(last().terminated).toBe(true);
    const count = workers.length;
    await expect(
      importInWorker(files, 'auto', controller.signal),
    ).rejects.toThrow('cancelled');
    expect(workers.length).toBe(count);
    failPost = true;
    await expect(importInWorker(files, 'auto')).rejects.toThrow(
      'clone failure',
    );
    expect(last().terminated).toBe(true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
