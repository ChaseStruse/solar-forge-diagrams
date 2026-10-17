import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { templates } from './catalog/templates';
import {
  defaultTraffic,
  evaluateTraffic,
  parseNetworkRule,
  parseTraffic,
} from './domain/network';
import { RecoveryWriter } from './persistence/recovery';
import type { OpenedFile } from './platform/files';
import { exportGif } from './platform/files';
import { choose, commandPalette, promptText } from './ui/dialogs';
import './style.css';
import { findService, services } from './catalog/services';
import type { DiagramEdge, DiagramNode, Port } from './domain/document';
import {
  MAX_TEXT,
  parseDocument,
  sampleDocument,
  serializeDocument,
  starterDocument,
  worldPosition,
} from './domain/document';
import type { Edit } from './domain/history';
import { DocumentHistory } from './domain/history';
import { journeyBranches, journeyStarts } from './domain/journey';
import { fontSize, resizedFont } from './domain/text';
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
import {
  copyPng,
  exportPng,
  nativeAvailable,
  openDocumentFile,
  saveDocumentFile,
} from './platform/files';
import { DiagramScene, type EditTarget, type Tool } from './renderer/scene';
import { applyThemeCss, findTheme, themes } from './themes';
import { icon } from './ui/icons';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = `
  <main class="workspace" aria-label="Diagram workspace"><div id="canvas"></div></main>
  <header class="topbar">
    <div class="board-heading"><button id="menu" class="icon-button" aria-label="File menu" aria-expanded="false" title="File menu">${icon('menu')}</button><span class="forge-mark" aria-hidden="true">✦</span><span class="brand">Solar Forge</span><span class="heading-divider"></span><button id="title" class="document-title" title="Rename diagram"></button><span id="save-state" class="save-state">Unchanged</span></div>
    <div class="top-actions"><button id="components" class="quiet-button" title="AWS components (/)" aria-expanded="false">${icon('cube')}<span>Components</span></button><button id="copy-image" class="quiet-button" title="Copy diagram image to clipboard (Ctrl+Shift+C)">${icon('camera')}<span>Copy image</span></button><button id="theme" class="icon-button" aria-label="Theme" aria-expanded="false" title="Theme">${icon('palette')}</button><button id="toggle-layers" class="icon-button" aria-label="Toggle Layers panel" aria-pressed="true" title="Layers">${icon('layers')}</button><button id="quick-save" class="quiet-button" title="Save diagram (Ctrl+S)">${icon('save')}<span>Save</span></button><button id="quick-export" class="export-button">Export ${icon('arrow')}</button></div>
  </header>
  <section id="file-menu" class="popover file-menu" aria-label="File menu" hidden><p class="popover-caption">LOCAL WORKSPACE</p><button id="new">New diagram <kbd>Ctrl N</kbd></button><button id="open">Open diagram <kbd>Ctrl O</kbd></button><button id="save">Save diagram <kbd>Ctrl S</kbd></button><button id="save-as">Save as… <kbd>Ctrl Shift S</kbd></button><button id="export">Export PNG ${icon('arrow')}</button><button id="export-gif">Export journey GIF</button><button id="export-svg">Export SVG ${icon('arrow')}</button><div class="menu-divider"></div><p class="popover-caption">RECENT DIAGRAMS</p><div id="recent-files"></div><div class="menu-divider"></div><p class="popover-caption">TEMPLATES</p><button id="example-starter">Two-service starter</button><button id="example-serverless">Serverless architecture</button><div id="templates"></div></section>
  <section id="theme-menu" class="popover theme-menu" aria-label="Themes" hidden><p class="popover-caption">THEME</p><div id="theme-list"></div></section>
  <nav class="tool-rail" aria-label="Canvas tools"><button id="tool-select" class="tool active" aria-label="Select" aria-pressed="true" title="Select (V)">${icon('pointer')}<kbd>V</kbd></button><button id="tool-pan" class="tool" aria-label="Pan" aria-pressed="false" title="Pan (M)">${icon('hand')}<kbd>M</kbd></button><span class="rail-divider"></span><button id="tool-add" class="tool" aria-label="Add AWS service" title="Add AWS service (/)">${icon('cube')}<kbd>/</kbd></button><button id="tool-connect" class="tool" aria-label="Connect components" aria-pressed="false" title="Connect (C)">${icon('connect')}<kbd>C</kbd></button><button id="tool-text" class="tool" aria-label="Text" aria-pressed="false" title="Text: click the board (T)">${icon('text')}<kbd>T</kbd></button><button id="tool-note" class="tool" aria-label="Sticky note" aria-pressed="false" title="Sticky note: click the board (N)">${icon('note')}<kbd>N</kbd></button><button id="tool-group" class="tool" aria-label="Group selection" title="Group (Ctrl+G)">${icon('group')}</button><button id="tool-edit" class="tool" aria-label="Rename selected component" title="Rename selected component" disabled>${icon('edit')}</button><span class="rail-divider"></span><button id="tool-fit" class="tool" aria-label="Fit diagram" title="Fit diagram (F)">${icon('fit')}</button></nav>
  <section id="component-palette" class="popover component-palette" aria-label="AWS components" hidden><div class="popover-heading"><h2>AWS components</h2><button id="close-components" class="small-icon" aria-label="Close components">${icon('close')}</button></div><label class="sr-only" for="search">Find a component</label><input id="search" type="search" placeholder="Search services…"><div id="services"></div><p class="palette-hint">Choose a component to add it to your board.</p></section>
  <aside id="layers-panel" class="layers-panel" aria-label="Layers and properties"><div class="panel-heading"><h2>Layers</h2><button id="layer-add" class="small-icon" aria-label="Add service">${icon('plus')}</button><button id="close-layers" class="small-icon" aria-label="Close Layers panel">${icon('close')}</button></div><div class="ground-card"><button id="ground-toggle" class="ground-eye" aria-label="Hide diagram" aria-pressed="true">${icon('eye')}</button><div><strong><span class="ground-dot"></span>Diagram</strong><p id="ground-summary"></p></div><span class="layer-index">01</span></div><div id="layer-tree" class="layer-tree" aria-label="Diagram objects"></div><section id="properties" class="properties" aria-label="Selected component properties" hidden><p class="section-label">SELECTED COMPONENT</p><h3 id="selection"></h3><p id="selection-note" class="muted"></p><label for="node-label" id="node-label-caption">Label</label><input id="node-label" maxlength="1000"><textarea id="node-text" rows="4" hidden></textarea><div class="property-grid"><label id="node-font-row">Text size<input id="node-font" type="number" min="4" max="400"></label><label>Colour<input id="node-color" type="color"></label></div><div class="property-grid"><label>X<input id="node-x" type="number" min="-1000000" max="1000000"></label><label>Z<input id="node-z" type="number" min="-1000000" max="1000000"></label><label>Width<input id="node-width" type="number" min="30" max="1000000"></label><label>Depth<input id="node-depth" type="number" min="30" max="1000000"></label></div><label id="node-branch-row">Journey at this fork<select id="node-branch"></select></label><label for="node-parent">Inside boundary</label><select id="node-parent"></select><div class="property-actions"><button id="duplicate">Duplicate</button><button id="ungroup">Ungroup</button></div><details><summary>Architecture details</summary><label>Region<input id="meta-region" maxlength="1000"></label><label>Environment<input id="meta-environment" maxlength="1000"></label><label>Resource name<input id="meta-resourceName" maxlength="1000"></label><label>Tags<input id="meta-tags" maxlength="1000" placeholder="team=platform, env=dev"></label><label>Notes<textarea id="meta-notes" maxlength="1000" rows="3"></textarea></label></details></section><section id="edge-properties" class="properties" aria-label="Connection properties" hidden><p class="section-label">SELECTED CONNECTION</p><label>Label<input id="edge-label" maxlength="1000"></label><label>From<select id="edge-source"></select></label><label>Source port<select id="edge-sourcePort"><option value="">Auto</option><option>north</option><option>east</option><option>south</option><option>west</option></select></label><label>To<select id="edge-target"></select></label><label>Target port<select id="edge-targetPort"><option value="">Auto</option><option>north</option><option>east</option><option>south</option><option>west</option></select></label><label>Route<select id="edge-routing"><option value="horizontal">Horizontal first</option><option value="vertical">Vertical first</option></select></label><label>Bend offset<input id="edge-bend" type="number" min="-1000000" max="1000000" step="10"></label><div class="property-actions"><button id="edge-active">Make active route</button><button id="edge-all-routes">Show all routes</button></div><details><summary>Journey traffic rule</summary><label>Action<select id="rule-action"><option value="none">Unrestricted</option><option value="allow">Allow matching traffic</option><option value="deny">Deny all traffic</option></select></label><label>Protocol<select id="rule-protocol"><option value="any">Any</option><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label><label>Port (blank = any)<input id="rule-port" type="number" min="1" max="65535"></label><label>Source CIDR (blank = any)<input id="rule-source" placeholder="0.0.0.0/0"></label><label>Direction<select id="rule-direction"><option value="any">Any</option><option value="ingress">Ingress</option><option value="egress">Egress</option></select></label><button id="rule-apply">Apply rule</button></details><button id="delete-edge" class="delete-button">Delete connection</button></section><div class="panel-foot"><span class="offline-dot"></span> Offline workspace <span class="forge-wordmark">SOLAR FORGE</span></div></aside>
  <nav class="canvas-controls" aria-label="Canvas controls"><div class="zoom-dock floating-dock" aria-label="Zoom controls"><button id="zoom-out" class="small-icon" aria-label="Zoom out">${icon('minus')}</button><span id="zoom-level">100%</span><button id="zoom-in" class="small-icon" aria-label="Zoom in">${icon('plus')}</button><span class="dock-divider"></span><button id="fit">Fit</button><span class="dock-divider"></span><button id="help" class="small-icon" aria-label="Keyboard help" aria-expanded="false">${icon('help')}</button></div>
  <div class="history-dock floating-dock" aria-label="Edit history"><button id="undo" class="small-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button id="redo" class="small-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')}</button></div>
  <div class="view-dock floating-dock" aria-label="View controls"><button id="journey" class="journey-button" aria-pressed="false" title="Walk a person through the data flow (P)">${icon('user')}<span>Journey</span></button><button id="traffic-settings" title="Configure journey traffic">Traffic</button><button id="flow" aria-pressed="true" title="Animate data flow along connections">${icon('flow')}<span>Flow</span></button><button id="snap" aria-pressed="true" title="Snap positions to a 10-unit grid">Snap</button><span class="dock-divider"></span><button id="iso" aria-pressed="true">2.5D</button><button id="top" aria-pressed="false">Plan</button><span class="dock-divider"></span><button id="delete" class="delete-button" disabled>${icon('trash')}<span>Delete</span></button></div></nav>
  <section id="traffic-panel" class="popover help-panel" aria-label="Journey traffic" hidden><h2>Journey traffic</h2><p>Rules on connections allow matching traffic. Blocked attempts flash red and stop at the source. This illustrates configured paths, not a full AWS policy simulation.</p><label>Protocol<select id="traffic-protocol"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label><label>Destination port<input id="traffic-port" type="number" min="1" max="65535" value="443"></label><label>Source IPv4<input id="traffic-source" value="203.0.113.10"></label><label>Direction<select id="traffic-direction"><option value="ingress">Ingress</option><option value="egress">Egress</option></select></label><button id="traffic-apply">Apply traffic</button><p>For private egress in the demo, select a private worker, use source 10.0.10.10 and Egress, then play Journey.</p></section>
  <section id="help-panel" class="popover help-panel" aria-label="Keyboard shortcuts" hidden><h2>Make room for your ideas.</h2><p><kbd>V</kbd> Select <kbd>M</kbd> Pan <kbd>F</kbd> Fit view</p><p><kbd>/</kbd> Add · Enter drops it <kbd>C</kbd> Connect</p><p><kbd>T</kbd> Text <kbd>N</kbd> Note <kbd>P</kbd> Journey</p><p>Double-click to rename · <kbd>Ctrl K</kbd> Commands</p><p><kbd>Esc</kbd> Deselect · stop</p><p><kbd>Ctrl Z</kbd> Undo <kbd>Ctrl Shift Z</kbd> Redo</p><label class="quality-label">Rendering quality<select id="quality"><option value="1">Efficient · 1×</option><option value="1.5" selected>Balanced · 1.5×</option><option value="2">Sharp · 2×</option></select></label><p>Drag empty canvas to select. Shift-drag adds.<br>Hold Ctrl while dragging to skip guides.<br>Scroll to zoom. Right-drag to pan.</p></section>
  <section id="context-menu" class="popover context-menu" aria-label="Selection actions" hidden><button data-action="duplicate">Duplicate</button><button data-action="tool-group">Group</button><button data-action="ungroup">Ungroup</button><div class="align-row" data-multi><button data-align="left" title="Align left edges">⇤</button><button data-align="center" title="Align centres horizontally">↔</button><button data-align="right" title="Align right edges">⇥</button><button data-align="top" title="Align top edges">⤒</button><button data-align="middle" title="Align middles">↕</button><button data-align="bottom" title="Align bottom edges">⤓</button></div><div class="align-row" data-multi><button data-align="distribute-x" title="Distribute horizontally">⋯ Space evenly ↔</button><button data-align="distribute-z" title="Distribute vertically">⋮ ↕</button></div><button data-action="edge-active">Make active route</button><button data-action="edge-all-routes">Show all routes</button><button data-action="delete">Delete</button><button data-action="fit">Fit view</button></section>
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
let selectedIds = new Set<string>();
let selectedEdge: string | undefined;
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
let theme = findTheme(
  (() => {
    try {
      return localStorage.getItem('solar-forge-theme');
    } catch {
      return null;
    }
  })(),
);
applyThemeCss(theme);
let scene: DiagramScene;
try {
  scene = new DiagramScene(element('canvas'), current, theme.scene);
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
    inputElement('search').value = '';
    populateServices();
    inputElement('search').focus();
  }
}
function setTheme(id: string): void {
  theme = findTheme(id);
  applyThemeCss(theme);
  scene.setPalette(theme.scene);
  for (const button of element('theme-list').querySelectorAll('button'))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.theme === theme.id),
    );
  try {
    localStorage.setItem('solar-forge-theme', theme.id);
  } catch {}
  notify(`${theme.name} theme`);
}
for (const option of themes) {
  const button = document.createElement('button');
  button.dataset.theme = option.id;
  button.setAttribute('aria-pressed', String(option.id === theme.id));
  const swatch = document.createElement('span');
  swatch.className = 'theme-swatch';
  swatch.style.background = `linear-gradient(135deg, ${option.css.bg} 0 45%, ${option.css.accent} 45% 72%, ${option.css.hot} 72%)`;
  const name = document.createElement('span');
  name.textContent = option.name;
  button.append(swatch, name);
  button.onclick = () => {
    setTheme(option.id);
    element('theme-menu').hidden = true;
    element('theme').setAttribute('aria-expanded', 'false');
  };
  element('theme-list').append(button);
}
element('theme').onclick = () => {
  const menu = element('theme-menu');
  menu.hidden = !menu.hidden;
  element('theme').setAttribute('aria-expanded', String(!menu.hidden));
};
function showLayers(show: boolean): void {
  layersVisible = show;
  element('layers-panel').hidden = !show;
  element('toggle-layers').setAttribute('aria-pressed', String(show));
  scene.setPanelVisible(show);
}
let layerSignature = '';
const layerButtons = new Map<string, HTMLButtonElement>();
function updateLayers(): void {
  const list = element('layer-tree');
  const signature = JSON.stringify([
    current.nodes.map((n) => [
      n.id,
      n.label,
      n.color,
      n.parentId,
      n.serviceId,
      n.kind,
    ]),
    current.edges.map((e) => [e.id, e.label, e.source, e.target]),
  ]);
  if (signature !== layerSignature) {
    layerSignature = signature;
    list.replaceChildren();
    layerButtons.clear();
    const names = new Map(current.nodes.map((node) => [node.id, node.label]));
    const children = new Map<string | undefined, DiagramNode[]>();
    for (const node of current.nodes) {
      const entries = children.get(node.parentId) ?? [];
      entries.push(node);
      children.set(node.parentId, entries);
    }
    const ordered: { node: DiagramNode; depth: number }[] = [];
    const visit = (parent: string | undefined, depth: number) => {
      for (const node of children.get(parent) ?? []) {
        ordered.push({ node, depth });
        visit(node.id, depth + 1);
      }
    };
    visit(undefined, 0);
    for (const { node, depth } of ordered) {
      const button = document.createElement('button');
      button.className = `layer-row ${node.kind}${selectedIds.has(node.id) ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(selectedIds.has(node.id)));
      const symbol = document.createElement('span');
      symbol.className = 'layer-symbol';
      symbol.style.color = node.color;
      const service = findService(node.serviceId ?? node.label);
      if (service?.icon && node.kind === 'service') {
        const image = document.createElement('img');
        image.src = service.icon;
        image.alt = '';
        symbol.append(image);
      } else
        symbol.textContent =
          node.kind === 'group' ? '▱' : (service?.glyph ?? '◇');
      if (node.kind === 'text' || node.kind === 'note') {
        symbol.textContent = node.kind === 'text' ? 'T' : '▤';
        symbol.style.color = node.kind === 'note' ? node.color : '';
      }
      const label = document.createElement('span');
      label.textContent =
        node.label.split('\n')[0] ||
        (node.kind === 'note'
          ? 'Sticky note'
          : node.kind === 'text'
            ? 'Text'
            : '');
      button.append(symbol, label);
      button.style.paddingLeft = `${8 + depth * 12}px`;
      layerButtons.set(`node:${node.id}`, button);
      button.onclick = (event) => scene.select(node.id, event.shiftKey);
      list.append(button);
    }
    if (current.edges.length) {
      const heading = document.createElement('p');
      heading.className = 'section-label connections-heading';
      heading.textContent = 'CONNECTIONS';
      list.append(heading);
    }
    for (const edge of current.edges) {
      const row = document.createElement('button');
      row.className = `layer-row connection-row${selectedEdge === edge.id ? ' selected' : ''}`;
      row.textContent = `↳ ${edge.label || 'Connection'} · ${names.get(edge.source) ?? ''} → ${names.get(edge.target) ?? ''}`;
      row.onclick = () => scene.selectEdge(edge.id);
      list.append(row);
      layerButtons.set(`edge:${edge.id}`, row);
    }
  }
  for (const [key, button] of layerButtons) {
    const active = key.startsWith('node:')
      ? selectedIds.has(key.slice(5))
      : selectedEdge === key.slice(5);
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
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
          fileHandle = opened.handle;
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
    const title = await promptText('Diagram name', current.title);
    if (title) commit({ type: 'graph', label: 'Rename diagram', title });
  });
