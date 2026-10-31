import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { layoutEdit } from './domain/layout';
import {
  defaultTraffic,
  evaluateTraffic,
  parseNetworkRule,
  parseTraffic,
} from './domain/network';
import { checkReachability } from './domain/reachability';
import { defaultScenarios } from './domain/scenarios';
import {
  defaultRecordingOptions,
  validateRecordingOptions,
} from './export/recording-options';
import { RecoveryWriter } from './persistence/recovery';
import type { OpenedFile } from './platform/files';
import { exportGif, exportText, exportVideo } from './platform/files';
import { choose, commandPalette, promptText } from './ui/dialogs';
import { infrastructureImporter } from './ui/importer';
import { renderNetworkProperties } from './ui/network-properties';
import { reachabilityPanel } from './ui/reachability';
import './style.css';
import './theme-effects.css';
import { findService, services } from './catalog/services';
import type { DiagramEdge, DiagramNode, Port } from './domain/document';
import {
  MAX_TEXT,
  parseDocument,
  serializeDocument,
  starterDocument,
  worldPosition,
} from './domain/document';
import type { Edit } from './domain/history';
import { DocumentHistory } from './domain/history';
import { journeyBranches, journeyStarts } from './domain/journey';
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
import {
  type DialStatus,
  setTabletFullscreen,
  watchTabletDial,
} from './platform/tablet';
import {
  actionForCombo,
  assignCombo,
  comboFromEvent,
  comboFromPointer,
  dialLevels,
  dialSteps,
  isBuiltInCombo,
  parseBindings,
  penSideButton,
  repeatingActions,
  type TabletAction,
  type TabletBindings,
  tabletActions,
  withDefaults,
} from './platform/tablet-buttons';
import { DiagramScene, type EditTarget, type Tool } from './renderer/scene';
import { applyThemeCss, findTheme, type ScenePalette, themes } from './themes';
import { icon } from './ui/icons';
import { renderAmbient } from './ui/theme-fx';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = `
  <main class="workspace" aria-label="Diagram workspace"><div id="canvas"></div><nav id="diagram-path" class="diagram-path" aria-label="Diagram navigation"></nav><div id="journey-caption" class="journey-caption" hidden role="status"></div></main><div id="theme-fx" aria-hidden="true"></div>
  <header class="topbar">
    <div class="board-heading"><button id="menu" class="icon-button" aria-label="File menu" aria-expanded="false" title="File menu">${icon('menu')}</button><span id="forge-mark" class="forge-mark" aria-hidden="true">✦</span><span class="brand">Solar Forge</span><span class="heading-divider"></span><button id="title" class="document-title" title="Rename diagram"></button><span id="save-state" class="save-state">Unchanged</span></div>
    <div class="top-actions"><button id="features" class="quiet-button" title="Take a quick tour of the features">${icon('play')}<span>Features</span></button><button id="examples" class="quiet-button" title="Browse examples">${icon('layers')}<span>Examples</span></button><button id="components" class="quiet-button" title="Components (/)" aria-expanded="false">${icon('cube')}<span>Components</span></button><button id="copy-image" class="quiet-button" title="Copy diagram image to clipboard (Ctrl+Shift+C)">${icon('camera')}<span>Copy image</span></button><button id="tablet-mode" class="icon-button" aria-label="Tablet mode" aria-pressed="false" title="Tablet mode: full screen on the pen display">${icon('tablet')}</button><button id="settings" class="icon-button" aria-label="Settings" aria-expanded="false" title="Settings">${icon('settings')}</button><button id="theme" class="icon-button" aria-label="Theme" aria-expanded="false" title="Theme">${icon('palette')}</button><button id="toggle-layers" class="icon-button" aria-label="Toggle Layers panel" aria-pressed="true" title="Layers">${icon('layers')}</button><button id="quick-save" class="quiet-button" title="Save diagram (Ctrl+S)">${icon('save')}<span>Save</span></button><button id="quick-export" class="export-button">Export ${icon('arrow')}</button></div>
  </header>
  <section id="file-menu" class="popover file-menu" aria-label="File menu" hidden><p class="popover-caption">LOCAL WORKSPACE</p><button id="new">New diagram <kbd>Ctrl N</kbd></button><button id="browse-examples">Browse examples…</button><button id="open">Open diagram <kbd>Ctrl O</kbd></button><button id="save">Save diagram <kbd>Ctrl S</kbd></button><button id="save-as">Save as… <kbd>Ctrl Shift S</kbd></button><button id="import-infrastructure">Import infrastructure…</button><button id="reachability">Reachability matrix…</button><button id="auto-layout">Automatic layout</button><button id="export">Export PNG ${icon('arrow')}</button><button id="export-gif">Export journey GIF</button><button id="export-video">Export journey video…</button><button id="export-mermaid">Export Mermaid source</button><button id="export-plantuml">Export PlantUML source</button><button id="export-drawio">Export draw.io project</button><button id="export-svg">Export SVG ${icon('arrow')}</button><div class="menu-divider"></div><p class="popover-caption">RECENT DIAGRAMS</p><div id="recent-files"></div></section>
  <section id="settings-panel" class="popover settings-panel" aria-labelledby="settings-title" hidden><div class="popover-heading"><h2 id="settings-title">Settings</h2><button id="close-settings" class="small-icon" aria-label="Close settings">${icon('close')}</button></div><div class="settings-tabs" role="tablist"><button id="settings-tab-tablet" role="tab" aria-selected="true" aria-controls="settings-tablet">Tablet buttons</button></div><div id="settings-tablet" role="tabpanel" aria-labelledby="settings-tab-tablet"><p class="section-label">WHEELS</p><p id="dial-status" class="muted" role="status"></p><label class="dial-row">Wheel sensitivity<input id="dial-sensitivity" type="range" min="1" max="10" step="1"></label><label class="check-row"><input id="dial-reverse" type="checkbox"> Reverse wheel direction</label><p class="section-label">BUTTONS</p><p class="muted">Choose Assign, then press a tablet button, pen button or extra mouse button. Tablet buttons send ordinary key combos, so the same keys typed on a keyboard do the same thing.</p><div id="tablet-bindings" class="tablet-bindings"></div><div class="property-actions"><button id="tablet-bindings-reset">Clear all</button></div></div></section>
  <section id="theme-menu" class="popover theme-menu" aria-label="Themes" hidden><div id="theme-list"></div><label class="fx-toggle"><input id="theme-fx-toggle" type="checkbox"> Ambient effects</label><label class="fx-toggle font-picker">Board font<select id="board-font"></select></label></section>
  <nav class="tool-rail" aria-label="Canvas tools"><button id="tool-select" class="tool active" aria-label="Select" aria-pressed="true" title="Select (V)">${icon('pointer')}<kbd>V</kbd></button><button id="tool-pan" class="tool" aria-label="Pan" aria-pressed="false" title="Pan (M)">${icon('hand')}<kbd>M</kbd></button><span class="rail-divider"></span><button id="tool-add" class="tool" aria-label="Add component" title="Add component (/)">${icon('cube')}<kbd>/</kbd></button><button id="tool-connect" class="tool" aria-label="Connect components" aria-pressed="false" title="Connect (C)">${icon('connect')}<kbd>C</kbd></button><button id="tool-sketch" class="tool" aria-label="Sketch" aria-pressed="false" title="Sketch (B): draw a box, diamond or oval to add a shape, or a line between two components to connect them">${icon('pen')}<kbd>B</kbd></button><button id="tool-text" class="tool" aria-label="Text" aria-pressed="false" title="Text: click the board (T)">${icon('text')}<kbd>T</kbd></button><button id="tool-note" class="tool" aria-label="Sticky note" aria-pressed="false" title="Sticky note: click the board (N)">${icon('note')}<kbd>N</kbd></button><button id="tool-group" class="tool" aria-label="Group selection" title="Group (Ctrl+G)">${icon('group')}</button><button id="tool-edit" class="tool" aria-label="Rename selected component" title="Rename selected component" disabled>${icon('edit')}</button><span class="rail-divider"></span><button id="tool-fit" class="tool" aria-label="Fit diagram" title="Fit diagram (F)">${icon('fit')}</button></nav>
  <section id="component-palette" class="popover component-palette" aria-label="Components" hidden><div class="popover-heading"><h2>Components</h2><button id="close-components" class="small-icon" aria-label="Close components">${icon('close')}</button></div><label class="sr-only" for="search">Find a component</label><input id="search" type="search" placeholder="Search services…"><div id="services"></div><p class="palette-hint">Choose a component to add it to your board.</p></section>
  <aside id="layers-panel" class="layers-panel" aria-label="Layers and properties"><div class="panel-heading"><h2>Layers</h2><button id="layer-add" class="small-icon" aria-label="Add service">${icon('plus')}</button><button id="close-layers" class="small-icon" aria-label="Close Layers panel">${icon('close')}</button></div><div class="ground-card"><button id="ground-toggle" class="ground-eye" aria-label="Hide diagram" aria-pressed="true">${icon('eye')}</button><div><strong><span class="ground-dot"></span>Diagram</strong><p id="ground-summary"></p></div><span class="layer-index">01</span></div><div id="layer-tree" class="layer-tree" aria-label="Diagram objects"></div><section id="properties" class="properties" aria-label="Selected component properties" hidden><p class="section-label">SELECTED COMPONENT</p><h3 id="selection"></h3><p id="selection-note" class="muted"></p><label for="node-label" id="node-label-caption">Label</label><input id="node-label" maxlength="1000"><textarea id="node-text" rows="4" hidden></textarea><div class="property-grid"><label id="node-font-row">Text size<input id="node-font" type="number" min="4" max="400"></label><label>Colour<input id="node-color" type="color"></label></div><label id="node-wrap-row" class="check-row"><input id="node-wrap" type="checkbox"> Wrap caption to tile width</label><div class="property-grid"><label>X<input id="node-x" type="number" min="-1000000" max="1000000"></label><label>Z<input id="node-z" type="number" min="-1000000" max="1000000"></label><label>Width<input id="node-width" type="number" min="30" max="1000000"></label><label>Depth<input id="node-depth" type="number" min="30" max="1000000"></label></div><label id="node-branch-row">Journey at this fork<select id="node-branch"></select></label><label for="node-parent">Inside boundary</label><select id="node-parent"></select><div class="property-actions"><button id="duplicate">Duplicate</button><button id="ungroup">Ungroup</button></div><label>Walkthrough caption<textarea id="node-caption" maxlength="1000" rows="3" placeholder="Explain what happens at this hop"></textarea></label><details id="detail-controls"><summary>Detail diagram</summary><label>Linked diagram<select id="node-detail"></select></label><button id="detail-open">Open detail ↗</button><button id="detail-create">Create detail diagram</button><p class="muted">Double-click a linked resource to open it. Use Label to rename it.</p></details><div id="resource-network"></div><details id="meta-details"><summary>Architecture details</summary><p id="meta-scope" class="muted" hidden></p><label>Region<input id="meta-region" maxlength="1000"></label><label>Environment<input id="meta-environment" maxlength="1000"></label><label>Resource name<input id="meta-resourceName" maxlength="1000"></label><label>Tags<input id="meta-tags" maxlength="1000" placeholder="team=platform, env=dev"></label><label>Notes<textarea id="meta-notes" maxlength="1000" rows="3"></textarea></label><button id="meta-apply-inside" hidden>Apply to everything inside</button></details></section><section id="edge-properties" class="properties" aria-label="Connection properties" hidden><p class="section-label">SELECTED CONNECTION</p><label>Label<input id="edge-label" maxlength="1000"></label><label>From<select id="edge-source"></select></label><label>Source port<select id="edge-sourcePort"><option value="">Auto</option><option>north</option><option>east</option><option>south</option><option>west</option></select></label><label>To<select id="edge-target"></select></label><label>Target port<select id="edge-targetPort"><option value="">Auto</option><option>north</option><option>east</option><option>south</option><option>west</option></select></label><label>Route<select id="edge-routing"><option value="horizontal">Horizontal first</option><option value="vertical">Vertical first</option></select></label><label>Bend offset<input id="edge-bend" type="number" min="-1000000" max="1000000" step="10"></label><div class="property-actions"><button id="edge-active">Make active route</button><button id="edge-all-routes">Show all routes</button></div><details><summary>Journey traffic rule</summary><label>Action<select id="rule-action"><option value="none">Unrestricted</option><option value="allow">Allow matching traffic</option><option value="deny">Deny all traffic</option></select></label><label>Protocol<select id="rule-protocol"><option value="any">Any</option><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label><label>Port (blank = any)<input id="rule-port" type="number" min="1" max="65535"></label><label>Source CIDR (blank = any)<input id="rule-source" placeholder="0.0.0.0/0"></label><label>Direction<select id="rule-direction"><option value="any">Any</option><option value="ingress">Ingress</option><option value="egress">Egress</option></select></label><button id="rule-apply">Apply rule</button><p id="rule-result" class="muted" role="status"></p></details><button id="delete-edge" class="delete-button">Delete connection</button></section><div class="panel-foot"><span class="offline-dot"></span> Offline workspace <span class="forge-wordmark">SOLAR FORGE</span></div></aside>
  <nav class="canvas-controls" aria-label="Canvas controls"><div class="zoom-dock floating-dock" aria-label="Zoom controls"><button id="zoom-out" class="small-icon" aria-label="Zoom out">${icon('minus')}</button><span id="zoom-level">100%</span><button id="zoom-in" class="small-icon" aria-label="Zoom in">${icon('plus')}</button><span class="dock-divider"></span><button id="fit">Fit</button><span class="dock-divider"></span><button id="help" class="small-icon" aria-label="Keyboard help" aria-expanded="false">${icon('help')}</button></div>
  <div class="history-dock floating-dock" aria-label="Edit history"><button id="undo" class="small-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button id="redo" class="small-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')}</button></div>
  <div class="view-dock floating-dock" aria-label="View controls"><button id="journey" class="journey-button" aria-pressed="false" title="Walk a person through the data flow (P)">${icon('user')}<span>Journey</span></button><button id="traffic-settings" title="Configure journey traffic">Traffic</button><button id="flow" aria-pressed="true" title="Animate data flow along connections">${icon('flow')}<span>Flow</span></button><button id="snap" aria-pressed="true" title="Snap positions to a 10-unit grid">Snap</button><span class="dock-divider"></span><button id="iso" aria-pressed="true">2.5D</button><button id="top" aria-pressed="false">Plan</button><span class="dock-divider"></span><button id="delete" class="delete-button" disabled>${icon('trash')}<span>Delete</span></button></div></nav>
  <section id="gif-panel" class="popover help-panel" aria-label="GIF recording settings" hidden><h2 id="recording-title">Journey GIF</h2><label id="video-format-row" hidden>Video format<select id="video-format"><option value="webm">WebM</option><option value="mp4">MP4</option></select></label><p id="video-help" hidden>Up to 30 fps, 1280 × 720, full colour. Format availability depends on your browser. Decision forks use their first branch.</p><label>Duration (seconds)<input id="gif-duration" type="number" min="2" max="120" step="1" value="12"></label><label id="gif-dither-row" class="checkbox-label"><input id="gif-dither" type="checkbox" checked> Dither gradients</label><p id="gif-help">Up to 8 frames per second, 640 × 480. An adaptive palette preserves theme colours. Decision forks use their first branch.</p><button id="gif-record">Record GIF</button><p>Press Esc to cancel recording.</p></section>
  <section id="traffic-panel" class="popover help-panel" aria-label="Journey traffic" hidden><h2>Journey traffic</h2><label>Saved scenario<select id="traffic-scenario"></select></label><div class="property-actions"><button id="scenario-use">Use scenario</button><button id="scenario-delete">Delete</button></div><label>Scenario name<input id="scenario-name" maxlength="100"></label><label>Start (optional)<select id="scenario-source"></select></label><label>Destination (optional)<select id="scenario-target"></select></label><button id="scenario-save">Save / update scenario</button><p>Rules on connections allow matching traffic. Blocked attempts flash red and stop at the source. This illustrates configured paths, not a full AWS policy simulation.</p><label>Protocol<select id="traffic-protocol"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label><label>Destination port<input id="traffic-port" type="number" min="1" max="65535" value="443"></label><label>Source IPv4<input id="traffic-source" value="203.0.113.10"></label><label>Direction<select id="traffic-direction"><option value="ingress">Ingress</option><option value="egress">Egress</option></select></label><button id="traffic-apply">Apply traffic</button><p>For private egress in the demo, select a private worker, use source 10.0.10.10 and Egress, then play Journey.</p></section>
  <section id="help-panel" class="popover help-panel" aria-label="Keyboard shortcuts" hidden><h2>Make room for your ideas.</h2><p><kbd>V</kbd> Select <kbd>M</kbd> Pan <kbd>F</kbd> Fit view</p><p><kbd>WASD</kbd> or arrows move the view · Shift for faster</p><p><kbd>/</kbd> Add · Enter drops it <kbd>C</kbd> Connect</p><p><kbd>T</kbd> Text <kbd>N</kbd> Note <kbd>B</kbd> Sketch <kbd>P</kbd> Journey</p><p>Double-click to rename · <kbd>Ctrl K</kbd> Commands</p><p><kbd>Esc</kbd> Deselect · stop</p><p><kbd>Ctrl Z</kbd> Undo <kbd>Ctrl Shift Z</kbd> Redo</p><label class="quality-label">Rendering quality<select id="quality"><option value="1">Efficient · 1×</option><option value="1.5">Balanced · 1.5×</option><option value="2" selected>Sharp · match display</option></select></label><p>Drag empty canvas to select. Shift-drag adds.<br>Hold Ctrl while dragging to skip guides.<br>Scroll to zoom. Right-drag to pan.<br>Pen: drag with a barrel button held to pan; the eraser end deletes.</p></section>
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
let project = current;
let history = new DocumentHistory(current);
let diagramTrail: (typeof current)[] = [];
let selected: string | undefined;
let checkedJourney: { path: string[]; allowed: boolean } | undefined;
let selectedIds = new Set<string>();
const METADATA_KEYS = [
  'region',
  'environment',
  'resourceName',
  'tags',
  'notes',
] as const;
let selectedEdge: string | undefined;
let dirty = false;
let busy = false;
let fileHandle: number | undefined;
let recoveryReady = false;
const recovery = new RecoveryWriter(
  () => (history.isDirty ? serializeDocument(project) : null),
  writeRecovery,
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
      n.detailId,
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
      if (service?.icon && (node.kind === 'service' || node.kind === 'group')) {
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
      if (node.detailId) {
        const detail = project.details?.find(
          (entry) => entry.id === node.detailId,
        );
        if (detail) {
          const open = document.createElement('button');
          open.className = 'detail-layer-link';
          open.textContent = '↳ Open detail ↗';
          open.setAttribute('aria-label', `Open detail for ${node.label}`);
          open.onclick = () => navigateDiagram(detail.document);
          list.append(open);
        }
      }
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
let recordingGif = false;
let recordingMode: 'gif' | 'video' = 'gif';
let recordingAbort: AbortController | undefined;
function openRecording(mode: 'gif' | 'video'): void {
  recordingMode = mode;
  element('file-menu').hidden = true;
  element('gif-panel').hidden = false;
  element('recording-title').textContent =
    mode === 'gif' ? 'Journey GIF' : 'Journey video';
  element('gif-record').textContent =
    mode === 'gif' ? 'Record GIF' : 'Record video';
  element('video-format-row').hidden = mode === 'gif';
  element('video-help').hidden = mode === 'gif';
  element('gif-dither-row').hidden = mode !== 'gif';
  element('gif-help').hidden = mode !== 'gif';
  inputElement('gif-duration').focus();
  if (mode === 'video')
    void import('./export/video').then(({ videoMime }) => {
      for (const option of (element('video-format') as HTMLSelectElement)
        .options) {
        const supported = !!videoMime(option.value as 'webm' | 'mp4');
        option.disabled = !supported;
        option.textContent =
          option.value.toUpperCase() + (supported ? '' : ' (unavailable)');
      }
      const select = element('video-format') as HTMLSelectElement;
      if (select.selectedOptions[0]?.disabled)
        select.value =
          [...select.options].find((option) => !option.disabled)?.value ?? '';
    });
}
element('export-gif').onclick = () => openRecording('gif');
element('export-video').onclick = () => openRecording('video');

try {
  const saved = localStorage.getItem('solar-forge-gif');
  const options = saved
    ? validateRecordingOptions(JSON.parse(saved))
    : defaultRecordingOptions;
  inputElement('gif-duration').value = String(options.duration);
  inputElement('gif-dither').checked = options.dither;
} catch {}
element('gif-record').onclick = () =>
  void action(async () => {
    const options = validateRecordingOptions({
      duration: Number(inputElement('gif-duration').value),
      dither: inputElement('gif-dither').checked,
    });
    try {
      localStorage.setItem('solar-forge-gif', JSON.stringify(options));
    } catch {}

    const networkPath = checkedJourney;
    const starts = networkPath
      ? networkPath.path.slice(0, 1)
      : journeyStarts(current, selected);
    if (!starts.length) {
      notify('Connect components before exporting a journey.');
      return;
    }
    const { recordJourney } = await import('./export/gif');
    const mode = recordingMode;
    const format = field('video-format').value as 'webm' | 'mp4';
    const video = mode === 'video' ? await import('./export/video') : undefined;
    if (video && !video.videoMime(format))
      throw Error('Choose an available video format');
    element('gif-panel').hidden = true;
    recordingGif = true;
    recordingAbort = new AbortController();
    element('file-menu').hidden = true;
    scene.stopJourney();
    const controls = [element('app')];
    for (const control of controls) control.inert = true;
    try {
      scene.playJourney(starts, networkPath);
      const progress = (percent: number) =>
        notify(
          `Recording journey ${mode === 'gif' ? 'GIF' : format.toUpperCase()} · ${percent}% · ${options.duration} seconds · Esc cancels; decision forks use the first branch`,
        );
      const blob = video
        ? await video.recordVideo(
            () => scene.gifFrame(1280, 720),
            progress,
            recordingAbort.signal,
            { duration: options.duration, format },
          )
        : await recordJourney(
            () => scene.gifFrame(),
            progress,
            recordingAbort.signal,
            options,
          );
      scene.stopJourney();
      const saved = video
        ? await exportVideo(blob, format)
        : await exportGif(blob);
      if (saved)
        notify(
          `Journey ${video ? format.toUpperCase() : 'GIF'} exported · ${options.duration} seconds`,
        );
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
    if (await saveSvg(await exportSvg(current, boardFont.family)))
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
        format === 'drawio' ? project : current,
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
  renderDiagramPath();
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
  (element('node-caption') as HTMLTextAreaElement).value =
    node?.journeyCaption ?? '';
  element('detail-controls').hidden =
    !node || !['group', 'service'].includes(node.kind);
  const detailSelect = element('node-detail') as HTMLSelectElement;
  detailSelect.replaceChildren(
    new Option('No detail diagram', ''),
    ...(project.details ?? []).map(
      (entry) => new Option(entry.document.title, entry.id),
    ),
  );
  detailSelect.value = node?.detailId ?? '';
  (element('detail-open') as HTMLButtonElement).disabled = !node?.detailId;
  const annotation = node?.kind === 'text' || node?.kind === 'note';
  inputElement('node-label').hidden = annotation;
  field('node-text').hidden = !annotation;
  element('node-label-caption').textContent = annotation ? 'Text' : 'Label';
  element('node-label-caption').setAttribute(
    'for',
    annotation ? 'node-text' : 'node-label',
  );
  const component = node?.kind === 'service';
  element('node-font-row').hidden = !annotation && !component;
  element('node-wrap-row').hidden = !component;
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
    // Components without a size fit their caption automatically.
    inputElement('node-font').value =
      node.kind === 'service'
        ? String(node.fontSize ?? '')
        : String(fontSize(node));
    inputElement('node-font').placeholder =
      node.kind === 'service' ? 'Auto' : '';
    inputElement('node-wrap').checked = Boolean(node.wrap);
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
    const targets = detailTargets();
    for (const key of METADATA_KEYS) {
      const input = field(`meta-${key}`) as HTMLInputElement;
      input.dataset.placeholder ??= input.placeholder;
      const values = targets.map((n) => n.metadata?.[key] ?? '');
      const same = values.every((value) => value === values[0]);
      input.value = same ? (values[0] ?? '') : '';
      input.placeholder = same
        ? (input.dataset.placeholder ?? '')
        : 'Mixed · type to set for all';
    }
    const scope = element('meta-scope');
    scope.hidden = targets.length < 2;
    scope.textContent = `Editing ${targets.length} selected objects. Changes apply to all of them.`;
    element('meta-apply-inside').hidden =
      targets.length > 1 || descendants(node.id).length === 0;
    if (targets.length > 1) {
      element('selection').textContent = `${targets.length} selected`;
      (element('meta-details') as HTMLDetailsElement).open = true;
    }
  }
  if (edge) {
    const routes = routeActions();
    element('edge-active').hidden = !routes.active;
    element('edge-all-routes').hidden = !routes.all;
    const ruleResult = evaluateTraffic(
      edge.networkRule,
      current.traffic ?? defaultTraffic,
    );
    element('rule-result').textContent =
      `${ruleResult.allowed ? 'Allowed' : 'Blocked'} for current traffic · ${ruleResult.reason}`;
    field('rule-action').value = edge.networkRule?.action ?? 'none';
    field('rule-protocol').value = edge.networkRule?.protocol ?? 'any';
    field('rule-port').value = String(edge.networkRule?.port ?? '');
    field('rule-source').value = edge.networkRule?.sourceCidr ?? '';
    field('rule-direction').value = edge.networkRule?.direction ?? 'any';
    updateRuleFields();
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
            : 'Component · double-click to rename';
  for (const id of ['delete', 'tool-edit']) {
    const button = element(id);
    if (button instanceof HTMLButtonElement) button.disabled = !node && !edge;
  }
  renderNetworkProperties(
    element('resource-network'),
    node,
    current,
    (value) =>
      commit({
        type: 'graph',
        label: 'Resource networking',
        nodes: [{ id: value.id, value }],
      }),
    notify,
  );
  updateLayers();
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
  checkedJourney = undefined;
  selected = node?.id;
  selectedIds = new Set(scene.selection);
  selectedEdge = undefined;
  if (!inspectDeferred) inspect();
};
scene.onSelectEdge = (id) => {
  checkedJourney = undefined;
  selected = undefined;
  selectedIds = new Set();
  selectedEdge = id;
  if (!inspectDeferred) inspect();
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
  project = next;
  diagramTrail = [];
  history = new DocumentHistory(current);
  selected = undefined;
  dirty = false;
  deferInspect(() => scene.load(current));
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
    serializeDocument(project),
    saveAs ? undefined : fileHandle,
    project.title,
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
const reachability = reachabilityPanel({
  document: () => current,
  play: (result) => {
    checkedJourney = {
      path: result.path,
      allowed: result.status === 'allowed',
    };
    scene.playJourney([result.path[0] ?? ''], {
      path: result.path,
      allowed: result.status === 'allowed',
    });
    element('journey').setAttribute('aria-pressed', 'true');
    notify(
      `${result.status.toUpperCase()} · ${result.reason} · P or Esc to stop`,
    );
  },
});
element('reachability').onclick = () => {
  element('file-menu').hidden = true;
  reachability.open();
};
const importer = infrastructureImporter({
  notify,
  apply: async (doc) => {
    const nodeChanges = new Map(
      current.nodes.map((node) => [
        node.id,
        { id: node.id, value: null as DiagramNode | null },
      ]),
    );
    for (const value of doc.nodes)
      nodeChanges.set(value.id, { id: value.id, value });
    const edgeChanges = new Map(
      current.edges.map((edge) => [
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
  commit(layoutEdit(current));
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
  if (node?.kind === 'service' && !field('node-font').value.trim()) {
    const value = { ...node };
    delete value.fontSize;
    commit({
      type: 'graph',
      label: 'Text size',
      nodes: [{ id: node.id, value }],
    });
    return;
  }
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
inputElement('node-wrap').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  const value = { ...node };
  if (inputElement('node-wrap').checked) value.wrap = true;
  else delete value.wrap;
  commit({
    type: 'graph',
    label: 'Caption wrapping',
    nodes: [{ id: node.id, value }],
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
  const switched = current !== history.document;
  deferInspect(() => {
    if (switched) {
      current = history.document;
      diagramTrail = current === project ? [] : [project];
      scene.load(current);
      scene.fit();
    }
    const selection = [...selectedIds];
    const edge = selectedEdge;
    if (edit.type === 'move') {
      if (!switched) scene.refreshPosition(edit.id);
    } else {
      // A board switch has just loaded this exact document.
      if (!switched) scene.load(current);
      scene.selectMany(
        selection.filter((id) => current.nodes.some((node) => node.id === id)),
      );
      if (edge && current.edges.some((e) => e.id === edge))
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
  deferInspect(() => scene.load(current));
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
  deferInspect(() => scene.load(current));
  scene.select(id);
  updateHeader();
  selectTool('select');
  openEditor({ kind: 'node', id }, true);
}
scene.onPlace = placeAnnotation;
scene.onEditRequest = (target) => {
  const node =
    target.kind === 'node'
      ? current.nodes.find((n) => n.id === target.id)
      : undefined;
  const detail = project.details?.find((entry) => entry.id === node?.detailId);
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
  const edge = selectedEdge;
  if (!history.execute(edit)) return;
  deferInspect(() => {
    scene.load(current);
    scene.selectMany(ids);
    if (!ids.length && edge && current.edges.some((e) => e.id === edge))
      scene.selectEdge(edge);
  });
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
  history.execute({
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
  deferInspect(() => scene.load(current));
  scene.select(id);
  updateHeader();
  notify(`${service.label} added. Double-click to rename it.`);
};
/** The pen's eraser end: delete what it passed over in one undoable step. */
scene.onErase = (nodes, edges) => {
  const edit = deleteNodes(current, new Set(nodes));
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
let penHintShown = false;
scene.onPenInput = (pen) => {
  document.body.classList.toggle('pen-input', pen);
  if (pen && !penHintShown && !tabletMode) {
    penHintShown = true;
    notify(
      'Pen detected. Tablet mode (top bar) goes full screen on the pen display.',
    );
  }
};
let tabletMode = false;
let layersBeforeTablet = true;
async function setTabletMode(on: boolean): Promise<void> {
  if (on === tabletMode) return;
  tabletMode = on;
  document.body.classList.toggle('tablet-mode', on);
  element('tablet-mode').setAttribute('aria-pressed', String(on));
  if (on) {
    layersBeforeTablet = layersVisible;
    showLayers(false);
  } else showLayers(layersBeforeTablet);
  try {
    const monitor = await setTabletFullscreen(on);
    notify(
      on
        ? `Tablet mode${monitor ? ` on ${monitor.replace(/^desc:/, '')}` : ''}. Tap the tablet button to leave.`
        : 'Tablet mode off',
    );
  } catch (error) {
    notify(
      `Full screen unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
