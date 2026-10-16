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
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { serviceImages } from '../catalog/images';
import { serviceGlyph } from '../catalog/services';

type LabelKind = 'node' | 'edge' | 'icon' | 'group';
interface Entry {
  object: Object3D;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: LabelKind;
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

/** Batched screen-facing captions and service glyphs; no DOM overlay to lose in exports. */
export class LabelAtlas {
  private readonly pages: Page[] = [];
  private readonly regions = new Map<
    string,
    {
      page: Page;
      x: number;
      y: number;
      width: number;
      height: number;
      kind: LabelKind;
    }
  >();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly depth = new Vector3();
  private readonly scale = new Vector3();
  private readonly up = new Vector3();
  private readonly right = new Vector3();

  public create(
    text: string,
    _zoom: number,
    kind: LabelKind = 'node',
  ): Object3D {
    if (kind === 'icon' && !serviceImages.has(text)) text = serviceGlyph(text);
    const key = `${kind}:${text}`;
    const cached = this.regions.get(key);
    if (cached) {
      const object = new Object3D();
      cached.page.entries.push({
        object,
        x: cached.x,
        y: cached.y,
        width: cached.width,
        height: cached.height,
        kind,
      });
      return object;
    }
    let page = this.pages[this.pages.length - 1] ?? this.page();
    const font =
      kind === 'icon'
        ? '500 64px system-ui'
        : kind === 'group'
          ? '500 24px system-ui'
          : kind === 'edge'
            ? '500 26px system-ui'
            : '600 34px system-ui';
    page.context.font = font;
    const height = kind === 'icon' ? 92 : 56;
    const width =
      kind === 'icon'
        ? 92
        : Math.min(520, Math.ceil(page.context.measureText(text).width) + 30);
    if (page.x + width > SIZE) {
      page.x = 0;
      page.y += page.rowHeight;
      page.rowHeight = 0;
    }
    if (page.y + height > SIZE) {
      page = this.page();
      page.context.font = font;
    }
    const { x, y, context } = page;
    if (kind === 'node' || kind === 'edge') {
      context.fillStyle = kind === 'node' ? '#14202b' : '#182431';
      context.fillRect(x + 2, y + 3, width - 4, height - 6);
      if (kind === 'node') {
        context.strokeStyle = '#41505e';
        context.lineWidth = 2;
        context.strokeRect(x + 2, y + 3, width - 4, height - 6);
      }
    }
    context.fillStyle =
      kind === 'group' ? '#93a6b6' : kind === 'icon' ? '#f6d7a5' : '#e9eef4';
    const image = kind === 'icon' ? serviceImages.get(text) : undefined;
    if (image) context.drawImage(image, x + 8, y + 8, width - 16, height - 16);
    else context.fillText(text, x + width / 2, y + height / 2, width - 20);
    const object = new Object3D();
    page.entries.push({ object, x, y, width, height, kind });
    this.regions.set(key, { page, x, y, width, height, kind });
    page.x += width + 4;
    page.rowHeight = Math.max(page.rowHeight, height + 4);
    return object;
  }
  private page(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Text canvas unavailable');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
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
            1 - (entry.y + entry.height) / SIZE,
            entry.width / SIZE,
            entry.height / SIZE,
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
        fog: false,
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
      material.customProgramCacheKey = () => 'solar-forge-atlas-v2';
      const batch = new InstancedMesh(geometry, material, page.entries.length);
      batch.instanceMatrix.setUsage(DynamicDrawUsage);
      batch.frustumCulled = false;
      batch.renderOrder = 10;
      page.batch = batch;
      root.add(batch);
    }
  }
  public sync(camera: Camera, viewportHeight: number): void {
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const projectionY = camera.projectionMatrix.elements[5] ?? 1;
    for (const page of this.pages) {
      const batch = page.batch;
      if (!batch) continue;
      for (let index = 0; index < page.entries.length; index++) {
        const entry = page.entries[index];
        if (!entry) continue;
        this.position.setFromMatrixPosition(entry.object.matrixWorld);
        const depth =
          camera instanceof PerspectiveCamera
            ? Math.max(
                1,
                -this.depth
                  .copy(this.position)
                  .applyMatrix4(camera.matrixWorldInverse).z,
              )
            : 1;
        const pixel = (2 * depth) / (viewportHeight * projectionY);
        if (entry.kind === 'edge') {
          const dx: unknown = entry.object.userData.offsetX;
          const dy: unknown = entry.object.userData.offsetY;
          this.position.addScaledVector(
            this.up,
            (typeof dy === 'number' ? dy : 22) * pixel,
          );
          if (typeof dx === 'number')
            this.position.addScaledVector(this.right, dx * pixel);
        }
        const width: unknown = entry.object.userData.nodeWidth;
        const tilePixels = typeof width === 'number' ? width / pixel : 120;
        const factor =
          entry.kind === 'icon'
            ? Math.min(58, Math.max(25, tilePixels * 0.28)) / 64
            : entry.kind === 'node'
              ? Math.min(24, Math.max(14, tilePixels * 0.13)) / 34
              : 0.5;
        this.scale.set(
          entry.width * factor * pixel,
          entry.height * factor * pixel,
          1,
        );
        this.matrix.compose(this.position, camera.quaternion, this.scale);
        batch.setMatrixAt(index, this.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
    }
  }
  public dispose(): void {
    for (const page of this.pages) {
      if (page.batch) {
        page.batch.dispose();
        page.batch.geometry.dispose();
        if (!Array.isArray(page.batch.material)) page.batch.material.dispose();
      }
      page.texture.dispose();
      page.canvas.width = 0;
      page.canvas.height = 0;
    }
    this.pages.length = 0;
    this.regions.clear();
  }
}
