/**
 * Browser smoke test: starts the Vite dev server, opens the app in headless
 * Chromium over the DevTools protocol and drives the editor through its main
 * flows, including real mouse gestures. Fails on any broken check or page
 * error. Needs Node and a Chromium build on PATH (or NODE=…, CHROMIUM=…).
 *
 *   bun run smoke            # writes smoke.png in the system temp folder
 *   bun run smoke out.png    # choose the screenshot path
 *   SMOKE_URL=http://127.0.0.1:5173/ bun run smoke   # use a running server
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiagramDocument, DiagramNode } from '../src/domain/document';

const scratch = mkdtempSync(join(tmpdir(), 'solar-forge-smoke-'));
const shot = process.argv[2] ?? join(tmpdir(), 'solar-forge-smoke.png');
const port = 9333;
const vitePort = 5197;
const vite = process.env.SMOKE_URL
  ? undefined
  : Bun.spawn(
      [
        // Vite runs on Node; spawning it directly lets one kill stop it.
        process.env.NODE ?? 'node',
        join(import.meta.dir, '../node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(vitePort),
        '--strictPort',
      ],
      {
        stderr: 'ignore',
        stdout: 'ignore',
      },
    );
const url = process.env.SMOKE_URL ?? `http://127.0.0.1:${vitePort}/`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {}
  await Bun.sleep(200);
}
const chrome = Bun.spawn(
  [
    process.env.CHROMIUM ?? 'chromium',
    '--headless=new',
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`,
    '--window-size=1400,900',
    `--user-data-dir=${join(scratch, 'profile')}`,
    'about:blank',
  ],
  { stderr: 'ignore', stdout: 'ignore' },
);
const shutdown = () => {
  chrome.kill();
  vite?.kill();
  rmSync(scratch, { recursive: true, force: true });
};
// A step that throws must not leave Chromium and Vite running.
const abort = (error: unknown) => {
  console.error(error);
  shutdown();
  process.exit(1);
};
process.on('uncaughtException', abort);
process.on('unhandledRejection', abort);
let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 50 && !target; i++) {
  await Bun.sleep(200);
  try {
    const list = (await (
      await fetch(`http://127.0.0.1:${port}/json`)
    ).json()) as { type: string; webSocketDebuggerUrl: string }[];
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) {
  shutdown();
  throw Error('Chromium did not start');
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
/** A DevTools protocol message: untyped JSON from the browser. */
// biome-ignore lint/suspicious/noExplicitAny: protocol payloads are dynamic.
type Cdp = any;
const pending = new Map<number, (v: Cdp) => void>();
const errors: string[] = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id) pending.get(msg.id)?.(msg);
  if (msg.method === 'Runtime.exceptionThrown')
    errors.push(
      msg.params.exceptionDetails.exception?.description ??
        msg.params.exceptionDetails.text,
    );
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    errors.push(
      `console.error: ${msg.params.args.map((a: Cdp) => a.value ?? a.description).join(' ')}`,
    );
};
const send = (method: string, params: object = {}) =>
  new Promise<Cdp>((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression: string) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails)
    throw Error(
      `${expression}\n  -> ${r.result.exceptionDetails.exception?.description}`,
    );
  return r.result?.result?.value;
};
const key = async (key: string, mods = 0, code = key) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      modifiers: mods,
      ...(key.length === 1 && !mods ? { text: key } : {}),
      windowsVirtualKeyCode:
        key.length === 1
          ? key.toUpperCase().charCodeAt(0)
          : key === 'Escape'
            ? 27
            : key === 'Delete'
              ? 46
              : 0,
    });
  await Bun.sleep(60);
};
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) {
  await Bun.sleep(100);
  if (await evaluate('!!window.solarForge')) break;
}
await Bun.sleep(500);

const checks: [string, boolean][] = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);
const $ = (sel: string) => `document.querySelector(${JSON.stringify(sel)})`;
const click = (sel: string) => evaluate(`${$(sel)}.click()`);
const text = (sel: string) => evaluate(`${$(sel)}.textContent`);
const hidden = (sel: string) => evaluate(`${$(sel)}.hidden`);
const doc = (): Promise<DiagramDocument> =>
  evaluate('window.solarForge.document()');
