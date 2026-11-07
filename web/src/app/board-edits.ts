import { services } from '../catalog/services';
import type { DiagramEdge, Port } from '../domain/document';
import { resizedFont } from '../domain/text';
import {
  type Alignment,
  alignNodes,
  copyFragment,
  defaultSize,
  deleteNodes,
  groupNodes,
  pasteFragment,
  ungroupNodes,
} from '../editor/operations';
import { recognizeSketch } from '../editor/sketch';
import { element } from '../ui/dom';
import type { App } from './context';

export interface BoardEdits {
  /** Drop a text or note at a board point and start typing into it. */
  placeAnnotation(kind: 'text' | 'note', x: number, z: number): void;
  align(alignment: Alignment): void;
  readonly alignments: readonly [Alignment, string][];
}

/**
 * Edits made directly on the canvas: placing, resizing, moving, connecting,
 * sketching and erasing, plus grouping, duplicating, aligning and the
 * selection's context menu.
 */
export function installBoardEdits(
  app: App,
  routeActions: () => { active: boolean; all: boolean },
): BoardEdits {
  const {
    state,
    scene,
    notify,
    commit,
    deferInspect,
    updateHeader,
    selectTool,
    openEditor,
    navigateDiagram,
  } = app;
  /** Drop a text or note at a board point and start typing into it. */
  function placeAnnotation(kind: 'text' | 'note', x: number, z: number): void {
    const service = services.find((s) => s.kind === kind);
    if (!service) return;
    const id = crypto.randomUUID();
    const [width, depth] = defaultSize(kind);
    const snap = (value: number) =>
      scene.snapping ? Math.round(value / 10) * 10 : value;
    state.history.execute({
      type: 'insert',
      node: {
        id,
        kind,
        serviceId: service.id,
        label: '',
        x: snap(x + width / 2 - 20),
        z: snap(z),
        width,
        depth,
        color: service.color,
      },
    });
    deferInspect(() => scene.load(state.current));
    scene.select(id);
    updateHeader();
    selectTool('select');
    openEditor({ kind: 'node', id }, true);
  }
  scene.onPlace = placeAnnotation;
  scene.onEditRequest = (target) => {
    const node =
      target.kind === 'node'
        ? state.current.nodes.find((n) => n.id === target.id)
        : undefined;
    const detail = state.project.details?.find(
      (entry) => entry.id === node?.detailId,
    );
    if (detail) navigateDiagram(detail.document);
    else openEditor(target);
  };

  scene.onResize = (changes) => {
    const nodes = changes.flatMap(({ id, from, to }) => {
      const node = state.current.nodes.find((n) => n.id === id);
      if (!node) return [];
      const value = {
        ...node,
        ...to,
        ...(node.kind === 'text' || node.kind === 'note'
          ? {
              fontSize: resizedFont(
                node,
                { ...node, ...from },
                { ...node, ...to },
              ),
            }
          : {}),
      };
      Object.assign(node, from);
      return [{ id, value }];
    });
    commit({ type: 'graph', label: 'Resize component', nodes });
  };
  scene.onMoves = (moves) => {
    const nodes = moves.flatMap((move) => {
      const node = state.current.nodes.find((n) => n.id === move.id);
      if (!node) return [];
      const value = { ...node, ...move.to };
      Object.assign(node, move.from);
      return [{ id: node.id, value }];
    });
    commit({ type: 'graph', label: 'Move selection', nodes });
  };
  scene.onConnect = (source, sourcePort, target, targetPort) => {
    if (connect(source, sourcePort, target, targetPort)) selectTool('select');
  };
  function connect(
    source: string,
    sourcePort: Port | undefined,
    target: string,
    targetPort: Port | undefined,
  ): boolean {
    if (source === target) {
      notify('Choose a different target component.');
      return false;
    }
    const id = crypto.randomUUID();
    const value: DiagramEdge = { id, source, target, label: '' };
    if (sourcePort) value.sourcePort = sourcePort;
    if (targetPort) value.targetPort = targetPort;
    commit({
      type: 'graph',
      label: 'Connect components',
      edges: [{ id, value }],
    });
    return true;
  }
  /** Turn a sketch-tool stroke into a flowchart shape or a connection. */
  scene.onSketch = (stroke) => {
    const sketch = recognizeSketch(stroke.points);
    if (sketch.kind === 'none') {
      // A tap selects, as with the select tool; only real strokes get a hint.
      if (stroke.points.length < 3) scene.select(stroke.from?.id);
      else
        notify(
          'Could not recognise that. Draw a box, diamond or oval, or a line between two components.',
        );
      return;
    }
    if (sketch.kind === 'line') {
      const { from, to } = stroke;
      if (from && to && from.id !== to.id)
        connect(from.id, from.port, to.id, to.port);
      else
        notify(
          'Start and end a line on two different components to connect them.',
        );
      return;
    }
    const service = services.find((s) => s.id === `flow.${sketch.shape}`);
    if (!service) return;
    const snap = (value: number) =>
      scene.snapping ? Math.round(value / 10) * 10 : Math.round(value);
    const id = crypto.randomUUID();
    state.history.execute({
      type: 'insert',
      node: {
        id,
        kind: service.kind,
        serviceId: service.id,
        shape: sketch.shape,
        label: service.label,
        x: snap(sketch.x),
        z: snap(sketch.z),
        width: Math.max(30, snap(sketch.width)),
        depth: Math.max(30, snap(sketch.depth)),
        color: service.color,
      },
    });
    deferInspect(() => scene.load(state.current));
    scene.select(id);
    updateHeader();
    notify(`${service.label} added. Double-click to rename it.`);
  };
  /** The pen's eraser end: delete what it passed over in one undoable step. */
  scene.onErase = (nodes, edges) => {
    const edit = deleteNodes(state.current, new Set(nodes));
    if (edit.type !== 'graph') return;
    const removed = new Set(edit.edges?.map((e) => e.id));
    const extra = edges
      .filter((id) => !removed.has(id))
      .map((id) => ({ id, value: null }));
    commit(
      {
        ...edit,
        label: 'Erase',
        edges: [...(edit.edges ?? []), ...extra],
      },
      [],
    );
  };
  element('tool-group').onclick = () => {
    try {
      const id = crypto.randomUUID();
      commit(groupNodes(state.current, state.selectedIds, id), [id]);
    } catch (error) {
      notify(String(error));
    }
  };
  element('ungroup').onclick = () =>
    commit(ungroupNodes(state.current, state.selectedIds), []);
  element('duplicate').onclick = () => {
    const edit = pasteFragment(
      copyFragment(state.current, state.selectedIds),
      () => crypto.randomUUID(),
    );
    commit(
      edit,
      edit.type === 'graph' ? (edit.nodes?.map((n) => n.id) ?? []) : [],
    );
  };
  scene.onContextMenu = (x, y) => {
    const menu = element('context-menu');
    for (const row of menu.querySelectorAll<HTMLElement>('[data-multi]'))
      row.hidden = !!state.selectedEdge || state.selectedIds.size < 2;
    for (const button of menu.querySelectorAll<HTMLButtonElement>(
      'button[data-action]',
    )) {
      const action = button.dataset.action;
      const routes = routeActions();
      button.hidden = state.selectedEdge
        ? action === 'edge-active'
          ? !routes.active
          : action === 'edge-all-routes'
            ? !routes.all
            : action !== 'delete'
        : action === 'edge-active' || action === 'edge-all-routes'
          ? true
          : action === 'delete' || action === 'duplicate'
            ? !state.selectedIds.size
            : false;
    }
    menu.hidden = false;
    menu.style.left = `${Math.min(x, innerWidth - 190)}px`;
    menu.style.top = `${Math.min(y, innerHeight - 250)}px`;
  };
  const alignments: readonly [Alignment, string][] = [
    ['left', 'Align left edges'],
    ['center', 'Align centres horizontally'],
    ['right', 'Align right edges'],
    ['top', 'Align top edges'],
    ['middle', 'Align middles'],
    ['bottom', 'Align bottom edges'],
    ['distribute-x', 'Distribute horizontally'],
    ['distribute-z', 'Distribute vertically'],
  ];
  function align(alignment: Alignment): void {
    if (state.selectedIds.size < 2) {
      notify('Select two or more components to align.');
      return;
    }
    commit(alignNodes(state.current, state.selectedIds, alignment));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#context-menu [data-align]',
  ))
    button.onclick = () => {
      element('context-menu').hidden = true;
      align(button.dataset.align as Alignment);
    };
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#context-menu button[data-action]',
  ))
    button.onclick = () => {
      element('context-menu').hidden = true;
      element(button.dataset.action ?? 'fit').click();
    };

  return { placeAnnotation, align, alignments };
}
