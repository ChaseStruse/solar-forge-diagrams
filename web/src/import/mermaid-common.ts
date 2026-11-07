/**
 * Pieces shared by the Mermaid importers (flowchart, state, architecture):
 * text decoding, line cleanup, exporter comments and the final layout.
 */
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
} from '../domain/document';
import { MAX_OWNER, MAX_TEXT, worldPosition } from '../domain/document';
import { laneLayout } from '../domain/lanes';
import { type LayoutDirection, layoutDocument } from '../domain/layout';
import type { ImportResult } from './types';

export const MAX_NODES = 2000;
export const MAX_EDGES = 4000;

/** Add a connection numbered in chart order, refusing charts past the limit. */
export function addEdge(
  edges: DiagramEdge[],
  noun: 'links' | 'transitions',
  edge: Omit<DiagramEdge, 'id'>,
): void {
  if (edges.length >= MAX_EDGES)
    throw Error(`Mermaid import supports up to ${MAX_EDGES} ${noun}`);
  edges.push({ id: `edge-${edges.length + 1}`, ...edge });
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  apos: "'",
};

/** Decode Mermaid text: quotes, `#…;` entities, HTML entities and `<br>`. */
export function mermaidText(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
    text = text.slice(1, -1);
  // Markdown strings: "`**bold** text`" keep their words, not the markup.
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`'))
    text = text.slice(1, -1).replace(/\*\*|__|\*|_/g, '');
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[#&](#?)(x[0-9a-f]+|\d+|[a-z]+);/gi, (match, _hash, code) => {
      const value = String(code);
      if (/^\d+$/.test(value)) return safeCodePoint(Number(value), match);
      if (/^x[0-9a-f]+$/i.test(value))
        return safeCodePoint(Number.parseInt(value.slice(1), 16), match);
      return NAMED_ENTITIES[value.toLowerCase()] ?? match;
    })
    .slice(0, MAX_TEXT);
}
function safeCodePoint(code: number, fallback: string): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** IDs written by this app's exporter (`n` + UTF-8 hex) decode to the original. */
export function originalId(id: string): string {
  if (!/^n(?:[0-9a-f]{2})+$/.test(id)) return id;
  const bytes = id
    .slice(1)
    .match(/../g)
    ?.map((pair) => Number.parseInt(pair, 16));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(bytes ?? []),
    );
  } catch {
    return id;
  }
}

/** Source lines without blanks, `%%` comments or a `---` front-matter block. */
export function meaningfulLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) lines.splice(0, end + 1);
  }
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
}

/**
 * Values from comments this app's exporter writes, `%% <keyword> <id>: "…"`,
 * keyed by the id as written in the chart.
 */
export function exporterComments(
  source: string,
  keyword: string,
): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = new RegExp(
    `^\\s*%%\\s*${keyword}\\s+(\\S+):\\s*(".*")\\s*$`,
    'gm',
  );
  for (const match of source.matchAll(pattern)) {
    try {
      const value: unknown = JSON.parse(match[2] ?? '');
      if (typeof value === 'string') values.set(match[1] ?? '', value);
    } catch {}
  }
  return values;
}

/** The board title: a front-matter `title:`, else the exporter's comment. */
export function chartTitle(source: string, name: string): string {
  let title = `Imported · ${name}`;
  const titleComment = /^\s*%%\s*Title:\s*(".*")\s*$/m.exec(source);
  if (titleComment?.[1]) {
    try {
      const value: unknown = JSON.parse(titleComment[1]);
      if (typeof value === 'string' && value.trim()) title = value;
    } catch {}
  }
  const frontTitle = /^---\s*\n(?:.*\n)*?\s*title:\s*(.+)\n(?:.*\n)*?---/m.exec(
    source.replace(/\r\n?/g, '\n'),
  );
  if (frontTitle?.[1]) title = mermaidText(frontTitle[1]);
  return title;
}

export const trimOwner = (owner: string) => owner.trim().slice(0, MAX_OWNER);

export interface Chart {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  direction: LayoutDirection;
  warnings: string[];
  format: string;
  /** Lane owners in order, when the chart should be shown as swimlanes. */
  lanes?: string[];
  /** Links to rank the layout by, when they differ from the chart's links. */
  layoutEdges?: DiagramEdge[];
}

/**
 * Size tiles for their labels, lay the chart out along its direction (in
 * lanes when it has them), and point forward links out of the side facing
 * the flow. Links that already name their sides keep them.
 */
export function finishChart(chart: Chart): ImportResult {
  if (!chart.nodes.length) throw Error('The chart has no nodes to import');
  // Long labels get a wider tile and wrap, rather than shrinking to fit.
  for (const node of chart.nodes) {
    if (node.kind !== 'service') continue;
    const longest = Math.max(...node.label.split('\n').map((l) => l.length));
    if (longest > 14) {
      node.width = Math.min(260, 160 + (longest - 14) * 6);
      node.wrap = true;
    }
    if (node.shape === 'decision') node.depth = 120;
  }
  const { direction } = chart;
  const document: DiagramDocument = {
    version: 1,
    title: chart.title.slice(0, 200),
    nodes: chart.nodes,
    edges: chart.layoutEdges ?? chart.edges,
  };
  const laid = layoutDocument(document, direction, 'flow');
  if (chart.layoutEdges) laid.edges = structuredClone(chart.edges);
  if (chart.lanes) {
    laid.lanes = { direction, order: chart.lanes };
    const { positions, order } = laneLayout(laid, direction);
    laid.lanes.order = order;
    for (const node of laid.nodes) {
      const at = positions.get(node.id);
      if (at) Object.assign(node, at);
    }
  }
  const index = new Map(laid.nodes.map((n) => [n.id, n]));
  for (const edge of laid.edges) {
    if (edge.sourcePort || edge.targetPort) continue;
    const source = index.get(edge.source);
    const target = index.get(edge.target);
    if (!source || !target) continue;
    const a = worldPosition(source, index);
    const b = worldPosition(target, index);
    const forward =
      direction === 'down'
        ? b.z - target.depth / 2 > a.z + source.depth / 2
        : b.x - target.width / 2 > a.x + source.width / 2;
    if (!forward) continue;
    edge.sourcePort = direction === 'down' ? 'south' : 'east';
    edge.targetPort = direction === 'down' ? 'north' : 'west';
  }
  return { document: laid, warnings: chart.warnings, format: chart.format };
}
