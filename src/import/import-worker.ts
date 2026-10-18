import { type ImportFormat, importInfrastructure } from './infrastructure';
import type { InfrastructureFile } from './types';

self.onmessage = (
  event: MessageEvent<{ files: InfrastructureFile[]; requested: ImportFormat }>,
) => {
  try {
    self.postMessage({
      result: importInfrastructure(event.data.files, event.data.requested),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
