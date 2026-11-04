import { findService } from '../catalog/services';
import type { DiagramEdge, DiagramNode, Port } from '../domain/document';
import { worldPosition } from '../domain/document';
import {
  chartTitle,
  finishChart,
  MAX_EDGES,
  MAX_NODES,
  mermaidText,
} from './mermaid-common';
import type { ImportResult } from './types';

const NAME = String.raw`[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*`;
/** `group id(icon)[Title] in parent`, `service …`, `junction id in parent`. */
const DECLARATION = new RegExp(
  String.raw`^(group|service|junction)\s+(${NAME})(?:\(([^)]*)\))?(?:\[([^\]]*)\])?(?:\s+in\s+(${NAME}))?\s*$`,
  'u',
);
/** `a{group}:R --> L:b`, with an optional `-[label]-` in the middle. */
const EDGE = new RegExp(
  String.raw`^(${NAME})(\{group\})?\s*:\s*([LRTB])\s*(<?)-(?:\[([^\]]*)\])?-(>?)\s*([LRTB])\s*:\s*(${NAME})(\{group\})?\s*$`,
  'u',
);
const SIDES: Record<string, Port> = {
  L: 'west',
  R: 'east',
  T: 'north',
  B: 'south',
};
const opposite: Record<Port, Port> = {
  west: 'east',
  east: 'west',
  north: 'south',
  south: 'north',
};

/**
 * The catalog component for an icon: `internet` is the Internet actor, and
 * iconify names such as `logos:aws-lambda` or `logos:docker-icon` resolve
 * to the matching AWS, Kubernetes or general component.
 */
function iconService(icon: string) {
  if (icon === 'internet') return findService('actor.internet');
  const name = icon
    .replace(/^[\w-]+:/, '')
    .replace(/-icon$/, '')
    .toLowerCase();
  // Mermaid's other built-in icons (cloud, database, disk, server) are plain.
  if (!icon.includes(':')) return undefined;
  const bare = name.replace(/^(aws|amazon|k8s|kubernetes)-/, '');
  for (const id of [
    `aws.${bare}`,
    `kubernetes.${bare}`,
    `component.${bare}`,
    `component.${name}`,
  ]) {
    const service = findService(id);
    if (service?.id === id) return service;
  }
  return undefined;
}

/**
 * Import a Mermaid architecture diagram: services become components (with
 * the catalog icon when the chart names one we have), groups become
 * boundaries, junctions become small joints, and edges keep the sides they
 * name where the layout allows.
 */
