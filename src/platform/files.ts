import { invoke, isTauri } from '@tauri-apps/api/core';

export function nativeAvailable(): boolean {
  return isTauri();
}
export async function openDocumentFile(): Promise<string | null> {
  if (!isTauri())
    throw new Error('Open is available in the native desktop application.');
  return invoke<string | null>('open_document');
}
export async function saveDocumentFile(content: string): Promise<boolean> {
  if (!isTauri())
    throw new Error('Save is available in the native desktop application.');
  return invoke<boolean>('save_document', { content });
}
export async function exportPng(blob: Blob): Promise<boolean> {
  if (!isTauri())
    throw new Error('Export is available in the native desktop application.');
  return invoke<boolean>('export_png', {
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  });
}
