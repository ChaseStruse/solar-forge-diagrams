import type { Camera, Group } from 'three';
import {
  CanvasTexture,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import { serviceImages } from '../catalog/images';
import { serviceGlyph } from '../catalog/services';
import type { DiagramNode } from '../domain/document';
import { serviceCaption } from '../domain/text';
import type { ScenePalette } from '../themes';
import { overlay } from './antialias';

type LabelKind = 'node' | 'edge' | 'icon' | 'group';
/** Caption box and typography of a component; only `node` labels use it. */
export type CaptionBounds = Pick<
  DiagramNode,
  'width' | 'depth' | 'fontSize' | 'wrap'
>;
interface Spec {
  text: string;
  kind: LabelKind;
  bounds: CaptionBounds;
}
/**
 * One drawn label. `width` and `height` are layout units, which `sync` sizes
 * on screen; the atlas holds it `scale` times larger, in `pixelWidth` pixels.
 */
interface Region {
  page: Page;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
  /** Drawn smaller than wanted because it would not fit a page. */
  capped: boolean;
}
interface Entry {
  object: Object3D;
  key: string;
  kind: LabelKind;
}
interface Page {
  size: number;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  entries: Entry[];
  x: number;
  y: number;
  rowHeight: number;
  batch?: InstancedMesh;
}
const PAGE = 1024;
const MAX_PAGE = 2048;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
/** Raster scale for a wanted pixel density: half-octave steps, rounded up. */
export function rasterBucket(wanted: number, max = MAX_SCALE): number {
  const scale = 2 ** (Math.ceil(Math.log2(Math.max(1e-3, wanted)) * 2) / 2);
  return Math.min(max, Math.max(MIN_SCALE, scale));
}

/**
 * Batched screen-facing captions and service glyphs; no DOM overlay to lose in
 * exports. Each label is drawn at the pixel density it is shown at, so text
 * stays sharp when zoomed in without holding oversized textures zoomed out.
 */
export class LabelAtlas {
  constructor(public palette: ScenePalette) {}
  private pages: Page[] = [];
  private readonly specs = new Map<string, Spec>();
  private readonly regions = new Map<string, Region>();
  private entries: Entry[] = [];
  /** Last raster scale per label, kept across reloads so edits redraw once. */
  private readonly hints = new Map<string, number>();
  /** Densest on-screen use of each label in the last sync. */
  private readonly wanted = new Map<string, number>();
  private root: Group | undefined;
  /** Text advances by font and string; they survive reloads (system fonts). */
  private readonly widths = new Map<string, number>();
  private measure(
    context: CanvasRenderingContext2D,
    font: string,
    text: string,
  ): number {
    const key = `${font}\n${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      if (this.widths.size > 50_000) this.widths.clear();
      context.font = font;
      width = context.measureText(text).width;
      this.widths.set(key, width);
    }
    return width;
  }
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
    bounds: CaptionBounds = { width: 160, depth: 100 },
  ): Object3D {
    if (kind === 'icon' && !serviceImages.has(text)) text = serviceGlyph(text);
    const key =
      kind === 'node'
        ? `node:${text}:${bounds.width}:${bounds.depth}:${bounds.fontSize ?? ''}:${bounds.wrap ? 1 : 0}`
        : `${kind}:${text}`;
    if (!this.specs.has(key)) this.specs.set(key, { text, kind, bounds });
    const object = new Object3D();
    if (kind === 'node') {
      object.userData.captionResolution = captionResolution(bounds);
      object.userData.captionBounds = bounds;
    }
    this.entries.push({ object, key, kind });
    return object;
  }
  /** Draw every label and add one instanced batch per atlas page. */
  public finish(root: Group): void {
    this.root = root;
    if (this.hints.size > 50_000) this.hints.clear();
    for (const [key, spec] of this.specs)
      this.draw(key, spec, this.hints.get(key) ?? 1);
    for (const entry of this.entries)
      this.regions.get(entry.key)?.page.entries.push(entry);
    for (const page of this.pages) this.batch(page, root);
  }
  private draw(key: string, spec: Spec, wanted: number): void {
    const { text, kind, bounds } = spec;
    const family = this.palette.labelFont ?? 'system-ui';
    const probe = this.pages[0]?.context ?? measuringContext();
    const resolution = captionResolution(bounds);
    const font =
      kind === 'icon'
        ? `500 64px ${family}`
        : kind === 'group'
          ? `500 24px ${family}`
          : kind === 'edge'
            ? `500 26px ${family}`
            : `600 34px ${family}`;
    const caption =
      kind === 'node'
        ? serviceCaption(
            { label: text, ...bounds },
            (line, size) =>
              this.measure(
                probe,
                `600 ${size * resolution}px ${family}`,
                line,
              ) / resolution,
          )
        : undefined;
    const captionFont = caption
      ? `600 ${caption.size * resolution}px ${family}`
      : font;
    const padding = caption ? 8 * resolution : 15;
    const height = caption
      ? Math.ceil(
          (caption.lines.length * caption.size * 1.28 + 16) * resolution,
        )
      : kind === 'icon'
        ? 92
        : 56;
    const width = caption
      ? Math.ceil(
          Math.max(
            1,
            ...caption.lines.map((line) =>
              this.measure(probe, captionFont, line),
            ),
          ) +
            padding * 2,
        )
      : kind === 'icon'
        ? 92
        : Math.min(520, Math.ceil(this.measure(probe, captionFont, text)) + 30);
    // Never larger than the biggest page, never smaller than a few pixels.
    const scale = Math.max(
      Math.min(rasterBucket(wanted), (MAX_PAGE - 8) / Math.max(width, height)),
      Math.min(1, 4 / Math.min(width, height)),
    );
    const pixelWidth = Math.ceil(width * scale);
    const pixelHeight = Math.ceil(height * scale);
    const page = this.place(pixelWidth, pixelHeight);
    const { x, y, context } = page;
    context.setTransform(scale, 0, 0, scale, x, y);
    const palette = this.palette;
    if (kind === 'node' || kind === 'edge') {
      context.fillStyle =
        kind === 'node'
          ? palette.nodeLabel.background
          : palette.edgeLabel.background;
      context.beginPath();
      context.roundRect(2, 3, width - 4, height - 6, 8);
      context.fill();
      if (kind === 'node') {
        context.strokeStyle = palette.nodeLabel.border;
        context.lineWidth = 2;
        context.stroke();
      }
    }
    context.fillStyle =
      kind === 'group'
        ? palette.groupLabel
        : kind === 'icon'
          ? palette.glyph
          : kind === 'edge'
            ? palette.edgeLabel.text
            : palette.nodeLabel.text;
    context.font = captionFont;
    const image = kind === 'icon' ? serviceImages.get(text) : undefined;
    if (image) {
      if (palette.iconFilter) context.filter = palette.iconFilter;
      context.drawImage(image, 8, 8, width - 16, height - 16);
      context.filter = 'none';
    } else if (caption)
      for (const [index, line] of caption.lines.entries())
        context.fillText(
          line,
          width / 2,
          padding + (index + 0.5) * caption.size * resolution * 1.28,
        );
    else context.fillText(text, width / 2, height / 2, width - 20);
    context.setTransform(1, 0, 0, 1, 0, 0);
    this.regions.set(key, {
      page,
      x,
      y,
      width,
      height,
      pixelWidth,
      pixelHeight,
      scale,
      capped: scale < rasterBucket(wanted) - 1e-6,
    });
    this.hints.set(key, scale);
    page.x += pixelWidth + 4;
    page.rowHeight = Math.max(page.rowHeight, pixelHeight + 4);
  }
  /** The page with room for a label, starting a new row or page as needed. */
  private place(width: number, height: number): Page {
    let page = this.pages[this.pages.length - 1];
    if (page && page.x + width > page.size) {
      page.x = 0;
      page.y += page.rowHeight;
      page.rowHeight = 0;
    }
    if (!page || page.y + height > page.size || width > page.size)
      page = this.page(Math.max(width, height) + 8 > PAGE ? MAX_PAGE : PAGE);
    return page;
  }
  private page(size: number): Page {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Text canvas unavailable');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Upload the canvas as it is stored: premultiplied sRGB bytes in a plain
    // RGBA8 texture. An sRGB format makes browsers convert on the CPU, which
    // cost several times as much and stalled the frame after every zoom.
    const texture = new CanvasTexture(canvas);
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    const page: Page = {
      size,
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
  private batch(page: Page, root: Group): void {
    page.texture.needsUpdate = true;
    const geometry = new PlaneGeometry(1, 1);
    const rects = new Float32Array(page.entries.length * 4);
    for (const [index, entry] of page.entries.entries()) {
      const region = this.regions.get(entry.key);
      if (!region) continue;
      rects.set(
        [
          region.x / page.size,
          1 - (region.y + region.pixelHeight) / page.size,
          region.pixelWidth / page.size,
          region.pixelHeight / page.size,
        ],
        index * 4,
      );
    }
    geometry.setAttribute('atlasRect', new InstancedBufferAttribute(rects, 4));
    // Texels are already premultiplied and sRGB-encoded, the space the board
    // blends in, so they are blended as-is and not encoded a second time.
    const material = new MeshBasicMaterial({
      map: page.texture,
      transparent: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
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
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        '',
      );
    };
    material.customProgramCacheKey = () => 'solar-forge-atlas-v3';
    const batch = new InstancedMesh(geometry, material, page.entries.length);
    batch.instanceMatrix.setUsage(DynamicDrawUsage);
    batch.frustumCulled = false;
    batch.renderOrder = 10;
    page.batch = batch;
    root.add(overlay(batch));
  }
  /**
   * Place every label for the camera. `pixelRatio` is device pixels per CSS
   * pixel. Returns true when some label is drawn too soft (or far too large)
   * for how it now appears, so the caller can `redraw` once the view settles.
   */
  public sync(camera: Camera, viewportHeight: number, pixelRatio = 1): boolean {
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const projectionY = camera.projectionMatrix.elements[5] ?? 1;
    this.wanted.clear();
    for (const page of this.pages) {
      const batch = page.batch;
      if (!batch) continue;
      for (let index = 0; index < page.entries.length; index++) {
        const entry = page.entries[index];
        const region = entry && this.regions.get(entry.key);
        if (!entry || !region) continue;
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
        const nodeDepth: unknown = entry.object.userData.nodeDepth;
        const depthPixels =
          typeof nodeDepth === 'number' ? nodeDepth / pixel : 100;
        const captionBounds = entry.object.userData.captionBounds as
          | CaptionBounds
          | undefined;
        const resizing =
          captionBounds &&
          typeof width === 'number' &&
          typeof nodeDepth === 'number'
            ? Math.min(
                width / captionBounds.width,
                nodeDepth / captionBounds.depth,
              )
            : 1;
        // Screen pixels per layout unit.
        const factor =
          entry.kind === 'icon'
            ? Math.min(58, tilePixels * 0.28, depthPixels * 0.7) / 64
            : entry.kind === 'node'
              ? resizing /
                (Number(entry.object.userData.captionResolution) * pixel)
              : entry.kind === 'group'
                ? Math.min(0.5, (tilePixels * 0.9) / region.width)
                : 0.5;
        const wanted = factor * pixelRatio;
        if (wanted > (this.wanted.get(entry.key) ?? 0))
          this.wanted.set(entry.key, wanted);
        if (entry.kind === 'node' && entry.object.userData.captionBelow)
          this.position.addScaledVector(
            this.up,
            (-region.height * factor * pixel) / 2,
          );
        this.scale.set(
          region.width * factor * pixel,
          region.height * factor * pixel,
          1,
        );
        this.matrix.compose(this.position, camera.quaternion, this.scale);
        batch.setMatrixAt(index, this.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
    }
    for (const [key, wanted] of this.wanted) {
      const region = this.regions.get(key);
      if (!region) continue;
      const ideal = rasterBucket(wanted);
      // Hysteresis: redraw when soft, or when holding 2× more than needed.
      if (
        (ideal > region.scale + 1e-6 && !region.capped) ||
        ideal * 2 < region.scale - 1e-6
      )
        return true;
    }
    return false;
  }
  /**
   * Redraw every label at the density it was last shown at. Returns a
   * callback that frees the old pages; run it after the next frame.
   */
  public redraw(): () => void {
    const root = this.root;
    const old = this.pages;
    this.pages = [];
    this.regions.clear();
    for (const [key, wanted] of this.wanted)
      this.hints.set(key, rasterBucket(wanted));
    if (root) {
      for (const page of old) if (page.batch) root.remove(page.batch);
      this.finish(root);
    }
    return () => release(old);
  }
  /**
   * Start a fresh atlas now; the returned callback frees the old pages. The
   * caller runs it after the next frame so new pages reuse the compiled shader.
   */
  public retire(): () => void {
    const pages = this.pages;
    this.pages = [];
    this.entries = [];
    this.specs.clear();
    this.regions.clear();
    this.wanted.clear();
    this.root = undefined;
    return () => release(pages);
  }
  public dispose(): void {
    this.retire()();
  }
}
/** Layout units per world unit for a component caption. */
function captionResolution(bounds: CaptionBounds): number {
  return Math.min(2, 800 / Math.max(bounds.width, bounds.depth));
}
let measuring: CanvasRenderingContext2D | undefined;
function measuringContext(): CanvasRenderingContext2D {
  measuring ??= document.createElement('canvas').getContext('2d') ?? undefined;
  if (!measuring) throw new Error('Text canvas unavailable');
  return measuring;
}
function release(pages: readonly Page[]): void {
  for (const page of pages) {
    if (page.batch) {
      page.batch.removeFromParent();
      page.batch.dispose();
      page.batch.geometry.dispose();
      if (!Array.isArray(page.batch.material)) page.batch.material.dispose();
    }
    page.texture.dispose();
    page.canvas.width = 0;
    page.canvas.height = 0;
  }
}