for (const template of templates) {
  const button = document.createElement('button');
  button.textContent = template.name;
  button.onclick = () =>
    void action(async () => {
      if (!(await canReplace())) return;
      replaceDocument(template.create());
      element('file-menu').hidden = true;
    });
  element('templates').append(button);
}
let recordingGif = false;
let recordingAbort: AbortController | undefined;
element('export-gif').onclick = () =>
  void action(async () => {
    const starts = journeyStarts(current, selected);
    if (!starts.length) {
      notify('Connect components before exporting a journey.');
      return;
    }
    const { recordJourney } = await import('./export/gif');
    recordingGif = true;
    recordingAbort = new AbortController();
    element('file-menu').hidden = true;
    scene.stopJourney();
    const controls = [
      element('canvas'),
      element('layers-panel'),
      element('traffic-panel'),
      ...document.querySelectorAll<HTMLElement>('.topbar, .canvas-controls'),
    ];
    for (const control of controls) control.inert = true;
    try {
      scene.playJourney(starts);
      const blob = await recordJourney(
        () => scene.gifFrame(),
        (percent) =>
          notify(
            `Recording journey GIF · ${percent}% · 12 seconds · Esc cancels; decision forks use the first branch`,
          ),
        recordingAbort.signal,
      );
      scene.stopJourney();
      if (await exportGif(blob))
        notify('Journey GIF exported · 12 seconds, 8 fps');
    } finally {
      recordingGif = false;
      recordingAbort = undefined;
      scene.stopJourney();
      for (const control of controls) control.inert = false;
    }
  });
