import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { layoutEdit } from './domain/layout';
import { RecoveryWriter } from './persistence/recovery';
import type { OpenedFile } from './platform/files';
import { exportText } from './platform/files';
import { choose, commandPalette, promptText } from './ui/dialogs';
import { infrastructureImporter } from './ui/importer';
import './style.css';
import './theme-effects.css';
import type { App } from './app/context';
import { installJourneyControls } from './app/journey-controls';
import { installRecording } from './app/recording';
import { createAppState } from './app/state';
import { installTabletControls } from './app/tablet-controls';
import { services } from './catalog/services';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  Port,
} from './domain/document';
import {
  MAX_TEXT,
  parseDocument,
  serializeDocument,
  starterDocument,
} from './domain/document';
import type { Edit } from './domain/history';
import { DocumentHistory } from './domain/history';
import { fontSize, resizedFont } from './domain/text';
import { CameraKeys, isPanKey } from './editor/camera-keys';
import {
  type Alignment,
  alignNodes,
  copyFragment,
  deleteNodes,
  groupNodes,
  insertionSlot,
  pasteFragment,
  ungroupNodes,
} from './editor/operations';
import { recognizeSketch } from './editor/sketch';
import { boardFonts, findBoardFont, loadBoardFont } from './fonts';
import {
  copyPng,
  exportPng,
  nativeAvailable,
  openDocumentFile,
  readRecovery,
  saveDocumentFile,
  saveSvg,
  writeRecovery,
} from './platform/files';
import { DiagramScene, type EditTarget, type Tool } from './renderer/scene';
import { applyThemeCss, findTheme, type ScenePalette, themes } from './themes';
import {
  element,
  field,
  fillOptions,
  inputElement,
  isTextTarget,
} from './ui/dom';
import { installInspector } from './ui/inspector';
import { installLayersPanel } from './ui/layers-panel';
import { appShell } from './ui/shell';
import { dismissSplash, removeSplash } from './ui/splash';
import { renderAmbient } from './ui/theme-fx';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = appShell();
const state = createAppState(starterDocument());
const recovery = new RecoveryWriter(
  () => (state.history.isDirty ? serializeDocument(state.project) : null),
  writeRecovery,
  (error) => notify(`Recovery failed: ${String(error)}. Save your diagram.`),
);
const notify = (message: string): void => {
  element('status').textContent = message;
};
let theme = findTheme(
  (() => {
    try {
      return localStorage.getItem('solar-forge-theme');
    } catch {
      return null;
    }
  })(),
);
/** Ambient theme effects: on by default unless the system asks for less motion. */
let themeEffects = (() => {
  try {
    const saved = localStorage.getItem('solar-forge-theme-fx');
    if (saved) return saved === 'on';
  } catch {}
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
})();
let boardFont = findBoardFont(
  (() => {
    try {
      return localStorage.getItem('solar-forge-font');
    } catch {
      return null;
    }
  })(),
);
/** The theme's board colours with the chosen board font. */
function scenePalette(): ScenePalette {
  return boardFont.family
    ? { ...theme.scene, labelFont: boardFont.family }
    : theme.scene;
}
function applyThemeChrome(): void {
  applyThemeCss(theme);
  document.documentElement.dataset.fx = themeEffects ? 'on' : 'off';
  if (theme.markSvg) element('forge-mark').innerHTML = theme.markSvg;
  else element('forge-mark').textContent = theme.mark;
  renderAmbient(element('theme-fx'), themeEffects ? theme.ambient : undefined);
}
applyThemeChrome();
let scene: DiagramScene;
const cameraKeys = new CameraKeys((dx, dy) => scene.panByPixels(dx, dy));
try {
  scene = new DiagramScene(element('canvas'), state.current, theme.scene);
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
  closeEditor: (save) => closeEditor?.(save),
  navigateDiagram,
  replaceDocument,
  canReplace,
  toggleJourney,
};
const layers = installLayersPanel(app);
function showLayers(show: boolean): void {
  layers.showLayers(show);
}
function updateLayers(): void {
  layers.updateLayers();
}
installRecording(app);
const inspector = installInspector(app);
function inspect(): void {
  inspector.inspect();
}
function showComponents(show: boolean): void {
  element('component-palette').hidden = !show;
  element('components').setAttribute('aria-expanded', String(show));
  if (show) {
    element('file-menu').hidden = true;
    inputElement('search').value = '';
    populateServices();
    inputElement('search').focus();
  }
}
function setTheme(id: string): void {
  theme = findTheme(id);
  applyThemeChrome();
  scene.setPalette(scenePalette());
  for (const button of element('theme-list').querySelectorAll('button'))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.theme === theme.id),
    );
  try {
    localStorage.setItem('solar-forge-theme', theme.id);
  } catch {}
  notify(`${theme.name} · ${theme.tagline}`);
}
for (const [index, option] of themes.entries()) {
  if (option.group !== themes[index - 1]?.group) {
    const caption = document.createElement('p');
    caption.className = 'popover-caption';
    caption.textContent = option.group.toUpperCase();
    element('theme-list').append(caption);
  }
  const button = document.createElement('button');
  button.dataset.theme = option.id;
  button.setAttribute('aria-pressed', String(option.id === theme.id));
  const swatch = document.createElement('span');
  swatch.className = 'theme-swatch';
  swatch.style.background = `linear-gradient(135deg, ${option.css.bg} 0 45%, ${option.css.accent} 45% 72%, ${option.css.hot} 72%)`;
  swatch.style.color = option.css.text ?? '';
  if (option.markSvg) swatch.innerHTML = option.markSvg;
  else swatch.textContent = option.mark;
  const text = document.createElement('span');
  text.className = 'theme-text';
  const name = document.createElement('strong');
  name.textContent = option.name;
  const tagline = document.createElement('small');
  tagline.textContent = option.tagline;
  text.append(name, tagline);
  button.append(swatch, text);
  button.onclick = () => {
    setTheme(option.id);
    element('theme-menu').hidden = true;
    element('theme').setAttribute('aria-expanded', 'false');
  };
  element('theme-list').append(button);
}
/** Switch board text to a font, drawing only once its face has loaded. */
async function setBoardFont(id: string, announce = true): Promise<void> {
  const font = findBoardFont(id);
  boardFont = font;
  field('board-font').value = font.id;
  try {
    await loadBoardFont(font);
  } catch {
    notify(`${font.name} font unavailable; using a fallback.`);
  }
  if (boardFont !== font) return;
  scene.setPalette(scenePalette());
  try {
    localStorage.setItem('solar-forge-font', font.id);
  } catch {}
  if (announce) notify(`Board font · ${font.name}`);
}
fillOptions(
  'board-font',
  boardFonts.map((font) => [font.id, font.name] as [string, string]),
  boardFont.id,
);
field('board-font').onchange = () =>
  void setBoardFont(field('board-font').value);
