import { invoke } from '@tauri-apps/api/core';
import { benchmarkDocument } from '../../benchmarks/fixtures';
import {
  sampleDocument,
  serializeDocument,
  starterDocument,
} from '../domain/document';
import type { DiagramScene } from './scene';

const frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
const percentile = (samples: number[]): number =>
  samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0;

/** Explicit diagnostic-build --smoke-test run; never runs during an ordinary session. */
export async function runNativeDiagnostics(scene: DiagramScene): Promise<void> {
  const results: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    pixelRatio: devicePixelRatio,
    navigationToScriptMs: performance.now(),
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
  const document = sampleDocument();
  scene.load(document);
  scene.fit();
  await invoke('diagnostic_finish', {
    report: JSON.stringify(results, null, 2),
    document: serializeDocument(document),
  });
}