element('tablet-mode').onclick = () => void setTabletMode(!tabletMode);

// Tablet buttons and wheels: combos learnt in Settings run app actions.
const tabletBindingsKey = 'solar-forge-tablet-buttons';
// Defaults are added once, so clearing one later sticks.
const tabletDefaultsKey = 'solar-forge-tablet-defaults';
let tabletBindings: TabletBindings = (() => {
  try {
    const saved = parseBindings(localStorage.getItem(tabletBindingsKey));
    if (localStorage.getItem(tabletDefaultsKey) === '1') return saved;
    const next = withDefaults(saved);
    localStorage.setItem(tabletBindingsKey, JSON.stringify(next));
    localStorage.setItem(tabletDefaultsKey, '1');
    return next;
  } catch {
    return withDefaults({});
  }
})();
let learningAction: TabletAction | undefined;
function saveTabletBindings(next: TabletBindings): void {
  tabletBindings = next;
  try {
    localStorage.setItem(tabletBindingsKey, JSON.stringify(next));
  } catch {
    notify('Button mappings changed for this session.');
  }
  renderTabletBindings();
}
function renderTabletBindings(): void {
  const list = element('tablet-bindings');
  list.replaceChildren();
  let group = '';
  for (const action of tabletActions) {
    if (action.group !== group) {
      group = action.group;
      const caption = document.createElement('p');
      caption.className = 'section-label';
      caption.textContent = group.toUpperCase();
      list.append(caption);
    }
    const row = document.createElement('div');
    row.className = 'binding-row';
    const label = document.createElement('span');
    label.textContent = action.label;
    const combo = document.createElement('kbd');
    const learning = learningAction === action.id;
    combo.textContent = learning
      ? 'Press a control…'
      : (tabletBindings[action.id] ?? '—');
    combo.classList.toggle('unbound', !learning && !tabletBindings[action.id]);
    const assign = document.createElement('button');
    assign.textContent = learning ? 'Cancel' : 'Assign';
    assign.setAttribute('aria-label', `${assign.textContent} ${action.label}`);
    assign.onclick = () => {
      learningAction = learning ? undefined : action.id;
      renderTabletBindings();
    };
    const clear = document.createElement('button');
    clear.className = 'small-icon';
    clear.innerHTML = icon('close');
    clear.setAttribute('aria-label', `Clear ${action.label}`);
    clear.disabled = !tabletBindings[action.id];
    clear.onclick = () => {
      const next = { ...tabletBindings };
      delete next[action.id];
      saveTabletBindings(next);
    };
    row.append(label, combo, assign, clear);
    list.append(row);
  }
}
function showSettings(show: boolean): void {
  element('settings-panel').hidden = !show;
  element('settings').setAttribute('aria-expanded', String(show));
  if (!show) learningAction = undefined;
  renderTabletBindings();
}
element('settings').onclick = () =>
  showSettings(element('settings-panel').hidden);
