import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { RecoveryWriter } from './persistence/recovery';
import { choose } from './ui/dialogs';
import './style.css';
import { services } from './catalog/services';
import {
  parseDocument,
  sampleDocument,
  serializeDocument,
  starterDocument,
} from './domain/document';
import { DocumentHistory } from './domain/history';
import {
  exportPng,
  nativeAvailable,
  openDocumentFile,
  saveDocumentFile,
} from './platform/files';
import { DiagramScene } from './renderer/scene';
import { icon } from './ui/icons';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = `
  <main class="workspace" aria-label="Diagram workspace"><div id="canvas"></div></main>
  <header class="topbar">
    <div class="board-heading"><button id="menu" class="icon-button" aria-label="File menu" aria-expanded="false" title="File menu">${icon('menu')}</button><span class="forge-mark" aria-hidden="true">✦</span><span class="brand">Solar Forge</span><span class="heading-divider"></span><span id="title" class="document-title"></span><span id="save-state" class="save-state">Unchanged</span></div>
    <div class="top-actions"><button id="components" class="quiet-button" title="AWS components (/)" aria-expanded="false">${icon('cube')}<span>Components</span></button><button id="toggle-layers" class="icon-button" aria-label="Toggle Layers panel" aria-pressed="true" title="Layers">${icon('layers')}</button><button id="quick-save" class="quiet-button" title="Save diagram (Ctrl+S)">${icon('save')}<span>Save</span></button><button id="quick-export" class="export-button">Export ${icon('arrow')}</button></div>
  </header>
  <section id="file-menu" class="popover file-menu" aria-label="File menu" hidden><p class="popover-caption">LOCAL WORKSPACE</p><button id="new">New diagram <kbd>Ctrl N</kbd></button><button id="open">Open diagram <kbd>Ctrl O</kbd></button><button id="save">Save diagram <kbd>Ctrl S</kbd></button><button id="save-as">Save as… <kbd>Ctrl Shift S</kbd></button><button id="export">Export PNG ${icon('arrow')}</button><div class="menu-divider"></div><p class="popover-caption">EXAMPLES</p><button id="example-starter">Two-service starter</button><button id="example-serverless">Serverless architecture</button></section>
  <nav class="tool-rail" aria-label="Canvas tools"><button id="tool-select" class="tool active" aria-label="Select" aria-pressed="true" title="Select (V)">${icon('pointer')}<kbd>V</kbd></button><button id="tool-pan" class="tool" aria-label="Pan" aria-pressed="false" title="Pan (M)">${icon('hand')}<kbd>M</kbd></button><span class="rail-divider"></span><button id="tool-add" class="tool" aria-label="Add AWS service" title="Add AWS service (/)">${icon('cube')}<kbd>/</kbd></button><button id="tool-edit" class="tool" aria-label="Rename selected component" title="Rename selected component" disabled>${icon('edit')}</button><span class="rail-divider"></span><button id="tool-fit" class="tool" aria-label="Fit diagram" title="Fit diagram (F)">${icon('fit')}</button></nav>
  <section id="component-palette" class="popover component-palette" aria-label="AWS components" hidden><div class="popover-heading"><h2>AWS components</h2><button id="close-components" class="small-icon" aria-label="Close components">${icon('close')}</button></div><label class="sr-only" for="search">Find a component</label><input id="search" type="search" placeholder="Search services…"><div id="services"></div><p class="palette-hint">Choose a service to add it to your board.</p></section>
  <aside id="layers-panel" class="layers-panel" aria-label="Layers and properties"><div class="panel-heading"><h2>Layers</h2><button id="layer-add" class="small-icon" aria-label="Add service">${icon('plus')}</button><button id="close-layers" class="small-icon" aria-label="Close Layers panel">${icon('close')}</button></div><div class="ground-card"><button id="ground-toggle" class="ground-eye" aria-label="Hide diagram" aria-pressed="true">${icon('eye')}</button><div><strong><span class="ground-dot"></span>Diagram</strong><p id="ground-summary"></p></div><span class="layer-index">01</span></div><div id="layer-tree" class="layer-tree" aria-label="Diagram objects"></div><section id="properties" class="properties" aria-label="Selected component properties" hidden><p class="section-label">SELECTED COMPONENT</p><h3 id="selection"></h3><p id="selection-note" class="muted"></p><label for="node-label">Label</label><input id="node-label"><dl><dt>X</dt><dd id="position-x">—</dd><dt>Z</dt><dd id="position-z">—</dd></dl></section><div class="panel-foot"><span class="offline-dot"></span> Offline workspace <span class="forge-wordmark">SOLAR FORGE</span></div></aside>
  <nav class="canvas-controls" aria-label="Canvas controls"><div class="zoom-dock floating-dock" aria-label="Zoom controls"><button id="zoom-out" class="small-icon" aria-label="Zoom out">${icon('minus')}</button><span id="zoom-level">100%</span><button id="zoom-in" class="small-icon" aria-label="Zoom in">${icon('plus')}</button><span class="dock-divider"></span><button id="fit">Fit</button><span class="dock-divider"></span><button id="help" class="small-icon" aria-label="Keyboard help" aria-expanded="false">${icon('help')}</button></div>
  <div class="history-dock floating-dock" aria-label="Edit history"><button id="undo" class="small-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button id="redo" class="small-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')}</button></div>
  <div class="view-dock floating-dock" aria-label="View controls"><span class="dock-label">View</span><button id="iso" aria-pressed="true">2.5D</button><button id="top" aria-pressed="false">Plan</button><span class="dock-divider"></span><button id="delete" class="delete-button" disabled>${icon('trash')}<span>Delete</span></button></div></nav>
  <section id="help-panel" class="popover help-panel" aria-label="Keyboard shortcuts" hidden><h2>Make room for your ideas.</h2><p><kbd>V</kbd> Select <kbd>M</kbd> Pan <kbd>F</kbd> Fit view</p><p><kbd>/</kbd> Add a service <kbd>Esc</kbd> Deselect</p><p><kbd>Ctrl Z</kbd> Undo <kbd>Ctrl Shift Z</kbd> Redo</p><p>Scroll to zoom. Right-drag to pan.<br>Choose a component in Layers to edit its label.</p></section>
  <div id="status" class="status" role="status">Ready</div><span id="count" class="board-count"></span>`;
