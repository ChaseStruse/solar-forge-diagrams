import { findService } from '../catalog/services';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
} from '../domain/document';
import { MAX_TEXT } from '../domain/document';
import { type LayoutDirection, layoutDocument } from '../domain/layout';
import type { ImportResult } from './types';

/** Mermaid diagram types other than flowcharts, for a clear refusal. */
const OTHER_DIAGRAMS =
  /^(sequenceDiagram|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w+|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?)\b/;
const HEADER = /^(flowchart|graph)\b(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i;
const MAX_NODES = 2000;
const MAX_EDGES = 4000;

type Shape = 'process' | 'decision' | 'terminal';
/** Node shape delimiters, longest opener first so `([` wins over `(`. */
const SHAPES: readonly [open: string, close: string, shape: Shape][] = [
  ['(((', ')))', 'terminal'],
  ['([', '])', 'terminal'],
  ['((', '))', 'terminal'],
  ['[[', ']]', 'process'],
  ['[(', ')]', 'process'],
  ['{{', '}}', 'process'],
  ['[/', '/]', 'process'],
  ['[/', '\\]', 'process'],
  ['[\\', '\\]', 'process'],
  ['[\\', '/]', 'process'],
  ['>', ']', 'process'],
  ['(', ')', 'process'],
  ['[', ']', 'process'],
  ['{', '}', 'decision'],
];
/** Node ids; `-` and `.` only between word characters, so `A-->B` splits. */
const ID = /^[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*/u;
/** A link with its label between the strokes: `-- text -->`, `-. text .->`. */
const LABELLED_LINK =
  /^\s*([<ox]?)(--|==|-\.)\s+(?![>\-=.])(.+?)\s+(-{2,}|={2,}|\.+-)([>ox]?)\s*/;
/** A plain link: `-->`, `---`, `-.->`, `==>`, `<-->`, `--o`, `--x`. */
const LINK = /^\s*([<ox]?)(-{2,}|={2,}|-\.+-)([>ox]?)\s*/;
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
function originalId(id: string): string {
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

/** Whether text looks like a Mermaid flowchart (or another Mermaid diagram). */
export function looksLikeMermaid(source: string): boolean {
  const first = meaningfulLines(source)[0] ?? '';
  return HEADER.test(first) || OTHER_DIAGRAMS.test(first);
}

/** Source lines without blanks, `%%` comments or a `---` front-matter block. */
function meaningfulLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) lines.splice(0, end + 1);
  }
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
}

/** Split a line into `;`-separated statements, ignoring `;` inside text. */
function statements(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  let depth = 0;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && '[({'.includes(char)) depth++;
    else if (!quoted && '])}'.includes(char)) depth = Math.max(0, depth - 1);
    if (char === ';' && !quoted && depth === 0) {
      result.push(current);
      current = '';
    } else current += char;
  }
  result.push(current);
  return result.map((s) => s.trim()).filter(Boolean);
}

interface NodeRef {
  id: string;
  label?: string;
  shape?: Shape;
}

/** Read one node reference at the start of `text`: `id`, `id[label]`, `id{label}`… */
function readNode(text: string): { node: NodeRef; rest: string } | undefined {
  const trimmed = text.trimStart();
  const match = ID.exec(trimmed);
  if (!match) return undefined;
  const id = match[0];
  let rest = trimmed.slice(id.length);
  const node: NodeRef = { id };
  for (const [open, close, shape] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    const body = rest.slice(open.length);
    let end: number;
    if (body.trimStart().startsWith('"')) {
      const quoteStart = body.indexOf('"');
      const quoteEnd = body.indexOf('"', quoteStart + 1);
      end = quoteEnd < 0 ? -1 : body.indexOf(close, quoteEnd + 1);
    } else end = body.indexOf(close);
    if (end < 0) continue;
    node.label = mermaidText(body.slice(0, end));
    node.shape = shape;
    rest = body.slice(end + close.length);
    break;
  }
  // Class shorthand: `A:::important` styles the node; styles are not imported.
  rest = rest.replace(/^:::[\w-]+/, '');
  return { node, rest };
}

