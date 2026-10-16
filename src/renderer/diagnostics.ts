import { invoke } from '@tauri-apps/api/core';
import { benchmarkDocument } from '../../benchmarks/fixtures';
import {
  sampleDocument,
  serializeDocument,
  starterDocument,
} from '../domain/document';
import { DocumentHistory } from '../domain/history';
import {
  copyFragment,
  groupNodes,
  pasteFragment,
  ungroupNodes,
} from '../editor/operations';
import type { DiagramScene } from './scene';

const frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
const percentile = (samples: number[]): number =>
  samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0;

/** Explicit diagnostic-build --smoke-test run; never runs during an ordinary session. */
export async function runNativeDiagnostics(scene: DiagramScene): Promise<void> {
  await scene.ready;
  // Diagnostics measure idle invalidation; continuous flow animation would mask it.
  scene.setFlow(false);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const results: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    pixelRatio: devicePixelRatio,
    navigationToDiagnosticsMs: performance.now(),
    build: await invoke<string>('diagnostic_build'),
    gpu: scene.gpuDetails(),
  };
  const interactionDocument = sampleDocument();
  scene.load(interactionDocument);
  scene.fit();
  await frame();
  const anchor = scene.nodeScreenPosition('lambda');
  const canvas = window.document.querySelector('canvas');
  if (!anchor || !canvas) throw new Error('Missing native interaction target');
  let moves = 0;
  const previousMove = scene.onMove;
  scene.onMove = () => {
    moves++;
  };
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: anchor.x,
      clientY: anchor.y,
      pointerId: 1,
      button: 0,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: anchor.x + 45,
      clientY: anchor.y + 20,
      pointerId: 1,
    }),
  );
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  scene.onMove = previousMove;
  const moved = interactionDocument.nodes.find((node) => node.id === 'lambda');
  if (
    moves !== 1 ||
    !moved ||
    (moved.x === -40 && moved.z === -80) ||
    moved.x % 10 !== 0 ||
    moved.z % 10 !== 0
  )
    throw new Error('Native snapped-drag check failed');
  results.syntheticSnappedDrag =
    'pass: one completed gesture, coordinates snapped to grid';
  const workflow = starterDocument();
  const history = new DocumentHistory(workflow);
  scene.load(workflow);
  scene.fit();
  await frame();
  const canvasRect = canvas.getBoundingClientRect();
  const marqueeStart = { x: canvasRect.left + 90, y: canvasRect.top + 100 };
  const marqueeEnd = { x: canvasRect.right - 280, y: canvasRect.bottom - 120 };
  const pointer = (
    type: string,
    point: { x: number; y: number },
    shiftKey = false,
  ) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: point.x,
        clientY: point.y,
        pointerId: 6,
        button: 0,
        shiftKey,
        cancelable: true,
      }),
    );
  const selectionOriginal = serializeDocument(workflow);
  if (pointer('pointerdown', marqueeStart))
    throw Error('Canvas press was not claimed');
  pointer('pointermove', marqueeEnd);
  const selectionBox =
    canvas.parentElement?.querySelector<HTMLElement>('.selection-box');
  if (!selectionBox || selectionBox.hidden)
    throw Error('Missing selection rectangle');
  pointer('pointerup', marqueeEnd);
  if (scene.selection.length !== 2 || !selectionBox.hidden)
    throw Error('Native rectangle selection failed');
  scene.selectMany([]);
  pointer('pointerdown', marqueeEnd);
  pointer('pointermove', marqueeStart);
  pointer('pointerup', marqueeStart);
  if (scene.selection.length !== 2)
    throw Error('Reverse rectangle selection failed');
  scene.select('database');
  const functionPoint = scene.nodeScreenPosition('function');
  if (!functionPoint) throw Error('Missing additive rectangle target');
  pointer('pointerdown', marqueeStart, true);
  pointer('pointermove', functionPoint, true);
  pointer('pointerup', functionPoint, true);
  if (scene.selection.length !== 2)
    throw Error('Additive rectangle selection failed');
  pointer('pointerdown', marqueeStart);
  pointer('pointermove', marqueeEnd);
  pointer('pointercancel', marqueeEnd);
  if (scene.selection.length !== 2 || !selectionBox.hidden)
    throw Error('Cancelled rectangle changed selection');
  if (serializeDocument(workflow) !== selectionOriginal)
    throw Error('Rectangle selection moved nodes or changed the document');
  if (
    canvas.dispatchEvent(new MouseEvent('mousedown', { cancelable: true })) ||
    canvas.dispatchEvent(new Event('dragstart', { cancelable: true }))
  )
    throw Error('Canvas native dragging was not prevented');
  results.rectangleSelection =
    'pass: forward/reverse, Shift-add, cancel, no document edits, native drag defaults prevented';
  const original = serializeDocument(workflow);
  history.execute(
    groupNodes(
      workflow,
      new Set(workflow.nodes.map((n) => n.id)),
      'workflow-group',
    ),
  );
  scene.load(workflow);
  scene.fit();
  history.execute(ungroupNodes(workflow, new Set(['workflow-group'])));
  history.undo();
  history.undo();
  if (serializeDocument(workflow) !== original)
    throw Error('Native graph history roundtrip failed');
  let sequence = 0;
  history.execute(
    pasteFragment(
      copyFragment(workflow, new Set(workflow.nodes.map((n) => n.id))),
      () => `copy-${sequence++}`,
    ),
  );
  history.undo();
  if (serializeDocument(workflow) !== original)
    throw Error('Native clipboard graph roundtrip failed');
  scene.load(workflow);
  scene.fit();
  scene.select('function');
  await frame();
  const handle = scene.handleScreenPosition('function', 'resize');
  if (!handle) throw Error('Missing resize handle');
  let resizes = 0;
  const previousResize = scene.onResize;
  scene.onResize = () => {
    resizes++;
  };
  for (const [type, x, y] of [
    ['pointerdown', handle.x, handle.y],
    ['pointermove', handle.x + 24, handle.y + 16],
    ['pointerup', handle.x + 24, handle.y + 16],
  ] as const)
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 3,
        button: 0,
      }),
    );
  scene.onResize = previousResize;
  if (resizes !== 1) throw Error('Native resize gesture failed');
  scene.selectMany(['function', 'database']);
  await frame();
  const moveAnchor = scene.nodeScreenPosition('function');
  if (!moveAnchor) throw Error('Missing multiselect anchor');
  let groupedMoves = 0;
  const previousMoves = scene.onMoves;
  scene.onMoves = (changes) => {
    if (changes.length === 2) groupedMoves++;
  };
  for (const [type, x, y] of [
    ['pointerdown', moveAnchor.x, moveAnchor.y],
    ['pointermove', moveAnchor.x + 30, moveAnchor.y + 20],
    ['pointerup', moveAnchor.x + 30, moveAnchor.y + 20],
  ] as const)
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 4,
        button: 0,
      }),
    );
  scene.onMoves = previousMoves;
  if (groupedMoves !== 1) throw Error('Native multi-selection drag failed');
  scene.select('function');
  await frame();
  const sourceHandle = scene.handleScreenPosition('function', 'east'),
    targetAnchor = scene.nodeScreenPosition('database');
  if (!sourceHandle || !targetAnchor) throw Error('Missing port target');
  let connects = 0;
  const previousConnect = scene.onConnect;
  scene.onConnect = (source, port, target) => {
    if (source === 'function' && port === 'east' && target === 'database')
      connects++;
  };
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: sourceHandle.x,
      clientY: sourceHandle.y,
      pointerId: 5,
      button: 0,
    }),
  );
  canvas.dispatchEvent(
    new PointerEvent('pointerup', {
      clientX: targetAnchor.x,
      clientY: targetAnchor.y,
      pointerId: 5,
      button: 0,
    }),
  );
  scene.onConnect = previousConnect;
  if (connects !== 1) throw Error('Native port connection failed');
  results.editorWorkflows =
    'pass: group/ungroup history, clipboard graph, one resize, one multiselection drag, named-port connection';
  scene.load(starterDocument());
  scene.fit();
  await frame();
  for (const mode of ['isometric', 'top'] as const) {
    scene.setView(mode);
    await frame();
    await frame();
    const png = await scene.png();
    await invoke('diagnostic_capture', {
      name: mode,
      bytes: Array.from(new Uint8Array(await png.arrayBuffer())),
    });
  }
  const framesBefore = scene.metrics.frames;
  await new Promise((resolve) => setTimeout(resolve, 500));
  results.idleFramesOver500ms = scene.metrics.frames - framesBefore;
  for (const [nodes, edges] of [
    [500, 750],
    [2000, 3000],
  ] as const) {
    const start = performance.now();
    const document = benchmarkDocument(nodes, edges);
    scene.load(document);
    scene.fit();
    await frame();
    await frame();
    const loadMs = performance.now() - start;
    const renderTimes: number[] = [];
    const eventToFrame: number[] = [];
    for (let i = 0; i < 40; i++) {
      const before = performance.now();
      scene.setView(i % 2 === 0 ? 'isometric' : 'top');
      await frame();
      renderTimes.push(scene.metrics.lastRenderMs);
      eventToFrame.push(performance.now() - before);
    }
    scene.setView('isometric');
    await frame();
    await frame();
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.4;
    const cy = rect.top + rect.height * 0.5;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: cx,
        clientY: cy,
        pointerId: 2,
        button: 2,
      }),
    );
    const panTimes: number[] = [];
    const panRenders: number[] = [];
    for (let step = 0; step < 50; step++) {
      const before = performance.now();
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: cx + (step % 2) * 6,
          clientY: cy + (step % 2) * 4,
          pointerId: 2,
        }),
      );
      await frame();
      if (step >= 10) {
        panTimes.push(performance.now() - before);
        panRenders.push(scene.metrics.lastRenderMs);
      }
    }
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
    results[`${nodes}nodes`] = {
      loadMs,
      panEventToFrameP95Ms: percentile(panTimes),
      panRenderSubmissionP95Ms: percentile(panRenders),
      textures: scene.metrics.textures,
      drawCalls: scene.metrics.drawCalls,
      renderSubmissionP95Ms: percentile(renderTimes),
      cameraChangeToFrameP95Ms: percentile(eventToFrame),
    };
  }
  scene.load(starterDocument());
  scene.fit();
  await frame();
  await frame();
  const baseTextures = scene.metrics.textures;
  for (let cycle = 0; cycle < 10; cycle++) {
    scene.load(starterDocument());
    scene.fit();
    await frame();
    await frame();
  }
  if (scene.metrics.textures !== baseTextures)
    throw Error('Repeated scene loads leaked textures');
  results.repeatedOpenTextureCheck = {
    cycles: 10,
    textures: scene.metrics.textures,
  };
  results.contextLossRecovery = await scene.checkContextRecovery();
  await frame();
  await frame();
  const document = sampleDocument();
  scene.load(document);
  scene.fit();
  await invoke('diagnostic_finish', {
    report: JSON.stringify(results, null, 2),
    document: serializeDocument(document),
  });
}