if (boardFont.family) void setBoardFont(boardFont.id, false);
element('features').onclick = () =>
  void import('./ui/tour')
    .then(({ startTour }) => startTour())
    .catch((error) => notify(`Tour unavailable: ${String(error)}`));
inputElement('theme-fx-toggle').checked = themeEffects;
inputElement('theme-fx-toggle').onchange = () => {
  themeEffects = inputElement('theme-fx-toggle').checked;
  applyThemeChrome();
  try {
    localStorage.setItem('solar-forge-theme-fx', themeEffects ? 'on' : 'off');
  } catch {}
  notify(`Ambient effects ${themeEffects ? 'on' : 'off'}`);
};
element('theme').onclick = () => {
  const menu = element('theme-menu');
  menu.hidden = !menu.hidden;
  element('theme').setAttribute('aria-expanded', String(!menu.hidden));
};
async function refreshRecents(): Promise<void> {
  if (!nativeAvailable()) return;
  try {
    const files =
      await invoke<{ name: string; path: string }[]>('recent_documents');
    const list = element('recent-files');
    list.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No recent diagrams yet';
      list.append(empty);
    }
    for (const file of files) {
      const button = document.createElement('button');
      button.textContent = file.name;
      button.title = file.path;
      button.onclick = () =>
        void action(async () => {
          if (!(await canReplace())) return;
          const opened = await invoke<OpenedFile>('open_recent', {
            path: file.path,
          });
          replaceDocument(parseDocument(opened.content));
          state.fileHandle = opened.handle;
          element('file-menu').hidden = true;
          notify(`Opened ${opened.name}`);
          await refreshRecents();
        });
      list.append(button);
    }
  } catch (error) {
    notify(`Recent files unavailable: ${String(error)}`);
  }
}
element('title').onclick = () =>
  void action(async () => {
    const title = await promptText('Diagram name', state.current.title);
    if (title) commit({ type: 'graph', label: 'Rename diagram', title });
  });
