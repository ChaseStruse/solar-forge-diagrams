import type { Camera, Group } from 'three';
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';

interface Entry {
  object: Object3D;
  x: number;
  y: number;
  width: number;
}
interface Page {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  entries: Entry[];
  x: number;
  y: number;
  rowHeight: number;
  batch?: InstancedMesh;
}
const SIZE = 1024;
const HEIGHT = 44;

/** Shared text atlases with one instanced draw per page, including PNG exports. */
export class LabelAtlas {
  private readonly pages: Page[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly up = new Vector3();

  public create(
    text: string,
    zoom: number,
    kind: 'node' | 'edge' = 'node',
  ): Object3D {
    let page = this.pages[this.pages.length - 1] ?? this.page();
    const width = Math.min(
      480,
      Math.ceil(page.context.measureText(text).width) + 20,
    );
    if (page.x + width > SIZE) {
      page.x = 0;
      page.y += page.rowHeight;
      page.rowHeight = 0;
    }
    if (page.y + HEIGHT > SIZE) page = this.page();
    const { x, y, context } = page;
    if (kind === 'edge') {
      context.fillStyle = '#1c252c';
      context.fillRect(x + 2, y + 4, width - 4, HEIGHT - 8);
      context.fillStyle = '#f5eee1';
    }
    context.strokeText(text, x + width / 2, y + HEIGHT / 2, width - 16);
    context.fillText(text, x + width / 2, y + HEIGHT / 2, width - 16);
    const object = new Object3D();
    object.userData.screenOffsetY = kind === 'edge' ? 20 : 0;
    object.userData.labelWidth = width;
    object.userData.labelHeight = HEIGHT;
    object.scale.set((width * 0.5) / zoom, (HEIGHT * 0.5) / zoom, 1);
    page.entries.push({ object, x, y, width });
    page.x += width + 4;
    page.rowHeight = Math.max(page.rowHeight, HEIGHT + 4);
    return object;
  }
  private page(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Text canvas unavailable');
    context.font = '600 28px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f5eee1';
    context.strokeStyle = '#182027';
    context.lineWidth = 2;
    context.lineJoin = 'round';
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    const page: Page = {
      canvas,
      context,
      texture,
      entries: [],
      x: 0,
      y: 0,
      rowHeight: 0,
    };
    this.pages.push(page);
    return page;
  }
  public finish(root: Group): void {
    for (const page of this.pages) {
      page.texture.needsUpdate = true;
      const geometry = new PlaneGeometry(1, 1);
      const regions = new Float32Array(page.entries.length * 4);
      for (const [index, entry] of page.entries.entries())
        regions.set(
          [
            entry.x / SIZE,
            1 - (entry.y + HEIGHT) / SIZE,
            entry.width / SIZE,
            HEIGHT / SIZE,
          ],
          index * 4,
        );
      geometry.setAttribute(
        'atlasRect',
        new InstancedBufferAttribute(regions, 4),
      );
      const material = new MeshBasicMaterial({
        map: page.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute vec4 atlasRect;',
          )
          .replace(
            '#include <uv_vertex>',
            '#include <uv_vertex>\nvMapUv = atlasRect.xy + vMapUv * atlasRect.zw;',
          );
      };
      material.customProgramCacheKey = () => 'solar-forge-atlas-v1';
      const batch = new InstancedMesh(geometry, material, page.entries.length);
      batch.instanceMatrix.setUsage(DynamicDrawUsage);
      batch.frustumCulled = false;
      batch.renderOrder = 10;
      page.batch = batch;
      root.add(batch);
    }
  }
  public sync(camera: Camera, zoom: number): void {
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const page of this.pages) {
      const batch = page.batch;
      if (!batch) continue;
      for (const [index, entry] of page.entries.entries()) {
        this.position.setFromMatrixPosition(entry.object.matrixWorld);
        const offset: unknown = entry.object.userData.screenOffsetY;
        if (typeof offset === 'number')
          this.position.addScaledVector(this.up, offset / zoom);
        this.matrix.compose(
          this.position,
          camera.quaternion,
          entry.object.scale,
        );
        batch.setMatrixAt(index, this.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
    }
  }
  public dispose(): void {
    for (const page of this.pages) {
      if (page.batch) {
        page.batch.geometry.dispose();
        if (!Array.isArray(page.batch.material)) page.batch.material.dispose();
      }
      page.texture.dispose();
      page.canvas.width = 0;
      page.canvas.height = 0;
    }
    this.pages.length = 0;
  }
}
