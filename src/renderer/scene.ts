import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  ExtrudeGeometry,
  FogExp2,
  GridHelper,
  Group,
  type InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { loadServiceImages } from '../catalog/images';
import { findService } from '../catalog/services';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  Port,
} from '../domain/document';
import { worldPosition } from '../domain/document';
import {
  nearestPort,
  type Point,
  portPosition,
  routeEdge,
  routeMidpoint,
} from '../domain/routing';
import { createBackdrop } from './backdrop';
import { LabelAtlas } from './labels';
import {
  nodesInSelectionRect,
  type ScreenPoint,
  selectionRect,
} from './selection';
import { TileBodies } from './tile-bodies';
import { TileDetails } from './tile-details';
import { BoardView, type ViewMode } from './view';

export type { ViewMode } from './view';

interface Box {
  x: number;
  z: number;
  width: number;
  depth: number;
}
export interface ResizeChange {
  id: string;
  from: Partial<Box>;
  to: Partial<Box>;
}
interface EdgePalette {
  edge: string;
  edgeHover: string;
  edgeSelected: string;
}
const isPort = (value: unknown): value is Port =>
  value === 'north' ||
  value === 'east' ||
  value === 'south' ||
  value === 'west';
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Both views keep +X screen-right and +Z screen-down, so cursors map directly. */
function resizeCursor(sx: number, sz: number, _mode: ViewMode): string {
  if (!sx) return 'ns-resize';
  if (!sz) return 'ew-resize';
  return sx * sz > 0 ? 'nwse-resize' : 'nesw-resize';
}

