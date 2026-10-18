import type { DiagramDocument, DiagramNode } from './document';
import type { Edit } from './history';

const GAP_X = 120,
  GAP_Z = 120,
  PADDING = 70,
  HEADER = 70;
const grid = (n: number) => Math.ceil(n / 10) * 10;
/** Deterministic layered packing, from the innermost boundary outwards. */
export function layoutDocument(input: DiagramDocument): DiagramDocument {
  const doc = structuredClone(input);
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const children = new Map<string | undefined, DiagramNode[]>();
  for (const n of doc.nodes) {
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  const rootOf = (
    id: string,
    parent: string | undefined,
  ): string | undefined => {
    let n = nodes.get(id);
    const visited = new Set<string>();
    while (n && n.parentId !== parent) {
      if (visited.has(n.id))
        throw Error('Layout cannot contain a boundary cycle');
      visited.add(n.id);
      n = n.parentId ? nodes.get(n.parentId) : undefined;
    }
    return n?.id;
  };
  const visiting = new Set<string>();
  const pack = (parent?: DiagramNode): void => {
    const list = children.get(parent?.id) ?? [];
    if (parent) {
      if (visiting.has(parent.id)) throw Error('Boundary cycle');
      visiting.add(parent.id);
    }
    for (const n of list) if (n.kind === 'group') pack(n);
    if (!list.length) {
      if (parent) visiting.delete(parent.id);
      return;
    }
    const adjacent = new Map(list.map((n) => [n.id, new Set<string>()]));
    const degree = new Map(list.map((n) => [n.id, 0]));
    for (const e of doc.edges) {
      const a = rootOf(e.source, parent?.id),
        b = rootOf(e.target, parent?.id);
      if (a && b && a !== b && !adjacent.get(a)?.has(b)) {
        adjacent.get(a)?.add(b);
        degree.set(b, (degree.get(b) ?? 0) + 1);
      }
    }
    const rank = new Map(list.map((n) => [n.id, 0]));
    const queue = list
      .filter((n) => !degree.get(n.id))
      .map((n) => n.id)
      .sort();
    const placed = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (!id) continue;
      placed.add(id);
      for (const next of adjacent.get(id) ?? []) {
        rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
        degree.set(next, (degree.get(next) ?? 0) - 1);
        if (!degree.get(next)) queue.push(next);
      }
    }
    // Cycles share a final layer; packing still guarantees no intersections.
    const cycleRank = Math.max(0, ...rank.values()) + 1;
    for (const n of list) if (!placed.has(n.id)) rank.set(n.id, cycleRank);
    const columns = new Map<number, DiagramNode[]>();
    for (const n of list) {
      const r = rank.get(n.id) ?? 0;
      const column = columns.get(r) ?? [];
      column.push(n);
      columns.set(r, column);
    }
    let x = 0,
      maxDepth = 0;
    for (const [, column] of [...columns].sort((a, b) => a[0] - b[0])) {
      column.sort((a, b) => a.id.localeCompare(b.id));
      // Wrap wide independent sets into rows instead of a very tall column.
      const slots = Math.max(1, Math.ceil(Math.sqrt(column.length)));
      const columnWidth = Math.max(...column.map((n) => n.width));
      let z = 0;
      for (let i = 0; i < column.length; i += slots) {
        const row = column.slice(i, i + slots);
        const depth = Math.max(...row.map((n) => n.depth));
        for (const [j, n] of row.entries()) {
          n.x = grid(x + j * (columnWidth + GAP_X) + columnWidth / 2);
          n.z = grid(z + depth / 2);
        }
        z += depth + GAP_Z;
      }
      x += slots * (columnWidth + GAP_X);
      maxDepth = Math.max(maxDepth, z - GAP_Z);
    }
    const width = x - GAP_X,
      depth = maxDepth;
    for (const n of list) {
      n.x = grid(n.x - width / 2);
      n.z = grid(n.z - depth / 2 + HEADER / 2);
    }
    if (parent) {
      parent.width = grid(width + PADDING * 2);
      parent.depth = grid(depth + PADDING * 2 + HEADER);
      visiting.delete(parent.id);
    }
  };
  pack();
  // Rerouting should use the newly placed geometry rather than old manual bends.
  for (const e of doc.edges) {
    delete e.bend;
    delete e.sourcePort;
    delete e.targetPort;
    delete e.routing;
  }
  return doc;
}
export function layoutEdit(doc: DiagramDocument): Edit {
  const laid = layoutDocument(doc);
  return {
    type: 'graph',
    label: 'Automatic layout',
    nodes: laid.nodes.map((value) => ({ id: value.id, value })),
    edges: laid.edges.map((value) => ({ id: value.id, value })),
  };
}