function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result;
}
function inputElement(id: string): HTMLInputElement {
  const result = element(id);
  if (!(result instanceof HTMLInputElement))
    throw new Error(`Expected input: ${id}`);
  return result;
}
let current = starterDocument();
let history = new DocumentHistory(current);
let selected: string | undefined;
let dirty = false;
let busy = false;
let fileHandle: number | undefined;
let recoveryReady = false;
const recovery = new RecoveryWriter(
  () => (history.isDirty ? serializeDocument(current) : null),
  (content) =>
    nativeAvailable()
      ? invoke('write_recovery', { content })
      : Promise.resolve(),
  (error) => notify(`Recovery failed: ${String(error)}. Save your diagram.`),
);
let layersVisible = true;
let diagramVisible = true;
const notify = (message: string): void => {
  element('status').textContent = message;
};
let scene: DiagramScene;
try {
  scene = new DiagramScene(element('canvas'), current);
} catch (error) {
  notify(
    `Graphics unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
  throw error;
}
function showComponents(show: boolean): void {
  element('component-palette').hidden = !show;
  element('components').setAttribute('aria-expanded', String(show));
  if (show) {
    element('file-menu').hidden = true;
    inputElement('search').focus();
  }
}
function showLayers(show: boolean): void {
  layersVisible = show;
  element('layers-panel').hidden = !show;
  element('toggle-layers').setAttribute('aria-pressed', String(show));
  scene.setPanelVisible(show);
}
function updateLayers(): void {
  const list = element('layer-tree');
  list.replaceChildren();
  for (const node of current.nodes) {
    const button = document.createElement('button');
    button.className = `layer-row ${node.kind}${selected === node.id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selected === node.id));
    const symbol = document.createElement('span');
    symbol.className = 'layer-symbol';
    symbol.style.color = node.color;
    symbol.textContent =
      node.kind === 'group'
        ? '▱'
        : (services.find((service) => service.label === node.label)?.glyph ??
          '◇');
    const label = document.createElement('span');
    label.textContent = node.label;
    button.append(symbol, label);
    button.onclick = () => scene.select(node.id);
    list.append(button);
  }
}
function updateHeader(): void {
  dirty = history.isDirty;
  if (recoveryReady) recovery.schedule();
  element('save-state').textContent = dirty ? 'Unsaved changes' : 'Unchanged';
  for (const [id, enabled] of [
    ['undo', history.canUndo],
    ['redo', history.canRedo],
  ] as const) {
    const button = element(id);
    if (button instanceof HTMLButtonElement) button.disabled = !enabled;
  }
  element('title').textContent = `${current.title}${dirty ? ' •' : ''}`;
  element('count').textContent =
    `${current.nodes.length} objects · ${current.edges.length} connections`;
  const serviceCount = current.nodes.filter(
    (node) => node.kind === 'service',
  ).length;
  element('ground-summary').textContent =
    `${serviceCount} services · ${current.nodes.length - serviceCount} boundaries`;
  updateLayers();
}
function inspect(): void {
  const node = current.nodes.find((n) => n.id === selected);
  element('properties').hidden = !node;
  element('selection').textContent = node?.label ?? '';
  inputElement('node-label').value = node?.label ?? '';
  element('position-x').textContent = node ? String(node.x) : '—';
  element('position-z').textContent = node ? String(node.z) : '—';
  element('selection-note').textContent =
    node?.kind === 'group' ? 'Architecture boundary' : 'AWS service';
  for (const id of ['delete', 'tool-edit']) {
    const button = element(id);
    if (button instanceof HTMLButtonElement) button.disabled = !node;
  }
  updateLayers();
}
scene.onSelect = (node) => {
  selected = node?.id;
  inspect();
};
scene.onMove = (id, from, to) => {
  history.execute({ type: 'move', id, from, to });
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
function replaceDocument(next: typeof current): void {
  fileHandle = undefined;
  current = next;
  history = new DocumentHistory(current);
  selected = undefined;
  dirty = false;
  scene.load(current);
  scene.fit();
  inspect();
  updateHeader();
}
async function action(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  scene.finishInteraction();
  busy = true;
  try {
    await task();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
  }
}
async function saveCurrent(saveAs = false): Promise<boolean> {
  scene.finishInteraction();
  const savedHistory = history;
  const token = history.token;
  const saved = await saveDocumentFile(
    serializeDocument(current),
    saveAs ? undefined : fileHandle,
  );
  if (!saved) return false;
  if (history === savedHistory) fileHandle = saved.handle;
  savedHistory.markSaved(token);
  updateHeader();
  await recovery.flush();
  notify(`Saved ${saved.name}`);
  return !history.isDirty;
}
async function canReplace(): Promise<boolean> {
  scene.finishInteraction();
  if (!history.isDirty) return true;
  const decision = await choose(
    'Save your changes?',
    'This diagram has unsaved changes.',
    ['Cancel', 'Discard changes', 'Save'],
  );
  if (decision === 'Save') return saveCurrent();
  return decision === 'Discard changes';
}
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
      fileHandle = opened.handle;
      notify(`Opened ${opened.name}`);
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
for (const [id, create] of [
  ['example-starter', starterDocument],
  ['example-serverless', sampleDocument],
] as const) {
  element(id).onclick = () =>
    void action(async () => {
      if (!(await canReplace())) return;
      replaceDocument(create());
      element('file-menu').hidden = true;
      notify('Example loaded');
    });
}
element('quick-save').onclick = () => element('save').click();
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
element('toggle-layers').onclick = () => showLayers(!layersVisible);
element('close-layers').onclick = () => showLayers(false);
element('ground-toggle').onclick = () => {
  diagramVisible = !diagramVisible;
  scene.setDiagramVisible(diagramVisible);
  element('ground-toggle').setAttribute('aria-pressed', String(diagramVisible));
  element('ground-toggle').setAttribute(
    'aria-label',
    diagramVisible ? 'Hide diagram' : 'Show diagram',
  );
};
function selectTool(tool: 'select' | 'pan'): void {
  scene.setTool(tool);
  for (const name of ['select', 'pan']) {
    const button = element(`tool-${name}`);
    button.classList.toggle('active', name === tool);
    button.setAttribute('aria-pressed', String(name === tool));
  }
}
element('tool-select').onclick = () => selectTool('select');
element('tool-pan').onclick = () => selectTool('pan');
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
  showLayers(true);
  inputElement('node-label').focus();
  inputElement('node-label').select();
};
element('node-label').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  if (
    !history.execute({
      type: 'rename',
      id: node.id,
      label: inputElement('node-label').value,
    })
  )
    return;
  scene.load(current);
  scene.select(node.id);
  updateHeader();
};
function deleteSelection(): void {
  scene.finishInteraction();
  if (!selected) return;
  history.execute({ type: 'delete', id: selected });
  selected = undefined;
  scene.load(current);
  updateHeader();
  inspect();
  notify('Selection deleted');
}
element('delete').onclick = deleteSelection;
function travelHistory(redo: boolean): void {
  scene.finishInteraction();
  const edit = redo ? history.redo() : history.undo();
  if (!edit) return;
  const selection = selected;
  if (edit.type === 'move') scene.refreshPosition(edit.id);
  else {
    scene.load(current);
    scene.select(
      selection && current.nodes.some((node) => node.id === selection)
        ? selection
        : undefined,
    );
  }
  updateHeader();
  inspect();
  notify(`${redo ? 'Redid' : 'Undid'} ${edit.type}`);
}
element('undo').onclick = () => travelHistory(false);
element('redo').onclick = () => travelHistory(true);