/** `A & B` — one or more nodes joined with ampersands. */
function readGroup(
  text: string,
): { nodes: NodeRef[]; rest: string } | undefined {
  const nodes: NodeRef[] = [];
  let rest = text;
  for (;;) {
    const read = readNode(rest);
    if (!read) return nodes.length ? { nodes, rest } : undefined;
    nodes.push(read.node);
    rest = read.rest;
    const amp = /^\s*&\s*/.exec(rest);
    if (!amp) return { nodes, rest };
    rest = rest.slice(amp[0].length);
  }
}

interface Link {
  label: string;
  dotted: boolean;
}
function readLink(text: string): { link: Link; rest: string } | undefined {
  const labelled = LABELLED_LINK.exec(text);
  if (labelled) {
    return {
      link: {
        label: mermaidText(labelled[3] ?? ''),
        dotted: labelled[2] === '-.',
      },
      rest: text.slice(labelled[0].length),
    };
  }
  const plain = LINK.exec(text);
  if (!plain) return undefined;
  let rest = text.slice(plain[0].length);
  let label = '';
  const piped = /^\|([^|]*)\|\s*/.exec(rest);
  if (piped) {
    label = mermaidText(piped[1] ?? '');
    rest = rest.slice(piped[0].length);
  }
  return {
    link: { label, dotted: (plain[2] ?? '').includes('.') },
    rest,
  };
}

/**
 * Import a Mermaid flowchart as a board: nodes become flowchart shapes,
 * subgraphs become groups, links become connections, and the result is laid
 * out in the chart's direction. Styling, click handlers and other diagram
 * types are not imported.
 */
