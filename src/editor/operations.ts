import type { DiagramDocument, DiagramNode } from '../domain/document';
import { worldPosition } from '../domain/document';
import type { Change, Edit } from '../domain/history';
import {
  cleanNetworkChanges,
  remapNetwork,
} from '../domain/network-references';

export function descendants(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
): Set<string> {
  const ids = new Set(selected);
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of doc.nodes)
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
  }
  return ids;
}
export function deleteNodes(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
): Edit {
  const ids = descendants(doc, selected);
  return {
    type: 'graph',
    label: 'Delete selection',
    nodes: cleanNetworkChanges(
      doc,
      doc.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => ({ id: n.id, value: null })),
    ),
    edges: doc.edges
      .filter((e) => ids.has(e.source) || ids.has(e.target))
      .map((e) => ({ id: e.id, value: null })),
  };
}
export function groupNodes(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
  id: string,
): Edit {
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  const roots = doc.nodes.filter(
    (n) => selected.has(n.id) && !hasSelectedParent(n, index, selected),
  );
  if (!roots.length) throw Error('Select components to group.');
  const positions = roots.map((n) => ({
    node: n,
    world: worldPosition(n, index),
  }));
  const left =
    Math.min(...positions.map(({ node, world }) => world.x - node.width / 2)) -
    40;
  const right =
    Math.max(...positions.map(({ node, world }) => world.x + node.width / 2)) +
    40;
  const top =
    Math.min(...positions.map(({ node, world }) => world.z - node.depth / 2)) -
    50;
  const bottom =
    Math.max(...positions.map(({ node, world }) => world.z + node.depth / 2)) +
    50;
  const group: DiagramNode = {
    id,
    kind: 'group',
    label: 'Group',
    x: (left + right) / 2,
    z: (top + bottom) / 2,
    width: right - left,
    depth: bottom - top,
    color: '#d9a15f',
  };
  return {
    type: 'graph',
    label: 'Group selection',
    nodes: [
      { id, value: group },
      ...positions.map(({ node, world }) => ({
        id: node.id,
        value: {
          ...node,
          parentId: id,
          x: world.x - group.x,
          z: world.z - group.z,
        },
      })),
    ],
  };
}
function hasSelectedParent(
  node: DiagramNode,
  index: ReadonlyMap<string, DiagramNode>,
  selected: ReadonlySet<string>,
): boolean {
  let parent = node.parentId;
  while (parent) {
    if (selected.has(parent)) return true;
    parent = index.get(parent)?.parentId;
  }
  return false;
}
export function ungroupNodes(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
): Edit {
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  const groups = new Set(
    doc.nodes
      .filter((n) => n.kind === 'group' && selected.has(n.id))
      .map((n) => n.id),
  );
  const nodes = doc.nodes.flatMap<Change<DiagramNode>>((node) => {
    if (groups.has(node.id)) return [{ id: node.id, value: null }];
    if (!node.parentId || !groups.has(node.parentId)) return [];
    const world = worldPosition(node, index);
    let parent = index.get(node.parentId)?.parentId;
    while (parent && groups.has(parent)) parent = index.get(parent)?.parentId;
    const origin = parent ? index.get(parent) : undefined;
    const offset = origin ? worldPosition(origin, index) : { x: 0, z: 0 };
    const value = { ...node, x: world.x - offset.x, z: world.z - offset.z };
    delete value.parentId;
    if (parent) value.parentId = parent;
    return [{ id: node.id, value }];
  });
  return {
    type: 'graph',
    label: 'Ungroup selection',
    nodes: cleanNetworkChanges(doc, nodes),
    edges: doc.edges
      .filter((e) => groups.has(e.source) || groups.has(e.target))
      .map((e) => ({ id: e.id, value: null })),
  };
}
export function copyFragment(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
): DiagramDocument {
  const ids = descendants(doc, selected);
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  return {
    version: 1,
    title: 'Selection',
    nodes: doc.nodes
      .filter((n) => ids.has(n.id))
      .map((node) => {
        const value = remapNetwork(
          node,
          new Map([...ids].map((id) => [id, id])),
        );
        // Clipboard fragments are standalone graphs; project links remain in the source.
        delete value.detailId;
        if (!value.parentId || !ids.has(value.parentId)) {
          const p = worldPosition(node, index);
          delete value.parentId;
          value.x = p.x;
          value.z = p.z;
        }
        return value;
      }),
    edges: doc.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => structuredClone(e)),
  };
}
export function pasteFragment(
  fragment: DiagramDocument,
  id: () => string,
  offset = 40,
): Edit {
  const ids = new Map(fragment.nodes.map((node) => [node.id, id()]));
  return {
    type: 'graph',
    label: 'Paste selection',
    nodes: fragment.nodes.map((node) => {
      const next = ids.get(node.id);
      if (!next) throw Error('Missing pasted node');
      const value = { ...remapNetwork(node, ids), id: next };
      if (node.parentId) {
        const parent = ids.get(node.parentId);
        if (parent) value.parentId = parent;
        else delete value.parentId;
      } else {
        value.x += offset;
        value.z += offset;
      }
      return { id: next, value };
    }),
    edges: fragment.edges.map((edge) => {
      const source = ids.get(edge.source),
        target = ids.get(edge.target);
      if (!source || !target) throw Error('Invalid clipboard connection');
      const next = id();
      return {
        id: next,
        value: { ...structuredClone(edge), id: next, source, target },
      };
    }),
  };
}

