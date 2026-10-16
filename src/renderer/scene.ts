import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
} from '../domain/document';
import { worldPosition } from '../domain/document';
import { LabelAtlas } from './labels';

export type ViewMode = 'isometric' | 'top';
interface Tile {
  node: DiagramNode;
  group: Group;
  material: MeshLambertMaterial;
  label: Sprite;
}
export class DiagramScene {
  private readonly scene = new Scene();
  private readonly labels = new LabelAtlas();
  private readonly camera = new OrthographicCamera(
    -700,
    700,
    500,
    -500,
    0.1,
    20000,
  );
  private readonly renderer = new WebGLRenderer({ antialias: true });
  private readonly content = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly edgeMaterial = new LineBasicMaterial({ color: '#e8b56b' });
  private readonly tiles = new Map<string, Tile>();
  private readonly edges = new Map<string, Line>();
  private readonly edgeLabels = new Map<string, Sprite>();
  private readonly nodeIndex = new Map<string, DiagramNode>();
  private readonly edgeIndex = new Map<string, DiagramEdge>();
  private readonly incident = new Map<string, Set<string>>();
  private readonly ray = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly point = new Vector3();
  private readonly target = new Vector3();
  private readonly observer: ResizeObserver;
  private frame = 0;
  private width = 1;
  private height = 1;
  private mode: ViewMode = 'isometric';
  private drag:
    | { id: string; x: number; z: number; startX: number; startZ: number }
    | undefined;
  private pan: { x: number; z: number } | undefined;
  private selected: string | undefined;
  private disposed = false;
  public onSelect: (node: DiagramNode | undefined) => void = () => {};
  public onMove: (
    id: string,
    from: { x: number; z: number },
    to: { x: number; z: number },
  ) => void = () => {};
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
    this.renderer.setClearColor('#151b20');
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Architecture diagram canvas',
    );
    this.host.append(this.renderer.domElement);
    this.scene.add(this.content, new AmbientLight('#ffffff', 2));
    const light = new DirectionalLight('#ffe5bf', 3);
    light.position.set(-200, 500, 300);
    this.scene.add(light);
    const grid = new GridHelper(10000, 200, '#3b4247', '#242d34');
    grid.position.y = -8;
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
    this.content.traverse((object) => {
      if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
      if (
        object instanceof Mesh &&
        object.material instanceof MeshLambertMaterial
      )
        object.material.dispose();
      if (object instanceof Line) object.geometry.dispose();
    });
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
    for (const node of document.nodes) {
      this.nodeIndex.set(node.id, node);
      const group = new Group();
      const material = new MeshLambertMaterial({ color: node.color });
      const mesh = new Mesh(this.geometry, material);
      mesh.scale.set(node.width, node.kind === 'group' ? 8 : 24, node.depth);
      mesh.userData.nodeId = node.id;
      group.add(mesh);
      const label = this.labels.create(node.label, this.camera.zoom);
      label.position.set(
        0,
        node.kind === 'group' ? 13 : 37,
        node.kind === 'group' ? -node.depth / 2 + 25 : 0,
      );
      group.add(label);
      this.content.add(group);
      this.tiles.set(node.id, { node, group, material, label });
    }
    for (const edge of document.edges) {
      this.edgeIndex.set(edge.id, edge);
      const line = new Line(new BufferGeometry(), this.edgeMaterial);
      this.content.add(line);
      this.edges.set(edge.id, line);
      if (edge.label) {
        const label = this.labels.create(edge.label, this.camera.zoom);
        this.content.add(label);
        this.edgeLabels.set(edge.id, label);
      }
      for (const id of [edge.source, edge.target]) {
        const ids = this.incident.get(id) ?? new Set<string>();
        ids.add(edge.id);
        this.incident.set(id, ids);
      }
    }
    this.labels.finish();
    this.updatePositions();
    this.invalidate();
    this.onSelect(undefined);
  }
  private updatePositions(): void {
    for (const tile of this.tiles.values()) {
      const p = worldPosition(tile.node, this.nodeIndex);
      tile.group.position.set(p.x, p.level * 16, p.z);
    }
    for (const id of this.edges.keys()) this.updateEdge(id);
  }
  private updateEdge(id: string): void {
    const edge = this.edgeIndex.get(id);
    const line = this.edges.get(id);
    if (!edge || !line) return;
    const source = this.tiles.get(edge.source);
    const target = this.tiles.get(edge.target);
    if (!source || !target) return;
    const a = source.group.position;
    const b = target.group.position;
    const y = Math.max(a.y, b.y) + 14;
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    const direction = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.z - a.z);
    const ax = a.x + (horizontal ? (direction * source.node.width) / 2 : 0);
    const az = a.z + (horizontal ? 0 : (direction * source.node.depth) / 2);
    const bx = b.x - (horizontal ? (direction * target.node.width) / 2 : 0);
    const bz = b.z - (horizontal ? 0 : (direction * target.node.depth) / 2);
    line.geometry.dispose();
    line.geometry = new BufferGeometry().setFromPoints([
      new Vector3(ax, y, az),
      new Vector3(
        horizontal ? (ax + bx) / 2 : ax,
        y,
        horizontal ? az : (az + bz) / 2,
      ),
      new Vector3(
        horizontal ? (ax + bx) / 2 : bx,
        y,
        horizontal ? bz : (az + bz) / 2,
      ),
      new Vector3(bx, y, bz),
    ]);
    this.edgeLabels.get(id)?.position.set((ax + bx) / 2, y + 20, (az + bz) / 2);
  }
  private scaleLabels(): void {
    const scale = 0.5 / this.camera.zoom;
    const apply = (label: Sprite): void => {
      const width: unknown = label.userData.labelWidth;
      const height: unknown = label.userData.labelHeight;
      if (typeof width === 'number' && typeof height === 'number')
        label.scale.set(width * scale, height * scale, 1);
    };
    for (const tile of this.tiles.values()) apply(tile.label);
    for (const label of this.edgeLabels.values()) apply(label);
  }

  public setView(mode: ViewMode): void {
    this.mode = mode;
    this.camera.up.set(0, 0, -1);
    this.camera.position
      .copy(this.target)
      .add(
        mode === 'top'
          ? new Vector3(0, 2000, 0)
          : new Vector3(1200, 1400, 1200),
      );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.scaleLabels();
    this.invalidate();
  }
  public fit(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const tile of this.tiles.values()) {
      minX = Math.min(minX, tile.group.position.x - tile.node.width / 2);
      maxX = Math.max(maxX, tile.group.position.x + tile.node.width / 2);
      minZ = Math.min(minZ, tile.group.position.z - tile.node.depth / 2);
      maxZ = Math.max(maxZ, tile.group.position.z + tile.node.depth / 2);
    }
    if (!Number.isFinite(minX)) return;
    this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.setView(this.mode);
    let extent = 0;
    const corner = new Vector3();
    for (const tile of this.tiles.values()) {
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          corner
            .set(
              tile.group.position.x + (x * tile.node.width) / 2,
              tile.group.position.y + 40,
              tile.group.position.z + (z * tile.node.depth) / 2,
            )
            .project(this.camera);
          extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
        }
    }
    this.camera.zoom = Math.min(3, 0.82 / Math.max(extent, 0.01));
    this.camera.updateProjectionMatrix();
    this.scaleLabels();
    this.invalidate();
  }

  private resize(): void {
    this.width = Math.max(this.host.clientWidth, 1);
    this.height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(this.width, this.height);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
    this.invalidate();
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
    this.renderer.domElement.setPointerCapture(event.pointerId);
    if (event.button === 1 || event.button === 2 || event.altKey) {
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
    if (tile.node.kind === 'group') this.updatePositions();
    else {
      const position = worldPosition(tile.node, this.nodeIndex);
      tile.group.position.set(position.x, position.level * 16, position.z);
      for (const id of this.incident.get(tile.node.id) ?? [])
        this.updateEdge(id);
    }
    this.invalidate();
  };
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
    this.renderer.render(this.scene, this.camera);
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.frames++;
    this.metrics.lastRenderMs = performance.now() - start;
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
    this.edgeMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