element('export-svg').onclick = () =>
  void action(async () => {
    const { exportSvg } = await import('./export/svg');
    if (
      await invoke<boolean>('export_svg', { content: await exportSvg(current) })
    )
      notify('SVG exported');
  });
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
  const count = (kind: DiagramNode['kind']) =>
    current.nodes.filter((node) => node.kind === kind).length;
  const notes = count('text') + count('note');
  element('ground-summary').textContent =
    `${count('service')} services · ${count('group')} boundaries${notes ? ` · ${notes} notes` : ''}`;
  updateLayers();
}
function inspect(): void {
  const node = current.nodes.find((n) => n.id === selected);
  element('properties').hidden = !node;
  element('selection').textContent =
    node?.kind === 'text' || node?.kind === 'note'
      ? node.label.split('\n')[0] ||
        (node.kind === 'note' ? 'Sticky note' : 'Text')
      : (node?.label ?? '');
  inputElement('node-label').value = node?.label ?? '';
  const annotation = node?.kind === 'text' || node?.kind === 'note';
  inputElement('node-label').hidden = annotation;
  field('node-text').hidden = !annotation;
  element('node-label-caption').textContent = annotation ? 'Text' : 'Label';
  element('node-label-caption').setAttribute(
    'for',
    annotation ? 'node-text' : 'node-label',
  );
  element('node-font-row').hidden = !annotation;
  const outgoing = node
    ? current.edges.filter((edge) => edge.source === node.id)
    : [];
  element('node-branch-row').hidden = outgoing.length < 2;
  if (node && outgoing.length >= 2) {
    const setting = node.journey;
    fillOptions(
      'node-branch',
      [
        ['all', 'Takes every branch'],
        ['ask', 'Asks me which way'],
        ...outgoing.map(
          (edge) =>
            [`fixed:${edge.id}`, `Active route ${branchName(edge.id)}`] as [
              string,
              string,
            ],
        ),
      ],
      setting?.mode === 'fixed'
        ? `fixed:${setting.edge}`
        : (setting?.mode ?? journeyBranches(current, node.id).mode),
    );
  }
  if (node) {
    field('node-text').value = node.label;
    inputElement('node-font').value = String(fontSize(node));
    inputElement('node-color').value = node.color;
  }
  const edge = current.edges.find((e) => e.id === selectedEdge);
  element('edge-properties').hidden = !edge;
  if (node) {
    for (const key of ['x', 'z', 'width', 'depth'] as const)
      inputElement(`node-${key}`).value = String(node[key]);
    const excluded = new Set<string>([node.id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const n of current.nodes)
        if (n.parentId && excluded.has(n.parentId) && !excluded.has(n.id)) {
          excluded.add(n.id);
          changed = true;
        }
    }
    fillOptions(
      'node-parent',
      [
        ['', 'Board'],
        ...current.nodes
          .filter((n) => n.kind === 'group' && !excluded.has(n.id))
          .map((n) => [n.id, n.label] as [string, string]),
      ],
      node.parentId ?? '',
    );
    for (const key of [
      'region',
      'environment',
      'resourceName',
      'tags',
      'notes',
    ] as const)
      field(`meta-${key}`).value = node.metadata?.[key] ?? '';
  }
  if (edge) {
    const routes = routeActions();
    element('edge-active').hidden = !routes.active;
    element('edge-all-routes').hidden = !routes.all;
    field('rule-action').value = edge.networkRule?.action ?? 'none';
    field('rule-protocol').value = edge.networkRule?.protocol ?? 'any';
    field('rule-port').value = String(edge.networkRule?.port ?? '');
    field('rule-source').value = edge.networkRule?.sourceCidr ?? '';
    field('rule-direction').value = edge.networkRule?.direction ?? 'any';
    inputElement('edge-label').value = edge.label;
    const options = current.nodes.map(
      (n) => [n.id, n.label] as [string, string],
    );
    fillOptions('edge-source', options, edge.source);
    fillOptions('edge-target', options, edge.target);
    field('edge-sourcePort').value = edge.sourcePort ?? '';
    field('edge-targetPort').value = edge.targetPort ?? '';
    field('edge-routing').value = edge.routing ?? 'horizontal';
    inputElement('edge-bend').value = String(edge.bend ?? 0);
  }
  element('selection-note').textContent =
    node?.kind === 'group'
      ? 'Architecture boundary'
      : node?.kind === 'text'
        ? 'Text · double-click to edit'
        : node?.kind === 'note'
          ? 'Sticky note · double-click to edit'
          : node?.shape
            ? 'Flowchart shape'
            : 'AWS service · double-click to rename';
  for (const id of ['delete', 'tool-edit']) {
    const button = element(id);
    if (button instanceof HTMLButtonElement) button.disabled = !node && !edge;
  }
  updateLayers();
}
scene.onSelect = (node) => {
  selected = node?.id;
  selectedIds = new Set(scene.selection);
  selectedEdge = undefined;
  inspect();
};
scene.onSelectEdge = (id) => {
  selected = undefined;
  selectedIds = new Set();
  selectedEdge = id;
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
  void refreshRecents();
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
function selectTool(tool: Tool): void {
  scene.setTool(tool);
  for (const name of ['select', 'pan', 'connect', 'text', 'note']) {
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
  if (selected) openEditor({ kind: 'node', id: selected });
  else if (selectedEdge) openEditor({ kind: 'edge', id: selectedEdge });
};
field('node-text').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  const label = field('node-text').value.slice(0, MAX_TEXT);
  if (!node || label === node.label) return;
  commit({
    type: 'graph',
    label: 'Edit text',
    nodes: [{ id: node.id, value: { ...node, label } }],
  });
};
field('node-font').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  const size = Number(field('node-font').value);
  if (!node || !Number.isFinite(size) || size < 4 || size > 400) {
    inspect();
    return;
  }
  commit({
    type: 'graph',
    label: 'Text size',
    nodes: [{ id: node.id, value: { ...node, fontSize: size } }],
  });
};
field('node-branch').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  const value = field('node-branch').value;
  if (!node) return;
  const journey: NonNullable<DiagramNode['journey']> = value.startsWith(
    'fixed:',
  )
    ? { mode: 'fixed', edge: value.slice(6) }
    : { mode: value === 'ask' ? 'ask' : 'all' };
  commit({
    type: 'graph',
    label: 'Journey branch',
    nodes: [{ id: node.id, value: { ...node, journey } }],
  });
};
field('node-color').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  const color = field('node-color').value;
  if (!node || !/^#[0-9a-f]{6}$/i.test(color) || color === node.color) return;
  commit({
    type: 'graph',
    label: 'Change colour',
    nodes: [{ id: node.id, value: { ...node, color } }],
  });
};
element('node-label').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  const label = inputElement('node-label').value.slice(0, 1000);
  if (label === node.label) return;
  const service = findService(node.serviceId ?? node.label);
  commit({
    type: 'graph',
    label: 'Rename component',
    nodes: [
      {
        id: node.id,
        value: {
          ...node,
          label,
          ...(service ? { serviceId: service.id } : {}),
        },
      },
    ],
  });
};
function deleteSelection(): void {
  if (selectedEdge) {
    commit(
      {
        type: 'graph',
        label: 'Delete connection',
        edges: [{ id: selectedEdge, value: null }],
      },
      [],
    );
    return;
  }
  if (!selectedIds.size) return;
  commit(deleteNodes(current, selectedIds), []);
  notify('Selection deleted');
}
element('delete').onclick = deleteSelection;
function travelHistory(redo: boolean): void {
  scene.finishInteraction();
  const edit = redo ? history.redo() : history.undo();
  if (!edit) return;
  const selection = [...selectedIds];
  const edge = selectedEdge;
  if (edit.type === 'move') scene.refreshPosition(edit.id);
  else {
    scene.load(current);
    scene.selectMany(
      selection.filter((id) => current.nodes.some((node) => node.id === id)),
    );
    if (edge && current.edges.some((e) => e.id === edge))
      scene.selectEdge(edge);
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
    if (
      !`${service.label} ${service.category} ${service.aliases}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      continue;
    const button = document.createElement('button');
    button.className = 'service';
    const symbol = document.createElement('span');
    symbol.className = 'service-symbol';
    symbol.style.color = service.color;
    if (service.icon) {
      const image = document.createElement('img');
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
    list.append(button);
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
    point = insertionSlot(current, scene.insertionPoint(), width, depth);
  } catch (error) {
    notify(String(error));
    return;
  }
  history.execute({
    type: 'insert',
    node: {
      id,
      kind: service.kind,
      serviceId: service.id,
      ...(service.shape ? { shape: service.shape } : {}),
      ...(service.boundary ? { boundary: service.boundary } : {}),
      label: service.label,
      x: Math.round(point.x / 10) * 10,
      z: Math.round(point.z / 10) * 10,
      width,
      depth,
      color: service.color,
    },
  });
  scene.load(current);
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
  history.execute({
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
  scene.load(current);
  scene.select(id);
  updateHeader();
  selectTool('select');
  openEditor({ kind: 'node', id }, true);
}
scene.onPlace = placeAnnotation;
scene.onEditRequest = (target) => openEditor(target);

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
      ? current.nodes.find((n) => n.id === target.id)
      : undefined;
  const edge =
    target.kind === 'edge'
      ? current.edges.find((e) => e.id === target.id)
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
      const live = current.nodes.find((n) => n.id === node.id);
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
      const live = current.edges.find((e) => e.id === edge.id);
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
function field(
  id: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const value = element(id);
  if (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  )
    return value;
  throw Error(`Expected field ${id}`);
}
function fillOptions(
  id: string,
  options: readonly (readonly [string, string])[],
  value: string,
): void {
  const select = field(id);
  if (!(select instanceof HTMLSelectElement)) return;
  select.replaceChildren(
    ...options.map(([id, label]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      return option;
    }),
  );
  select.value = value;
}
function hasSelectedAncestor(node: DiagramNode): boolean {
  let parent = node.parentId;
  while (parent) {
    if (selectedIds.has(parent)) return true;
    parent = current.nodes.find((n) => n.id === parent)?.parentId;
  }
  return false;
}
function commit(edit: Edit, ids: readonly string[] = [...selectedIds]): void {
  scene.finishInteraction();
  if (!history.execute(edit)) return;
  scene.load(current);
  scene.selectMany(ids);
  updateHeader();
  inspect();
  notify(edit.type === 'graph' ? edit.label : `Updated ${edit.type}`);
}
scene.onResize = (changes) => {
  const nodes = changes.flatMap(({ id, from, to }) => {
    const node = current.nodes.find((n) => n.id === id);
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
    const node = current.nodes.find((n) => n.id === move.id);
    if (!node) return [];
    const value = { ...node, ...move.to };
    Object.assign(node, move.from);
    return [{ id: node.id, value }];
  });
  commit({ type: 'graph', label: 'Move selection', nodes });
};
scene.onConnect = (source, sourcePort, target, targetPort) => {
  if (source === target) {
    notify('Choose a different target component.');
    return;
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
  selectTool('select');
};
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
function toggleJourney(): void {
  if (scene.journeyPlaying) {
    scene.stopJourney();
    return;
  }
  const starts = journeyStarts(current, selected);
  if (!starts.length) {
    notify('Connect some components first, then press Journey.');
    return;
  }
  scene.playJourney(starts);
  element('journey').setAttribute('aria-pressed', 'true');
  const names = starts
    .map((id) => current.nodes.find((n) => n.id === id)?.label)
    .join(', ');
  notify(`Journey from ${names} · P or Esc to stop`);
}
element('journey').onclick = toggleJourney;
element('traffic-settings').onclick = () => {
  const panel = element('traffic-panel');
  panel.hidden = !panel.hidden;
  const traffic = current.traffic ?? defaultTraffic;
  field('traffic-protocol').value = traffic.protocol;
  field('traffic-port').value = String(traffic.port);
  field('traffic-source').value = traffic.sourceIp;
  field('traffic-direction').value = traffic.direction;
};
element('traffic-apply').onclick = () => {
  try {
    const traffic = parseTraffic({
      protocol: field('traffic-protocol').value,
      port: Number(field('traffic-port').value),
      sourceIp: field('traffic-source').value.trim(),
      direction: field('traffic-direction').value,
    });
    commit({ type: 'traffic', from: current.traffic, to: traffic });
    element('traffic-panel').hidden = true;
  } catch (error) {
    notify(String(error));
  }
};
element('rule-apply').onclick = () => {
  const edge = current.edges.find((e) => e.id === selectedEdge);
  if (!edge) return;
  try {
    const value = { ...edge };
    if (field('rule-action').value === 'none') delete value.networkRule;
    else
      value.networkRule = parseNetworkRule({
        action: field('rule-action').value,
        protocol: field('rule-protocol').value,
        direction: field('rule-direction').value,
        ...(field('rule-port').value
          ? { port: Number(field('rule-port').value) }
          : {}),
        ...(field('rule-source').value.trim()
          ? { sourceCidr: field('rule-source').value.trim() }
          : {}),
      });
    commit({
      type: 'graph',
      label: 'Change traffic rule',
      edges: [{ id: edge.id, value }],
    });
  } catch (error) {
    notify(String(error));
  }
};
scene.onJourneyPermit = (id) => {
  const edge = current.edges.find((e) => e.id === id);
  const result = evaluateTraffic(
    edge?.networkRule,
    current.traffic ?? defaultTraffic,
  );
  if (!result.allowed)
    notify(`Blocked · ${edge?.label || id} · ${result.reason}`);
  return result.allowed;
};
scene.onJourneyHop = (id) => {
  const edge = current.edges.find((e) => e.id === id);
  if (!edge) return;
  const name = (nodeId: string) =>
    current.nodes.find((n) => n.id === nodeId)?.label ?? '';
  notify(
    `${name(edge.source)} → ${name(edge.target)}${edge.label ? ` · ${edge.label}` : ''}`,
  );
};
scene.onJourneyEnd = () => {
  element('journey').setAttribute('aria-pressed', 'false');
};
scene.onJourneyBranches = (id) => journeyBranches(current, id);
/** Name a branch by its connection label, else by where it leads. */
function branchName(edgeId: string): string {
  const edge = current.edges.find((e) => e.id === edgeId);
  if (!edge) return 'Connection';
  const target = current.nodes.find((n) => n.id === edge.target)?.label ?? '';
  return edge.label ? `${edge.label} → ${target}` : `→ ${target}`;
}
let chooser: { close: (edge?: string) => void } | undefined;
scene.onJourneyChoose = (nodeId, edges) =>
  new Promise((resolve) => {
    if (recordingGif) {
      resolve(edges[0]);
      return;
    }
    const node = current.nodes.find((n) => n.id === nodeId);
    const rect = scene.nodeScreenRect(nodeId);
    const panel = document.createElement('section');
    panel.className = 'popover decision-chooser';
    panel.setAttribute('aria-label', 'Choose a branch');
    const caption = document.createElement('p');
    caption.className = 'popover-caption';
    caption.textContent = 'DECISION';
    const title = document.createElement('h2');
    title.textContent = node?.label || 'Which way?';
    panel.append(caption, title);
    const close = (edge?: string) => {
      panel.remove();
      chooser = undefined;
      resolve(edge);
    };
    edges.forEach((edge, index) => {
      const button = document.createElement('button');
      const key = document.createElement('kbd');
      key.textContent = String(index + 1);
      const name = document.createElement('span');
      name.textContent = branchName(edge);
      button.append(key, name);
      button.onclick = () => close(edge);
      panel.append(button);
    });
    document.body.append(panel);
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = rect
      ? rect.left + rect.width + 16
      : innerWidth / 2 - width / 2;
    const top = rect
      ? rect.top + rect.height / 2 - height / 2
      : innerHeight / 3;
    panel.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(64, Math.min(top, innerHeight - height - 80))}px`;
    chooser = { close };
    notify(
      `Decision at ${node?.label ?? 'a fork'} · choose a branch (1–${edges.length})`,
    );
  });
scene.onJourneyCancelChoice = () => chooser?.close();
// Number keys answer an open decision before any other shortcut.
window.addEventListener(
  'keydown',
  (event) => {
    if (!chooser || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = Number(event.key) - 1;
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '.decision-chooser button',
    );
    if (Number.isInteger(index) && buttons[index]) {
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[index].click();
    }
  },
  { capture: true },
);
element('snap').onclick = () => {
  scene.snapping = !scene.snapping;
  element('snap').setAttribute('aria-pressed', String(scene.snapping));
};
element('tool-group').onclick = () => {
  try {
    const id = crypto.randomUUID();
    commit(groupNodes(current, selectedIds, id), [id]);
  } catch (error) {
    notify(String(error));
  }
};
element('ungroup').onclick = () =>
  commit(ungroupNodes(current, selectedIds), []);
element('duplicate').onclick = () => {
  const edit = pasteFragment(copyFragment(current, selectedIds), () =>
    crypto.randomUUID(),
  );
  commit(
    edit,
    edit.type === 'graph' ? (edit.nodes?.map((n) => n.id) ?? []) : [],
  );
};
for (const key of ['x', 'z', 'width', 'depth'] as const)
  field(`node-${key}`).onchange = () => {
    const node = current.nodes.find((n) => n.id === selected);
    if (!node) return;
    const value = Number(field(`node-${key}`).value);
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > 1000000 ||
      ((key === 'width' || key === 'depth') && value < 30)
    ) {
      notify('Enter a valid size or coordinate.');
      inspect();
      return;
    }
    commit({
      type: 'graph',
      label: `Change ${key}`,
      nodes: [
        {
          id: node.id,
          value: {
            ...node,
            [key]: value,
            ...((node.kind === 'text' || node.kind === 'note') &&
            (key === 'width' || key === 'depth')
              ? { fontSize: resizedFont(node, node, { ...node, [key]: value }) }
              : {}),
          },
        },
      ],
    });
  };