/** A value the test knows is there; fails loudly if it is not. */
const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw Error(`${what} is missing`);
  return value;
};
/** A node of the open board that the test knows exists. */
const nodeOf = async (id: string): Promise<DiagramNode> => {
  const node = (await doc()).nodes.find((n) => n.id === id);
  if (!node) throw Error(`Node ${id} is missing`);
  return node;
};

const start = await doc();
check('starter board loads', start.nodes.length === 2);
check('header counts', (await text('#count')).includes('2 objects'));
check(
  'layers list rows',
  (await evaluate(
    `document.querySelectorAll('#layer-tree .layer-row').length`,
  )) === 3,
);

// Selection drives the inspector.
const first = must(start.nodes[0], 'first node');
const firstId = first.id;
await evaluate(`window.solarForge.scene.select(${JSON.stringify(firstId)})`);
check('inspector shows selection', !(await hidden('#properties')));
check(
  'inspector label',
  (await evaluate(`${$('#node-label')}.value`)) === first.label,
);
// Inspector edit commits through history.
await evaluate(
  `(() => { const i = ${$('#node-label')}; i.value = 'Renamed'; i.onchange(); })()`,
);
check('rename commits', (await nodeOf(firstId)).label === 'Renamed');
check('header dirty', (await text('#save-state')) === 'Unsaved changes');
await key('z', 2, 'KeyZ');
check('ctrl+z undoes', (await nodeOf(firstId)).label === first.label);
await key('z', 2 | 8, 'KeyZ');
check('ctrl+shift+z redoes', (await nodeOf(firstId)).label === 'Renamed');

// Component palette: open, filter, add.
await key('/');
check('palette opens', !(await hidden('#component-palette')));
await evaluate(
  `(() => { const s = ${$('#search')}; s.value = 'S3'; s.oninput(); })()`,
);
await key('Enter');
check('palette adds component', (await doc()).nodes.length === 3);
check('palette closes after add', await hidden('#component-palette'));

// Delete and tools.
await evaluate(`document.activeElement?.blur()`);
await key('Delete');
check('delete removes selection', (await doc()).nodes.length === 2);
await key('c');
check(
  'C picks connect tool',
  (await evaluate(`${$('#tool-connect')}.getAttribute('aria-pressed')`)) ===
    'true',
);
await key('v');
check(
  'V back to select',
  (await evaluate(`${$('#tool-select')}.getAttribute('aria-pressed')`)) ===
    'true',
);

// Edge selection and inspector.
const edge = must((await doc()).edges[0], 'starter connection');
await evaluate(
  `window.solarForge.scene.selectEdge(${JSON.stringify(edge.id)})`,
);
check('edge inspector', !(await hidden('#edge-properties')));
check('edge rule result', (await text('#rule-result')).length > 0);

// Panels and popovers.
await click('#menu');
check('file menu opens', !(await hidden('#file-menu')));
await key('Escape');
check('escape closes file menu', await hidden('#file-menu'));
await click('#theme');
check('theme menu', !(await hidden('#theme-menu')));
const themeButtons = await evaluate(
  `document.querySelectorAll('#theme-list button').length`,
);
check('themes listed', themeButtons > 3);
await evaluate(`document.querySelectorAll('#theme-list button')[1].click()`);
check(
  'theme applied',
  (await evaluate(
    `document.querySelectorAll('#theme-list button')[1].getAttribute('aria-pressed')`,
  )) === 'true',
);
await evaluate(`document.querySelectorAll('#theme-list button')[0].click()`);
await click('#settings');
check(
  'settings tablet bindings',
  (await evaluate(
    `document.querySelectorAll('#tablet-bindings .binding-row').length`,
  )) > 10,
);
await key('Escape');
await click('#traffic-settings');
check('traffic panel', !(await hidden('#traffic-panel')));
check(
  'scenario choices',
  (await evaluate(`${$('#traffic-scenario')}.options.length`)) >= 1,
);
await key('Escape');
await click('#export-gif');
check('gif panel', !(await hidden('#gif-panel')));
await key('Escape');
await click('#toggle-layers');
check('layers toggle hides', await hidden('#layers-panel'));
await click('#toggle-layers');
check('layers toggle shows', !(await hidden('#layers-panel')));

