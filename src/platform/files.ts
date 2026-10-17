import { invoke, isTauri } from '@tauri-apps/api/core';

export function nativeAvailable(): boolean {
  return isTauri();
}
export interface SavedFile {
  handle: number;
  name: string;
}
export interface OpenedFile extends SavedFile {
  content: string;
}
export async function openDocumentFile(): Promise<OpenedFile | null> {
  if (!isTauri())
    throw new Error('Open is available in the native desktop application.');
  return invoke<OpenedFile | null>('open_document');
}
export async function saveDocumentFile(
  content: string,
  handle?: number,
): Promise<SavedFile | null> {
  if (!isTauri())
    throw new Error('Save is available in the native desktop application.');
  return invoke<SavedFile | null>('save_document', {
    content,
    handle: handle ?? null,
  });
}
export async function exportPng(blob: Blob): Promise<boolean> {
  if (!isTauri())
    throw new Error('Export is available in the native desktop application.');
  return invoke<boolean>('export_png', {
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  });
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
  if (isTauri())
    return invoke<boolean>('export_gif', {
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'journey.gif';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
