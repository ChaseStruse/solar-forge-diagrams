import type { DiagramDocument, DiagramNode } from '../domain/document';
import { worldPosition } from '../domain/document';
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
    ? ['flowchart LR', `  %% Title: ${JSON.stringify(doc.title)}`]
    : [
        '@startuml',
        `title ${plantLabel(doc.title)}`,
        'left to right direction',
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
    if (depth > 256) throw Error('Diagram is too deeply nested to export');
    for (const node of children.get(parent) ?? []) {
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
      if (node.journeyCaption)
        lines.push(
          mermaid
            ? `${indent}%% Caption ${id}: ${JSON.stringify(node.journeyCaption)}`
            : `${indent}' Caption ${id}: ${JSON.stringify(node.journeyCaption)}`,
        );
      if (node.detailId)
        lines.push(
          mermaid
            ? `${indent}%% Detail ${id}: ${JSON.stringify(node.detailId)}`
            : `${indent}' Detail ${id}: ${JSON.stringify(node.detailId)}`,
        );
    }
  }
  visit(undefined, 0);
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
    for (const node of sorted(board.nodes)) {
      const parent = node.parentId ? index.get(node.parentId) : undefined;
      const position = worldPosition(node, index);
      // Editor centres become top-left positions relative to the parent in draw.io.
      const parentPosition = parent ? worldPosition(parent, index) : undefined;
      const x =
        position.x -
        node.width / 2 -
        (parent && parentPosition ? parentPosition.x - parent.width / 2 : 0);
      const y =
        position.z -
        node.depth / 2 -
        (parent && parentPosition ? parentPosition.z - parent.depth / 2 : 0);
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
      const cell = `<mxCell id="${stableId(node.id)}" value="${xml(node.label).replace(/\n/g, '&#10;')}" style="${style}" vertex="1" parent="${parent ? stableId(parent.id) : '1'}"><mxGeometry x="${x}" y="${y}" width="${node.width}" height="${node.depth}" as="geometry"/></mxCell>`;
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