// Journey on the starter board.
await evaluate(`window.solarForge.scene.select(undefined)`);
await key('p');
check(
  'journey plays',
  (await evaluate(`${$('#journey')}.getAttribute('aria-pressed')`)) === 'true',
);
await key('Escape');

// Command palette.
await key('k', 2, 'KeyK');
check(
  'command palette',
  !!(await evaluate(`document.querySelector('dialog[open]')`)),
);
await key('Escape');

// Board edits on the starter board.
await evaluate(
  `window.solarForge.load(${JSON.stringify(JSON.stringify(start))})`,
);
await Bun.sleep(200);
await evaluate(`window.solarForge.scene.select(${JSON.stringify(firstId)})`);
await key('Enter');
check(
  'enter opens inline editor',
  !!(await evaluate(`document.querySelector('.inline-editor')`)),
);
await evaluate(
  `(() => { const e = document.querySelector('.inline-editor'); e.value = 'Edited inline'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`,
);
check('inline edit commits', (await nodeOf(firstId)).label === 'Edited inline');
const x0 = (await nodeOf(firstId)).x;
await key('ArrowRight', 0, 'ArrowRight');
check('arrow nudges selection', (await nodeOf(firstId)).x === x0 + 10);
await key('a', 2, 'KeyA');
check(
  'ctrl+a selects all',
  (await evaluate(`window.solarForge.scene.selection.length`)) === 2,
);
await key('d', 2, 'KeyD');
check('ctrl+d duplicates', (await doc()).nodes.length === 4);
await key('z', 2, 'KeyZ');
await key('a', 2, 'KeyA');
await key('g', 2, 'KeyG');
check(
  'ctrl+g groups',
  (await doc()).nodes.some((n: DiagramNode) => n.kind === 'group'),
);
await key('z', 2, 'KeyZ');
await key('a', 2, 'KeyA');
await evaluate(`window.solarForge.scene.onContextMenu(200, 200)`);
check('context menu opens', !(await hidden('#context-menu')));
check(
  'align row shown for multi',
  !(await evaluate(
    `document.querySelector('#context-menu [data-multi]').hidden`,
  )),
);
await evaluate(
  `document.querySelector('#context-menu [data-align="top"]').click()`,
);
const zs = (await doc()).nodes.map((n: DiagramNode) => n.z - n.depth / 2);
check(
  'align top',
  zs.every((z: number) => z === zs[0]) && (await hidden('#context-menu')),
);
const copied = await evaluate(
  `(() => { const dt = new DataTransfer(); window.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt })); return dt.getData('text/plain'); })()`,
);
check(
  'copy writes selection',
  typeof copied === 'string' && copied.includes('"nodes"'),
);
await evaluate(
  `(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(copied)}); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); })()`,
);
check('paste adds copies', (await doc()).nodes.length === 4);
await evaluate(
  `window.solarForge.scene.onSketch({ points: [{x:0,z:0},{x:200,z:0},{x:200,z:120},{x:0,z:120},{x:0,z:2}] })`,
);
check('sketch box adds a shape', (await doc()).nodes.length === 5);
await evaluate(`window.solarForge.scene.onPlace('note', 300, 300)`);
check(
  'note tool opens editor',
  !!(await evaluate(`document.querySelector('.inline-editor.note')`)),
);
await key('Escape');
check(
  'escape on new note removes it',
  (await doc()).nodes.length === 5 &&
    !(await evaluate(`document.querySelector('.inline-editor')`)),
);

