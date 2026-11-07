import type { DiagramDocument, DiagramNode } from './document';
import { type FlowSlot, flowLayers, flowPositions } from './flow-layout';
import type { Edit } from './history';

const GAP_X = 120,
  GAP_Z = 120,
  PADDING = 70,
  HEADER = 70;
const grid = (n: number) => Math.ceil(n / 10) * 10;
/** Space between flowchart layers, leaving room for link labels. */
const FLOW_GAP = 200;
/** Which way flow runs: layers advance left to right, or top to bottom. */
export type LayoutDirection = 'right' | 'down';
/**
 * `packed` wraps a large layer into a compact grid, which suits
 * architecture boards. `flow` keeps every layer in one centred line across
 * the flow, ordered under its predecessors, which suits flowcharts.
 */
export type LayoutStyle = 'packed' | 'flow';
/** Deterministic layered packing, from the innermost boundary outwards. */
export function layoutDocument(
  input: DiagramDocument,
  direction: LayoutDirection = 'right',
  style: LayoutStyle = 'packed',
): DiagramDocument {
  const doc = structuredClone(input);
  const down = direction === 'down';
  // Layers advance along the main axis; a layer's members spread across it.
  const along = (n: DiagramNode) => (down ? n.depth : n.width);
  const across = (n: DiagramNode) => (down ? n.width : n.depth);
  const place = (n: DiagramNode, main: number, cross: number) => {
    n.x = grid(down ? cross : main);
    n.z = grid(down ? main : cross);
  };
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
    /** Members entered by a link from outside this container. */
    const entries = new Set<string>();
    for (const e of doc.edges) {
      const a = rootOf(e.source, parent?.id),
        b = rootOf(e.target, parent?.id);
      if (!a && b) entries.add(b);
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
    // Flowcharts leave room between layers for link labels.
    const gapAlong = style === 'flow' ? FLOW_GAP : down ? GAP_Z : GAP_X,
      gapAcross = down ? GAP_X : GAP_Z;
    let main = 0,
      maxCross = 0;
    const ordered = [...columns].sort((a, b) => a[0] - b[0]);
    if (style === 'flow') {
      const byId = new Map(list.map((n) => [n.id, n]));
      // A link passing through a layer reserves a narrow lane there.
      const LANE = 60;
      const size = (slot: FlowSlot) => {
        const node = slot.virtual ? undefined : byId.get(slot.id);
        return node ? across(node) : LANE;
      };
      const flow = flowLayers(
        list.map((n) => n.id),
        adjacent,
        entries,
      );
      const centres = flowPositions(flow, size, gapAcross);
      // Measure from the leftmost edge so every slot sits at cross >= 0.
      let low = Number.POSITIVE_INFINITY,
        high = Number.NEGATIVE_INFINITY;
      for (const layer of flow.layers)
        for (const slot of layer) {
          const c = centres.get(slot.id) ?? 0;
          low = Math.min(low, c - size(slot) / 2);
          high = Math.max(high, c + size(slot) / 2);
        }
      maxCross = Number.isFinite(low) ? high - low : 0;
      for (const layer of flow.layers) {
        const real = layer.flatMap((slot) => {
          const node = slot.virtual ? undefined : byId.get(slot.id);
          return node ? [node] : [];
        });
        const columnSize = Math.max(0, ...real.map(along));
        for (const node of real)
          place(node, main + columnSize / 2, (centres.get(node.id) ?? 0) - low);
        main += columnSize + gapAlong;
      }
    }
    for (const [, column] of style === 'flow' ? [] : ordered) {
      column.sort((a, b) => a.id.localeCompare(b.id));
      // Wrap wide independent sets into rows instead of a very tall column.
      const slots = Math.max(1, Math.ceil(Math.sqrt(column.length)));
      const columnSize = Math.max(...column.map(along));
      let cross = 0;
      for (let i = 0; i < column.length; i += slots) {
        const row = column.slice(i, i + slots);
        const rowSize = Math.max(...row.map(across));
        for (const [j, n] of row.entries())
          place(
            n,
            main + j * (columnSize + gapAlong) + columnSize / 2,
            cross + rowSize / 2,
          );
        cross += rowSize + gapAcross;
      }
      main += slots * (columnSize + gapAlong);
      maxCross = Math.max(maxCross, cross - gapAcross);
    }
    const width = down ? maxCross : main - gapAlong,
      depth = down ? main - gapAlong : maxCross;
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
export function layoutEdit(
  doc: DiagramDocument,
  direction: LayoutDirection = 'right',
  style: LayoutStyle = 'packed',
): Edit {
  const laid = layoutDocument(doc, direction, style);
  return {
    type: 'graph',
    label: 'Automatic layout',
    nodes: laid.nodes.map((value) => ({ id: value.id, value })),
    edges: laid.edges.map((value) => ({ id: value.id, value })),
  };
}