for (const id of ['examples', 'browse-examples']) {
  element(id).onclick = () =>
    void action(async () => {
      element('file-menu').hidden = true;
      element('menu').setAttribute('aria-expanded', 'false');
      const { chooseExample } = await import('./ui/examples');
      const template = await chooseExample();
      if (!template || !(await canReplace())) return;
      replaceDocument(template.create());
      notify(`Loaded ${template.name}`);
    });
}
element('export-svg').onclick = () =>
  void action(async () => {
    const { exportSvg } = await import('./export/svg');
    if (await saveSvg(await exportSvg(state.current, boardFont.family)))
      notify('SVG exported');
  });
for (const [id, format] of [
  ['export-mermaid', 'mmd'],
  ['export-plantuml', 'puml'],
  ['export-drawio', 'drawio'],
] as const) {
  element(id).onclick = () =>
    void action(async () => {
      const { exportInterchange } = await import('./export/interchange');
      const content = exportInterchange(
        format === 'drawio' ? state.project : state.current,
        format,
      );
      if (await exportText(content, format))
        notify(
          `Exported ${format === 'drawio' ? 'draw.io project' : 'diagram source'}`,
        );
      element('file-menu').hidden = true;
    });
}
function updateHeader(): void {
  state.dirty = state.history.isDirty;
  if (state.recoveryReady) recovery.schedule();
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
async function saveCurrent(saveAs = false): Promise<boolean> {
  scene.finishInteraction();
  const savedHistory = state.history;
  const token = state.history.token;
  const saved = await saveDocumentFile(
    serializeDocument(state.project),
    saveAs ? undefined : state.fileHandle,
    state.project.title,
  );
  if (!saved) return false;
  if (state.history === savedHistory) state.fileHandle = saved.handle;
  savedHistory.markSaved(token);
  updateHeader();
  await recovery.flush();
  notify(`Saved ${saved.name}`);
  void refreshRecents();
  return !state.history.isDirty;
}
async function canReplace(): Promise<boolean> {
  scene.finishInteraction();
  if (!state.history.isDirty) return true;
  const decision = await choose(
    'Save your changes?',
    'This diagram has unsaved changes.',
    ['Cancel', 'Discard changes', 'Save'],
  );
  if (decision === 'Save') return saveCurrent();
  return decision === 'Discard changes';
}
const importer = infrastructureImporter({
  notify,
  apply: async (doc) => {
    const nodeChanges = new Map(
      state.current.nodes.map((node) => [
        node.id,
        { id: node.id, value: null as DiagramNode | null },
      ]),
    );
    for (const value of doc.nodes)
      nodeChanges.set(value.id, { id: value.id, value });
    const edgeChanges = new Map(
      state.current.edges.map((edge) => [
        edge.id,
        { id: edge.id, value: null as DiagramEdge | null },
      ]),
    );
    for (const value of doc.edges)
      edgeChanges.set(value.id, { id: value.id, value });
    commit(
      {
        type: 'graph',
        label: 'Import infrastructure',
        title: doc.title,
        nodes: [...nodeChanges.values()],
        edges: [...edgeChanges.values()],
      },
      [],
    );
    scene.fit();
    return true;
  },
});
element('import-infrastructure').onclick = () => {
  element('file-menu').hidden = true;
  importer.open();
};
element('auto-layout').onclick = () => {
  commit(layoutEdit(state.current));
  scene.fit();
  element('file-menu').hidden = true;
};
element('new').onclick = () =>
  void action(async () => {
    if (!(await canReplace())) return;
    replaceDocument({
      version: 1,
      title: 'Untitled diagram',
      nodes: [],
      edges: [],
    });
    element('file-menu').hidden = true;
  });
element('open').onclick = () => {
  element('file-menu').hidden = true;
  void action(async () => {
    if (!(await canReplace())) return;
    const opened = await openDocumentFile();
    if (opened !== null) {
      replaceDocument(parseDocument(opened.content));
      state.fileHandle = opened.handle;
      notify(`Opened ${opened.name}`);
      void refreshRecents();
    }
  });
};
for (const id of ['save', 'save-as'])
  element(id).onclick = () => {
    element('file-menu').hidden = true;
    void action(async () => {
      await saveCurrent(id === 'save-as');
    });
  };
element('export').onclick = () => {
  element('file-menu').hidden = true;
  void action(async () => {
    if (await exportPng(await scene.png())) notify('PNG exported');
  });
};
element('quick-save').onclick = () => element('save').click();
async function copyImage(): Promise<void> {
  try {
    notify('Capturing diagram…');
    await copyPng(await scene.captureDiagram());
    notify('Diagram image copied · paste it anywhere');
  } catch (error) {
    notify(
      `Could not copy image: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
element('copy-image').onclick = () => void copyImage();
element('quick-export').onclick = () => element('export').click();
element('menu').onclick = () => {
  const menu = element('file-menu');
  menu.hidden = !menu.hidden;
  element('menu').setAttribute('aria-expanded', String(!menu.hidden));
  showComponents(false);
};
for (const id of ['components', 'tool-add', 'layer-add'])
  element(id).onclick = () =>
    showComponents(element('component-palette').hidden);
element('close-components').onclick = () => showComponents(false);
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
element('iso').onclick = () => {
  scene.setView('isometric');
  element('iso').setAttribute('aria-pressed', 'true');
  element('top').setAttribute('aria-pressed', 'false');
};
element('top').onclick = () => {
  scene.setView('top');
  element('iso').setAttribute('aria-pressed', 'false');
  element('top').setAttribute('aria-pressed', 'true');
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

/** Palette rows are built once; searching only filters and re-orders them. */
const serviceRows = services.map((service) => ({
  service,
  search:
    `${service.label} ${service.category} ${service.aliases}`.toLowerCase(),
  button: undefined as HTMLButtonElement | undefined,
}));
function serviceButton(service: (typeof services)[number]): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'service';
  const symbol = document.createElement('span');
  symbol.className = 'service-symbol';
  symbol.style.color = service.color;
  if (service.icon) {
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = service.icon;
    image.alt = '';
    symbol.append(image);
  } else symbol.textContent = service.glyph;
  const text = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = service.label;
  const detail = document.createElement('small');
  detail.textContent = service.description;
  text.append(name, detail);
  button.append(symbol, text);
  button.onclick = () => addService(service);
  return button;
}
function populateServices(query = ''): void {
  const list = element('services');
  const needle = query.toLowerCase();
  list.replaceChildren();
  for (const row of serviceRows) {
    if (!row.search.includes(needle)) continue;
    row.button ??= serviceButton(row.service);
    list.append(row.button);
  }
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'empty-search';
    empty.textContent = 'No matching services. Try another name.';
    list.append(empty);
  }
  highlightService(0);
}
function addService(service: (typeof services)[number]): void {
  const id = crypto.randomUUID();
  const [width, depth] = defaultSize(service.kind);
  let point: { x: number; z: number };
  try {
    point = insertionSlot(state.current, scene.insertionPoint(), width, depth);
  } catch (error) {
    notify(String(error));
    return;
  }
  state.history.execute({
    type: 'insert',
    node: {
      id,
      kind: service.kind,
      serviceId: service.id,
      ...(service.shape ? { shape: service.shape } : {}),
      ...(service.boundary ? { boundary: service.boundary } : {}),
      ...(service.policyKind
        ? {
            policy:
              service.policyKind === 'route-table'
                ? { kind: 'route-table' as const, routes: [] }
                : { kind: service.policyKind, rules: [] },
          }
        : {}),
      label: service.label,
      x: Math.round(point.x / 10) * 10,
      z: Math.round(point.z / 10) * 10,
      width,
      depth,
      color: service.color,
    },
  });
  deferInspect(() => scene.load(state.current));
  scene.select(id);
  scene.reveal(id);
  updateHeader();
  showComponents(false);
  selectTool('select');
  notify(`${service.label} added`);
  if (service.kind === 'text' || service.kind === 'note')
    openEditor({ kind: 'node', id }, true);
}
function defaultSize(kind: DiagramNode['kind']): [number, number] {
  if (kind === 'group') return [500, 320];
  if (kind === 'text') return [280, 60];
  if (kind === 'note') return [220, 170];
  return [160, 100];
}
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

let closeEditor: ((save: boolean) => void) | undefined;
/**
 * Edit text in place over the canvas. Annotations get a multi-line editor
 * matching their box; services, boundaries and connections a one-line field.
 */
function openEditor(target: EditTarget, created = false): void {
  closeEditor?.(true);
  if (target.kind === 'empty') {
    placeAnnotation('text', target.x, target.z);
    return;
  }
  const node =
    target.kind === 'node'
      ? state.current.nodes.find((n) => n.id === target.id)
      : undefined;
  const edge =
    target.kind === 'edge'
      ? state.current.edges.find((e) => e.id === target.id)
      : undefined;
  if (!node && !edge) return;
  const annotation = node?.kind === 'text' || node?.kind === 'note';
  const editor = document.createElement(annotation ? 'textarea' : 'input');
  editor.className = `inline-editor${node ? ` ${node.kind}` : ' edge'}`;
  editor.value = node?.label ?? edge?.label ?? '';
  editor.maxLength = annotation ? MAX_TEXT : 1000;
  editor.setAttribute('aria-label', annotation ? 'Text' : 'Label');
  editor.spellcheck = annotation;
  if (node && annotation) {
    const rect = scene.nodeScreenRect(node.id);
    const scale = scene.nodePixelScale(node.id);
    if (!rect) return;
    Object.assign(editor.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${Math.max(rect.width, 160)}px`,
      height: `${Math.max(rect.height, 48)}px`,
      fontSize: `${Math.max(11, fontSize(node) * scale)}px`,
      padding: `${(node.kind === 'note' ? 14 : 4) * scale}px`,
      background: node.kind === 'note' ? node.color : '',
    });
  } else {
    const anchor = node
      ? (() => {
          const rect = scene.nodeScreenRect(node.id);
          return rect
            ? {
                x: rect.left + rect.width / 2,
                y:
                  node.kind === 'group'
                    ? rect.top + 18
                    : rect.top + rect.height + 22,
              }
            : undefined;
        })()
      : edge
        ? scene.edgeScreenPosition(edge.id)
        : undefined;
    if (!anchor) return;
    Object.assign(editor.style, {
      left: `${anchor.x - 110}px`,
      top: `${anchor.y - 18}px`,
      width: '220px',
    });
  }
  document.body.append(editor);
  editor.focus();
  editor.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    closeEditor = undefined;
    const value = editor.value;
    editor.remove();
    if (!save) {
      // Cancelling a just-placed annotation removes it again.
      if (created && annotation) travelHistory(false);
      return;
    }
    if (node) {
      const live = state.current.nodes.find((n) => n.id === node.id);
      if (!live) return;
      if (created && live.kind === 'text' && !value.trim()) {
        travelHistory(false);
        return;
      }
      if (value === live.label) return;
      commit(
        {
          type: 'graph',
          label: annotation ? 'Edit text' : 'Rename component',
          nodes: [{ id: live.id, value: { ...live, label: value } }],
        },
        [live.id],
      );
    } else if (edge) {
      const live = state.current.edges.find((e) => e.id === edge.id);
      if (!live || value === live.label) return;
      commit(
        {
          type: 'graph',
          label: 'Label connection',
          edges: [
            { id: live.id, value: { ...live, label: value.slice(0, 1000) } },
          ],
        },
        [],
      );
      scene.selectEdge(live.id);
    }
  };
  closeEditor = finish;
  editor.addEventListener('blur', () => finish(true));
  editor.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    keyboard.stopPropagation();
    if (keyboard.key === 'Escape') {
      keyboard.preventDefault();
      finish(!created);
    } else if (
      keyboard.key === 'Enter' &&
      (!annotation || keyboard.ctrlKey || keyboard.metaKey)
    ) {
      keyboard.preventDefault();
      finish(true);
    }
  });
  notify(
    annotation
      ? 'Typing · Ctrl+Enter or click away to finish · Esc cancels'
      : 'Enter to rename · Esc cancels',
  );
}
let highlighted = 0;
function serviceButtons(): HTMLButtonElement[] {
  return [...element('services').querySelectorAll<HTMLButtonElement>('button')];
}
function highlightService(index: number): void {
  const buttons = serviceButtons();
  highlighted = buttons.length ? (index + buttons.length) % buttons.length : 0;
  for (const [i, button] of buttons.entries())
    button.classList.toggle('highlighted', i === highlighted);
  buttons[highlighted]?.scrollIntoView({ block: 'nearest' });
}
element('search').oninput = () =>
  populateServices(inputElement('search').value);
