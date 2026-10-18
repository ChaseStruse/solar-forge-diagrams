import type { ImportFormat } from './infrastructure';
import type { ImportResult, InfrastructureFile } from './types';

/** One disposable worker per preview: parsing, validation and layout stay off the UI thread. */
export function importInWorker(
  files: InfrastructureFile[],
  requested: ImportFormat,
  signal?: AbortSignal,
): Promise<ImportResult> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Import cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.ts', import.meta.url), {
      type: 'module',
    });
    function cleanup() {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    }
    function abort() {
      cleanup();
      reject(new DOMException('Import cancelled', 'AbortError'));
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ result?: ImportResult; error?: string }>,
    ) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else
        reject(Error(event.data.error ?? 'Import worker returned no diagram'));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(Error(event.message || 'Infrastructure import worker failed'));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(Error('Could not read infrastructure import result'));
    };
    try {
      worker.postMessage({ files, requested });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
