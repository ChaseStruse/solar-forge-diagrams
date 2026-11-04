import type { DiagramDocument, DiagramNode } from '../domain/document';
import { worldPosition } from '../domain/document';
import { LANE_HUES, laneBands, laneMembers, laneName } from '../domain/lanes';

/** Width of a draw.io lane's title strip, short of where the steps start. */
const LANE_TITLE = 180;
export type InterchangeFormat = 'mmd' | 'puml' | 'drawio';
const stableId = (id: string) =>
  `n${Array.from(new TextEncoder().encode(id), (n) => n.toString(16).padStart(2, '0')).join('')}`;
const sorted = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const xml = (value: string) =>
  value
    .replace(
      /[<>&"']/g,
      (char) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[char] ?? char,
    )
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('');
// Mermaid entity codes keep user text out of the diagram grammar and HTML.
const mermaidLabel = (value: string) =>
  Array.from(value, (char) =>
    char === '\n'
      ? '<br/>'
      : /[\p{L}\p{N} _-]/u.test(char)
        ? char
        : `#${char.codePointAt(0)};`,
  ).join('');
// PlantUML's Unicode escapes keep labels from injecting directives or Creole markup.
const plantLabel = (value: string) =>
  Array.from(value, (char) =>
    char === '\n'
      ? '\\n'
      : /[\p{L}\p{N} _.,:-]/u.test(char)
        ? char
        : `<U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}>`,
  ).join('');

function textDiagram(doc: DiagramDocument, format: 'mmd' | 'puml'): string {
  const mermaid = format === 'mmd';
  const label = mermaid ? mermaidLabel : plantLabel;
  const lines = mermaid
    ? [
        // Mermaid has no swimlanes: lanes become subgraphs and the chart
        // follows the flow, downwards when lanes are columns.
        `flowchart ${doc.lanes?.direction === 'down' ? 'TB' : 'LR'}`,
        `  %% Title: ${JSON.stringify(doc.title)}`,
      ]
    : [
        '@startuml',
        `title ${plantLabel(doc.title)}`,
        ...(doc.lanes?.direction === 'down' ? [] : ['left to right direction']),
        'skinparam shadowing false',
      ];
  const nodes = sorted(doc.nodes);
  const children = new Map<string | undefined, DiagramNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  function visit(parent: string | undefined, depth: number): void {
    for (const node of children.get(parent) ?? []) emit(node, depth);
  }
  function emit(node: DiagramNode, depth: number): void {
    if (depth > 256) throw Error('Diagram is too deeply nested to export');
    const indent = '  '.repeat(depth + 1);
    const id = stableId(node.id),
      text = label(node.label);
    const group = node.kind === 'group' && children.has(node.id);
    if (group) {
      lines.push(
        mermaid
          ? `${indent}subgraph ${id}["${text}"]`
          : `${indent}package "${text}" as ${id} {`,
      );
      visit(node.id, depth + 1);
      lines.push(indent + (mermaid ? 'end' : '}'));
    } else if (mermaid) {
      const [open, close] =
        node.shape === 'decision'
          ? ['{', '}']
          : node.shape === 'terminal'
            ? ['([', '])']
            : ['[', ']'];
      lines.push(`${indent}${id}${open}"${text}"${close}`);
    } else {
      lines.push(
        `${indent}${node.kind === 'note' ? 'artifact' : 'rectangle'} "${text}" as ${id} ${node.color}`,
      );
    }
    const comment = mermaid ? '%%' : "'";
    if (node.journeyCaption)
      lines.push(
        `${indent}${comment} Caption ${id}: ${JSON.stringify(node.journeyCaption)}`,
      );
    if (node.detailId)
      lines.push(
        `${indent}${comment} Detail ${id}: ${JSON.stringify(node.detailId)}`,
      );
    if (node.owner)
      lines.push(
        `${indent}${comment} Owner ${id}: ${JSON.stringify(node.owner)}`,
      );
  }
  const lanes = laneMembers(doc);
  if (lanes.length) {
    // Lanes wrap the top-level steps; their IDs can't clash with node IDs,
    // which all start with `n`. The comment keeps the owner (and an empty
    // Unassigned owner) for re-import.
    const inLane = new Set(lanes.flatMap((lane) => lane.nodes));
    for (const [i, lane] of lanes.entries()) {
      const id = `lane${i}`,
        text = label(laneName(lane.owner));
      lines.push(
        mermaid
          ? `  subgraph ${id}["${text}"]`
          : `  rectangle "${text}" <<lane>> as ${id} {`,
        mermaid
          ? `    %% Lane ${id}: ${JSON.stringify(lane.owner)}`
          : `    ' Lane ${id}: ${JSON.stringify(lane.owner)}`,
      );
      for (const node of sorted(lane.nodes)) emit(node, 1);
      lines.push(mermaid ? '  end' : '  }');
    }
    for (const node of children.get(undefined) ?? [])
      if (!inLane.has(node)) emit(node, 0);
  } else visit(undefined, 0);
  for (const edge of sorted(doc.edges)) {
    const source = stableId(edge.source),
      target = stableId(edge.target);
    const text = edge.label ? label(edge.label) : '';
    if (mermaid)
      lines.push(
        `  ${source} ${edge.relationship === 'dependency' ? '-.->' : '-->'}${text ? `|"${text}"|` : ''} ${target}`,
      );
    else
      lines.push(
        `  ${source} ${edge.relationship === 'dependency' ? '..>' : '-->'} ${target}${text ? ` : ${text}` : ''}`,
      );
  }
  if (!mermaid) lines.push('@enduml');
  return `${lines.join('\n')}\n`;
}

function drawio(doc: DiagramDocument): string {
  const boards = [
    { id: undefined as string | undefined, document: doc },
    ...sorted(doc.details ?? []),
  ];
  const pages = boards.map(({ id, document: board }) => {
    const index = new Map(board.nodes.map((node) => [node.id, node]));
    const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
    // Lanes become draw.io swimlanes holding their top-level steps, placed
    // where the editor draws the bands.
    const lanes = new Map<string, { id: string; x: number; y: number }>();
    const bands = laneBands(board);
    const down = bands?.direction === 'down';
    for (const [i, lane] of laneMembers(board).entries()) {
      const band = bands?.bands.find((b) => b.owner === lane.owner);
      if (!bands || !band) continue;
      const id = `lane${i}`;
      const x = down ? band.start : bands.from;
      const y = down ? bands.from : band.start;
      const along = bands.to - bands.from,
        across = band.end - band.start;
      const hue =
        LANE_HUES[bands.bands.indexOf(band) % LANE_HUES.length] ?? '#35e0f0';
      cells.push(
        `<mxCell id="${id}" value="${xml(laneName(lane.owner))}" style="swimlane;horizontal=${down ? 1 : 0};startSize=${LANE_TITLE};container=1;collapsible=0;html=0;fontStyle=1;fillColor=${hue};swimlaneFillColor=#ffffff;strokeColor=#475569;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${down ? across : along}" height="${down ? along : across}" as="geometry"/></mxCell>`,
      );
      for (const node of lane.nodes) lanes.set(node.id, { id, x, y });
    }
    for (const node of sorted(board.nodes)) {
      const parent = node.parentId ? index.get(node.parentId) : undefined;
      const lane = lanes.get(node.id);
      const position = worldPosition(node, index);
      // Editor centres become top-left positions relative to the parent in draw.io.
      const parentPosition = parent ? worldPosition(parent, index) : undefined;
      const x =
        position.x -
        node.width / 2 -
        (parent && parentPosition
          ? parentPosition.x - parent.width / 2
          : (lane?.x ?? 0));
      const y =
        position.z -
        node.depth / 2 -
        (parent && parentPosition
          ? parentPosition.z - parent.depth / 2
          : (lane?.y ?? 0));
      const shape =
        node.kind === 'group'
          ? 'rounded=0;container=1;recursiveResize=0;verticalAlign=top;'
          : node.shape === 'decision'
            ? 'rhombus;'
            : node.shape === 'terminal'
              ? 'rounded=1;'
              : node.kind === 'note'
                ? 'shape=note;'
                : 'rounded=0;';
      const style = `${shape}whiteSpace=wrap;html=0;fillColor=${node.color};fontColor=#111827;strokeColor=#475569;`;
      const cell = `<mxCell id="${stableId(node.id)}" value="${xml(node.label).replace(/\n/g, '&#10;')}" style="${style}" vertex="1" parent="${parent ? stableId(parent.id) : (lane?.id ?? '1')}"><mxGeometry x="${x}" y="${y}" width="${node.width}" height="${node.depth}" as="geometry"/></mxCell>`;
      cells.push(
        node.detailId
          ? `<object id="${stableId(node.id)}" label="${xml(node.label).replace(/\n/g, '&#10;')}" link="data:page/id,${xml(stableId(node.detailId))}">${cell.replace(` id="${stableId(node.id)}"`, '')}</object>`
          : cell,
      );
    }
    for (const edge of sorted(board.edges))
      cells.push(
        `<mxCell id="e${stableId(edge.id)}" value="${xml(edge.label).replace(/\n/g, '&#10;')}" edge="1" parent="1" source="${stableId(edge.source)}" target="${stableId(edge.target)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;endArrow=block;${edge.relationship === 'dependency' ? 'dashed=1;' : ''}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      );
    return `<diagram id="${id === undefined ? 'overview' : stableId(id)}" name="${xml(board.title)}"><mxGraphModel grid="1" gridSize="10"><root>${cells.join('')}</root></mxGraphModel></diagram>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Solar Forge">${pages.join('')}</mxfile>\n`;
}
/** Mermaid/PlantUML describe the active board; draw.io includes all linked project boards. */
export function exportInterchange(
  doc: DiagramDocument,
  format: InterchangeFormat,
): string {
  return format === 'drawio' ? drawio(doc) : textDiagram(doc, format);
}