// ---- Real pointer gestures through CDP mouse input (trusted events).
const mouse = async (
  type: string,
  x: number,
  y: number,
  button = 'left',
  extra: object = {},
) => {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button,
    buttons:
      type === 'mouseReleased' || button === 'none'
        ? 0
        : button === 'right'
          ? 2
          : 1,
    clickCount: 1,
    ...extra,
  });
};
const dragFrom = async (
  a: { x: number; y: number },
  b: { x: number; y: number },
  button = 'left',
  steps = 8,
) => {
  await mouse('mouseMoved', a.x, a.y, 'none');
  await mouse('mousePressed', a.x, a.y, button);
  for (let i = 1; i <= steps; i++)
    await mouse(
      'mouseMoved',
      a.x + ((b.x - a.x) * i) / steps,
      a.y + ((b.y - a.y) * i) / steps,
      button,
    );
  await mouse('mouseReleased', b.x, b.y, button);
  await Bun.sleep(80);
};
const at = (id: string) =>
  evaluate(`window.solarForge.scene.nodeScreenPosition(${JSON.stringify(id)})`);
await evaluate(
  `window.solarForge.load(${JSON.stringify(JSON.stringify(start))})`,
);
await evaluate(
  `document.querySelector('#iso').click(); window.solarForge.scene.fit()`,
);
await Bun.sleep(300);
const n0 = firstId;
const n1 = must(start.nodes[1], 'second node').id;
const p0 = await at(n0);
const x0d = (await nodeOf(n0)).x;
await dragFrom(p0, { x: p0.x, y: p0.y + 80 });
const moved = await nodeOf(n0);
check('pointer drag moves node', moved.x !== x0d || moved.z !== first.z);
check(
  'drag selects node',
  (await evaluate(`window.solarForge.scene.selection.join()`)) === n0,
);
await key('z', 2, 'KeyZ');
check('undo drag', (await nodeOf(n0)).x === x0d);
// Resize via the corner handle.
await evaluate(`window.solarForge.scene.select(${JSON.stringify(n0)})`);
await Bun.sleep(100);
const h = await evaluate(
  `window.solarForge.scene.handleScreenPosition(${JSON.stringify(n0)}, 'resize')`,
);
const w0 = (await nodeOf(n0)).width;
await dragFrom(h, { x: h.x + 60, y: h.y + 30 });
check('resize handle grows node', (await nodeOf(n0)).width > w0);
await key('z', 2, 'KeyZ');
// Connect by dragging a port dot onto the other node.
const edges0 = (await doc()).edges.length;
await evaluate(`window.solarForge.scene.select(${JSON.stringify(n0)})`);
await Bun.sleep(100);
const portDot = await evaluate(
  `window.solarForge.scene.handleScreenPosition(${JSON.stringify(n0)}, 'south')`,
);
await dragFrom(portDot, await at(n1));
check('port drag connects', (await doc()).edges.length === edges0 + 1);
await key('z', 2, 'KeyZ');
// Marquee across the whole board selects both.
await evaluate(`window.solarForge.scene.select(undefined)`);
await dragFrom({ x: 30, y: 120 }, { x: 1100, y: 780 });
check(
  'marquee selects both',
  (await evaluate(`window.solarForge.scene.selection.length`)) === 2,
);
// Click empty canvas clears; click an edge midpoint selects it.
await dragFrom({ x: 40, y: 780 }, { x: 40, y: 780 }, 'left', 1);
check(
  'click empty clears',
  (await evaluate(`window.solarForge.scene.selection.length`)) === 0,
);
const q0 = await at(n0),
  q1 = await at(n1);
