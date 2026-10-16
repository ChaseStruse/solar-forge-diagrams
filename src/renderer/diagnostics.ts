import { invoke } from '@tauri-apps/api/core';
import { benchmarkDocument } from '../../benchmarks/fixtures';
import { sampleDocument, serializeDocument } from '../domain/document';
import type { DiagramScene } from './scene';

const frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
const percentile = (samples: number[]): number =>
  samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0;

/** Explicit debug-only --smoke-test run; never runs during an ordinary session. */
export async function runNativeDiagnostics(scene: DiagramScene): Promise<void> {
  const results: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    pixelRatio: devicePixelRatio,
    startupToScriptMs: performance.now(),
    build: 'debug shell / production frontend',
  };
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
    results[`${nodes}nodes`] = {
      loadMs,
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