export function importArchitecture(
  source: string,
  lines: string[],
  name: string,
): ImportResult {
  const warnings: string[] = [];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const layoutEdges: DiagramEdge[] = [];
  const plainIcons = new Set<string>();
  const parentOf = new Map<string, string>();
  const process = findService('flow.process');
  let undirected = false;

  for (const line of lines) {
    const declaration = DECLARATION.exec(line);
    if (declaration) {
      const [, kind, id = '', icon = '', title, parent] = declaration;
      if (nodes.has(id)) {
        warnings.push(`${id} is declared twice; the first is kept`);
        continue;
      }
      if (nodes.size >= MAX_NODES)
        throw Error(`Mermaid import supports up to ${MAX_NODES} services`);
      const label = title === undefined ? id : mermaidText(title);
      const base = { id, label, x: 0, z: 0 };
      if (kind === 'group')
        nodes.set(id, {
          ...base,
          kind: 'group',
          width: 400,
          depth: 300,
          color: '#334d80',
        });
      else if (kind === 'junction')
        // A joint where links meet: a small dot with no caption.
        nodes.set(id, {
          ...base,
          label: '',
          kind: 'service',
          serviceId: 'flow.terminal',
          shape: 'terminal',
          width: 40,
          depth: 40,
          color: process?.color ?? '#d9b677',
        });
      else {
        const service = iconService(icon.trim());
        if (!service && icon.includes(':')) plainIcons.add(icon.trim());
        nodes.set(
          id,
          service
            ? {
                ...base,
                kind: 'service',
                serviceId: service.id,
                width: 160,
                depth: 100,
                color: service.color,
              }
            : {
                ...base,
                kind: 'service',
                serviceId: 'flow.process',
                shape: 'process',
                width: 160,
                depth: 100,
                color: process?.color ?? '#d9b677',
              },
        );
      }
      if (parent) parentOf.set(id, parent);
      continue;
    }
    const edge = EDGE.exec(line);
    if (edge) {
      const [
        ,
        a = '',
        aGroup,
        aSide = 'R',
        back,
        text,
        ahead,
        bSide = 'L',
        b = '',
        bGroup,
      ] = edge;
      // `{group}` attaches the link to the group around the service.
      const end = (id: string, group: string | undefined) =>
        group ? (parentOf.get(id) ?? id) : id;
      const from = end(a, aGroup),
        to = end(b, bGroup);
      const fromSide = SIDES[aSide] ?? 'east',
        toSide = SIDES[bSide] ?? 'west';
      const label = text ? mermaidText(text) : '';
      const link = (
        source: string,
        sourcePort: Port,
        target: string,
        targetPort: Port,
      ) => {
        if (edges.length >= MAX_EDGES)
          throw Error(`Mermaid import supports up to ${MAX_EDGES} links`);
        edges.push({
          id: `edge-${edges.length + 1}`,
          source,
          target,
          label,
          sourcePort,
          targetPort,
        });
      };
      if (!back && !ahead) undirected = true;
      if (back && !ahead) link(to, toSide, from, fromSide);
      else link(from, fromSide, to, toSide);
      if (back && ahead) link(to, toSide, from, fromSide);
      // Rank side-by-side pairs left to right, as the sides say they sit.
      // Pairs stacked above one another don't affect the left-to-right rank.
      if (fromSide === 'east' || fromSide === 'west')
        layoutEdges.push({
          id: `rank-${layoutEdges.length}`,
          source: fromSide === 'east' ? from : to,
          target: fromSide === 'east' ? to : from,
          label: '',
        });
      continue;
    }
    if (/^(title|accTitle|accDescr)\b/.test(line)) continue;
    warnings.push(`Skipped unreadable line: ${line.slice(0, 80)}`);
  }
  for (const [id, parent] of parentOf) {
    const node = nodes.get(id);
    if (!node) continue;
    if (nodes.get(parent)?.kind === 'group' && parent !== id)
      node.parentId = parent;
    else warnings.push(`${id} is in ${parent}, which is not a group`);
  }
  // Guard against groups that contain each other.
  for (const node of nodes.values()) {
    const seen = new Set<string>();
    for (let at: DiagramNode | undefined = node; at?.parentId; ) {
      if (seen.has(at.id)) {
        warnings.push(`Groups around ${node.id} contain each other`);
        delete node.parentId;
        break;
      }
      seen.add(at.id);
      at = nodes.get(at.parentId);
    }
  }
  const known = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  if (known.length < edges.length)
    warnings.push(
      `${edges.length - known.length} link(s) name a service that isn't declared`,
    );
  if (undirected)
    warnings.push('Links without arrowheads are drawn as one-way arrows');
  if (plainIcons.size)
    warnings.push(
      `Shown as plain tiles (no matching icon): ${[...plainIcons].sort().join(', ')}`,
    );
  const result = finishChart({
    title: chartTitle(source, name),
    nodes: [...nodes.values()],
    edges: known,
    layoutEdges: layoutEdges.filter(
      (e) => nodes.has(e.source) && nodes.has(e.target),
    ),
    direction: 'right',
    warnings,
    format: 'Mermaid architecture diagram',
  });
  // Keep a link's named sides only where they face each other after layout;
  // otherwise the router picks sides rather than looping around a tile.
  const index = new Map(result.document.nodes.map((n) => [n.id, n]));
  // The layout only ranks left to right. Where a link says one tile sits
  // above another in the same column, put them that way round.
  for (const edge of result.document.edges) {
    const a = index.get(edge.source),
      b = index.get(edge.target);
    if (!a || !b || a.parentId !== b.parentId || Math.abs(a.x - b.x) > 1)
      continue;
    const below =
      (edge.sourcePort === 'south' && b.z < a.z) ||
      (edge.sourcePort === 'north' && b.z > a.z);
    if (below) [a.z, b.z] = [b.z, a.z];
  }
  for (const edge of result.document.edges) {
    const a = index.get(edge.source),
      b = index.get(edge.target);
    if (!a || !b || !edge.sourcePort || !edge.targetPort) continue;
    const p = worldPosition(a, index),
      q = worldPosition(b, index);
    const toward: Record<Port, boolean> = {
      east: q.x - b.width / 2 >= p.x + a.width / 2,
      west: q.x + b.width / 2 <= p.x - a.width / 2,
      south: q.z - b.depth / 2 >= p.z + a.depth / 2,
      north: q.z + b.depth / 2 <= p.z - a.depth / 2,
    };
    if (
      !toward[edge.sourcePort] ||
      opposite[edge.sourcePort] !== edge.targetPort
    ) {
      delete edge.sourcePort;
      delete edge.targetPort;
    }
  }
  return result;
}