await evaluate(`window.solarForge.scene.select(undefined)`);
const mid = await evaluate(
  `(() => { const s = window.solarForge.scene; return s.edgeScreenPosition(${JSON.stringify(must(start.edges[0], 'starter connection').id)}); })()`,
);
// The edge label sits on the line; probe a little off the label along the line.
const along = {
  x: mid.x + (q1.x - q0.x) * 0.2,
  y: mid.y + (q1.y - q0.y) * 0.2,
};
await dragFrom(along, along, 'left', 1);
check('click edge selects it', !(await hidden('#edge-properties')));
// Right-drag pans the view, not the board.
const before = await at(n0);
await dragFrom({ x: 600, y: 700 }, { x: 700, y: 650 }, 'right');
const after = await at(n0);
check('right drag pans view', Math.abs(after.x - before.x) > 20);
check('pan leaves board unchanged', (await nodeOf(n0)).x === x0d);
await key('Escape');
// Right-click on a node opens the context menu for it.
const r = await at(n1);
await mouse('mousePressed', r.x, r.y, 'right');
await mouse('mouseReleased', r.x, r.y, 'right');
await Bun.sleep(100);
check('right click opens context menu', !(await hidden('#context-menu')));
check(
  'right click selects node',
  (await evaluate(`window.solarForge.scene.selection.join()`)) === n1,
);
await key('Escape');
// Wheel zooms.
const z0 = await text('#zoom-level');
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: 600,
  y: 450,
  deltaX: 0,
  deltaY: -400,
});
await Bun.sleep(100);
check('wheel zooms', (await text('#zoom-level')) !== z0);
await evaluate(`window.solarForge.scene.fit()`);
await Bun.sleep(100);
// Double-click a node opens the inline editor.
const d = await at(n1);
await mouse('mousePressed', d.x, d.y, 'left');
await mouse('mouseReleased', d.x, d.y, 'left');
await mouse('mousePressed', d.x, d.y, 'left', { clickCount: 2 });
await mouse('mouseReleased', d.x, d.y, 'left', { clickCount: 2 });
await Bun.sleep(100);
check(
  'double click edits node',
  !!(await evaluate(`document.querySelector('.inline-editor')`)),
);
await key('Escape');
// Sketch tool: draw a box on empty board.
await evaluate(`document.activeElement?.blur()`);
await key('b');
const n = (await doc()).nodes.length;
const box: [number, number][] = [
  [200, 650],
  [380, 650],
  [380, 760],
  [200, 760],
  [200, 652],
];
await mouse('mouseMoved', 200, 650, 'none');
await mouse('mousePressed', 200, 650, 'left');
for (let i = 1; i < box.length; i++) {
  const [ax, ay] = box[i - 1] as [number, number],
    [bx, by] = box[i] as [number, number];
  for (let s = 1; s <= 10; s++)
    await mouse(
      'mouseMoved',
      ax + ((bx - ax) * s) / 10,
      ay + ((by - ay) * s) / 10,
      'left',
    );
}
await mouse('mouseReleased', 200, 652, 'left');
await Bun.sleep(100);
check('sketch draws a shape', (await doc()).nodes.length === n + 1);
await key('v');
// Text tool: click to place and type.
await key('t');
await mouse('mousePressed', 900, 700, 'left');
await mouse('mouseReleased', 900, 700, 'left');
await Bun.sleep(100);
check(
  'text tool places editor',
  !!(await evaluate(`document.querySelector('.inline-editor.text')`)),
);
await key('Escape');