field('node-parent').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  const index = new Map(current.nodes.map((n) => [n.id, n]));
  const world = worldPosition(node, index);
  const parent = field('node-parent').value;
  const target = index.get(parent);
  const p = target ? worldPosition(target, index) : { x: 0, z: 0 };
  const value = { ...node, x: world.x - p.x, z: world.z - p.z };
  delete value.parentId;
  if (parent) value.parentId = parent;
  commit({
    type: 'graph',
    label: 'Move into boundary',
    nodes: [{ id: node.id, value }],
  });
};
for (const key of [
  'region',
  'environment',
  'resourceName',
  'notes',
  'tags',
] as const)
  field(`meta-${key}`).onchange = () => {
    const node = current.nodes.find((n) => n.id === selected);
    if (node)
      commit({
        type: 'graph',
        label: `Edit ${key}`,
        nodes: [
          {
            id: node.id,
            value: {
              ...node,
              metadata: {
                ...node.metadata,
                [key]: field(`meta-${key}`).value.slice(0, 1000),
              },
            },
          },
        ],
      });
  };
for (const key of [
  'label',
  'source',
  'target',
  'sourcePort',
  'targetPort',
  'routing',
  'bend',
] as const)
  field(`edge-${key}`).onchange = () => {
    const edge = current.edges.find((e) => e.id === selectedEdge);
    if (!edge) return;
    const value = { ...edge };
    const input = field(`edge-${key}`).value;
    if (key === 'bend') {
      const bend = Number(input);
      if (!Number.isFinite(bend) || Math.abs(bend) > 1000000) {
        inspect();
        return;
      }
      value.bend = bend;
    } else if (key === 'sourcePort' || key === 'targetPort') {
      if (input) value[key] = input as Port;
      else delete value[key];
    } else if (key === 'routing')
      value.routing = input as NonNullable<DiagramEdge['routing']>;
    else value[key] = input.slice(0, 1000);
    const id = edge.id;
    commit(
      { type: 'graph', label: 'Edit connection', edges: [{ id, value }] },
      [],
    );
    scene.selectEdge(id);
  };