/** Search nearby free slots so adding components never stacks them invisibly. */
export function insertionSlot(
  doc: DiagramDocument,
  center: { x: number; z: number },
  width: number,
  depth: number,
): { x: number; z: number } {
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  const occupied = doc.nodes
    .filter((n) => n.kind !== 'group')
    .map((node) => ({ node, p: worldPosition(node, index) }));
  const stepX = Math.max(220, width + 60),
    stepZ = Math.max(200, depth + 100);
  for (let ring = 0; ring < 150; ring++)
    for (let z = -ring; z <= ring; z++)
      for (let x = -ring; x <= ring; x++) {
        if (ring && Math.abs(x) !== ring && Math.abs(z) !== ring) continue;
        const point = {
          x: Math.round((center.x + x * stepX) / 10) * 10,
          z: Math.round((center.z + z * stepZ) / 10) * 10,
        };
        if (
          occupied.every(
            ({ node, p }) =>
              Math.abs(point.x - p.x) > (width + node.width) / 2 + 25 ||
              // Room below each tile for its caption.
              Math.abs(point.z - p.z) > (depth + node.depth) / 2 + 90,
          )
        )
          return point;
      }
  throw Error('No nearby space for another component. Pan to an empty area.');
}

export type Alignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-z';
/**
 * Line up or evenly space the selected top-level nodes in world space.
 * Children of selected boundaries travel with their parent.
 */
export function alignNodes(
  doc: DiagramDocument,
  selected: ReadonlySet<string>,
  alignment: Alignment,
): Edit {
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  const items = doc.nodes
    .filter((n) => selected.has(n.id) && !hasSelectedParent(n, index, selected))
    .map((node) => {
      const p = worldPosition(node, index);
      return {
        node,
        x: p.x,
        z: p.z,
        minX: p.x - node.width / 2,
        maxX: p.x + node.width / 2,
        minZ: p.z - node.depth / 2,
        maxZ: p.z + node.depth / 2,
      };
    });
  const label =
    alignment === 'distribute-x' || alignment === 'distribute-z'
      ? 'Distribute selection'
      : 'Align selection';
  if (items.length < 2) return { type: 'graph', label, nodes: [] };
  const target = new Map<string, { x: number; z: number }>();
  const min = (key: 'minX' | 'minZ') => Math.min(...items.map((i) => i[key]));
  const max = (key: 'maxX' | 'maxZ') => Math.max(...items.map((i) => i[key]));
  for (const item of items) {
    const { node } = item;
    let { x, z } = item;
    if (alignment === 'left') x = min('minX') + node.width / 2;
    if (alignment === 'right') x = max('maxX') - node.width / 2;
    if (alignment === 'center') x = (min('minX') + max('maxX')) / 2;
    if (alignment === 'top') z = min('minZ') + node.depth / 2;
    if (alignment === 'bottom') z = max('maxZ') - node.depth / 2;
    if (alignment === 'middle') z = (min('minZ') + max('maxZ')) / 2;
    target.set(node.id, { x, z });
  }
  if (alignment === 'distribute-x' || alignment === 'distribute-z') {
    // Equal gaps between neighbours, keeping the outermost two in place.
    const horizontal = alignment === 'distribute-x';
    const sorted = [...items].sort((a, b) =>
      horizontal ? a.x - b.x : a.z - b.z,
    );
    const span = horizontal
      ? max('maxX') - min('minX')
      : max('maxZ') - min('minZ');
    const occupied = sorted.reduce(
      (sum, i) => sum + (horizontal ? i.node.width : i.node.depth),
      0,
    );
    const gap = (span - occupied) / (sorted.length - 1);
    let cursor = horizontal ? min('minX') : min('minZ');
    for (const item of sorted) {
      const size = horizontal ? item.node.width : item.node.depth;
      const centre = cursor + size / 2;
      target.set(item.node.id, {
        x: horizontal ? centre : item.x,
        z: horizontal ? item.z : centre,
      });
      cursor += size + gap;
    }
  }
  return {
    type: 'graph',
    label,
    nodes: items.flatMap(({ node, x, z }) => {
      const next = target.get(node.id);
      if (!next || (next.x === x && next.z === z)) return [];
      return [
        {
          id: node.id,
          value: {
            ...node,
            x: Math.round(node.x + next.x - x),
            z: Math.round(node.z + next.z - z),
          },
        },
      ];
    }),
  };
}