// ---- More gestures: shift-click, connect tool, pen eraser (synthetic).
await evaluate(
  `window.solarForge.load(${JSON.stringify(JSON.stringify(start))})`,
);
await evaluate(`window.solarForge.scene.fit()`);
await Bun.sleep(300);
{
  const a = await at(n0),
    b = await at(n1);
  await evaluate(`window.solarForge.scene.select(undefined)`);
  await mouse('mousePressed', a.x, a.y, 'left');
  await mouse('mouseReleased', a.x, a.y, 'left');
  await mouse('mousePressed', b.x, b.y, 'left', { modifiers: 8 });
  await mouse('mouseReleased', b.x, b.y, 'left', { modifiers: 8 });
  await Bun.sleep(80);
  check(
    'shift-click adds to selection',
    (await evaluate(`window.solarForge.scene.selection.length`)) === 2,
  );
  await key('Escape');
  // Connect tool: click source then target.
  const e0 = (await doc()).edges.length;
  await key('c');
  await mouse('mousePressed', b.x, b.y, 'left');
  await mouse('mouseReleased', b.x, b.y, 'left');
  await mouse('mouseMoved', (a.x + b.x) / 2, a.y + 40, 'none');
  await mouse('mousePressed', a.x, a.y, 'left');
  await mouse('mouseReleased', a.x, a.y, 'left');
  await Bun.sleep(80);
  const last = must((await doc()).edges.at(-1), 'new connection');
  check(
    'connect tool links two clicks',
    (await doc()).edges.length === e0 + 1 &&
      last.source === n1 &&
      last.target === n0,
  );
  check(
    'connect tool returns to select',
    (await evaluate(`${$('#tool-select')}.getAttribute('aria-pressed')`)) ===
      'true',
  );
  // Pen eraser end (button 5) rubs out a node and its connections in one step.
  const n0count = (await doc()).nodes.length;
  // Wait two frames so the reloaded board's meshes have their positions.
  await evaluate(
    `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
  );
  await evaluate(`(() => {
    const c = document.querySelector('#canvas canvas');
    const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', button: type === 'pointermove' ? -1 : 5, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', ${a.x}, ${a.y}, 32);
    ev('pointermove', ${a.x + 3}, ${a.y + 2}, 32);
    ev('pointerup', ${a.x + 3}, ${a.y + 2}, 0);
  })()`);
  await Bun.sleep(80);
  check(
    'pen eraser deletes node',
    (await doc()).nodes.length === n0count - 1 &&
      !(await doc()).nodes.some((n: DiagramNode) => n.id === n0),
  );
  check(
    'pen input noticed',
    await evaluate(`document.body.classList.contains('pen-input')`),
  );
  await key('z', 2, 'KeyZ');
  check('undo erase', (await doc()).nodes.length === n0count);
}

// Mermaid import through the real dialog and its worker.
{
  const chart = await Bun.file(
    new URL('../../examples/mermaid/checkout.mmd', import.meta.url),
  ).text();
  await evaluate(`document.querySelector('#import-infrastructure').click()`);
  await evaluate(`(() => {
    const dialog = document.querySelector('[aria-label="Import a diagram"]');
    const source = dialog.querySelector('[data-source]');
    source.value = ${JSON.stringify(chart)};
    source.oninput();
    dialog.querySelector('[data-preview]').click();
  })()`);
  for (
    let i = 0;
    i < 50 &&
    (await evaluate(
      `document.querySelector('[aria-label="Import a diagram"] [data-apply]').disabled`,
    ));
    i++
  )
    await Bun.sleep(100);
  const summary = await evaluate(
    `document.querySelector('[aria-label="Import a diagram"] [data-summary]').textContent`,
  );
  check(
    'mermaid preview summarises',
    /Mermaid flowchart · 12 shapes · 1 groups · 13 connections/.test(summary),
  );
  await evaluate(
    `document.querySelector('[aria-label="Import a diagram"] [data-apply]').click()`,
  );
  await Bun.sleep(400);
  const imported = await doc();
  check(
    'mermaid import replaces board',
    imported.title === 'Checkout flow' && imported.nodes.length === 13,
  );
  check(
    'mermaid decisions become diamonds',
    imported.nodes.filter((n: DiagramNode) => n.shape === 'decision').length ===
      2,
  );
  await key('z', 2, 'KeyZ');
  check(
    'undo restores the previous board',
    (await doc()).title !== 'Checkout flow',
  );
}

// Mermaid architecture and state charts, and subgraphs as lanes, through the
// same dialog: the checkbox reaches the worker.
{
  const importChart = async (file: string, lanes: boolean) => {
    const chart = await Bun.file(
      new URL(`../../examples/mermaid/${file}`, import.meta.url),
    ).text();
    await evaluate(`document.querySelector('#import-infrastructure').click()`);
    await evaluate(`(() => {
      const dialog = document.querySelector('[aria-label="Import a diagram"]');
      const box = dialog.querySelector('[data-lanes]');
      box.checked = ${lanes};
      box.onchange();
      const source = dialog.querySelector('[data-source]');
      source.value = ${JSON.stringify(chart)};
      source.oninput();
      dialog.querySelector('[data-preview]').click();
    })()`);
    for (
      let i = 0;
      i < 50 &&
      (await evaluate(
        `document.querySelector('[aria-label="Import a diagram"] [data-apply]').disabled`,
      ));
      i++
    )
      await Bun.sleep(100);
    const summary: string = await evaluate(
      `document.querySelector('[aria-label="Import a diagram"] [data-summary]').textContent`,
    );
    await evaluate(
      `document.querySelector('[aria-label="Import a diagram"] [data-apply]').click()`,
    );
    await Bun.sleep(400);
    return summary;
  };
  const architecture = await importChart('web-architecture.mmd', false);
  const arch = await doc();
  check(
    'mermaid architecture imports with AWS icons',
    architecture.startsWith('Mermaid architecture diagram') &&
      arch.nodes.some((n: DiagramNode) => n.serviceId === 'aws.lambda'),
  );
  const states = await importChart('order-states.mmd', false);
  check(
    'mermaid state diagram imports',
    states.startsWith('Mermaid state diagram') &&
      (await doc()).nodes.some((n: DiagramNode) => n.label === 'Start'),
  );
  await importChart('checkout.mmd', true);
  const laned = await doc();
  check(
    'mermaid subgraphs become lanes',
    laned.lanes?.order[0] === 'Payment service' &&
      !laned.nodes.some((n: DiagramNode) => n.kind === 'group'),
  );
  await importChart('order-states.mmd', false);
  check('lane-free import clears lanes', (await doc()).lanes === undefined);
  for (let i = 0; i < 4; i++) await key('z', 2, 'KeyZ');
  await evaluate(
    `document.querySelector('[aria-label="Import a diagram"] [data-lanes]').checked = false`,
  );
}

// Swimlanes: owners from the inspector, L toggles, a drop changes owner.
{
  await evaluate(
    `window.solarForge.load(${JSON.stringify(JSON.stringify(start))})`,
  );
  await evaluate(`document.querySelector('#top').click()`);
  await Bun.sleep(200);
  const setOwner = async (id: string, owner: string) => {
    await evaluate(`window.solarForge.scene.select(${JSON.stringify(id)})`);
    await evaluate(
      `(() => { const f = document.querySelector('#node-owner'); f.value = ${JSON.stringify(owner)}; f.onchange(); })()`,
    );
  };
  await setOwner(n0, 'Frontend team');
  check(
    'owner field saves owner',
    (await nodeOf(n0)).owner === 'Frontend team',
  );
  check(
    'owner offered as a suggestion',
    (await evaluate(
      `[...document.querySelectorAll('#owner-options option')].map(o => o.value).join()`,
    )) === 'Frontend team',
  );
  await setOwner(n1, 'Data team');
  await evaluate(
    `window.solarForge.scene.select(undefined); document.activeElement?.blur()`,
  );
  await key('l');
  const laned = await doc();
  check(
    'L shows lanes',
    laned.lanes?.direction === 'right' &&
      (await evaluate(
        `document.querySelector('#lanes').getAttribute('aria-pressed')`,
      )) === 'true',
  );
  check('lanes separate owners', (await nodeOf(n0)).z !== (await nodeOf(n1)).z);
  // Drag the first step down into the second step's lane.
  await evaluate(`window.solarForge.scene.fit()`);
  await evaluate(
    `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
  );
  const from = await at(n0),
    lane = await at(n1);
  await dragFrom(from, { x: from.x, y: lane.y });
  await Bun.sleep(150);
  check(
    'drop into a lane changes owner',
    (await nodeOf(n0)).owner === 'Data team',
  );
  check(
    'drop is one undoable step',
    /Move to Data team/.test(await text('#status')),
  );
  await key('z', 2, 'KeyZ');
  check(
    'undo restores the owner',
    (await nodeOf(n0)).owner === 'Frontend team',
  );
  // A journey across owners reports its handoff.
  await evaluate(`window.solarForge.scene.select(${JSON.stringify(n0)})`);
  await key('p');
  for (
    let i = 0;
    i < 60 &&
    (await evaluate(
      `document.querySelector('#journey').getAttribute('aria-pressed')`,
    )) === 'true';
    i++
  ) {
    if (/Handoff Frontend team → Data team/.test(await text('#status'))) break;
    await Bun.sleep(100);
  }
  check(
    'journey calls out the handoff',
    /Handoff Frontend team → Data team/.test(await text('#status')),
  );
  await key('Escape');
  await evaluate(`document.activeElement?.blur()`);
  await key('l');
  check(
    'L again hides lanes, keeps owners',
    !(await doc()).lanes && (await nodeOf(n1)).owner === 'Data team',
  );
}

