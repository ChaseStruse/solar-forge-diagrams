import { findService } from '../catalog/services';
import type { DiagramEdge, DiagramNode } from '../domain/document';
import type { LayoutDirection } from '../domain/layout';
import { importArchitecture } from './mermaid-architecture';
import {
  addEdge,
  chartTitle,
  exporterComments,
  finishChart,
  MAX_NODES,
  meaningfulLines,
  mermaidText,
  originalId,
  trimOwner,
} from './mermaid-common';
import { importStateDiagram } from './mermaid-state';
import { MermaidStyles } from './mermaid-styles';
import type { ImportResult } from './types';

export { mermaidText } from './mermaid-common';

/** Mermaid diagram types the importer can't read, for a clear refusal. */
const OTHER_DIAGRAMS =
  /^(sequenceDiagram|classDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w+|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture)\b/;
const STATE = /^stateDiagram(-v2)?\s*$/;
const ARCHITECTURE = /^architecture-beta\s*$/;
const HEADER = /^(flowchart|graph)\b(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i;

export interface MermaidOptions {
  /** Top-level subgraphs become swimlanes, named for their owners. */
  subgraphLanes?: boolean;
}

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
/** Whether text looks like a Mermaid chart the importer knows (or refuses). */
export function looksLikeMermaid(source: string): boolean {
  const first = meaningfulLines(source)[0] ?? '';
  return (
    HEADER.test(first) ||
    STATE.test(first) ||
    ARCHITECTURE.test(first) ||
    OTHER_DIAGRAMS.test(first)
  );
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
  /** Classes from `:::name` shorthand. */
  classes?: string[];
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
  // Class shorthand: `A:::important` styles the node.
  const shorthand = /^:::([\w-]+)/.exec(rest);
  if (shorthand?.[1]) {
    node.classes = [shorthand[1]];
    rest = rest.slice(shorthand[0].length);
  }
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
 * Import a Mermaid chart as a board. Flowcharts, state diagrams and
 * architecture diagrams are read; other Mermaid diagrams are refused.
 */
export function importMermaid(
  source: string,
  name = 'Mermaid',
  options: MermaidOptions = {},
): ImportResult {
  const lines = meaningfulLines(source);
  const header = lines.shift() ?? '';
  if (STATE.test(header)) return importStateDiagram(source, lines, name);
  if (ARCHITECTURE.test(header)) return importArchitecture(source, lines, name);
  const other = OTHER_DIAGRAMS.exec(header);
  if (other)
    throw Error(
      `Mermaid ${other[1]} diagrams can't be imported; use a flowchart, state or architecture diagram`,
    );
  const head = HEADER.exec(header);
  if (!head)
    throw Error(
      'Mermaid charts start with "flowchart", "graph", "stateDiagram-v2" or "architecture-beta"',
    );
  return importFlowchart(source, lines, name, head[2] ?? 'TB', options);
}

/**
 * Flowcharts: nodes become flowchart shapes, subgraphs become groups (or
 * swimlanes), links become connections, and styles become tile colours.
 */
function importFlowchart(
  source: string,
  lines: string[],
  name: string,
  written: string,
  options: MermaidOptions,
): ImportResult {
  const warnings: string[] = [];
  const way = written.toUpperCase();
  const direction: LayoutDirection =
    way === 'LR' || way === 'RL' ? 'right' : 'down';
  if (way === 'RL' || way === 'BT')
    warnings.push(
      `Direction ${way} is laid out as ${way === 'RL' ? 'LR' : 'TB'}`,
    );
  let title = chartTitle(source, name);

  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const parents: string[] = [];
  const process = findService('flow.process');
  const ignored = new Set<string>();
  const styles = new MermaidStyles();
  /** Each node's id as written in the chart, for styles and comments. */
  const writtenIds = new Map<string, string>();

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
      writtenIds.set(id, ref.id);
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
    for (const name of ref.classes ?? []) styles.addClass(ref.id, name);
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
        const writtenId = read?.node.id ?? `subgraph-${nodes.size}`;
        const id = originalId(writtenId);
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
        writtenIds.set(groupId, writtenId);
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
        if (['classDef', 'class', 'style'].includes(keyword)) {
          if (!styles.read(statement))
            warnings.push(
              `Skipped unreadable style: ${statement.slice(0, 80)}`,
            );
        } else if (!['direction', 'accTitle', 'accDescr'].includes(keyword))
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
            addEdge(edges, 'links', {
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
      `Interaction and link styling lines were skipped (${[...ignored].sort().join(', ')})`,
    );
  styles.apply(nodes, warnings, (id) => writtenIds.get(id) ?? id);

  // Comments written by this app's exporter: captions and owners.
  for (const [writtenId, caption] of exporterComments(source, 'Caption')) {
    const node = nodes.get(originalId(writtenId));
    if (node) node.journeyCaption = caption.slice(0, 1000);
  }
  for (const [writtenId, owner] of exporterComments(source, 'Owner')) {
    const node = nodes.get(originalId(writtenId));
    if (node && trimOwner(owner)) node.owner = trimOwner(owner);
  }
  const lanes = subgraphLanes(source, nodes, writtenIds, edges, options);
  if (lanes.dropped)
    warnings.push(
      `${lanes.dropped} link(s) to a whole lane were skipped; lanes are not steps`,
    );

  return finishChart({
    title,
    nodes: [...nodes.values()],
    edges: lanes.edges,
    direction,
    warnings,
    format: 'Mermaid flowchart',
    ...(lanes.order ? { lanes: lanes.order } : {}),
  });
}

/**
 * Turn lane subgraphs into owners. Lanes are the subgraphs this app's
 * exporter marked with `%% Lane`, or every top-level subgraph when asked.
 * Their contents move to the top level, owned by the lane, and the subgraph
 * itself goes away.
 */
function subgraphLanes(
  source: string,
  nodes: Map<string, DiagramNode>,
  writtenIds: Map<string, string>,
  edges: DiagramEdge[],
  options: MermaidOptions,
): { order?: string[]; edges: DiagramEdge[]; dropped: number } {
  const marked = exporterComments(source, 'Lane');
  const lanes = [...nodes.values()].filter((node) => {
    if (node.kind !== 'group' || node.parentId !== undefined) return false;
    return options.subgraphLanes || marked.has(writtenIds.get(node.id) ?? '');
  });
  if (!lanes.length) return { edges, dropped: 0 };
  const order: string[] = [];
  for (const lane of lanes) {
    const comment = marked.get(writtenIds.get(lane.id) ?? '');
    const owner = trimOwner(comment ?? lane.label.replace(/\s+/g, ' '));
    if (!order.includes(owner)) order.push(owner);
    for (const node of nodes.values()) {
      if (node.parentId !== lane.id) continue;
      delete node.parentId;
      if (owner) node.owner = owner;
      else delete node.owner;
    }
    nodes.delete(lane.id);
  }
  const kept = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  return { order, edges: kept, dropped: edges.length - kept.length };
}