element('close-settings').onclick = () => showSettings(false);
element('tablet-bindings-reset').onclick = () => {
  learningAction = undefined;
  saveTabletBindings({});
  notify('Tablet button mappings cleared.');
};

/** Wheel turns open the Components menu, then move through its list. */
function stepComponents(direction: 1 | -1): void {
  if (element('component-palette').hidden) showComponents(true);
  else highlightService(highlighted + direction);
}
/** Add the highlighted component; opens the menu first if it is closed. */
function addHighlightedComponent(): void {
  if (element('component-palette').hidden) showComponents(true);
  else serviceButtons()[highlighted]?.click();
}
function runTabletAction(action: TabletAction): void {
  // A tool's button pressed again goes back to Select.
  if (
    [
      'tool-pan',
      'tool-connect',
      'tool-sketch',
      'tool-text',
      'tool-note',
    ].includes(action) &&
    element(action).getAttribute('aria-pressed') === 'true'
  ) {
    selectTool('select');
    return;
  }
  switch (action) {
    case 'wheel-next':
      stepComponents(1);
      break;
    case 'wheel-previous':
      stepComponents(-1);
      break;
    case 'pick':
      addHighlightedComponent();
      break;
    case 'deselect':
      if (scene.journeyPlaying) scene.stopJourney();
      scene.cancelInteraction();
      selectTool('select');
      scene.select(undefined);
      break;
    case 'tool-select':
      selectTool('select');
      break;
    case 'tool-pan':
      selectTool('pan');
      break;
    case 'tool-add':
      showComponents(true);
      break;
    case 'undo':
      travelHistory(false);
      break;
    case 'redo':
      travelHistory(true);
      break;
    case 'delete':
      deleteSelection();
      break;
    case 'zoom-in':
      scene.zoomBy(1.2);
      break;
    case 'zoom-out':
      scene.zoomBy(1 / 1.2);
      break;
    case 'fit':
      scene.fit();
      break;
    case 'journey':
      toggleJourney();
      break;
    case 'tablet-mode':
      void setTabletMode(!tabletMode);
      break;
    default:
      element(action).click();
  }
}
// Kamvas wheels: turning steps the highlight, pressing selects it.
const dialKey = 'solar-forge-tablet-dial';
const dial = (() => {
  const fallback = { sensitivity: 7, reverse: false };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(dialKey) ?? '{}');
    if (!saved || typeof saved !== 'object') return fallback;
    const { sensitivity, reverse } = saved as Record<string, unknown>;
    return {
      sensitivity:
        typeof sensitivity === 'number' &&
        Number.isInteger(sensitivity) &&
        sensitivity >= 1 &&
        sensitivity <= dialLevels.length
          ? sensitivity
          : fallback.sensitivity,
      reverse: reverse === true,
    };
  } catch {
    return fallback;
  }
})();
function saveDial(): void {
  try {
    localStorage.setItem(dialKey, JSON.stringify(dial));
  } catch {
    notify('Wheel settings changed for this session.');
  }
}
inputElement('dial-sensitivity').value = String(dial.sensitivity);
inputElement('dial-reverse').checked = dial.reverse;
inputElement('dial-sensitivity').oninput = () => {
  dial.sensitivity = Number(inputElement('dial-sensitivity').value);
  saveDial();
};
inputElement('dial-reverse').onchange = () => {
  dial.reverse = inputElement('dial-reverse').checked;
  saveDial();
};
const dialMessages: Record<DialStatus, string> = {
  connected:
    'Wheels connected. Turn a wheel to zoom. Press its centre to open Components, turn to scroll, and press again to add the highlighted one.',
  permission:
    'The tablet is plugged in, but the app is not allowed to read its wheels. Install the tablet permission rule (see the user guide), then unplug and replug the tablet.',
  absent:
    'No Huion tablet found. The wheels work in the desktop app with the tablet plugged in.',
};
let dialPending = 0;
let dialLastTurn = 0;
void watchTabletDial(
  (event) => {
    if (event.kind === 'pen') {
      if (!event.pressed) return;
      const action = actionForCombo(tabletBindings, penSideButton);
      if (learningAction) learnCombo(penSideButton);
      else if (action) runTabletAction(action);
      return;
    }
    // Press opens Components, or adds the highlighted entry when it is open.
    if (event.kind === 'press') {
      addHighlightedComponent();
      dialPending = 0;
      dialLastTurn = 0;
      return;
    }
    const now = performance.now();
    const fresh = now - dialLastTurn > 350;
    dialLastTurn = now;
    const result = dialSteps(
      dialPending,
      dial.reverse ? -event.delta : event.delta,
      dialLevels[dial.sensitivity - 1] ?? 10,
      fresh,
    );
    dialPending = result.pending;
    if (!result.steps) return;
    // Turning scrolls the open menu and zooms the board otherwise.
    if (!element('component-palette').hidden)
      highlightService(highlighted + result.steps);
    else scene.zoomBy(1.1 ** result.steps);
  },
  (status) => {
    element('dial-status').textContent = dialMessages[status];
  },
).catch((error: unknown) => {
  element('dial-status').textContent =
    `Wheels unavailable: ${error instanceof Error ? error.message : String(error)}`;
});
function learnCombo(combo: string): void {
  const action = learningAction;
  if (!action) return;
  learningAction = undefined;
  if (combo === 'Escape') {
    renderTabletBindings();
    return;
  }
  const result = assignCombo(tabletBindings, action, combo);
  saveTabletBindings(result.bindings);
  const label = (id: TabletAction) =>
    tabletActions.find((a) => a.id === id)?.label ?? id;
  notify(
    [
      `${combo} → ${label(action)}.`,
      result.replaced ? `Removed from ${label(result.replaced)}.` : '',
      isBuiltInCombo(combo)
        ? `${combo} is also a built-in shortcut; the mapping now replaces it.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
// Registered before the other key handlers so a mapped combo wins.
window.addEventListener(
  'keydown',
  (event) => {
    if (recordingGif) return;
    const combo = comboFromEvent(event);
    if (learningAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!combo || event.repeat) return;
      learnCombo(combo);
      return;
    }
    if (!combo) return;
    const action = actionForCombo(tabletBindings, combo);
    if (!action) return;
    // Plain keys typed into a field stay text.
    if (
      isTextTarget(event.target) &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat && !repeatingActions.has(action)) return;
    runTabletAction(action);
  },
  { capture: true },
);
// Pen side buttons and extra mouse buttons arrive as clicks, not keys. WebKit
// may report one only as a change in the held-buttons mask of a move, so the
// mask is compared too. Bits after the first: right, middle, back, forward,
// eraser, matching button numbers 2, 1, 3, 4, 5.
const maskButtons = [
  [2, 2],
  [4, 1],
  [8, 3],
  [16, 4],
  [32, 5],
] as const;
const heldButtons = new Map<number, number>();
let swallowContextMenu = false;
let lastPointerBinding = 0;
function pressedButton(event: PointerEvent): number | undefined {
  const before = heldButtons.get(event.pointerId) ?? 0;
  heldButtons.set(event.pointerId, event.buttons);
  if (event.button >= 1 && event.type !== 'pointerup') return event.button;
  const added = event.buttons & ~before;
  return maskButtons.find(([bit]) => added & bit)?.[1];
}
function bindPointerButton(
  event: Event,
  button: number,
  pointerType: string,
): boolean {
  const combo = comboFromPointer({ button, pointerType });
  if (!combo) return false;
  const action = learningAction
    ? undefined
    : actionForCombo(tabletBindings, combo);
  if (!learningAction && !action) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  swallowContextMenu = true;
  lastPointerBinding = performance.now();
  if (learningAction) learnCombo(combo);
  else if (action) runTabletAction(action);
  return true;
}
function pointerBinding(event: PointerEvent): void {
  if (recordingGif) return;
  const button = pressedButton(event);
  if (button !== undefined) bindPointerButton(event, button, event.pointerType);
}
window.addEventListener('pointerdown', pointerBinding, { capture: true });
window.addEventListener('pointermove', pointerBinding, { capture: true });
window.addEventListener(
  'pointerup',
  (event) => {
    heldButtons.set(event.pointerId, event.buttons);
  },
  { capture: true },
);
// Fallback for buttons that produce mouse events without pointer events.
for (const type of ['mousedown', 'auxclick'] as const)
  window.addEventListener(
    type,
    (event) => {
      if (recordingGif || performance.now() - lastPointerBinding < 300) {
        if (swallowContextMenu) event.preventDefault();
        return;
      }
      bindPointerButton(event, event.button, 'mouse');
    },
    { capture: true },
  );
window.addEventListener(
  'contextmenu',
  (event) => {
    if (learningAction) {
      event.preventDefault();
      return;
    }
    if (!swallowContextMenu) return;
    swallowContextMenu = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  { capture: true },
);
window.addEventListener(
  'pointerup',
  () => {
    // Clear after this release's contextmenu, which follows pointerup.
    if (swallowContextMenu) setTimeout(() => (swallowContextMenu = false), 0);
  },
  { capture: true },
);
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
  if (current === project) return;
  const home = document.createElement('button');
  home.textContent = `⌂ ${project.title}`;
  home.onclick = () => navigateDiagram(project, true);
  const back = document.createElement('button');
  back.textContent = '← Back';
  back.onclick = () => {
    const previous = diagramTrail.pop();
    if (previous) navigateDiagram(previous, true);
  };
  const label = document.createElement('span');
  label.textContent = current.title;
  nav.append(home, back, label);
}
function navigateDiagram(board: typeof current, returning = false): void {
  if (board === current) return;
  scene.finishInteraction();
  closeEditor?.(true);
  scene.stopJourney();
  if (!returning && board !== current) diagramTrail.push(current);
  if (diagramTrail.length > 100) diagramTrail.shift();
  if (board === project) diagramTrail = [];
  current = board;
  history.document = board;
  selected = undefined;
  selectedEdge = undefined;
  selectedIds.clear();
  checkedJourney = undefined;
  deferInspect(() => scene.load(current));
  scene.fit();
  updateHeader();
  inspect();
  notify(`Opened ${board.title}`);
}
element('detail-open').onclick = () => {
  const id = current.nodes.find((n) => n.id === selected)?.detailId;
  const board = project.details?.find((entry) => entry.id === id)?.document;
  if (board) navigateDiagram(board);
};
element('detail-create').onclick = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  if ((project.details?.length ?? 0) >= 100) {
    notify('A project supports up to 100 detail diagrams');
    return;
  }
  const id = crypto.randomUUID();
  const board: typeof current = {
    version: 1,
    title: `${node.label} detail`,
    nodes: [],
    edges: [],
  };
  history.execute({ type: 'detail', root: project, id, board });
  commit({
    type: 'graph',
    label: 'Link detail diagram',
    nodes: [{ id: node.id, value: { ...node, detailId: id } }],
  });
  navigateDiagram(board);
};
field('node-detail').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  const value = { ...node };
  if (field('node-detail').value) value.detailId = field('node-detail').value;
  else delete value.detailId;
  commit({
    type: 'graph',
    label: 'Link detail diagram',
    nodes: [{ id: node.id, value }],
  });
};
field('node-caption').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  commit({
    type: 'graph',
    label: 'Edit walkthrough caption',
    nodes: [
      {
        id: node.id,
        value: {
          ...node,
          journeyCaption: field('node-caption').value.slice(0, 1000),
        },
      },
    ],
  });
};
function scenarioOptions() {
  return current.scenarios ?? defaultScenarios;
}
function refreshScenarioChoices(): void {
  const select = element('traffic-scenario') as HTMLSelectElement;
  const previous = select.value;
  select.replaceChildren(
    new Option('Choose a scenario…', ''),
    ...scenarioOptions().map(
      (scenario) => new Option(scenario.name, scenario.id),
    ),
  );
  select.value = previous;
  for (const id of ['scenario-source', 'scenario-target']) {
    const endpoint = element(id) as HTMLSelectElement;
    const value = endpoint.value;
    endpoint.replaceChildren(
      new Option('Not set', ''),
      ...current.nodes
        .filter((n) => n.kind === 'service')
        .map((n) => new Option(n.label, n.id)),
    );
    endpoint.value = value;
  }
}
function readTrafficFields() {
  return parseTraffic({
    protocol: field('traffic-protocol').value,
    port: Number(field('traffic-port').value),
    sourceIp: field('traffic-source').value.trim(),
    direction: field('traffic-direction').value,
  });
}
field('traffic-scenario').onchange = () => {
  const scenario = scenarioOptions().find(
    (item) => item.id === field('traffic-scenario').value,
  );
  if (!scenario) return;
  field('scenario-name').value = scenario.name;
  for (const [key, endpoint] of [
    ['sourceId', 'scenario-source'],
    ['targetId', 'scenario-target'],
  ] as const) {
    const select = element(endpoint) as HTMLSelectElement;
    const id = scenario[key];
    if (id && ![...select.options].some((option) => option.value === id))
      select.add(new Option(`Missing resource: ${id}`, id));
    select.value = id ?? '';
  }
  field('traffic-protocol').value = scenario.traffic.protocol;
  field('traffic-port').value = String(scenario.traffic.port);
  field('traffic-source').value = scenario.traffic.sourceIp;
  field('traffic-direction').value = scenario.traffic.direction;
};
element('scenario-save').onclick = () => {
  try {
    const name = field('scenario-name').value.trim();
    if (!name) throw Error('Give the scenario a name');
    const existing = field('traffic-scenario').value;
    const id = existing || crypto.randomUUID();
    const scenarios = scenarioOptions().filter((item) => item.id !== id);
    if (scenarios.length >= 100)
      throw Error('A diagram supports up to 100 scenarios');
    scenarios.push({
      id,
      name,
      traffic: readTrafficFields(),
      ...(field('scenario-source').value
        ? { sourceId: field('scenario-source').value }
        : {}),
      ...(field('scenario-target').value
        ? { targetId: field('scenario-target').value }
        : {}),
    });
    commit({ type: 'scenarios', scenarios });
    refreshScenarioChoices();
    field('traffic-scenario').value = id;
    notify(`Saved scenario ${name}`);
  } catch (error) {
    notify(String(error));
  }
};
element('scenario-delete').onclick = () => {
  const id = field('traffic-scenario').value;
  if (!id) return;
  commit({
    type: 'scenarios',
    scenarios: scenarioOptions().filter((item) => item.id !== id),
  });
  refreshScenarioChoices();
};
element('scenario-use').onclick = () => {
  try {
    const traffic = readTrafficFields();
    const source = field('scenario-source').value,
      target = field('scenario-target').value;
    checkedJourney = undefined;
    if (source && !current.nodes.some((n) => n.id === source))
      throw Error('Scenario start is missing; choose another resource');
    if (target && !current.nodes.some((n) => n.id === target))
      throw Error('Scenario destination is missing; choose another resource');
    commit({ type: 'traffic', from: current.traffic, to: traffic });
    if (source && target) {
      const result = checkReachability(current, source, target, traffic);
      notify(`${result.status}: ${result.reason}`);
      if (result.status !== 'unknown')
        checkedJourney = {
          path: result.path,
          allowed: result.status === 'allowed',
        };
    } else {
      if (source) scene.select(source);
      notify('Traffic scenario applied');
    }
    scene.stopJourney();
    element('traffic-panel').hidden = true;
  } catch (error) {
    notify(String(error));
  }
};
function toggleJourney(): void {
  if (scene.journeyPlaying) {
    scene.stopJourney();
    return;
  }
  const starts = checkedJourney
    ? checkedJourney.path.slice(0, 1)
    : journeyStarts(current, selected);
  if (!starts.length) {
    notify(
      'No flow arrows. Use Reachability matrix for imported resources, or connect components.',
    );
    return;
  }
  scene.playJourney(starts, checkedJourney);
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
  refreshScenarioChoices();
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
function updateRuleFields(): void {
  const disabled = field('rule-action').value !== 'allow';
  for (const id of [
    'rule-protocol',
    'rule-port',
    'rule-source',
    'rule-direction',
  ])
    field(id).disabled = disabled;
}
field('rule-action').onchange = updateRuleFields;
element('rule-apply').onclick = () => {
  const edge = current.edges.find((e) => e.id === selectedEdge);
  if (!edge) return;
  try {
    const value = { ...edge };
    if (field('rule-action').value === 'none') delete value.networkRule;
    else if (field('rule-action').value === 'deny')
      value.networkRule = { action: 'deny', protocol: 'any', direction: 'any' };
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
  if (
    edge &&
    (current.nodes.find((n) => n.id === edge.source)?.network ||
      current.nodes.find((n) => n.id === edge.target)?.network)
  ) {
    const reach = checkReachability(
      current,
      edge.source,
      edge.target,
      current.traffic ?? defaultTraffic,
    );
    if (reach.status !== 'allowed') {
      notify(`${reach.status.toUpperCase()} · ${reach.reason}`);
      return false;
    }
  }
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
    `${edge.networkRule ? 'Allowed · ' : ''}${name(edge.source)} → ${name(edge.target)}${edge.label ? ` · ${edge.label}` : ''}`,
  );
};
scene.onJourneyCaption = (caption) => {
  element('journey-caption').textContent = caption;
  element('journey-caption').hidden = !caption;
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
/** Nodes whose architecture details the panel edits: the whole selection. */
function detailTargets(): DiagramNode[] {
  const ids = selectedIds.size
    ? selectedIds
    : new Set(selected ? [selected] : []);
  return current.nodes.filter((n) => ids.has(n.id));
}
/** Every node nested inside a boundary, at any depth. */
function descendants(id: string): DiagramNode[] {
  const inside = new Set([id]);
  const result: DiagramNode[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of current.nodes)
      if (n.parentId && inside.has(n.parentId) && !inside.has(n.id)) {
        inside.add(n.id);
        result.push(n);
        changed = true;
      }
  }
  return result;
}
/** Set architecture details on several nodes in one undoable step. */
function setDetails(
  nodes: readonly DiagramNode[],
  details: NonNullable<DiagramNode['metadata']>,
  label: string,
): void {
  if (!nodes.length) return;
  commit({
    type: 'graph',
    label,
    nodes: nodes.map((n) => ({
      id: n.id,
      value: { ...n, metadata: { ...n.metadata, ...details } },
    })),
  });
}
for (const key of METADATA_KEYS)
  field(`meta-${key}`).onchange = () => {
    const targets = detailTargets();
    setDetails(
      targets,
      { [key]: field(`meta-${key}`).value.slice(0, 1000) },
      targets.length > 1
        ? `Edit ${key} on ${targets.length} objects`
        : `Edit ${key}`,
    );
  };
element('meta-apply-inside').onclick = () => {
  const boundary = current.nodes.find((n) => n.id === selected);
  if (!boundary) return;
  const details = Object.fromEntries(
    Object.entries(boundary.metadata ?? {}).filter(([, value]) => value),
  );
  const inside = descendants(boundary.id);
  if (!Object.keys(details).length) {
    notify('Fill in this boundary’s details first, then apply them.');
    return;
  }
  setDetails(inside, details, 'Apply details inside boundary');
  notify(
    `Details applied to ${inside.length} objects inside ${boundary.label}`,
  );
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
    showSettings(false);
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
  const roots = current.nodes.filter(
    (n) => selectedIds.has(n.id) && !hasSelectedAncestor(n),
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
window.addEventListener('keyup', (event) => {
  if (isPanKey(event.key)) cameraKeys.release(event.key, event.shiftKey);
});
window.addEventListener('blur', () => cameraKeys.stop());
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
      project: () => project,
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
      if (closing || busy) return;
      closing = true;
      void (async () => {
        if (!(await canReplace())) return;
        // A deliberate discard also removes the recovery snapshot.
        if (recoveryReady) {
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
      history.markSaved(-1);
      updateHeader();
      notify('Recovered diagram. Save to choose a destination.');
    } else if (decision === 'Discard recovery') await writeRecovery(null);
    else if (native) {
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
  if (!native) return;
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
})().catch((error) => notify(`Startup check failed: ${String(error)}`));