// Example with detail diagrams, navigate in and out.
const examples = await evaluate(
  `import('/src/catalog/templates.ts').then(m => Object.keys(m))`,
);
check('examples module', Array.isArray(examples));
await evaluate(`(async () => {
  const { templates: list } = await import('/src/catalog/templates.ts');
  const withDetail = list.map(t => t.create()).find(d => d.details?.length);
  window.solarForge.load(JSON.stringify(withDetail ?? list[0].create()));
})()`);
await Bun.sleep(300);
const loaded = await doc();
check('example loads', loaded.nodes.length > 2);
const linked = loaded.nodes.find((n: DiagramNode) => n.detailId);
if (linked) {
  await evaluate(`document.querySelector('.detail-layer-link').click()`);
  check('detail opens', (await doc()).title !== loaded.title);
  check(
    'breadcrumb',
    (await evaluate(
      `document.querySelectorAll('#diagram-path button').length`,
    )) === 2,
  );
  await evaluate(
    `document.querySelectorAll('#diagram-path button')[1].click()`,
  );
  check('back returns', (await doc()).title === loaded.title);
} else check('example with detail diagram found', false);

// Auto layout + undo.
await click('#auto-layout');
check('auto layout commits', (await text('#save-state')) === 'Unsaved changes');

await Bun.sleep(300);
const shotData = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(shot, Buffer.from(shotData.result.data, 'base64'));
// File lifecycle: New on a dirty board asks first; Discard clears it.
await evaluate(`document.querySelector('#new').click()`);
await Bun.sleep(200);
check(
  'new asks to save',
  !!(await evaluate(`document.querySelector('dialog[open]')`)),
);
await evaluate(
  `[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent === 'Discard changes').click()`,
);
await Bun.sleep(300);
check(
  'discard opens empty board',
  (await doc()).nodes.length === 0 &&
    (await doc()).title === 'Untitled diagram',
);
check('clean after new', (await text('#save-state')) === 'Unchanged');
// Recording: a 2 second GIF runs, locks the UI, and finishes.
await evaluate(
  `window.solarForge.load(JSON.stringify((() => { return null; })() ?? ${JSON.stringify(start)}))`,
);
await Bun.sleep(200);
await click('#export-gif');
await evaluate(
  `(() => { const d = document.querySelector('#gif-duration'); d.value = '2'; })()`,
);
await click('#gif-record');
await Bun.sleep(400);
check(
  'recording locks app',
  await evaluate(`document.querySelector('#app').inert`),
);
for (
  let i = 0;
  i < 60 && (await evaluate(`document.querySelector('#app').inert`));
  i++
)
  await Bun.sleep(250);
check(
  'recording finishes',
  !(await evaluate(`document.querySelector('#app').inert`)),
);
check('recording reports', /exported|GIF/.test(await text('#status')));
shutdown();

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
for (const e of errors) console.log(`PAGE ERROR ${e}`);
console.log(
  `${checks.length - failed.length}/${checks.length} checks, ${errors.length} page errors`,
);
process.exit(failed.length || errors.length ? 1 : 0);