function populateServices(query = ''): void {
  const list = element('services');
  list.replaceChildren();
  for (const service of services) {
    if (!service.label.toLowerCase().includes(query.toLowerCase())) continue;
    const button = document.createElement('button');
    button.className = 'service';
    const symbol = document.createElement('span');
    symbol.className = 'service-symbol';
    symbol.style.color = service.color;
    symbol.textContent = service.glyph;
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = service.label;
    const detail = document.createElement('small');
    detail.textContent = service.description;
    text.append(name, detail);
    button.append(symbol, text);
    button.onclick = () => {
      const id = crypto.randomUUID();
      const point = scene.insertionPoint();
      history.execute({
        type: 'insert',
        node: {
          id,
          kind: 'service',
          label: service.label,
          x: Math.round(point.x / 10) * 10,
          z: Math.round(point.z / 10) * 10,
          width: 150,
          depth: 96,
          color: service.color,
        },
      });
      scene.load(current);
      scene.select(id);
      updateHeader();
      showComponents(false);
      selectTool('select');
      notify(`${service.label} added`);
    };
    list.append(button);
  }
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'empty-search';
    empty.textContent = 'No matching services. Try another name.';
    list.append(empty);
  }
}
element('search').oninput = () =>
  populateServices(inputElement('search').value);
