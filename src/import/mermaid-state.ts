import { findService } from '../catalog/services';
import type { DiagramEdge, DiagramNode } from '../domain/document';
import type { LayoutDirection } from '../domain/layout';
import {
  chartTitle,
  finishChart,
  MAX_EDGES,
  MAX_NODES,
  mermaidText,
} from './mermaid-common';
import { MermaidStyles } from './mermaid-styles';
import type { ImportResult } from './types';

/** State names: words, with `-` or `.` between word characters. */
const NAME = String.raw`[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*`;
/** `[*]` or a state, with optional `:::class` shorthand. */
const END = String.raw`(\[\*\]|${NAME})(?::::([\w-]+))?`;
const TRANSITION = new RegExp(
  String.raw`^${END}\s*(-->|<--)\s*${END}\s*(?::\s*(.*))?$`,
  'u',
);
/** `State:::class` on its own line. */
const SHORTHAND = new RegExp(String.raw`^(${NAME}):::([\w-]+)$`, 'u');
const DESCRIPTION = new RegExp(String.raw`^(${NAME})\s*:\s*(.+)$`, 'u');
const STATE = new RegExp(
  String.raw`^state\s+(?:("[^"]*")\s+as\s+(${NAME})|(${NAME})(?:\s+as\s+("[^"]*"))?)\s*(<<\s*(choice|fork|join)\s*>>)?\s*(\{)?\s*$`,
  'u',
);
const NOTE = new RegExp(
  String.raw`^note\s+(left|right)\s+of\s+(${NAME})\s*(?::\s*(.*))?$`,
  'u',
);

/**
 * Import a Mermaid state diagram: states become process steps, `[*]` becomes
 * a Start or End in each scope, choices become decisions, composite states
 * become groups, and notes become sticky notes.
 */
