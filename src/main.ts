import './style.css';
import './theme-effects.css';
import { loadAppearance } from './app/appearance';
import { installBoardEdits } from './app/board-edits';
import type { App } from './app/context';
import { installFileCommands } from './app/file-commands';
import { installJourneyControls } from './app/journey-controls';
import { installLanes } from './app/lanes';
import { installRecording } from './app/recording';
import { installShortcuts } from './app/shortcuts';
import { createAppState } from './app/state';
import { installTabletControls } from './app/tablet-controls';
import type { DiagramDocument, DiagramNode } from './domain/document';
import { parseDocument, starterDocument } from './domain/document';
import type { Edit } from './domain/history';
import { DocumentHistory } from './domain/history';
import { deleteNodes } from './editor/operations';
import { nativeAvailable } from './platform/files';
import { DiagramScene, type EditTarget, type Tool } from './renderer/scene';
import { installComponentPalette } from './ui/component-palette';
import { element } from './ui/dom';
import { installInlineEditor } from './ui/inline-editor';
import { installInspector } from './ui/inspector';
import { installLayersPanel } from './ui/layers-panel';
import { appShell } from './ui/shell';
import { dismissSplash, removeSplash } from './ui/splash';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = appShell();
const state = createAppState(starterDocument());
const notify = (message: string): void => {
  element('status').textContent = message;
};
const appearance = loadAppearance(notify);
let scene: DiagramScene;
try {
  scene = new DiagramScene(
    element('canvas'),
    state.current,
    appearance.initialPalette,
  );
} catch (error) {
  removeSplash();
  notify(
    `Graphics unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
  throw error;
}
const app: App = {
  state,
  scene,
  notify,
  commit,
  action,
  inspect,
  deferInspect,
  updateHeader,
  updateLayers,
  showLayers,
  showComponents,
  selectTool,
  travelHistory,
  deleteSelection,
  openEditor,
  closeEditor: (save) => editor.close(save),
  navigateDiagram,
  replaceDocument,
  canReplace: () => files.canReplace(),
  toggleJourney,
};
const { setTheme } = appearance.install(scene);
const files = installFileCommands(app, appearance.boardFontFamily);
const layers = installLayersPanel(app);
function showLayers(show: boolean): void {
  layers.showLayers(show);
}
function updateLayers(): void {
  layers.updateLayers();
}
installRecording(app);
const palette = installComponentPalette(app);
function showComponents(show: boolean): void {
  palette.show(show);
}
const inspector = installInspector(app);
function inspect(): void {
  inspector.inspect();
}
element('features').onclick = () =>
  void import('./ui/tour')
    .then(({ startTour }) => startTour())
    .catch((error) => notify(`Tour unavailable: ${String(error)}`));
/** Lanes install late; header refreshes before then skip the lane button. */
let lanesReady = false;
function updateHeader(): void {
  if (lanesReady) lanes.refresh();
  state.dirty = state.history.isDirty;
  files.scheduleRecovery();
  element('save-state').textContent = state.dirty
    ? 'Unsaved changes'
    : 'Unchanged';
  for (const [id, enabled] of [
    ['undo', state.history.canUndo],
    ['redo', state.history.canRedo],
  ] as const) {
    const button = element(id);
    if (button instanceof HTMLButtonElement) button.disabled = !enabled;
  }
  element('title').textContent =
    `${state.current.title}${state.dirty ? ' •' : ''}`;
  element('count').textContent =
    `${state.current.nodes.length} objects · ${state.current.edges.length} connections`;
  const count = (kind: DiagramNode['kind']) =>
    state.current.nodes.filter((node) => node.kind === kind).length;
  const notes = count('text') + count('note');
  element('ground-summary').textContent =
    `${count('service')} services · ${count('group')} boundaries${notes ? ` · ${notes} notes` : ''}`;
  updateLayers();
  renderDiagramPath();
}
/**
 * Loading and reselecting fires the selection callbacks several times in a
 * row; batched updates keep the selection state but inspect once at the end.
 */
let inspectDeferred = false;
function deferInspect(task: () => void): void {
  inspectDeferred = true;
  try {
    task();
  } finally {
    inspectDeferred = false;
  }
}
scene.onSelect = (node) => {
  state.checkedJourney = undefined;
  state.selected = node?.id;
  state.selectedIds = new Set(scene.selection);
  state.selectedEdge = undefined;
  if (!inspectDeferred) inspect();
};
scene.onSelectEdge = (id) => {
  state.checkedJourney = undefined;
  state.selected = undefined;
  state.selectedIds = new Set();
  state.selectedEdge = id;
  if (!inspectDeferred) inspect();
};
scene.onMove = (id, from, to) => {
  state.history.execute({ type: 'move', id, from, to });
  updateHeader();
  inspect();
  notify('Position updated');
};
scene.onError = notify;
scene.onZoom = (percent) => {
  const value = `${percent}%`;
  if (element('zoom-level').textContent !== value)
    element('zoom-level').textContent = value;
};
function replaceDocument(next: DiagramDocument): void {
  state.fileHandle = undefined;
  state.current = next;
  state.project = next;
  state.diagramTrail = [];
  state.history = new DocumentHistory(state.current);
  state.selected = undefined;
  state.dirty = false;
  deferInspect(() => scene.load(state.current));
  scene.fit();
  inspect();
  updateHeader();
}
async function action(task: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  scene.finishInteraction();
  state.busy = true;
  try {
    await task();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
  }
}
element('menu').onclick = () => {
  const menu = element('file-menu');
  menu.hidden = !menu.hidden;
  element('menu').setAttribute('aria-expanded', String(!menu.hidden));
  showComponents(false);
};
function selectTool(tool: Tool): void {
  scene.setTool(tool);
  for (const name of ['select', 'pan', 'connect', 'sketch', 'text', 'note']) {
    const button = element(`tool-${name}`);
    button.classList.toggle('active', name === tool);
    button.setAttribute('aria-pressed', String(name === tool));
  }
}
element('tool-select').onclick = () => selectTool('select');
element('tool-pan').onclick = () => selectTool('pan');
element('tool-text').onclick = () => {
  selectTool('text');
  notify('Click the board to place text.');
};
element('tool-note').onclick = () => {
  selectTool('note');
  notify('Click the board to pin a sticky note.');
};
element('tool-sketch').onclick = () => {
  selectTool('sketch');
  notify(
    'Draw a box, diamond or oval to add a shape, or a line between two components to connect them.',
  );
};
element('tool-connect').onclick = () => {
  selectTool('connect');
  notify(
    'Choose a source, then a target. Or drag a port dot to another component.',
  );
};
/** 2.5D, Plan or the experimental 3D orbit view. */
const showView = (view: 'iso' | 'top' | 'view-3d') => {
  if (view === 'top') scene.setView('top');
  else scene.setOrbit(view === 'view-3d');
  for (const id of ['iso', 'top', 'view-3d'])
    element(id).setAttribute('aria-pressed', String(id === view));
};
element('iso').onclick = () => showView('iso');
element('top').onclick = () => showView('top');
element('view-3d').onclick = () => {
  showView('view-3d');
  notify(
    '3D (experimental): right-drag to orbit and tilt. 2.5D resets the angle.',
  );
};
for (const id of ['fit', 'tool-fit']) element(id).onclick = () => scene.fit();
element('zoom-in').onclick = () => scene.zoomBy(1.2);
element('zoom-out').onclick = () => scene.zoomBy(1 / 1.2);
element('help').onclick = () => {
  const help = element('help-panel');
  help.hidden = !help.hidden;
  element('help').setAttribute('aria-expanded', String(!help.hidden));
};
element('tool-edit').onclick = () => {
  if (state.selected) openEditor({ kind: 'node', id: state.selected });
  else if (state.selectedEdge)
    openEditor({ kind: 'edge', id: state.selectedEdge });
};
function deleteSelection(): void {
  if (state.selectedEdge) {
    commit(
      {
        type: 'graph',
        label: 'Delete connection',
        edges: [{ id: state.selectedEdge, value: null }],
      },
      [],
    );
    return;
  }
  if (!state.selectedIds.size) return;
  commit(deleteNodes(state.current, state.selectedIds), []);
  notify('Selection deleted');
}
element('delete').onclick = deleteSelection;
function travelHistory(redo: boolean): void {
  scene.finishInteraction();
  const edit = redo ? state.history.redo() : state.history.undo();
  if (!edit) return;
  const switched = state.current !== state.history.document;
  deferInspect(() => {
    if (switched) {
      state.current = state.history.document;
      state.diagramTrail =
        state.current === state.project ? [] : [state.project];
      scene.load(state.current);
      scene.fit();
    }
    const selection = [...state.selectedIds];
    const edge = state.selectedEdge;
    if (edit.type === 'move') {
      if (!switched) scene.refreshPosition(edit.id);
    } else {
      // A board switch has just loaded this exact document.
      if (!switched) scene.load(state.current);
      scene.selectMany(
        selection.filter((id) =>
          state.current.nodes.some((node) => node.id === id),
        ),
      );
      if (edge && state.current.edges.some((e) => e.id === edge))
        scene.selectEdge(edge);
    }
  });
  updateHeader();
  inspect();
  notify(`${redo ? 'Redid' : 'Undid'} ${edit.type}`);
}
element('undo').onclick = () => travelHistory(false);
element('redo').onclick = () => travelHistory(true);

function commit(
  edit: Edit,
  ids: readonly string[] = [...state.selectedIds],
): void {
  scene.finishInteraction();
  const edge = state.selectedEdge;
  if (!state.history.execute(edit)) return;
  deferInspect(() => {
    scene.load(state.current);
    scene.selectMany(ids);
    if (!ids.length && edge && state.current.edges.some((e) => e.id === edge))
      scene.selectEdge(edge);
  });
  updateHeader();
  inspect();
  notify(edit.type === 'graph' ? edit.label : `Updated ${edit.type}`);
}
const tablet = installTabletControls({
  scene,
  notify,
  isRecording: () => state.recording,
  layersVisible: () => state.layersVisible,
  showLayers,
  components: {
    isOpen: palette.isOpen,
    open: () => palette.show(true),
    step: palette.step,
    addHighlighted: palette.addHighlighted,
  },
  selectTool: () => selectTool('select'),
  actions: {
    deselect: () => {
      if (scene.journeyPlaying) scene.stopJourney();
      scene.cancelInteraction();
      selectTool('select');
      scene.select(undefined);
    },
    'tool-select': () => selectTool('select'),
    'tool-pan': () => selectTool('pan'),
    'tool-add': () => showComponents(true),
    undo: () => travelHistory(false),
    redo: () => travelHistory(true),
    delete: deleteSelection,
    'zoom-in': () => scene.zoomBy(1.2),
    'zoom-out': () => scene.zoomBy(1 / 1.2),
    fit: () => scene.fit(),
    journey: toggleJourney,
  },
});
const edits = installBoardEdits(app, inspector.routeActions);
const editor = installInlineEditor(app, (x, z) =>
  edits.placeAnnotation('text', x, z),
);
function openEditor(target: EditTarget, created = false): void {
  editor.open(target, created);
}
const journey = installJourneyControls(app);
function toggleJourney(): void {
  journey.toggleJourney();
}
// After board edits: lanes wrap the move handlers to reassign dropped steps.
const lanes = installLanes(app);
lanesReady = true;
function renderDiagramPath(): void {
  const nav = element('diagram-path');
  nav.replaceChildren();
  if (state.current === state.project) return;
  const home = document.createElement('button');
  home.textContent = `⌂ ${state.project.title}`;
  home.onclick = () => navigateDiagram(state.project, true);
  const back = document.createElement('button');
  back.textContent = '← Back';
  back.onclick = () => {
    const previous = state.diagramTrail.pop();
    if (previous) navigateDiagram(previous, true);
  };
  const label = document.createElement('span');
  label.textContent = state.current.title;
  nav.append(home, back, label);
}
function navigateDiagram(board: DiagramDocument, returning = false): void {
  if (board === state.current) return;
  scene.finishInteraction();
  editor.close(true);
  scene.stopJourney();
  if (!returning && board !== state.current)
    state.diagramTrail.push(state.current);
  if (state.diagramTrail.length > 100) state.diagramTrail.shift();
  if (board === state.project) state.diagramTrail = [];
  state.current = board;
  state.history.document = board;
  state.selected = undefined;
  state.selectedEdge = undefined;
  state.selectedIds.clear();
  state.checkedJourney = undefined;
  deferInspect(() => scene.load(state.current));
  scene.fit();
  updateHeader();
  inspect();
  notify(`Opened ${board.title}`);
}
element('snap').onclick = () => {
  scene.snapping = !scene.snapping;
  element('snap').setAttribute('aria-pressed', String(scene.snapping));
};
installShortcuts(app, {
  setTheme,
  copyImage: files.copyImage,
  populateComponents: palette.populate,
  align: edits.align,
  alignments: edits.alignments,
  closeSettings: () => tablet.showSettings(false),
  toggleLanes: lanes.toggle,
  swapLaneDirection: lanes.swapDirection,
});
window.addEventListener('beforeunload', (event) => {
  scene.finishInteraction();
  if (state.dirty) event.preventDefault();
});
window.addEventListener('pagehide', () => scene.dispose(), { once: true });
if (import.meta.env.DEV)
  Object.assign(window, {
    solarForge: {
      scene,
      document: () => state.current,
      project: () => state.project,
      load: (json: string) => replaceDocument(parseDocument(json)),
    },
  });
palette.populate();
updateHeader();
void dismissSplash();
scene.fit();
notify(
  nativeAvailable()
    ? 'Offline · Ready'
    : 'Browser workspace · Saving downloads a copy',
);
void files
  .start()
  .catch((error) => notify(`Startup check failed: ${String(error)}`));