export function importMermaid(source: string, name = 'Mermaid'): ImportResult {
  const warnings: string[] = [];
  const lines = meaningfulLines(source);
  const header = lines.shift() ?? '';
  const other = OTHER_DIAGRAMS.exec(header);
  if (other)
    throw Error(
      `Only Mermaid flowcharts can be imported; this is a ${other[1]} diagram`,
    );
  const head = HEADER.exec(header);
  if (!head)
    throw Error('Mermaid flowcharts start with "flowchart" or "graph"');
  const way = (head[2] ?? 'TB').toUpperCase();
  const direction: LayoutDirection =
    way === 'LR' || way === 'RL' ? 'right' : 'down';
  if (way === 'RL' || way === 'BT')
    warnings.push(
      `Direction ${way} is laid out as ${way === 'RL' ? 'LR' : 'TB'}`,
    );

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

  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const parents: string[] = [];
  const process = findService('flow.process');
  const ignored = new Set<string>();

  /** Whether `id` is `of` or one of its enclosing groups. */
  const isAncestor = (id: string, of: string): boolean => {
    for (let at: string | undefined = of; at; at = nodes.get(at)?.parentId)
      if (at === id) return true;
    return false;
  };
  const ensure = (ref: NodeRef): DiagramNode => {
    const id = originalId(ref.id);
    let node = nodes.get(id);
    if (!node) {
      if (nodes.size >= MAX_NODES)
        throw Error(`Mermaid import supports up to ${MAX_NODES} nodes`);
      const parentId = parents.at(-1);
      node = {
        id,
        kind: 'service',
        serviceId: 'flow.process',
        shape: 'process',
        label: ref.id,
        x: 0,
        z: 0,
        width: 160,
        depth: 100,
        color: process?.color ?? '#d9b677',
        ...(parentId ? { parentId } : {}),
      };
      nodes.set(id, node);
    }
    // As in Mermaid, mentioning a node inside a subgraph moves it there.
    const inside = parents.at(-1);
    if (inside && node.parentId !== inside && !isAncestor(node.id, inside))
      node.parentId = inside;
    if (ref.label !== undefined) node.label = ref.label;
    if (ref.shape && node.kind === 'service') {
      node.shape = ref.shape;
      node.serviceId = `flow.${ref.shape}`;
    }
    return node;
  };

  for (const line of lines)
    for (const statement of statements(line)) {
      const keyword = /^(\w+)\b/.exec(statement)?.[1] ?? '';
      if (keyword === 'subgraph') {
        // `subgraph id [Title]` may put a space before the title brackets.
        const rest = statement
          .slice('subgraph'.length)
          .trim()
          .replace(/^([\p{L}\p{N}_.-]+)\s+(?=\[)/u, '$1');
        const read = readNode(rest);
        const id = originalId(read?.node.id ?? `subgraph-${nodes.size}`);
        const label =
          read?.node.label ??
          (read && !read.rest.trim() ? read.node.id : mermaidText(rest));
        if (nodes.has(id)) {
          warnings.push(`Subgraph ${id} reuses a node name; renamed`);
        }
        const groupId = nodes.has(id) ? `${id}-group` : id;
        const parentId = parents.at(-1);
        nodes.set(groupId, {
          id: groupId,
          kind: 'group',
          label: label || groupId,
          x: 0,
          z: 0,
          width: 400,
          depth: 300,
          color: '#334d80',
          ...(parentId ? { parentId } : {}),
        });
        parents.push(groupId);
        continue;
      }
      if (keyword === 'end' && statement === 'end') {
        if (!parents.pop()) warnings.push('Ignored an "end" with no subgraph');
        continue;
      }
      if (
        [
          'direction',
          'classDef',
          'class',
          'style',
          'linkStyle',
          'click',
          'accTitle',
          'accDescr',
          'title',
        ].includes(keyword) &&
        !/^\w+\s*(-->|---|-\.|==|&|\[|\(|\{|>)/.test(statement)
      ) {
        if (!['direction', 'accTitle', 'accDescr'].includes(keyword))
          ignored.add(keyword);
        if (keyword === 'title') title = mermaidText(statement.slice(5));
        continue;
      }
      let group = readGroup(statement);
      if (!group) {
        warnings.push(`Skipped unreadable line: ${statement.slice(0, 80)}`);
        continue;
      }
      let from = group.nodes.map(ensure);
      let rest = group.rest;
      while (rest.trim()) {
        const read = readLink(rest);
        if (!read) break;
        group = readGroup(read.rest);
        if (!group) break;
        const to = group.nodes.map(ensure);
        for (const source of from)
          for (const target of to) {
            if (edges.length >= MAX_EDGES)
              throw Error(`Mermaid import supports up to ${MAX_EDGES} links`);
            edges.push({
              id: `edge-${edges.length + 1}`,
              source: source.id,
              target: target.id,
              label: read.link.label,
              ...(read.link.dotted
                ? { relationship: 'dependency' as const }
                : {}),
            });
          }
        from = to;
        rest = group.rest;
      }
      if (rest.trim())
        warnings.push(`Skipped unreadable text: ${rest.trim().slice(0, 80)}`);
    }
  if (parents.length) warnings.push('A subgraph was missing its "end"');
  if (ignored.size)
    warnings.push(
      `Styling and interaction lines were skipped (${[...ignored].sort().join(', ')})`,
    );

  // Captions written by this app's exporter: `%% Caption <id>: "text"`.
  for (const match of source.matchAll(
    /^\s*%%\s*Caption\s+(\S+):\s*(".*")\s*$/gm,
  )) {
    const node = nodes.get(originalId(match[1] ?? ''));
    try {
      const caption: unknown = JSON.parse(match[2] ?? '');
      if (node && typeof caption === 'string')
        node.journeyCaption = caption.slice(0, 1000);
    } catch {}
  }
  if (!nodes.size) throw Error('The flowchart has no nodes to import');

  const document: DiagramDocument = {
    version: 1,
    title: title.slice(0, 200),
    nodes: [...nodes.values()],
    edges,
  };
  return {
    document: layoutDocument(document, direction),
    warnings,
    format: 'Mermaid flowchart',
  };
}
