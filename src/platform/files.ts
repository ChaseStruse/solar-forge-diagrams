import { invoke, isTauri } from '@tauri-apps/api/core';

export function nativeAvailable(): boolean {
  return isTauri();
}
export interface SavedFile {
  /** Native file handle; absent in the browser, where every save downloads a copy. */
  handle?: number;
  name: string;
}
export interface OpenedFile extends SavedFile {
  content: string;
}
export async function openDocumentFile(): Promise<OpenedFile | null> {
  if (isTauri()) return invoke<OpenedFile | null>('open_document');
  const [file] = await pickFiles('.json,application/json', false);
  if (!file) return null;
  if (file.size > 50_000_000) throw Error('Diagram files are limited to 50 MB');
  return { name: file.name, content: await file.text() };
}
export async function saveDocumentFile(
  content: string,
  handle?: number,
  title = 'diagram',
): Promise<SavedFile | null> {
  if (isTauri())
    return invoke<SavedFile | null>('save_document', {
      content,
      handle: handle ?? null,
    });
  const name = `${fileStem(title)}.sforge.json`;
  downloadBlob(new Blob([content], { type: 'application/json' }), name);
  return { name };
}
export async function exportPng(blob: Blob): Promise<boolean> {
  if (isTauri())
    return invoke<boolean>('export_png', {
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    });
  return downloadBlob(blob, 'diagram.png');
}
export async function saveSvg(content: string): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('export_svg', { content });
  return downloadBlob(
    new Blob([content], { type: 'image/svg+xml' }),
    'diagram.svg',
  );
}
const RECOVERY_KEY = 'solar-forge-diagrams:recovery';
/** Recovery snapshots live in app data natively and in localStorage in the browser. */
export async function readRecovery(): Promise<string | null> {
  if (isTauri()) return invoke<string | null>('read_recovery');
  try {
    return localStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}
export async function writeRecovery(content: string | null): Promise<void> {
  if (isTauri()) {
    await invoke('write_recovery', { content });
    return;
  }
  if (content === null) localStorage.removeItem(RECOVERY_KEY);
  else localStorage.setItem(RECOVERY_KEY, content);
}
/** Copy a PNG to the clipboard: natively via the desktop tool, else the web API. */
export async function copyPng(blob: Blob): Promise<void> {
  if (isTauri()) {
    await invoke('copy_png', {
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    });
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function exportGif(blob: Blob): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('export_gif', await blob.arrayBuffer());
  return downloadBlob(blob, 'journey.gif');
}

export async function openInfrastructureFiles(): Promise<
  { name: string; content: string }[]
> {
  if (isTauri()) return invoke('open_infrastructure');
  const files = await pickFiles('.tf,.json,.yaml,.yml', true);
  if (
    files.length > 256 ||
    files.reduce((sum, f) => sum + f.size, 0) > 50_000_000
  )
    throw Error('Choose up to 256 files totaling at most 50 MB');
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      content: await file.text(),
    })),
  );
}
function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.oncancel = () => {
      resolve([]);
      input.remove();
    };
    input.hidden = true;
    document.body.append(input);
    input.click();
  });
}

export async function exportVideo(
  blob: Blob,
  format: 'webm' | 'mp4',
): Promise<boolean> {
  if (isTauri())
    return invoke<boolean>('export_video', await blob.arrayBuffer());
  return downloadBlob(blob, `journey.${format}`);
}
export async function exportText(
  content: string,
  format: 'mmd' | 'puml' | 'drawio',
): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('export_text', { content, format });
  return downloadBlob(
    new Blob([content], { type: 'text/plain;charset=utf-8' }),
    `diagram.${format}`,
  );
}
function fileStem(title: string): string {
  return (
    title
      .trim()
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 100) || 'diagram'
  );
}
function downloadBlob(blob: Blob, name: string): boolean {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
