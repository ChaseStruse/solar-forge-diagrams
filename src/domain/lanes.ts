import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  LaneView,
} from './document';
import { flowLayers } from './flow-layout';
import type { Change, Edit } from './history';
import { layoutEdit } from './layout';

/** Space before the first step, along the flow, for the lane names. */
export const LANE_HEADER = 320;
/** Space between a lane's edge and the steps inside it. */
const LANE_PAD = 70;
/** Space between flow layers, leaving room for link labels. */
const LAYER_GAP = 200;
/** Space between steps stacked in the same lane and layer. */
const STACK_GAP = 60;
const grid = (n: number) => Math.round(n / 10) * 10;

/** The lane a node belongs to: its owner, or '' for Unassigned. */
export const laneKey = (node: DiagramNode) => node.owner ?? '';
export const laneName = (owner: string) => owner || 'Unassigned';

/**
 * Top-level steps and boundaries: lanes arrange these. Nested nodes move
 * with their boundary; text and sticky notes stay where they are.
 */
const participants = (doc: DiagramDocument) =>
  doc.nodes.filter(
    (n) => n.parentId === undefined && n.kind !== 'text' && n.kind !== 'note',
  );

/**
 * Lane order: the board's previous order for owners still in use, then new
 * owners in the order the flow first reaches them, with Unassigned last.
 */
export function laneOrder(
  doc: DiagramDocument,
  firstSeen: readonly string[] = participants(doc).map(laneKey),
): string[] {
  const used = new Set(participants(doc).map(laneKey));
  const order = (doc.lanes?.order ?? []).filter((o) => used.has(o) && o);
  for (const owner of firstSeen)
    if (owner && used.has(owner) && !order.includes(owner)) order.push(owner);
  if (used.has('')) order.push('');
  return order;
}

/** Positions for every top-level node, arranged in lanes along the flow. */
export function laneLayout(
  doc: DiagramDocument,
  direction: LaneView['direction'],
): { positions: Map<string, { x: number; z: number }>; order: string[] } {
  const down = direction === 'down';
  const along = (n: DiagramNode) => (down ? n.depth : n.width);
  const across = (n: DiagramNode) => (down ? n.width : n.depth);
  const roots = participants(doc);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const rootOf = (id: string): string | undefined => {
    let node = byId.get(id);
    const seen = new Set<string>();
    while (node?.parentId !== undefined && !seen.has(node.id)) {
      seen.add(node.id);
      node = byId.get(node.parentId);
    }
    return node?.id;
  };
  const links = new Map(roots.map((n) => [n.id, new Set<string>()]));
  for (const edge of doc.edges) {
    const a = rootOf(edge.source);
    const b = rootOf(edge.target);
    if (a && b && a !== b) links.get(a)?.add(b);
  }
  const { layers } = flowLayers(
    roots.map((n) => n.id),
    links,
  );
  const columns = layers.map((layer) =>
    layer.flatMap((slot) => {
      const node = slot.virtual ? undefined : byId.get(slot.id);
      return node ? [node] : [];
    }),
  );
  const order = laneOrder(
    doc,
    columns.flat().map((n) => laneKey(n)),
  );

  // Along the flow: one column per layer, after the lane-name header.
  const mainOf = new Map<string, number>();
  let main = LANE_HEADER;
  for (const column of columns) {
    const size = Math.max(0, ...column.map(along));
    for (const n of column) mainOf.set(n.id, main + size / 2);
    main += size + LAYER_GAP;
  }

  // Across the flow: each lane is as deep as its tallest stack.
  const crossOf = new Map<string, number>();
  let cross = 0;
  for (const owner of order) {
    const stacks = columns.map((column) =>
      column.filter((n) => laneKey(n) === owner),
    );
    const sizes = stacks.map(
      (stack) =>
        stack.reduce((sum, n) => sum + across(n), 0) +
        STACK_GAP * Math.max(0, stack.length - 1),
    );
    const inner = Math.max(100, ...sizes);
    for (const [i, stack] of stacks.entries()) {
      let at = cross + LANE_PAD + (inner - (sizes[i] ?? 0)) / 2;
      for (const n of stack) {
        crossOf.set(n.id, at + across(n) / 2);
        at += across(n) + STACK_GAP;
      }
    }
    cross += inner + LANE_PAD * 2;
  }

  // Centre the whole arrangement on the board origin.
  const shiftMain = main / 2;
  const shiftCross = cross / 2;
  const positions = new Map<string, { x: number; z: number }>();
  for (const n of roots) {
    const m = (mainOf.get(n.id) ?? 0) - shiftMain;
    const c = (crossOf.get(n.id) ?? 0) - shiftCross;
    positions.set(n.id, {
      x: grid(down ? c : m),
      z: grid(down ? m : c),
    });
  }
  return { positions, order };
}

