import type { DiagramDocument } from '../domain/document';
export interface InfrastructureFile {
  name: string;
  content: string;
}
export interface ImportResult {
  document: DiagramDocument;
  warnings: string[];
  format: string;
}
export interface Resource {
  id: string;
  type: string;
  values: Record<string, unknown>;
  region?: string;
}
export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const list = (value: unknown): unknown[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
