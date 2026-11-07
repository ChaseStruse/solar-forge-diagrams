import { type ImportFormat, importInfrastructure } from './infrastructure';
import type { MermaidOptions } from './mermaid';
import type { InfrastructureFile } from './types';

self.onmessage = (
  event: MessageEvent<{
    files: InfrastructureFile[];
    requested: ImportFormat;
    options?: MermaidOptions;
  }>,
) => {
  try {
    self.postMessage({
      result: importInfrastructure(
        event.data.files,
        event.data.requested,
        event.data.options,
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
