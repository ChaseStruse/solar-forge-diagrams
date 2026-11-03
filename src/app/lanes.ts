import { type DiagramNode, MAX_OWNER } from '../domain/document';
import { laneAt, laneBands, laneName, lanesEdit } from '../domain/lanes';
import { element, field } from '../ui/dom';
import type { App } from './context';

export interface LaneControls {
  /** Show or hide the board as swimlanes. */
  toggle(): void;
  /** Switch between lanes as rows (flow right) and columns (flow down). */
  swapDirection(): void;
  /** Reflect the board's lane state in the Lanes button. */
  refresh(): void;
}

/**
 * Swimlanes: an optional view of a board with one band per owner. Turning it
 * on arranges the steps; changing an owner, or dropping a step in another
 * lane, re-flows the lanes. Each change is one undoable edit.
 */
export function installLanes(app: App): LaneControls {
  const { state, scene, notify, commit } = app;
  const button = element('lanes');

  function toggle(): void {
    const doc = state.current;
    if (doc.lanes) {
      commit({ type: 'graph', label: 'Hide lanes', lanes: null });
      notify('Lanes hidden. Steps stay where they are; owners are kept.');
      return;
    }
    if (!doc.nodes.some((n) => n.owner)) {
      notify(
        'Give steps an Owner in the properties panel first, then show lanes.',
      );
      return;
    }
    commit(lanesEdit(doc, 'right', 'Show lanes'));
    scene.fit();
    notify('Lanes on. Change a step’s Owner, or drag it to another lane.');
  }

  function swapDirection(): void {
    const view = state.current.lanes;
    if (!view) {
      notify('Show lanes first.');
      return;
    }
    const direction = view.direction === 'right' ? 'down' : 'right';
    commit(
      lanesEdit(
        state.current,
        direction,
        direction === 'down' ? 'Lanes as columns' : 'Lanes as rows',
      ),
    );
    scene.fit();
  }

  /** Give nodes a new owner; with lanes on, re-flow them in the same step. */
  function setOwner(ids: readonly string[], owner: string): void {
    const doc = state.current;
    const value = owner.trim().slice(0, MAX_OWNER);
    const next = structuredClone(doc);
    const changed: DiagramNode[] = [];
    for (const node of next.nodes) {
      if (!ids.includes(node.id) || (node.owner ?? '') === value) continue;
      if (value) node.owner = value;
      else delete node.owner;
      changed.push(node);
    }
    if (!changed.length) return;
    const label =
      changed.length > 1
        ? `Owner of ${changed.length} steps`
        : `Owner · ${laneName(value)}`;
    commit(
      next.lanes
        ? lanesEdit(next, next.lanes.direction, label, changed)
        : {
            type: 'graph',
            label,
            nodes: changed.map((node) => ({ id: node.id, value: node })),
          },
    );
  }

  field('node-owner').onchange = () => {
    const ids = state.selectedIds.size
      ? [...state.selectedIds]
      : state.selected
        ? [state.selected]
        : [];
    setOwner(ids, field('node-owner').value);
  };
  button.onclick = toggle;

  // In lane view a drop decides the owner: the lane a step lands in.
  const dropped = (
    moves: {
      id: string;
      from: { x: number; z: number };
      to: { x: number; z: number };
    }[],
  ): boolean => {
    const doc = state.current;
    if (!doc.lanes) return false;
    // Put the live nodes back first: undo then returns them where they were,
    // and the bands are measured without the dragged steps stretching them.
    for (const move of moves) {
      const live = doc.nodes.find((n) => n.id === move.id);
      if (live) Object.assign(live, move.from);
    }
    const bands = laneBands(doc);
    if (!bands) return false;
    const next = structuredClone(doc);
    const changed: DiagramNode[] = [];
    for (const move of moves) {
      const node = next.nodes.find((n) => n.id === move.id);
      if (!node || node.parentId !== undefined) continue;
      const owner = laneAt(bands, move.to);
      if (owner === undefined) continue;
      if (owner) node.owner = owner;
      else delete node.owner;
      changed.push(node);
    }
    const lane = changed[0] ? laneName(changed[0].owner ?? '') : '';
    commit(
      lanesEdit(
        next,
        bands.direction,
        lane ? `Move to ${lane}` : 'Re-flow lanes',
        changed,
      ),
    );
    return true;
  };
  const baseMove = scene.onMove;
  scene.onMove = (id, from, to) => {
    if (!dropped([{ id, from, to }])) baseMove(id, from, to);
  };
  const baseMoves = scene.onMoves;
  scene.onMoves = (moves) => {
    if (!dropped(moves)) baseMoves(moves);
  };

  return {
    toggle,
    swapDirection,
    refresh() {
      const view = state.current.lanes;
      button.setAttribute('aria-pressed', String(Boolean(view)));
      button.title = view
        ? `Hide swimlanes (L) · ${view.direction === 'right' ? 'rows' : 'columns'}`
        : 'Show the board as swimlanes, one per owner (L)';
    },
  };
}