interface Tile {
  index: number;
  node: DiagramNode;
  group: Group;
  material: MeshLambertMaterial;
  label: Object3D;
}
export class DiagramScene {
  public readonly ready: Promise<void>;
  private document: DiagramDocument;
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
    alpha: false,
  });
  private readonly content = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly shapeGeometries = createFlowGeometries();
  private readonly tileOutline = new EdgesGeometry(this.geometry);
  private details: TileDetails | undefined;
  private bodies: TileBodies | undefined;
  private readonly edgeMaterial = new LineMaterial({
    color: '#ffffff',
    linewidth: 1.6,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  });
  private readonly haloMaterial = new LineMaterial({
    color: '#ffffff',
    linewidth: 8,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    vertexColors: true,
  });
  private edgeGeometry: LineSegmentsGeometry | undefined;
  private edgeBuffer: InterleavedBuffer | undefined;
  private readonly tiles = new Map<string, Tile>();
  private readonly scratchColor = new Color();
  private palette: EdgePalette = {
    edge: '#ffe1a2',
    edgeHover: '#fff4dc',
    edgeSelected: '#ff9d3c',
  };
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
  private tool: 'select' | 'pan' | 'connect' = 'select';
  public snapping = true;
  private readonly selectedIds = new Set<string>();
  private readonly portGeometry = new SphereGeometry(1, 12, 8);
  private readonly handleGeometry = new BoxGeometry(1, 1, 1);
  private readonly portMaterial = new MeshBasicMaterial({
    color: '#ffc778',
    depthTest: false,
  });
  private readonly handleMaterial = new MeshBasicMaterial({
    color: '#f4f7fb',
    depthTest: false,
  });
  /** Selection affordances: resize squares on the outline, connect dots outside it. */
  private readonly ports = new Group();
  private connectionStart: { id: string; port?: Port } | undefined;
  private readonly previewMaterial = new LineMaterial({
    color: '#ffc778',
    linewidth: 2,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    dashed: true,
    dashSize: 10,
    gapSize: 7,
  });
  private preview: LineSegments2 | undefined;
  private selectedEdge: string | undefined;
  private hoveredEdge: string | undefined;
  private edgeColors: Float32Array<ArrayBufferLike> = new Float32Array();
  private edgeColorBuffer: InterleavedBuffer | undefined;
  public onSelectEdge: (id: string | undefined) => void = () => {};
  public onConnect: (
    source: string,
    sourcePort: Port | undefined,
    target: string,
    targetPort: Port | undefined,
  ) => void = () => {};
  public onMoves: (
    moves: {
      id: string;
      from: { x: number; z: number };
      to: { x: number; z: number };
    }[],
  ) => void = () => {};
  public onContextMenu: (x: number, y: number) => void = () => {};
  /** One completed resize; children shift so they stay put in world space. */
  public onResize: (changes: ResizeChange[]) => void = () => {};
  private resizing:
    | {
        id: string;
        sx: number;
        sz: number;
        start: Point;
        from: Box;
        children: { node: DiagramNode; x: number; z: number }[];
      }
    | undefined;
  private dragOrigins: { node: DiagramNode; x: number; z: number }[] = [];
  private drag:
    | { id: string; x: number; z: number; startX: number; startZ: number }
    | undefined;
  private pan: { x: number; z: number } | undefined;
  private activePointer: number | undefined;
  private readonly selectionBox = document.createElement('div');
  private marquee:
    | {
        start: ScreenPoint;
        end: ScreenPoint;
        initial: readonly string[];
        additive: boolean;
        clickId: string | undefined;
        active: boolean;
      }
    | undefined;
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
    this.document = document;
    this.ready = loadServiceImages()
      .then(() => {
        if (this.disposed) return;
        const ids = this.selection;
        this.load(this.document);
        this.selectMany(ids);
      })
      .catch((error) => this.onError(String(error)));
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#0b111a', 0);
    this.scene.background = this.backdrop;
    this.scene.fog = new FogExp2('#0b111a', 0.00012);
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Architecture diagram canvas',
    );
    this.host.append(this.renderer.domElement);
    this.selectionBox.className = 'selection-box';
    this.selectionBox.hidden = true;
    this.selectionBox.setAttribute('aria-hidden', 'true');
    this.host.append(this.selectionBox);
    this.scene.add(this.ports);
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
    this.renderer.domElement.addEventListener(
      'lostpointercapture',
      this.lostCapture,
    );
    this.renderer.domElement.addEventListener(
      'mousedown',
      this.preventNativeDrag,
    );
    this.renderer.domElement.addEventListener(
      'dragstart',
      this.preventNativeDrag,
    );
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
    this.bodies?.dispose();
    this.bodies = undefined;
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
    // History may already have changed parent IDs. Do not refresh the old scene
    // against that edited graph while replacing its node index.
    this.releasePointer();
    this.marquee = undefined;
    this.selectionBox.hidden = true;
    this.drag = undefined;
    this.dragOrigins = [];
    this.resizing = undefined;
    this.pan = undefined;
    this.connectionStart = undefined;
    this.clearPreview();
    this.hoveredEdge = undefined;
    if (
      this.selectedEdge &&
      !document.edges.some((e) => e.id === this.selectedEdge)
    )
      this.selectedEdge = undefined;
    this.document = document;
    this.releaseContent();
    this.selected = undefined;
    this.selectedIds.clear();
    this.ports.clear();
    this.bodies = new TileBodies(
      document.nodes,
      this.geometry,
      this.shapeGeometries,
    );
    this.content.add(this.bodies.root);
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
      const mesh = new Mesh(
        node.shape ? this.shapeGeometries[node.shape] : this.geometry,
        material,
      );
      mesh.scale.set(node.width, node.kind === 'group' ? 2 : 24, node.depth);
      mesh.userData.nodeId = node.id;
      mesh.visible = false;
      group.add(mesh);
      if (node.kind === 'service' && !node.shape) {
        const glyph = this.labels.create(
          findService(node.serviceId ?? node.label)?.id ?? node.label,
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
        node.kind === 'group' ? 5 : node.shape ? 26 : 0,
        node.kind === 'group'
          ? -node.depth / 2 + 22
          : node.shape
            ? 0
            : node.depth / 2 + 43,
      );
      group.add(label);
      this.content.add(group);
      this.tiles.set(node.id, { index, node, group, material, label });
    }
    const positions = new Float32Array(document.edges.length * 42);
    this.edgePositions = new BufferAttribute(positions, 3);
    this.edgeColors = new Float32Array(document.edges.length * 42);
    this.edgeGeometry = new LineSegmentsGeometry()
      .setPositions(positions)
      .setColors(this.edgeColors);
    const attribute = this.edgeGeometry.getAttribute('instanceStart');
    if (attribute instanceof InterleavedBufferAttribute) {
      this.edgeBuffer = attribute.data;
      this.edgeBuffer.setUsage(DynamicDrawUsage);
    }
    const colors = this.edgeGeometry.getAttribute('instanceColorStart');
    if (colors instanceof InterleavedBufferAttribute) {
      this.edgeColorBuffer = colors.data;
      this.edgeColorBuffer.setUsage(DynamicDrawUsage);
      // setColors copies; paint into the live buffer from now on.
      this.edgeColors = colors.data.array as Float32Array;
    }
    const halo = new LineSegments2(this.edgeGeometry, this.haloMaterial);
    halo.frustumCulled = false;
    const connections = new LineSegments2(this.edgeGeometry, this.edgeMaterial);
    connections.frustumCulled = false;
    this.content.add(halo, connections);
    for (const [index, edge] of document.edges.entries()) {
      this.edgeIndex.set(edge.id, edge);
      this.edges.set(edge.id, index);
      this.paintEdge(edge.id);
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
      this.bodies?.update(
        tile.node,
        tile.group.position,
        this.selectedIds.has(tile.node.id),
      );
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
    const { points, targetPort } = routeEdge(edge, this.nodeIndex);
    const y = Math.max(source.group.position.y, target.group.position.y) + 8;
    const offset = index * 14;
    for (let segment = 0; segment < 5; segment++) {
      const a = points[segment],
        b = points[segment + 1];
      if (!a || !b) continue;
      this.edgePositions.setXYZ(offset + segment * 2, a.x, y, a.z);
      this.edgePositions.setXYZ(offset + segment * 2 + 1, b.x, y, b.z);
    }
    const start = points[0],
      end = points[points.length - 1];
    if (!start || !end) return;
    const dx = targetPort === 'west' ? 1 : targetPort === 'east' ? -1 : 0;
    const dz = targetPort === 'north' ? 1 : targetPort === 'south' ? -1 : 0;
    this.edgePositions.setXYZ(
      offset + 10,
      end.x - dx * 8 + dz * 4,
      y,
      end.z - dz * 8 - dx * 4,
    );
    this.edgePositions.setXYZ(offset + 11, end.x, y, end.z);
    this.edgePositions.setXYZ(
      offset + 12,
      end.x - dx * 8 - dz * 4,
      y,
      end.z - dz * 8 + dx * 4,
    );
    this.edgePositions.setXYZ(offset + 13, end.x, y, end.z);
    const { point: middle, horizontal } = routeMidpoint(points);
    if (this.edgeBuffer) {
      this.edgeBuffer.addUpdateRange(index * 42, 42);
      this.edgeBuffer.needsUpdate = true;
    }
    const label = this.edgeLabels.get(id);
    if (label) {
      label.position.set(middle.x, y + 8, middle.z);
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
  public setQuality(ratio: number): void {
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, Math.min(2, Math.max(1, ratio))),
    );
    this.resize();
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
  public setTool(tool: 'select' | 'pan' | 'connect'): void {
    this.cancelInteraction();
    this.tool = tool;
    this.renderer.domElement.style.cursor =
      tool === 'pan' ? 'grab' : tool === 'connect' ? 'crosshair' : 'default';
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
    if (this.activePointer !== undefined || event.button > 2) return;
    // Claim canvas gestures before WebKit/GTK can interpret an unhandled drag.
    event.preventDefault();
    const point = this.locate(event);
    if (!point) return;
    this.activePointer = event.pointerId;
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
    const handle = this.handleAt();
    if (handle) {
      const id: unknown = handle.userData.nodeId;
      const node =
        typeof id === 'string' ? this.tiles.get(id)?.node : undefined;
      const resize: unknown = handle.userData.resize;
      if (node && Array.isArray(resize)) {
        const [sx, sz] = resize as [number, number];
        this.resizing = {
          id: node.id,
          sx,
          sz,
          start: { x: point.x, z: point.z },
          from: { x: node.x, z: node.z, width: node.width, depth: node.depth },
          children: [...this.tiles.values()]
            .filter((tile) => tile.node.parentId === node.id)
            .map(({ node: child }) => ({
              node: child,
              x: child.x,
              z: child.z,
            })),
        };
        return;
      }
      const port: unknown = handle.userData.port;
      if (node && isPort(port)) {
        this.connectionStart = { id: node.id, port };
        this.showPreview(point);
        return;
      }
    }
    if (this.tool === 'select') {
      const edge = this.edgeAt(event);
      if (edge) {
        this.selectEdge(edge);
        this.releasePointer();
        return;
      }
    }
    const id = this.nodeAt();
    if (this.tool === 'connect') {
      if (id) {
        if (this.connectionStart) {
          this.onConnect(this.connectionStart.id, undefined, id, undefined);
          this.connectionStart = undefined;
          this.clearPreview();
        } else {
          this.select(id);
          this.connectionStart = { id };
          this.showPreview(point);
        }
      }
      return;
    }
    const hitNode = id ? this.tiles.get(id)?.node : undefined;
    if (!id || (hitNode?.kind === 'group' && !this.selectedIds.has(id))) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const start = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      this.marquee = {
        start,
        end: start,
        initial: this.selection,
        additive: event.shiftKey,
        clickId: id,
        active: false,
      };
      return;
    }
    if (event.shiftKey || !this.selectedIds.has(id))
      this.select(id, event.shiftKey);
    else this.selected = id;
    const node = this.selected
      ? this.tiles.get(this.selected)?.node
      : undefined;
    if (node) {
      this.dragOrigins = [...this.tiles.values()]
        .filter((tile) => {
          if (!this.selectedIds.has(tile.node.id)) return false;
          let parent = tile.node.parentId;
          while (parent) {
            if (this.selectedIds.has(parent)) return false;
            parent = this.nodeIndex.get(parent)?.parentId;
          }
          return true;
        })
        .map(({ node }) => ({ node, x: node.x, z: node.z }));
      this.drag = {
        id: node.id,
        x: point.x,
        z: point.z,
        startX: node.x,
        startZ: node.z,
      };
    }
  };
  /** Topmost node under the last located ray; services win over boundaries. */
  private nodeAt(): string | undefined {
    const candidates = [...this.tiles.values()]
      .map((t) => t.group.children[0])
      .filter((item): item is Mesh => item instanceof Mesh);
    const hits = this.ray.intersectObjects(candidates, false);
    const hit =
      hits.find((h) => {
        const id: unknown = h.object.userData.nodeId;
        return (
          typeof id === 'string' && this.tiles.get(id)?.node.kind !== 'group'
        );
      }) ?? hits[0];
    const id: unknown = hit?.object.userData.nodeId;
    return typeof id === 'string' ? id : undefined;
  }
  private handleAt(): Object3D | undefined {
    return this.ray.intersectObjects(this.ports.children, false)[0]?.object;
  }
  /** Nearest connection within a few pixels of the pointer, in screen space. */
  private edgeAt(event: {
    clientX: number;
    clientY: number;
  }): string | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const a = new Vector3();
    const b = new Vector3();
    let best: string | undefined;
    let bestDistance = 7;
    for (const [id, index] of this.edges) {
      for (let segment = 0; segment < 5; segment++) {
        const offset = index * 14 + segment * 2;
        a.fromBufferAttribute(this.edgePositions, offset).project(this.camera);
        b.fromBufferAttribute(this.edgePositions, offset + 1).project(
          this.camera,
        );
        const ax = ((a.x + 1) * this.width) / 2,
          ay = ((1 - a.y) * this.height) / 2;
        const bx = ((b.x + 1) * this.width) / 2,
          by = ((1 - b.y) * this.height) / 2;
        const distance = segmentDistance(px, py, ax, ay, bx, by);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = id;
        }
      }
    }
    return best;
  }
  private hover(event: PointerEvent): void {
    if (!this.locate(event)) return;
    const handle = this.handleAt();
    const resize: unknown = handle?.userData.resize;
    let cursor =
      this.tool === 'pan'
        ? 'grab'
        : this.tool === 'connect'
          ? 'crosshair'
          : 'default';
    let edge: string | undefined;
    if (Array.isArray(resize)) {
      const [sx, sz] = resize as [number, number];
      cursor = resizeCursor(sx, sz, this.mode);
    } else if (handle) cursor = 'crosshair';
    else if (this.tool === 'select') {
      edge = this.edgeAt(event);
      if (edge) cursor = 'pointer';
      else if (this.nodeAt()) cursor = 'move';
    }
    this.renderer.domElement.style.cursor = cursor;
    if (edge !== this.hoveredEdge) {
      const previous = this.hoveredEdge;
      this.hoveredEdge = edge;
      if (previous) this.paintEdge(previous);
      if (edge) this.paintEdge(edge);
      this.invalidate();
    }
  }
  private move = (event: PointerEvent): void => {
    if (this.activePointer === undefined) {
      this.hover(event);
      return;
    }
    if (event.pointerId !== this.activePointer) return;
    event.preventDefault();
    if (this.marquee) {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      this.marquee.end = {
        x: Math.max(0, Math.min(this.width, event.clientX - bounds.left)),
        y: Math.max(0, Math.min(this.height, event.clientY - bounds.top)),
      };
      if (
        Math.hypot(
          this.marquee.end.x - this.marquee.start.x,
          this.marquee.end.y - this.marquee.start.y,
        ) >= 4
      )
        this.marquee.active = true;
      if (this.marquee.active) {
        const rect = selectionRect(this.marquee.start, this.marquee.end);
        this.selectionBox.hidden = false;
        Object.assign(this.selectionBox.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.right - rect.left}px`,
          height: `${rect.bottom - rect.top}px`,
        });
      }
      return;
    }
    const point = this.locate(event);
    if (!point) return;
    if (this.connectionStart) {
      this.showPreview(point);
      return;
    }
    if (this.resizing) {
      const { sx, sz, start, from } = this.resizing;
      const tile = this.tiles.get(this.resizing.id);
      if (!tile) return;
      const step = this.snapping ? 10 : 1;
      const size = (base: number, delta: number) =>
        Math.max(30, Math.round((base + delta) / step) * step);
      const node = tile.node;
      if (sx) {
        node.width = size(from.width, sx * (point.x - start.x));
        node.x = from.x + (sx * (node.width - from.width)) / 2;
      }
      if (sz) {
        node.depth = size(from.depth, sz * (point.z - start.z));
        node.z = from.z + (sz * (node.depth - from.depth)) / 2;
      }
      // Children are stored relative to the centre; keep them fixed on screen.
      for (const child of this.resizing.children) {
        child.node.x = child.x - (node.x - from.x);
        child.node.z = child.z - (node.z - from.z);
      }
      this.applySize(tile);
      this.refreshPosition(node.id);
      return;
    }
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
    const step = this.snapping ? 10 : 1;
    const dx = Math.round((point.x - this.drag.x) / step) * step;
    const dz = Math.round((point.z - this.drag.z) / step) * step;
    for (const origin of this.dragOrigins) {
      origin.node.x = origin.x + dx;
      origin.node.z = origin.z + dz;
      this.refreshPosition(origin.node.id);
    }
  };
  private applySize(tile: Tile): void {
    const mesh = tile.group.children[0];
    if (mesh instanceof Mesh)
      mesh.scale.set(
        tile.node.width,
        tile.node.kind === 'group' ? 2 : 24,
        tile.node.depth,
      );
    tile.label.userData.nodeWidth = tile.node.width;
  }
  private showPreview(point: Vector3): void {
    const start = this.connectionStart;
    const tile = start ? this.tiles.get(start.id) : undefined;
    if (!start || !tile) return;
    const from = start.port
      ? portPosition(tile.node, start.port, this.nodeIndex)
      : { x: tile.group.position.x, z: tile.group.position.z };
    const y = tile.group.position.y + 14;
    const positions = [from.x, y, from.z, point.x, y, point.z];
    if (!this.preview) {
      this.preview = new LineSegments2(
        new LineSegmentsGeometry().setPositions(positions),
        this.previewMaterial,
      );
      this.preview.frustumCulled = false;
      this.preview.renderOrder = 11;
      this.scene.add(this.preview);
    } else this.preview.geometry.setPositions(positions);
    this.preview.computeLineDistances();
    this.invalidate();
  }
  private clearPreview(): void {
    if (!this.preview) return;
    this.scene.remove(this.preview);
    this.preview.geometry.dispose();
    this.preview = undefined;
    this.invalidate();
  }
  public refreshPosition(id: string): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    if (tile.node.kind === 'group') this.updatePositions();
    else {
      const position = worldPosition(tile.node, this.nodeIndex);
      tile.group.position.set(position.x, position.level * 4, position.z);
      this.bodies?.update(
        tile.node,
        tile.group.position,
        this.selectedIds.has(tile.node.id),
      );
      this.details?.update(tile.index, tile.node, tile.group.position);
      for (const edgeId of this.incident.get(tile.node.id) ?? [])
        this.updateEdge(edgeId);
    }
    tile.label.position.set(
      tile.node.kind === 'group'
        ? -tile.node.width / 2 + Math.min(tile.node.width / 2, 150)
        : 0,
      tile.node.kind === 'group' ? 5 : tile.node.shape ? 26 : 0,
      tile.node.kind === 'group'
        ? -tile.node.depth / 2 + 22
        : tile.node.shape
          ? 0
          : tile.node.depth / 2 + 43,
    );
    this.invalidate();
  }
  /** Keep selection handles a constant on-screen size around the selected node. */
  private syncHandles(): void {
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    if (!tile) return;
    const { x, y, z } = tile.group.position;
    const top = y + (tile.node.kind === 'group' ? 2 : 13);
    const halfW = tile.node.width / 2;
    const halfD = tile.node.depth / 2;
    for (const handle of this.ports.children) {
      const resize: unknown = handle.userData.resize;
      const port: unknown = handle.userData.port;
      handle.position.set(x, top, z);
      const pixel = this.pixelSize(handle.position);
      if (Array.isArray(resize)) {
        const [sx, sz] = resize as [number, number];
        handle.position.set(x + sx * halfW, top, z + sz * halfD);
        handle.scale.setScalar(9 * pixel);
      } else if (isPort(port)) {
        const gap = 20 * pixel;
        handle.position.set(
          x +
            (port === 'east'
              ? halfW + gap
              : port === 'west'
                ? -halfW - gap
                : 0),
          top,
          z +
            (port === 'south'
              ? halfD + gap
              : port === 'north'
                ? -halfD - gap
                : 0),
        );
        handle.scale.setScalar(5.5 * pixel);
      }
    }
  }
  /** World units covered by one screen pixel at a point. */
  private pixelSize(point: Vector3): number {
    const projectionY = this.camera.projectionMatrix.elements[5] ?? 1;
    const depth =
      this.camera instanceof PerspectiveCamera
        ? Math.max(
            1,
            -point.clone().applyMatrix4(this.camera.matrixWorldInverse).z,
          )
        : 1;
    return (2 * depth) / (this.height * projectionY);
  }
  private up = (event?: PointerEvent): void => {
    if (event && event.pointerId !== this.activePointer) return;
    if (this.marquee) {
      if (event) this.move(event);
      const marquee = this.marquee;
      this.marquee = undefined;
      this.selectionBox.hidden = true;
      if (marquee.active) {
        const ids = nodesInSelectionRect(
          this.nodeIndex,
          this.camera,
          this.width,
          this.height,
          selectionRect(marquee.start, marquee.end),
        );
        this.selectMany(
          marquee.additive ? [...new Set([...marquee.initial, ...ids])] : ids,
        );
      } else this.select(marquee.clickId, marquee.additive);
    }
    this.releasePointer();
    if (this.resizing) {
      const { id, from, children } = this.resizing;
      this.resizing = undefined;
      const node = this.tiles.get(id)?.node;
      if (
        node &&
        (node.width !== from.width ||
          node.depth !== from.depth ||
          node.x !== from.x ||
          node.z !== from.z)
      )
        this.onResize([
          {
            id,
            from,
            to: { x: node.x, z: node.z, width: node.width, depth: node.depth },
          },
          ...children
            .filter((c) => c.node.x !== c.x || c.node.z !== c.z)
            .map((c) => ({
              id: c.node.id,
              from: { x: c.x, z: c.z },
              to: { x: c.node.x, z: c.node.z },
            })),
        ]);
    }
    if (this.connectionStart && event && this.tool !== 'connect') {
      const start = this.connectionStart;
      this.connectionStart = undefined;
      this.clearPreview();
      const point = this.locate(event);
      const hits = this.ray.intersectObjects(
        [...this.tiles.values()]
          .map((t) => t.group.children[0])
          .filter((m): m is Mesh => m instanceof Mesh),
        false,
      );
      const target = hits.find((h) => h.object.userData.nodeId !== start.id);
      const id: unknown = target?.object.userData.nodeId;
      const node = typeof id === 'string' ? this.nodeIndex.get(id) : undefined;
      if (node && point)
        this.onConnect(
          start.id,
          start.port,
          node.id,
          nearestPort(node, point, this.nodeIndex),
        );
    }
    const moves = this.dragOrigins
      .filter((o) => o.node.x !== o.x || o.node.z !== o.z)
      .map((o) => ({
        id: o.node.id,
        from: { x: o.x, z: o.z },
        to: { x: o.node.x, z: o.node.z },
      }));
    this.drag = undefined;
    this.dragOrigins = [];
    this.pan = undefined;
    if (moves.length === 1) {
      const move = moves[0];
      if (move) this.onMove(move.id, move.from, move.to);
    } else if (moves.length) this.onMoves(moves);
  };
  public cancelInteraction = (): void => {
    this.marquee = undefined;
    this.selectionBox.hidden = true;
    this.releasePointer();
    if (this.resizing) {
      const tile = this.tiles.get(this.resizing.id);
      if (tile) {
        Object.assign(tile.node, this.resizing.from);
        this.applySize(tile);
      }
      for (const child of this.resizing.children) {
        child.node.x = child.x;
        child.node.z = child.z;
      }
      this.resizing = undefined;
    }
    for (const origin of this.dragOrigins) {
      origin.node.x = origin.x;
      origin.node.z = origin.z;
    }
    this.drag = undefined;
    this.dragOrigins = [];
    this.pan = undefined;
    this.connectionStart = undefined;
    this.clearPreview();
    this.updatePositions();
    this.invalidate();
  };
  private cancel = (): void => this.cancelInteraction();
  private lostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.cancelInteraction();
  };
  private releasePointer(): void {
    const pointer = this.activePointer;
    this.activePointer = undefined;
    if (
      pointer !== undefined &&
      this.renderer.domElement.hasPointerCapture(pointer)
    )
      this.renderer.domElement.releasePointerCapture(pointer);
  }
  private preventNativeDrag = (event: Event): void => event.preventDefault();
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
  private context = (event: MouseEvent): void => {
    event.preventDefault();
    const edge = this.edgeAt(event);
    if (edge) this.selectEdge(edge);
    else if (!this.selectedEdge || this.selectedIds.size) {
      // Right-clicking an unselected node acts on that node.
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / this.width) * 2 - 1,
        (-(event.clientY - rect.top) / this.height) * 2 + 1,
      );
      this.ray.setFromCamera(this.pointer, this.camera);
      const id = this.nodeAt();
      if (id && !this.selectedIds.has(id)) this.select(id);
    }
    this.onContextMenu(event.clientX, event.clientY);
  };
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.onError('Graphics context lost. Waiting for recovery…');
  };
  private contextRestored = (): void => {
    this.onError('Graphics context restored');
    this.invalidate();
  };
  public get selection(): readonly string[] {
    return [...this.selectedIds];
  }
  public get edgeSelection(): string | undefined {
    return this.selectedEdge;
  }
  public select(id: string | undefined, additive = false): void {
    const ids = additive ? new Set(this.selectedIds) : new Set<string>();
    if (id) {
      if (additive && ids.has(id)) ids.delete(id);
      else ids.add(id);
    }
    this.selectMany([...ids]);
  }
  /** Select one connection; node selection is cleared. */
  public selectEdge(id: string | undefined): void {
    const edge = id && this.edges.has(id) ? id : undefined;
    this.setNodeSelection([]);
    this.setEdgeSelection(edge);
    this.onSelectEdge(edge);
    this.invalidate();
  }
  private setEdgeSelection(id: string | undefined): void {
    const previous = this.selectedEdge;
    this.selectedEdge = id;
    if (previous) this.paintEdge(previous);
    if (id) this.paintEdge(id);
  }
  public selectMany(ids: readonly string[]): void {
    this.setEdgeSelection(undefined);
    this.setNodeSelection(ids);
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    this.onSelect(tile?.node);
    this.invalidate();
  }
  private setNodeSelection(ids: readonly string[]): void {
    this.selectedIds.clear();
    for (const id of ids) if (this.tiles.has(id)) this.selectedIds.add(id);
    this.selected = [...this.selectedIds].at(-1);
    for (const tile of this.tiles.values())
      this.bodies?.update(
        tile.node,
        tile.group.position,
        this.selectedIds.has(tile.node.id),
      );
    this.ports.clear();
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    // Handles only for a single selection; a multi-selection moves as a unit.
    if (!tile || this.selectedIds.size !== 1) return;
    for (const port of ['north', 'east', 'south', 'west'] as const) {
      const mesh = new Mesh(this.portGeometry, this.portMaterial);
      mesh.userData.nodeId = tile.node.id;
      mesh.userData.port = port;
      mesh.renderOrder = 12;
      this.ports.add(mesh);
    }
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 0, 1]) {
        if (!sx && !sz) continue;
        const handle = new Mesh(this.handleGeometry, this.handleMaterial);
        handle.userData.nodeId = tile.node.id;
        handle.userData.resize = [sx, sz];
        handle.renderOrder = 13;
        this.ports.add(handle);
      }
  }
  /** Write one connection's colour into the shared line buffer. */
  private paintEdge(id: string): void {
    const index = this.edges.get(id);
    if (index === undefined || !this.edgeColorBuffer) return;
    const color =
      id === this.selectedEdge
        ? this.palette.edgeSelected
        : id === this.hoveredEdge
          ? this.palette.edgeHover
          : this.palette.edge;
    this.scratchColor.set(color);
    for (let i = 0; i < 14; i++)
      this.edgeColors.set(
        [this.scratchColor.r, this.scratchColor.g, this.scratchColor.b],
        index * 42 + i * 3,
      );
    this.edgeColorBuffer.addUpdateRange(index * 42, 42);
    this.edgeColorBuffer.needsUpdate = true;
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
    this.syncHandles();
    this.scene.updateMatrixWorld();
    this.labels.sync(this.camera, this.height);
    this.renderer.render(this.scene, this.camera);
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.frames++;
    this.metrics.lastRenderMs = performance.now() - start;
  }
  public async checkContextRecovery(): Promise<boolean> {
    const extension = this.renderer
      .getContext()
      .getExtension('WEBGL_lose_context');
    if (!extension) return false;
    const canvas = this.renderer.domElement;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
        reject(Error('Graphics context recovery timed out'));
      }, 5000);
      const restored = () => {
        clearTimeout(timeout);
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
        this.invalidate();
        resolve(true);
      };
      const lost = () => {
        setTimeout(() => extension.restoreContext(), 100);
      };
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      extension.loseContext();
    });
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
  public handleScreenPosition(
    id: string,
    port: Port | 'resize',
  ): { x: number; y: number } | undefined {
    const tile = this.tiles.get(id);
    if (!tile) return;
    this.syncHandles();
    this.scene.updateMatrixWorld();
    const handle = this.ports.children.find((child) =>
      child.userData.nodeId !== id
        ? false
        : port === 'resize'
          ? Array.isArray(child.userData.resize) &&
            child.userData.resize[0] === 1 &&
            child.userData.resize[1] === 1
          : child.userData.port === port,
    );
    const position = handle
      ? handle.position
      : {
          ...portPosition(
            tile.node,
            port === 'resize' ? 'east' : port,
            this.nodeIndex,
          ),
          y: tile.group.position.y + 13,
        };
    const point = new Vector3(position.x, position.y, position.z).project(
      this.camera,
    );
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
    this.cancelInteraction();
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
    for (const geometry of Object.values(this.shapeGeometries))
      geometry.dispose();
    this.clearPreview();
    this.previewMaterial.dispose();
    this.portGeometry.dispose();
    this.portMaterial.dispose();
    this.handleGeometry.dispose();
    this.handleMaterial.dispose();
    this.geometry.dispose();
    this.tileOutline.dispose();
    this.haloMaterial.dispose();
    this.edgeMaterial.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.selectionBox.remove();
  }
}

function createFlowGeometries(): Record<
  'process' | 'decision' | 'terminal',
  BoxGeometry | ExtrudeGeometry
> {
  const diamond = new Shape();
  diamond.moveTo(0, -0.5);
  diamond.lineTo(0.5, 0);
  diamond.lineTo(0, 0.5);
  diamond.lineTo(-0.5, 0);
  diamond.closePath();
  const rounded = new Shape();
  rounded.moveTo(-0.3, -0.5);
  rounded.lineTo(0.3, -0.5);
  rounded.quadraticCurveTo(0.5, -0.5, 0.5, -0.3);
  rounded.lineTo(0.5, 0.3);
  rounded.quadraticCurveTo(0.5, 0.5, 0.3, 0.5);
  rounded.lineTo(-0.3, 0.5);
  rounded.quadraticCurveTo(-0.5, 0.5, -0.5, 0.3);
  rounded.lineTo(-0.5, -0.3);
  rounded.quadraticCurveTo(-0.5, -0.5, -0.3, -0.5);
  const extrude = (shape: Shape) => {
    const geometry = new ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
      curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.5, 0);
    return geometry;
  };
  return {
    process: new BoxGeometry(1, 1, 1),
    decision: extrude(diamond),
    terminal: extrude(rounded),
  };
}
