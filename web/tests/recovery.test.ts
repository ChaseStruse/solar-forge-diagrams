import { expect, test } from 'bun:test';
import { RecoveryWriter } from '../src/persistence/recovery';

test('recovery writes serialize old snapshots before later save clears', async () => {
  const writes: (string | null)[] = [];
  let value: string | null = 'first';
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new RecoveryWriter(
    () => value,
    async (content) => {
      if (content === 'first') await gate;
      writes.push(content);
    },
    () => {},
  );
  writer.schedule();
  const first = writer.flush();
  value = null;
  writer.schedule();
  const clear = writer.flush();
  release();
  await Promise.all([first, clear]);
  expect(writes).toEqual(['first', null]);
  writer.dispose();
});

test('failed recovery remains retryable and reports the failure', async () => {
  let fail = true;
  let errors = 0;
  const writes: string[] = [];
  const writer = new RecoveryWriter(
    () => 'latest',
    async (content) => {
      if (fail) throw Error('disk full');
      if (content) writes.push(content);
    },
    () => {
      errors++;
    },
  );
  writer.schedule();
  await expect(writer.flush()).rejects.toThrow('disk full');
  expect(errors).toBe(1);
  fail = false;
  await writer.flush();
  expect(writes).toEqual(['latest']);
  writer.dispose();
});

test('debounce coalesces edits and maximum wait flushes continuous editing', async () => {
  let value = 'initial';
  const writes: (string | null)[] = [];
  const writer = new RecoveryWriter(
    () => value,
    async (content) => {
      writes.push(content);
    },
    () => {},
    30,
    50,
  );
  writer.schedule();
  value = 'latest';
  writer.schedule();
  await Bun.sleep(40);
  expect(writes).toEqual(['latest']);
  value = 'continuous';
  for (let i = 0; i < 6; i++) {
    writer.schedule();
    await Bun.sleep(12);
  }
  expect(writes).toContain('continuous');
  writer.dispose();
});