element('delete-edge').onclick = deleteSelection;
/** Which route actions apply to the selected connection's fork. */
function routeActions(): { active: boolean; all: boolean } {
  const edge = current.edges.find((e) => e.id === selectedEdge);
  if (!edge) return { active: false, all: false };
  const fork =
    current.edges.filter((e) => e.source === edge.source).length >= 2;
  const node = current.nodes.find((n) => n.id === edge.source);
  const fixed = node?.journey?.mode === 'fixed' ? node.journey.edge : undefined;
  return { active: fork && fixed !== edge.id, all: fork && !!fixed };
}
/** Choose the connection a fork follows; the other branches dim and go still. */
function setRoute(active: boolean): void {
  const edge = current.edges.find((e) => e.id === selectedEdge);
  const node = edge && current.nodes.find((n) => n.id === edge.source);
  if (!edge || !node) return;
  const value = { ...node };
  if (active) value.journey = { mode: 'fixed', edge: edge.id };
  else delete value.journey;
  commit(
    {
      type: 'graph',
      label: active ? 'Set active route' : 'Show all routes',
      nodes: [{ id: node.id, value }],
    },
    [],
  );
  scene.selectEdge(edge.id);
  notify(
    active
      ? `Active route: ${node.label} ${branchName(edge.id)}`
      : `All routes from ${node.label} are active`,
  );
}
element('edge-active').onclick = () => setRoute(true);
element('edge-all-routes').onclick = () => setRoute(false);
scene.onContextMenu = (x, y) => {
  const menu = element('context-menu');
  for (const row of menu.querySelectorAll<HTMLElement>('[data-multi]'))
    row.hidden = !!selectedEdge || selectedIds.size < 2;
  for (const button of menu.querySelectorAll<HTMLButtonElement>(
    'button[data-action]',
  )) {
    const action = button.dataset.action;
    const routes = routeActions();
    button.hidden = selectedEdge
      ? action === 'edge-active'
        ? !routes.active
        : action === 'edge-all-routes'
          ? !routes.all
          : action !== 'delete'
      : action === 'edge-active' || action === 'edge-all-routes'
        ? true
        : action === 'delete' || action === 'duplicate'
          ? !selectedIds.size
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
  if (selectedIds.size < 2) {
    notify('Select two or more components to align.');
    return;
  }
  commit(alignNodes(current, selectedIds, alignment));
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
function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
for (const type of ['copy', 'cut'] as const)
  window.addEventListener(type, (event) => {
    if (isTextTarget(event.target) || !selectedIds.size) return;
    event.preventDefault();
    event.clipboardData?.setData(
      'text/plain',
      serializeDocument(copyFragment(current, selectedIds)),
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
window.addEventListener(
  'keydown',
  (event) => {
    if (!recordingGif) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') recordingAbort?.abort();
  },
  true,
);
window.addEventListener('keydown', (event) => {
  if (isTextTarget(event.target)) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    ['a', 'g', 'd'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (key === 'a') scene.selectMany(current.nodes.map((n) => n.id));
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
        'open',
        'save',
        'save-as',
        'export',
        'export-svg',
        'export-gif',
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
    element('theme-menu').hidden = true;
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
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 50 : scene.snapping ? 10 : 1;
    const dx =
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dz =
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const roots = current.nodes.filter(
      (n) => selectedIds.has(n.id) && !hasSelectedAncestor(n),
    );
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
  if (event.key === 'Enter' && selected) {
    event.preventDefault();
    openEditor({ kind: 'node', id: selected });
  }
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
if (import.meta.env.DEV)
  Object.assign(window, {
    solarForge: {
      scene,
      document: () => current,
      load: (json: string) => replaceDocument(parseDocument(json)),
    },
  });
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
    await refreshRecents();
    const openPending = async () => {
      if (busy) return;
      const opened = await invoke<OpenedFile | null>('take_pending_file');
      if (!opened) return;
      await action(async () => {
        if (!(await canReplace())) return;
        replaceDocument(parseDocument(opened.content));
        fileHandle = opened.handle;
        notify(`Opened ${opened.name}`);
        await refreshRecents();
      });
    };
    await listen(
      'pending-file',
      () => void openPending().catch((error) => notify(String(error))),
    );
    await openPending();
    window.addEventListener('blur', () => {
      if (history.isDirty) {
        recovery.schedule();
        void recovery.flush().catch(() => {});
      }
    });
  })().catch((error) => notify(`Startup check failed: ${String(error)}`));