// Type to filter, arrows to choose, Enter drops the match on the board.
element('search').onkeydown = (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    highlightService(highlighted + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    serviceButtons()[highlighted]?.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    showComponents(false);
  }
};
function hasSelectedAncestor(node: DiagramNode): boolean {
  let parent = node.parentId;
  while (parent) {
    if (state.selectedIds.has(parent)) return true;
    parent = state.current.nodes.find((n) => n.id === parent)?.parentId;
  }
  return false;
}
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
const tablet = installTabletControls({
  scene,
  notify,
  isRecording: () => state.recording,
  layersVisible: () => state.layersVisible,
  showLayers,
  components: {
    isOpen: () => !element('component-palette').hidden,
    open: () => showComponents(true),
    step: (by) => highlightService(highlighted + by),
    addHighlighted: () => serviceButtons()[highlighted]?.click(),
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
const journey = installJourneyControls(app);
function toggleJourney(): void {
  journey.toggleJourney();
}
field('quality').onchange = () => {
  const ratio = Number(field('quality').value);
  scene.setQuality(ratio);
  try {
    localStorage.setItem('solar-forge-quality', String(ratio));
  } catch {
    notify('Quality changed for this session.');
  }
};
try {
  const quality = localStorage.getItem('solar-forge-quality');
  if (quality && ['1', '1.5', '2'].includes(quality)) {
    field('quality').value = quality;
    scene.setQuality(Number(quality));
  }
} catch {}
function setFlow(on: boolean): void {
  scene.setFlow(on);
  element('flow').setAttribute('aria-pressed', String(on));
  try {
    localStorage.setItem('solar-forge-flow', on ? '1' : '0');
  } catch {}
}
try {
  if (localStorage.getItem('solar-forge-flow') === '0') setFlow(false);
} catch {}
element('flow').onclick = () => setFlow(!scene.flow);
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
  closeEditor?.(true);
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
    const routes = inspector.routeActions();
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
// The canvas claims pointerdown (no blur), so finish inline edits explicitly.
window.addEventListener(
  'pointerdown',
  (event) => {
    if (
      closeEditor &&
      !(
        event.target instanceof Element &&
        event.target.closest('.inline-editor')
      )
    )
      closeEditor(true);
  },
  { capture: true },
);
window.addEventListener('pointerdown', (event) => {
  if (
    event.target instanceof Node &&
    !element('context-menu').contains(event.target)
  )
    element('context-menu').hidden = true;
});
for (const type of ['copy', 'cut'] as const)
  window.addEventListener(type, (event) => {
    if (isTextTarget(event.target) || !state.selectedIds.size) return;
    event.preventDefault();
    event.clipboardData?.setData(
      'text/plain',
      serializeDocument(copyFragment(state.current, state.selectedIds)),
    );
    if (type === 'cut') deleteSelection();
  });
window.addEventListener('paste', (event) => {
  if (isTextTarget(event.target)) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  try {
    const doc = parseDocument(text);
    const edit = pasteFragment(doc, () => crypto.randomUUID());
    event.preventDefault();
    commit(
      edit,
      edit.type === 'graph' ? (edit.nodes?.map((n) => n.id) ?? []) : [],
    );
  } catch {
    notify('Clipboard does not contain a valid Solar Forge selection.');
  }
});
window.addEventListener('keydown', (event) => {
  if (isTextTarget(event.target)) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    ['a', 'g', 'd'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (key === 'a') scene.selectMany(state.current.nodes.map((n) => n.id));
    else
      element(
        key === 'd' ? 'duplicate' : event.shiftKey ? 'ungroup' : 'tool-group',
      ).click();
  }
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    commandPalette([
      ...[
        'new',
        'browse-examples',
        'open',
        'save',
        'save-as',
        'export',
        'export-svg',
        'auto-layout',
        'reachability',
        'import-infrastructure',
        'export-gif',
        'export-video',
        'export-mermaid',
        'export-plantuml',
        'export-drawio',
        'fit',
        'iso',
        'top',
        'tool-group',
        'ungroup',
        'duplicate',
        'delete',
      ].map((id) => ({
        label:
          element(id).getAttribute('title') ??
          element(id).textContent?.trim() ??
          id,
        run: () => element(id).click(),
      })),
      { label: 'Play journey (P)', run: toggleJourney },
      {
        label: 'Copy diagram image (Ctrl+Shift+C)',
        run: () => void copyImage(),
      },
      ...alignments.map(([alignment, label]) => ({
        label,
        run: () => align(alignment),
      })),
      ...themes.map((option) => ({
        label: `Theme: ${option.name}`,
        run: () => setTheme(option.id),
      })),
      ...services.map((service) => ({
        label: `Add ${service.label} · ${service.category}`,
        run: () => {
          showComponents(true);
          inputElement('search').value = service.label;
          populateServices(service.label);
        },
      })),
    ]);
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    ['z', 'y'].includes(event.key.toLowerCase()) &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    travelHistory(event.shiftKey || event.key.toLowerCase() === 'y');
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === 'c' &&
    !isTextTarget(event.target)
  ) {
    event.preventDefault();
    void copyImage();
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    ['s', 'o', 'n'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    element(
      event.key.toLowerCase() === 's'
        ? event.shiftKey
          ? 'save-as'
          : 'save'
        : event.key.toLowerCase() === 'n'
          ? 'new'
          : 'open',
    ).click();
    return;
  }
  if (event.key === 'Escape') {
    closeEditor?.(false);
    if (scene.journeyPlaying) {
      scene.stopJourney();
      return;
    }
    scene.cancelInteraction();
    element('context-menu').hidden = true;
    selectTool('select');
    showComponents(false);
    element('file-menu').hidden = true;
    element('help-panel').hidden = true;
    element('traffic-panel').hidden = true;
    element('gif-panel').hidden = true;
    element('theme-menu').hidden = true;
    tablet.showSettings(false);
    element('menu').setAttribute('aria-expanded', 'false');
    element('help').setAttribute('aria-expanded', 'false');
    scene.select(undefined);
    return;
  }
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  const roots = state.current.nodes.filter(
    (n) => state.selectedIds.has(n.id) && !hasSelectedAncestor(n),
  );
  const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
    event.key,
  );
  // Arrows nudge a selection; otherwise they and WASD glide the camera.
  if (
    isPanKey(event.key) &&
    !(arrow && roots.length) &&
    // A modal dialog owns the keyboard; the board behind it stays put.
    !document.querySelector('dialog[open]')
  ) {
    event.preventDefault();
    cameraKeys.press(event.key, event.shiftKey);
    return;
  }
  if (arrow) {
    event.preventDefault();
    const step = event.shiftKey ? 50 : scene.snapping ? 10 : 1;
    const dx =
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dz =
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    commit({
      type: 'graph',
      label: 'Nudge selection',
      nodes: roots.map((n) => ({
        id: n.id,
        value: { ...n, x: n.x + dx, z: n.z + dz },
      })),
    });
  }
  if (event.key === '/') {
    event.preventDefault();
    showComponents(true);
  }
  if (event.key.toLowerCase() === 'v') selectTool('select');
  if (event.key.toLowerCase() === 'c') element('tool-connect').click();
  if (event.key.toLowerCase() === 'm') selectTool('pan');
  if (event.key.toLowerCase() === 'p') toggleJourney();
  if (event.key.toLowerCase() === 't') element('tool-text').click();
  if (event.key.toLowerCase() === 'n') element('tool-note').click();
  if (event.key.toLowerCase() === 'b') element('tool-sketch').click();
  if (event.key === 'Enter' && state.selected) {
    event.preventDefault();
    openEditor({ kind: 'node', id: state.selected });
  }
  if (event.key.toLowerCase() === 'f') scene.fit();
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelection();
  }
});
window.addEventListener('keyup', (event) => {
  if (isPanKey(event.key)) cameraKeys.release(event.key, event.shiftKey);
});
window.addEventListener('blur', () => cameraKeys.stop());
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
populateServices();
updateHeader();
void dismissSplash();
scene.fit();
notify(
  nativeAvailable()
    ? 'Offline · Ready'
    : 'Browser workspace · Saving downloads a copy',
);
void (async () => {
  const native = nativeAvailable();
  if (native) {
    if (await invoke<boolean>('diagnostic_mode')) {
      const { runNativeDiagnostics } = await import('./renderer/diagnostics');
      await runNativeDiagnostics(scene);
      return;
    }
    let closing = false;
    await getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      if (closing || state.busy) return;
      closing = true;
      void (async () => {
        if (!(await canReplace())) return;
        // A deliberate discard also removes the recovery snapshot.
        if (state.recoveryReady) {
          await recovery.flush();
          await writeRecovery(null);
        }
        recovery.dispose();
        await getCurrentWindow().destroy();
      })()
        .catch((error) => notify(`Could not close: ${String(error)}`))
        .finally(() => {
          closing = false;
        });
    });
  }
  const content = await readRecovery();
  if (content) {
    const decision = await choose(
      'Recover your diagram?',
      'An unsaved diagram was found from a previous session.',
      native
        ? ['Close app', 'Discard recovery', 'Recover']
        : ['Discard recovery', 'Recover'],
    );
    if (decision === 'Recover') {
      replaceDocument(parseDocument(content));
      state.history.markSaved(-1);
      updateHeader();
      notify('Recovered diagram. Save to choose a destination.');
    } else if (decision === 'Discard recovery') await writeRecovery(null);
    else if (native) {
      await getCurrentWindow().destroy();
      return;
    }
  }
  state.recoveryReady = true;
  window.addEventListener('blur', () => {
    if (state.history.isDirty) {
      recovery.schedule();
      void recovery.flush().catch(() => {});
    }
  });
  if (!native) return;
  await refreshRecents();
  const openPending = async () => {
    if (state.busy) return;
    const opened = await invoke<OpenedFile | null>('take_pending_file');
    if (!opened) return;
    await action(async () => {
      if (!(await canReplace())) return;
      replaceDocument(parseDocument(opened.content));
      state.fileHandle = opened.handle;
      notify(`Opened ${opened.name}`);
      await refreshRecents();
    });
  };
  await listen(
    'pending-file',
    () => void openPending().catch((error) => notify(String(error))),
  );
  await openPending();
})().catch((error) => notify(`Startup check failed: ${String(error)}`));
