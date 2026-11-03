import type { Object3D } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { overlay } from './antialias';

/**
 * A temporary line drawn over the board, such as smart guides, pen ink or a
 * connection preview. Each update replaces and disposes the previous
 * geometry, so a long gesture does not accumulate GPU buffers.
 */
export class OverlayLine {
  private line: LineSegments2 | undefined;

  constructor(
    private readonly parent: Object3D,
    readonly material: LineMaterial,
    private readonly renderOrder: number,
    private readonly changed: () => void,
  ) {}

  /** Draw segments given as flat x, y, z pairs; an empty list clears. */
  set(positions: readonly number[]): void {
    if (!positions.length) {
      this.clear();
      return;
    }
    this.removeLine();
    const line = new LineSegments2(
      new LineSegmentsGeometry().setPositions([...positions]),
      this.material,
    );
    if (this.material.dashed) line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = this.renderOrder;
    this.parent.add(overlay(line));
    this.line = line;
    this.changed();
  }

  clear(): void {
    if (!this.line) return;
    this.removeLine();
    this.changed();
  }

  dispose(): void {
    this.removeLine();
    this.material.dispose();
  }

  private removeLine(): void {
    if (!this.line) return;
    this.parent.remove(this.line);
    this.line.geometry.dispose();
    this.line = undefined;
  }
}