/**
 * One undoable edit that arranges the board in lanes and turns the lane view
 * on. `changed` nodes (such as a new owner) are included even if they do not
 * move; `doc` should already carry those changes.
 */
export function lanesEdit(
  doc: DiagramDocument,
  direction: LaneView['direction'],
  label: string,
  changed: readonly DiagramNode[] = [],
): Edit {
  const { positions, order } = laneLayout(doc, direction);
  const nodes: Change<DiagramNode>[] = [];
  const included = new Set(changed.map((n) => n.id));
  for (const n of doc.nodes) {
    const at = positions.get(n.id);
    const moved = at && (at.x !== n.x || at.z !== n.z);
    if (moved || included.has(n.id))
      nodes.push({ id: n.id, value: { ...n, ...(at ?? {}) } });
  }
  // Manual bends and ports belong to the old geometry.
  const edges: Change<DiagramEdge>[] = doc.edges
    .filter(
      (e) =>
        e.bend !== undefined ||
        e.sourcePort !== undefined ||
        e.targetPort !== undefined ||
        e.routing !== undefined,
    )
    .map((e) => {
      const value = { ...e };
      delete value.bend;
      delete value.sourcePort;
      delete value.targetPort;
      delete value.routing;
      return { id: e.id, value };
    });
  return {
    type: 'graph',
    label,
    nodes,
    edges,
    lanes: { direction, order },
  };
}

/** Automatic layout: lanes when the board shows them, otherwise the packer. */
export function arrangeEdit(doc: DiagramDocument): Edit {
  return doc.lanes
    ? lanesEdit(doc, doc.lanes.direction, 'Arrange lanes')
    : layoutEdit(doc);
}

export interface LaneBand {
  owner: string;
  /** Across the flow: where the band starts and ends. */
  start: number;
  end: number;
}
export interface LaneBands {
  direction: LaneView['direction'];
  bands: LaneBand[];
  /** Along the flow: the bands' extent, including the name header. */
  from: number;
  to: number;
}

/**
 * The lanes as drawn: each owner's band spans its steps plus padding, with
 * neighbouring bands meeting halfway. Derived from positions, so bands follow
 * the steps through undo, imports and hand-moves.
 */
export function laneBands(doc: DiagramDocument): LaneBands | undefined {
  const view = doc.lanes;
  if (!view) return undefined;
  const down = view.direction === 'down';
  const roots = participants(doc);
  if (!roots.length) return undefined;
  const mainAt = (n: DiagramNode) => (down ? n.z : n.x);
  const crossAt = (n: DiagramNode) => (down ? n.x : n.z);
  const along = (n: DiagramNode) => (down ? n.depth : n.width);
  const across = (n: DiagramNode) => (down ? n.width : n.depth);
  const bands: LaneBand[] = [];
  for (const owner of laneOrder(doc)) {
    const members = roots.filter((n) => laneKey(n) === owner);
    if (!members.length) continue;
    bands.push({
      owner,
      start:
        Math.min(...members.map((n) => crossAt(n) - across(n) / 2)) - LANE_PAD,
      end:
        Math.max(...members.map((n) => crossAt(n) + across(n) / 2)) + LANE_PAD,
    });
  }
  bands.sort((a, b) => a.start - b.start);
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1] as LaneBand;
    const b = bands[i] as LaneBand;
    if (a.end <= b.start) a.end = b.start = (a.end + b.start) / 2;
  }
  return {
    direction: view.direction,
    bands,
    from:
      Math.min(...roots.map((n) => mainAt(n) - along(n) / 2)) -
      LANE_HEADER +
      LANE_PAD,
    to: Math.max(...roots.map((n) => mainAt(n) + along(n) / 2)) + LANE_PAD,
  };
}

/** The owner of the band under a board point, if any. */
export function laneAt(
  bands: LaneBands,
  point: { x: number; z: number },
): string | undefined {
  const cross = bands.direction === 'down' ? point.x : point.z;
  return bands.bands.find((b) => cross >= b.start && cross < b.end)?.owner;
}
