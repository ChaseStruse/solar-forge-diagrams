import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  FogExp2,
  GridHelper,
  Group,
  type InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { serviceGlyph } from '../catalog/services';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
} from '../domain/document';
import { worldPosition } from '../domain/document';
import { createBackdrop } from './backdrop';
import { LabelAtlas } from './labels';
import { TileDetails } from './tile-details';
import { BoardView, type ViewMode } from './view';

export type { ViewMode } from './view';

interface Tile {
  index: number;
  node: DiagramNode;
  group: Group;
  material: MeshLambertMaterial;
  label: Object3D;
}
export class DiagramScene {
  private readonly scene = new Scene();
  private readonly backdrop = createBackdrop();
  private readonly labels = new LabelAtlas();
  private readonly view = new BoardView();
  private get camera() {
    return this.view.camera;
  }
  private get target() {
    return this.view.target;
  }
  private readonly renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  private readonly content = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly tileOutline = new EdgesGeometry(this.geometry);
  private details: TileDetails | undefined;
  private readonly edgeMaterial = new LineMaterial({
    color: '#ffe1a2',
    linewidth: 1.6,
    transparent: true,
    depthWrite: false,
  });
  private readonly haloMaterial = new LineMaterial({
    color: '#ffae42',
    linewidth: 8,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  private edgeGeometry: LineSegmentsGeometry | undefined;
  private edgeBuffer: InterleavedBuffer | undefined;
  private readonly tiles = new Map<string, Tile>();
  private readonly edges = new Map<string, number>();
  private edgePositions = new BufferAttribute(new Float32Array(), 3);
  private readonly edgeLabels = new Map<string, Object3D>();
  private readonly nodeIndex = new Map<string, DiagramNode>();
  private readonly edgeIndex = new Map<string, DiagramEdge>();
  private readonly incident = new Map<string, Set<string>>();
  private readonly ray = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly point = new Vector3();
  private readonly observer: ResizeObserver;
  private frame = 0;
  private width = 1;
  private height = 1;
  private mode: ViewMode = 'isometric';
  private tool: 'select' | 'pan' = 'select';
  private drag:
    | { id: string; x: number; z: number; startX: number; startZ: number }
    | undefined;
  private pan: { x: number; z: number } | undefined;
  private selected: string | undefined;
  private disposed = false;
  private fitted = false;
  public onSelect: (node: DiagramNode | undefined) => void = () => {};
  public onMove: (
    id: string,
    from: { x: number; z: number },
    to: { x: number; z: number },
  ) => void = () => {};
  public onZoom: (percent: number) => void = () => {};
  public onError: (message: string) => void = () => {};
  public readonly metrics = {
    frames: 0,
    lastRenderMs: 0,
    textures: 0,
    drawCalls: 0,
  };

  constructor(
    private readonly host: HTMLElement,
    document: DiagramDocument,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#0b111a', 0);
    this.scene.background = this.backdrop;
    this.scene.fog = new FogExp2('#0b111a', 0.00012);
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Architecture diagram canvas',
    );
    this.host.append(this.renderer.domElement);
    this.scene.add(this.content, new AmbientLight('#c9def1', 2));
    const light = new DirectionalLight('#ffe5bf', 2);
    light.position.set(-200, 500, 300);
    this.scene.add(light);
    const grid = new GridHelper(16000, 320, '#62503a', '#253543');
    grid.position.y = -12;
    if (!Array.isArray(grid.material)) {
      grid.material.transparent = true;
      grid.material.opacity = 0.22;
    }
    this.scene.add(grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.down);
    this.renderer.domElement.addEventListener('pointermove', this.move);
    this.renderer.domElement.addEventListener('pointerup', this.up);
    this.renderer.domElement.addEventListener('pointercancel', this.cancel);
    this.renderer.domElement.addEventListener('wheel', this.wheel, {
      passive: false,
    });
    this.renderer.domElement.addEventListener('contextmenu', this.context);
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.contextLost,
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.contextRestored,
    );
    this.load(document);
    this.resize();
    this.setView('isometric');
  }
  private releaseContent(): void {
    for (const tile of this.tiles.values()) tile.material.dispose();
    this.details?.dispose();
    this.details = undefined;
    this.edgeGeometry?.dispose();
    this.edgeGeometry = undefined;
    this.edgeBuffer = undefined;
    this.labels.dispose();
    this.content.clear();
    this.tiles.clear();
    this.edges.clear();
    this.edgeLabels.clear();
    this.incident.clear();
    this.nodeIndex.clear();
    this.edgeIndex.clear();
  }
  public load(document: DiagramDocument): void {
    this.releaseContent();
    this.selected = undefined;
    this.details = new TileDetails(
      document.nodes.length,
      this.tileOutline.getAttribute('position'),
    );
    this.content.add(this.details.root);
    for (const [index, node] of document.nodes.entries()) {
      this.nodeIndex.set(node.id, node);
      const group = new Group();
      const material = new MeshLambertMaterial({
        color: node.kind === 'group' ? '#172c3a' : '#172b3a',
        transparent: node.kind === 'group',
        opacity: node.kind === 'group' ? 0.12 : 1,
        depthWrite: node.kind !== 'group',
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.scale.set(node.width, node.kind === 'group' ? 2 : 24, node.depth);
      mesh.userData.nodeId = node.id;
      group.add(mesh);
      if (node.kind === 'service') {
        const glyph = this.labels.create(
          serviceGlyph(node.label),
          this.camera.zoom,
          'icon',
        );
        glyph.position.y = 28;
        glyph.userData.nodeWidth = node.width;
        group.add(glyph);
      }
      const label = this.labels.create(
        node.label,
        this.camera.zoom,
        node.kind === 'group' ? 'group' : 'node',
      );
      label.userData.nodeWidth = node.width;
      label.position.set(
        node.kind === 'group'
          ? -node.width / 2 + Math.min(node.width / 2, 150)
          : 0,
        node.kind === 'group' ? 5 : 0,
        node.kind === 'group' ? -node.depth / 2 + 22 : node.depth / 2 + 43,
      );
      group.add(label);
      this.content.add(group);
      this.tiles.set(node.id, { index, node, group, material, label });
    }
    const positions = new Float32Array(document.edges.length * 30);
    this.edgePositions = new BufferAttribute(positions, 3);
    this.edgeGeometry = new LineSegmentsGeometry().setPositions(positions);
    const attribute = this.edgeGeometry.getAttribute('instanceStart');
    if (attribute instanceof InterleavedBufferAttribute) {
      this.edgeBuffer = attribute.data;
      this.edgeBuffer.setUsage(DynamicDrawUsage);
    }
    const halo = new LineSegments2(this.edgeGeometry, this.haloMaterial);
    halo.frustumCulled = false;
    const connections = new LineSegments2(this.edgeGeometry, this.edgeMaterial);
    connections.frustumCulled = false;
    this.content.add(halo, connections);
    for (const [index, edge] of document.edges.entries()) {
      this.edgeIndex.set(edge.id, edge);
      this.edges.set(edge.id, index);
      if (edge.label) {
        const label = this.labels.create(edge.label, this.camera.zoom, 'edge');
        this.content.add(label);
        this.edgeLabels.set(edge.id, label);
      }
      for (const id of [edge.source, edge.target]) {
        const ids = this.incident.get(id) ?? new Set<string>();
        ids.add(edge.id);
        this.incident.set(id, ids);
      }
    }
    this.labels.finish(this.content);
    this.updatePositions();
    this.invalidate();
    this.onSelect(undefined);
  }
  private updatePositions(): void {
    for (const tile of this.tiles.values()) {
      const p = worldPosition(tile.node, this.nodeIndex);
      tile.group.position.set(p.x, p.level * 4, p.z);
      this.details?.update(tile.index, tile.node, tile.group.position);
    }
    for (const id of this.edges.keys()) this.updateEdge(id);
  }
  private updateEdge(id: string): void {
    const edge = this.edgeIndex.get(id);
    const index = this.edges.get(id);
    if (!edge || index === undefined) return;
    const source = this.tiles.get(edge.source);
    const target = this.tiles.get(edge.target);
    if (!source || !target) return;
    const a = source.group.position;
    const b = target.group.position;
    const y = Math.max(a.y, b.y) + 8;
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    const direction = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.z - a.z);
    const ax = a.x + (horizontal ? (direction * source.node.width) / 2 : 0);
    const az = a.z + (horizontal ? 0 : (direction * source.node.depth) / 2);
    const bx = b.x - (horizontal ? (direction * target.node.width) / 2 : 0);
    const bz = b.z - (horizontal ? 0 : (direction * target.node.depth) / 2);
    const mx = horizontal ? (ax + bx) / 2 : ax;
    const mz = horizontal ? az : (az + bz) / 2;
    const nx = horizontal ? (ax + bx) / 2 : bx;
    const nz = horizontal ? bz : (az + bz) / 2;
    const offset = index * 10;
    this.edgePositions.setXYZ(offset, ax, y, az);
    this.edgePositions.setXYZ(offset + 1, mx, y, mz);
    this.edgePositions.setXYZ(offset + 2, mx, y, mz);
    this.edgePositions.setXYZ(offset + 3, nx, y, nz);
    this.edgePositions.setXYZ(offset + 4, nx, y, nz);
    this.edgePositions.setXYZ(offset + 5, bx, y, bz);
    const dx = horizontal ? direction : 0;
    const dz = horizontal ? 0 : direction;
    this.edgePositions.setXYZ(
      offset + 6,
      bx - dx * 8 + dz * 4,
      y,
      bz - dz * 8 - dx * 4,
    );
    this.edgePositions.setXYZ(offset + 7, bx, y, bz);
    this.edgePositions.setXYZ(
      offset + 8,
      bx - dx * 8 - dz * 4,
      y,
      bz - dz * 8 + dx * 4,
    );
    this.edgePositions.setXYZ(offset + 9, bx, y, bz);
    if (this.edgeBuffer) {
      this.edgeBuffer.addUpdateRange(index * 30, 30);
      this.edgeBuffer.needsUpdate = true;
    }
    const label = this.edgeLabels.get(id);
    if (label) {
      label.position.set((ax + bx) / 2, y + 8, (az + bz) / 2);
      label.userData.offsetX = horizontal ? 0 : 46;
      label.userData.offsetY = horizontal ? 22 : 0;
    }
  }
  public setView(mode: ViewMode): void {
    this.mode = mode;
    this.view.setMode(mode);
    this.onZoom(this.view.percent);
    this.invalidate();
  }
  public setDiagramVisible(visible: boolean): void {
    this.content.visible = visible;
    this.invalidate();
  }
  public insertionPoint(): { x: number; z: number } {
    return { x: this.target.x, z: this.target.z };
  }
  public setPanelVisible(visible: boolean): void {
    this.view.setPanelVisible(visible);
    this.fit();
  }
  public zoomBy(factor: number): void {
    this.fitted = false;
    this.view.zoomBy(factor);
    this.onZoom(this.view.percent);
    this.invalidate();
  }
  public setTool(tool: 'select' | 'pan'): void {
    this.tool = tool;
    this.renderer.domElement.style.cursor = tool === 'pan' ? 'grab' : 'default';
  }
  public finishInteraction(): void {
    this.up();
  }
  public fit(): void {
    this.fitted = true;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxY = 0;
    for (const tile of this.tiles.values()) {
      minX = Math.min(minX, tile.group.position.x - tile.node.width / 2);
      maxX = Math.max(maxX, tile.group.position.x + tile.node.width / 2);
      minZ = Math.min(minZ, tile.group.position.z - tile.node.depth / 2);
      maxZ = Math.max(maxZ, tile.group.position.z + tile.node.depth / 2 + 70);
      maxY = Math.max(maxY, tile.group.position.y + 45);
    }
    if (Number.isFinite(minX)) this.view.fit({ minX, maxX, minZ, maxZ, maxY });
    this.onZoom(this.view.percent);
    this.invalidate();
  }
  private resize(): void {
    this.width = Math.max(this.host.clientWidth, 1);
    this.height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(this.width, this.height);
    this.view.resize(this.width, this.height);
    if (this.fitted) this.fit();
    else this.invalidate();
  }

  private locate(event: PointerEvent | WheelEvent): Vector3 | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / this.width) * 2 - 1,
      (-(event.clientY - rect.top) / this.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.point) ?? undefined;
  }
  private down = (event: PointerEvent): void => {
    const point = this.locate(event);
    if (!point) return;
    if (event.isTrusted)
      this.renderer.domElement.setPointerCapture(event.pointerId);
    if (
      event.button === 1 ||
      event.button === 2 ||
      event.altKey ||
      this.tool === 'pan'
    ) {
      this.pan = { x: point.x, z: point.z };
      return;
    }
    const candidates = [...this.tiles.values()]
      .map((t) => t.group.children[0])
      .filter((item): item is Mesh => item instanceof Mesh);
    const hits = this.ray.intersectObjects(candidates, false);
    const hit =
      hits.find((h) => {
        const id: unknown = h.object.userData.nodeId;
        return (
          typeof id === 'string' && this.tiles.get(id)?.node.kind === 'service'
        );
      }) ?? hits[0];
    const id: unknown = hit?.object.userData.nodeId;
    this.select(typeof id === 'string' ? id : undefined);
    const node = this.selected
      ? this.tiles.get(this.selected)?.node
      : undefined;
    if (node)
      this.drag = {
        id: node.id,
        x: point.x,
        z: point.z,
        startX: node.x,
        startZ: node.z,
      };
  };
  private move = (event: PointerEvent): void => {
    const point = this.locate(event);
    if (!point) return;
    if (this.pan) {
      this.fitted = false;
      this.target.x += this.pan.x - point.x;
      this.target.z += this.pan.z - point.z;
      this.setView(this.mode);
      return;
    }
    if (!this.drag) return;
    const tile = this.tiles.get(this.drag.id);
    if (!tile) return;
    tile.node.x =
      Math.round((this.drag.startX + point.x - this.drag.x) / 10) * 10;
    tile.node.z =
      Math.round((this.drag.startZ + point.z - this.drag.z) / 10) * 10;
    this.refreshPosition(tile.node.id);
  };
  public refreshPosition(id: string): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    if (tile.node.kind === 'group') this.updatePositions();
    else {
      const position = worldPosition(tile.node, this.nodeIndex);
      tile.group.position.set(position.x, position.level * 4, position.z);
      this.details?.update(tile.index, tile.node, tile.group.position);
      for (const edgeId of this.incident.get(tile.node.id) ?? [])
        this.updateEdge(edgeId);
    }
    this.invalidate();
  }
  private up = (): void => {
    if (this.drag) {
      const node = this.tiles.get(this.drag.id)?.node;
      if (node && (node.x !== this.drag.startX || node.z !== this.drag.startZ))
        this.onMove(
          node.id,
          { x: this.drag.startX, z: this.drag.startZ },
          { x: node.x, z: node.z },
        );
    }
    this.drag = undefined;
    this.pan = undefined;
  };
  private cancel = (): void => {
    if (this.drag) {
      const node = this.tiles.get(this.drag.id)?.node;
      if (node) {
        node.x = this.drag.startX;
        node.z = this.drag.startZ;
        this.updatePositions();
        this.invalidate();
      }
    }
    this.drag = undefined;
    this.pan = undefined;
  };
  private wheel = (event: WheelEvent): void => {
    this.fitted = false;
    event.preventDefault();
    const before = this.locate(event)?.clone();
    this.camera.zoom = Math.min(
      4,
      Math.max(0.05, this.camera.zoom * Math.exp(-event.deltaY * 0.001)),
    );
    this.camera.updateProjectionMatrix();
    const after = this.locate(event);
    if (before && after) {
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
      this.setView(this.mode);
    }
    this.onZoom(this.view.percent);
    this.invalidate();
  };
  private context = (event: Event): void => event.preventDefault();
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.onError('Graphics context lost. Waiting for recovery…');
  };
  private contextRestored = (): void => {
    this.onError('Graphics context restored');
    this.invalidate();
  };
  public select(id: string | undefined): void {
    if (this.selected)
      this.tiles.get(this.selected)?.material.emissive.set('#000000');
    this.selected = id;
    if (id) this.tiles.get(id)?.material.emissive.set('#55300c');
    this.onSelect(id ? this.tiles.get(id)?.node : undefined);
    this.invalidate();
  }
  public refresh(): void {
    this.updatePositions();
    this.invalidate();
  }
  private invalidate(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }
  private render(): void {
    const start = performance.now();
    this.scene.updateMatrixWorld();
    this.labels.sync(this.camera, this.height);
    this.renderer.render(this.scene, this.camera);
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.frames++;
    this.metrics.lastRenderMs = performance.now() - start;
  }
  public gpuDetails(): { renderer: string; vendor: string } {
    const gl = this.renderer.getContext();
    const extension: {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    } | null = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(
      extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
    );
    const vendor: unknown = gl.getParameter(
      extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR,
    );
    return {
      renderer: typeof renderer === 'string' ? renderer : 'unknown',
      vendor: typeof vendor === 'string' ? vendor : 'unknown',
    };
  }
  /** Client-space anchor for contextual UI and portable interaction checks. */
  public nodeScreenPosition(id: string): { x: number; y: number } | undefined {
    const tile = this.tiles.get(id);
    if (!tile) return undefined;
    const point = tile.group.position.clone();
    point.y += tile.node.kind === 'group' ? 1 : 12;
    point.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) * this.width) / 2,
      y: rect.top + ((1 - point.y) * this.height) / 2,
    };
  }
  public png(): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('PNG encoding failed')),
        'image/png',
      ),
    );
  }
  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.releaseContent();
    this.scene.traverse((object) => {
      if (object instanceof GridHelper) {
        object.geometry.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((m) => {
            m.dispose();
          });
        else object.material.dispose();
      }
    });
    this.geometry.dispose();
    this.tileOutline.dispose();
    this.haloMaterial.dispose();
    this.edgeMaterial.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
