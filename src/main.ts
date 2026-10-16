import { invoke } from '@tauri-apps/api/core';
import './style.css';
import { benchmarkDocument } from '../benchmarks/fixtures';
import {
  parseDocument,
  sampleDocument,
  serializeDocument,
} from './domain/document';
import {
  exportPng,
  nativeAvailable,
  openDocumentFile,
  saveDocumentFile,
} from './platform/files';
import { DiagramScene } from './renderer/scene';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing');
root.innerHTML = `
  <header>
    <div class="brand"><span class="brand-mark">✦</span><div>SOLAR FORGE<span class="brand-sub">DIAGRAMS / WORKSPACE</span></div></div>
    <div class="document-title"><span class="status-dot"></span><span id="title"></span><span class="badge">LOCAL</span></div>
    <div class="actions"><button id="open">Open</button><button id="save">Save diagram</button><button id="export" class="primary">Export PNG ↗</button></div>
  </header>
  <main>
    <aside class="library">
      <p class="eyebrow">COMPONENT LIBRARY</p><h1>Build something<br><span>brilliant.</span></h1>
      <p class="muted">A little structure. Endless possibilities.</p>
      <label class="search-label" for="search">Find a component</label><input id="search" type="search" placeholder="Search AWS services…">
      <div class="section-heading">AWS SERVICES <span>5</span></div><div id="services"></div>
      <div class="library-note"><span>✦</span><p><strong>Made to stay local.</strong><br>Your architecture belongs to you. Work offline, save anywhere.</p></div>
    </aside>
    <section class="workspace" aria-label="Diagram workspace">
      <div class="canvas-top"><span class="eyebrow">ARCHITECTURE CANVAS</span><div class="view-switch"><button id="iso" aria-pressed="true">Isometric</button><button id="top" aria-pressed="false">Top-down</button><button id="fit">Fit view</button></div></div>
      <div id="canvas"></div><div class="canvas-bottom"><span>Drag to move · Right-drag to pan · Scroll to zoom</span><span id="count"></span></div>
    </section>
    <aside class="inspector"><p class="eyebrow">PROPERTIES</p><h2 id="selection">Your architecture</h2><p class="muted" id="selection-note">Select a tile to inspect its position.</p><label for="node-label">LABEL</label><input id="node-label" disabled><dl><dt>Position X</dt><dd id="position-x">—</dd><dt>Position Z</dt><dd id="position-z">—</dd></dl><div class="divider"></div><p class="eyebrow">VIEW & PERFORMANCE</p><p class="muted">The scene rests when you do. Rendering happens only when the canvas changes.</p><label for="benchmark">Load a board</label><select id="benchmark"><option value="sample">Serverless example</option><option value="standard">500 nodes / 750 edges</option><option value="stress">2,000 nodes / 3,000 edges</option></select><p class="muted small">Prototype tiles use text identifiers. Official AWS artwork arrives in M3.</p></aside>
  </main>
  <footer><span id="status" role="status">Ready</span><span>✦ SOLAR FORGE <span class="version">PREVIEW 0.1</span></span></footer>`;
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
function selectElement(id: string): HTMLSelectElement {
  const result = element(id);
  if (!(result instanceof HTMLSelectElement))
    throw new Error(`Expected select: ${id}`);
  return result;
}
let current = sampleDocument();
let selected: string | undefined;
let dirty = false;
let busy = false;
const status = element('status');
const notify = (message: string): void => {
  status.textContent = message;
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
function updateHeader(): void {
  element('title').textContent = `${current.title}${dirty ? ' •' : ''}`;
  element('count').textContent =
    `${current.nodes.length} nodes / ${current.edges.length} connections`;
}
function inspect(): void {
  const node = current.nodes.find((n) => n.id === selected);
  element('selection').textContent = node?.label ?? 'Your architecture';
  const input = inputElement('node-label');
  input.disabled = !node;
  input.value = node?.label ?? '';
  element('position-x').textContent = node ? String(node.x) : '—';
  element('position-z').textContent = node ? String(node.z) : '—';
  element('selection-note').textContent = node
    ? `${node.kind === 'group' ? 'Architecture boundary' : 'Service tile'} · ${node.id}`
    : 'Select a tile to inspect its position.';
}
scene.onSelect = (node) => {
  selected = node?.id;
  inspect();
};
scene.onMove = () => {
  dirty = true;
  updateHeader();
  inspect();
  notify('Position updated');
};
scene.onError = notify;
function replaceDocument(next: typeof current): void {
  current = next;
  selected = undefined;
  dirty = false;
  scene.load(current);
  scene.fit();
  inspect();
  updateHeader();
}
async function action(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await task();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
  }
}
function canReplace(): boolean {
  return !dirty || window.confirm('Discard unsaved changes?');
}
element('open').onclick = () => {
  void action(async () => {
    if (!canReplace()) return;
    const content = await openDocumentFile();
    if (content !== null) {
      replaceDocument(parseDocument(content));
      notify('Diagram opened');
    }
  });
};
element('save').onclick = () => {
  void action(async () => {
    const snapshot = serializeDocument(current);
    if (await saveDocumentFile(snapshot)) {
      dirty = serializeDocument(current) !== snapshot;
      updateHeader();
      notify('Diagram saved');
    }
  });
};
element('export').onclick = () => {
  void action(async () => {
    if (await exportPng(await scene.png())) notify('PNG exported');
  });
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
element('fit').onclick = () => scene.fit();
element('node-label').onchange = () => {
  const node = current.nodes.find((n) => n.id === selected);
  if (!node) return;
  node.label = inputElement('node-label').value.slice(0, 1000);
  dirty = true;
  scene.load(current);
  scene.select(node.id);
  updateHeader();
};
element('benchmark').onchange = () => {
  if (!canReplace()) return;
  const value = selectElement('benchmark').value;
  replaceDocument(
    value === 'sample'
      ? sampleDocument()
      : benchmarkDocument(
          value === 'stress' ? 2000 : 500,
          value === 'stress' ? 3000 : 750,
        ),
  );
  notify(
    'Board loaded. Performance targets remain subject to native measurement.',
  );
};
const services = [
  ['API Gateway', '#a568ce'],
  ['Lambda', '#ed983c'],
  ['DynamoDB', '#548bc4'],
  ['SQS', '#cb6186'],
  ['S3', '#79a950'],
] as const;
function populateServices(query = ''): void {
  const list = element('services');
  list.replaceChildren();
  for (const [label, color] of services) {
    if (!label.toLowerCase().includes(query.toLowerCase())) continue;
    const button = document.createElement('button');
    button.className = 'service';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = color;
    swatch.textContent = label.slice(0, 2);
    const text = document.createElement('span');
    text.textContent = label;
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+';
    button.append(swatch, text, plus);
    button.onclick = () => {
      const id = crypto.randomUUID();
      current.nodes.push({
        id,
        kind: 'service',
        label,
        x: 0,
        z: 0,
        width: 150,
        depth: 96,
        color,
      });
      dirty = true;
      scene.load(current);
      scene.select(id);
      updateHeader();
      notify(`${label} added`);
    };
    list.append(button);
  }
}
element('search').oninput = () =>
  populateServices(inputElement('search').value);
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    element('save').click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'o') {
    event.preventDefault();
    element('open').click();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});
window.addEventListener('pagehide', () => scene.dispose(), { once: true });
populateServices();
updateHeader();
scene.fit();
notify(
  nativeAvailable()
    ? 'Native workspace · Offline and ready'
    : 'Browser development preview · Open, Save, and Export require the desktop app',
);

if (nativeAvailable()) {
  void (async () => {
    if (await invoke<boolean>('diagnostic_mode')) {
      const { runNativeDiagnostics } = await import('./renderer/diagnostics');
      await runNativeDiagnostics(scene);
    }
  })().catch((error) =>
    notify(`Native diagnostic check failed: ${String(error)}`),
  );
}