window.addEventListener('keydown', (event) => {
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
    showComponents(false);
    element('file-menu').hidden = true;
    element('help-panel').hidden = true;
    element('menu').setAttribute('aria-expanded', 'false');
    element('help').setAttribute('aria-expanded', 'false');
    scene.select(undefined);
    return;
  }
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.key === '/') {
    event.preventDefault();
    showComponents(true);
  }
  if (event.key.toLowerCase() === 'v') selectTool('select');
  if (event.key.toLowerCase() === 'm') selectTool('pan');
  if (event.key.toLowerCase() === 'f') scene.fit();
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelection();
  }
});
window.addEventListener('beforeunload', (event) => {
  scene.finishInteraction();
  if (dirty) event.preventDefault();
});
window.addEventListener('pagehide', () => scene.dispose(), { once: true });
function adaptViewport(): void {
  if (innerWidth < 800 && layersVisible) showLayers(false);
}
window.addEventListener('resize', adaptViewport);
populateServices();
updateHeader();
adaptViewport();
scene.fit();
notify(
  nativeAvailable()
    ? 'Offline · Ready'
    : 'Development preview · File operations use the native app',
);
if (nativeAvailable())
  void (async () => {
    if (await invoke<boolean>('diagnostic_mode')) {
      const { runNativeDiagnostics } = await import('./renderer/diagnostics');
      await runNativeDiagnostics(scene);
      return;
    }
    let closing = false;
    await getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      if (closing || busy) return;
      closing = true;
      void (async () => {
        if (!(await canReplace())) return;
        // A deliberate discard also removes the recovery snapshot.
        if (recoveryReady) {
          await recovery.flush();
          await invoke('write_recovery', { content: null });
        }
        recovery.dispose();
        await getCurrentWindow().destroy();
      })()
        .catch((error) => notify(`Could not close: ${String(error)}`))
        .finally(() => {
          closing = false;
        });
    });
    const content = await invoke<string | null>('read_recovery');
    if (content) {
      const decision = await choose(
        'Recover your diagram?',
        'An unsaved diagram was found from a previous session.',
        ['Close app', 'Discard recovery', 'Recover'],
      );
      if (decision === 'Recover') {
        replaceDocument(parseDocument(content));
        history.markSaved(-1);
        updateHeader();
        notify('Recovered diagram. Save to choose a destination.');
      } else if (decision === 'Discard recovery')
        await invoke('write_recovery', { content: null });
      else {
        await getCurrentWindow().destroy();
        return;
      }
    }
    recoveryReady = true;
    window.addEventListener('blur', () => {
      if (history.isDirty) {
        recovery.schedule();
        void recovery.flush().catch(() => {});
      }
    });
  })().catch((error) =>
    notify(`Startup recovery check failed: ${String(error)}`),
  );
