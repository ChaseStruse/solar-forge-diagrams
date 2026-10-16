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