export function importStateDiagram(
  source: string,
  lines: string[],
  name: string,
): ImportResult {
  const warnings: string[] = [];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const scopes: string[] = [];
  const styles = new MermaidStyles();
  const process = findService('flow.process');
  const terminal = findService('flow.terminal');
  const decision = findService('flow.decision');
  let direction: LayoutDirection = 'down';
  let notes = 0;
  let concurrent = false;
  const placed: { note: DiagramNode; anchor: DiagramNode; side: string }[] = [];
  const skipped = new Set<string>();

  const add = (node: DiagramNode) => {
    if (nodes.size >= MAX_NODES)
      throw Error(`Mermaid import supports up to ${MAX_NODES} states`);
    const parentId = scopes.at(-1);
    if (parentId) node.parentId = parentId;
    nodes.set(node.id, node);
    return node;
  };
  const state = (id: string): DiagramNode =>
    nodes.get(id) ??
    add({
      id,
      kind: 'service',
      serviceId: 'flow.process',
      shape: 'process',
      label: id,
      x: 0,
      z: 0,
      width: 160,
      depth: 100,
      color: process?.color ?? '#d9b677',
    });
  /** `[*]` is the scope's Start when a transition leaves it, else its End. */
  const pseudo = (start: boolean): DiagramNode => {
    const scope = scopes.at(-1) ?? '';
    const id = `[*]${start ? 'start' : 'end'}:${scope}`;
    return (
      nodes.get(id) ??
      add({
        id,
        kind: 'service',
        serviceId: 'flow.terminal',
        shape: 'terminal',
        label: start ? 'Start' : 'End',
        x: 0,
        z: 0,
        width: 160,
        depth: 100,
        color: terminal?.color ?? '#d9b677',
      })
    );
  };
  const end = (id: string, cls: string | undefined, start: boolean) => {
    const node = id === '[*]' ? pseudo(start) : state(id);
    if (cls) styles.addClass(node.id, cls);
    return node;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const keyword = /^(\w+)\b/.exec(line)?.[1] ?? '';
    if (keyword === 'direction' && !scopes.length) {
      const way = /^direction\s+(TB|TD|BT|LR|RL)\b/i.exec(line)?.[1];
      if (way) direction = /LR|RL/i.test(way) ? 'right' : 'down';
      continue;
    }
    if (
      ['direction', 'hide', 'scale', 'accTitle', 'accDescr'].includes(keyword)
    )
      continue;
    if (keyword === 'title') continue;
    if (['classDef', 'class', 'style'].includes(keyword)) {
      if (!styles.read(line))
        warnings.push(`Skipped unreadable style: ${line.slice(0, 80)}`);
      continue;
    }
    if (line === '}') {
      if (!scopes.pop()) warnings.push('Ignored a "}" with no composite state');
      continue;
    }
    if (line === '--') {
      concurrent = true;
      continue;
    }
    const transition = TRANSITION.exec(line);
    if (transition) {
      const [, a = '', aClass, arrow, b = '', bClass, label] = transition;
      // `B <-- A` reads right to left.
      const forward = arrow === '-->';
      const source = end(forward ? a : b, forward ? aClass : bClass, true);
      const target = end(forward ? b : a, forward ? bClass : aClass, false);
      if (edges.length >= MAX_EDGES)
        throw Error(`Mermaid import supports up to ${MAX_EDGES} transitions`);
      edges.push({
        id: `edge-${edges.length + 1}`,
        source: source.id,
        target: target.id,
        label: label ? mermaidText(label) : '',
      });
      continue;
    }
    const declared = STATE.exec(line);
    if (declared) {
      const [, quoted, alias, plain, quotedAfter, , special, composite] =
        declared;
      const id = alias ?? plain ?? '';
      const node = state(id);
      const text = quoted ?? quotedAfter;
      if (text) node.label = mermaidText(text);
      if (special === 'choice') {
        node.shape = 'decision';
        node.serviceId = 'flow.decision';
        node.color = decision?.color ?? node.color;
      } else if (special) {
        // Forks and joins are bars in Mermaid; a short step reads the same.
        node.label = text ? node.label : special === 'fork' ? 'Fork' : 'Join';
        node.depth = 60;
      }
      if (composite) {
        node.kind = 'group';
        delete node.serviceId;
        delete node.shape;
        node.width = 400;
        node.depth = 300;
        node.color = '#334d80';
        scopes.push(id);
      }
      continue;
    }
    const note = NOTE.exec(line);
    if (note) {
      const [, , target = '', inline] = note;
      let text = inline ?? '';
      if (inline === undefined) {
        const body: string[] = [];
        while (++i < lines.length && !/^end\s+note$/i.test(lines[i] ?? ''))
          body.push(lines[i] ?? '');
        text = body.join('\n');
      }
      const anchor = nodes.get(target);
      const node: DiagramNode = {
        id: `note-${++notes}`,
        kind: 'note',
        label: mermaidText(text) || 'Note',
        x: 0,
        z: 0,
        width: 220,
        depth: 120,
        fontSize: 18,
        color: '#ffe98a',
      };
      // A note sits beside its state, inside the same composite state.
      add(node);
      if (anchor) placed.push({ note: node, anchor, side: note[1] ?? 'right' });
      if (anchor?.parentId) node.parentId = anchor.parentId;
      else if (anchor) delete node.parentId;
      continue;
    }
    const shorthand = SHORTHAND.exec(line);
    if (shorthand) {
      styles.addClass(state(shorthand[1] ?? '').id, shorthand[2] ?? '');
      continue;
    }
    const description = DESCRIPTION.exec(line);
    if (description) {
      const [, id = '', text = ''] = description;
      const node = state(id);
      // Each `S : text` adds a line under the state's name.
      node.label = `${node.label}\n${mermaidText(text)}`;
      continue;
    }
    skipped.add(line.slice(0, 80));
  }
  if (scopes.length) warnings.push('A composite state was missing its "}"');
  if (concurrent)
    warnings.push('Concurrent regions (--) are shown together in one group');
  for (const line of skipped) warnings.push(`Skipped unreadable line: ${line}`);
  if (styles.unreadable.length)
    warnings.push(
      `${styles.unreadable.length} style line(s) set no fill or stroke colour the board can show`,
    );
  const missing = styles.undefinedClasses;
  if (missing.length)
    warnings.push(`Classes used but never defined: ${missing.join(', ')}`);
  for (const [id, node] of nodes) {
    const color = styles.colorOf(id);
    if (color) node.color = color;
  }
  const result = finishChart({
    title: chartTitle(source, name),
    nodes: [...nodes.values()],
    edges,
    direction,
    warnings,
    format: 'Mermaid state diagram',
  });
  // Move top-level notes beside their state, a little above it, on the side
  // the chart asks for. Notes in a composite keep their laid-out place, so
  // they stay inside it.
  const laid = new Map(result.document.nodes.map((n) => [n.id, n]));
  for (const { note, anchor, side } of placed) {
    const n = laid.get(note.id),
      a = laid.get(anchor.id);
    if (!n || !a || n.parentId || a.parentId) continue;
    const gap = 40;
    n.x = a.x + (side === 'left' ? -1 : 1) * (a.width / 2 + n.width / 2 + gap);
    n.z = a.z - a.depth / 2 - n.depth / 2 - gap;
  }
  return result;
}
