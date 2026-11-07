import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  FogExp2,
  GridHelper,
  Group,
  type InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { loadServiceImages, missingServiceImages } from '../catalog/images';
import { findService } from '../catalog/services';
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  Footprint,
  Port,
  Rect,
} from '../domain/document';
import { isPort, worldPosition, worldRect } from '../domain/document';
import { inactiveEdges } from '../domain/journey';
import { laneBands } from '../domain/lanes';
import {
  type Fans,
  fansOf,
  type Obstacle,
  obstaclesOf,
  portPosition,
  routeEdge,
  routeMidpoint,
} from '../domain/routing';
import { defaultTheme, type ScenePalette } from '../themes';
import { createAnnotation, NOTE_HEIGHT } from './annotations';
import { AntialiasPass, OVERLAY_LAYER, overlay } from './antialias';
import { createBackdrop } from './backdrop';
import { drawCaption } from './caption';
import { createFlowGeometries } from './flow-shapes';
import { JourneyPlayer } from './journey';
import { LabelAtlas, rasterBucket } from './labels';
import { createLaneBands, type LaneBandsView } from './lane-bands';
import { type GestureBoard, PointerGestures } from './pointer-gestures';
import { nodesInSelectionRect } from './selection';
import { TileBodies } from './tile-bodies';
import { TileDetails } from './tile-details';
import { BoardView, type ViewMode } from './view';

export type { ViewMode } from './view';

/** Fog density at the reference camera distance; see BoardView.fogScale. */
const FOG_DENSITY = 0.00012;
/** Marching-dash defaults; themes may override them via flowStyle. */
const DEFAULT_FLOW = { width: 3.6, dash: 12, gap: 38, speed: 40 };

export interface ResizeChange {
  id: string;
  from: Partial<Footprint>;
  to: Partial<Footprint>;
}
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

interface Tile {
  index: number;
  node: DiagramNode;
  group: Group;
  label: Object3D;
  headerIcon?: Object3D;
  annotation?: { root: Group; dispose: () => void };
}
const isAnnotation = (node: DiagramNode) =>
  node.kind === 'text' || node.kind === 'note';
/** Caption anchor: boundary header, above a flow shape, or below a service tile. */
function placeLabel(label: Object3D, node: DiagramNode): void {
  label.position.set(
    node.kind === 'group' ? -node.width / 2 + Math.min(node.width / 2, 150) : 0,
    node.kind === 'group' ? 5 : node.shape ? 26 : 0,
    node.kind === 'group'
      ? -node.depth / 2 + 22
      : node.shape
        ? 0
        : node.depth / 2 + 16,
  );
}
/** Height of the invisible picking box, matching what is drawn. */
function pickHeight(node: DiagramNode): number {
  if (node.kind === 'group') return 2;
  if (node.kind === 'text') return 4;
  if (node.kind === 'note') return NOTE_HEIGHT;
  return 24;
}
export type EditTarget =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'empty'; x: number; z: number };
export type Tool = 'select' | 'pan' | 'connect' | 'text' | 'note' | 'sketch';
/** One finished pen stroke on the board, with the components under its ends. */
export interface SketchStroke {
  points: { x: number; z: number }[];
  from?: { id: string; port: Port };
  to?: { id: string; port: Port };
}
/** Pen-sized hit targets: handles and connection slop grow by this much. */
const PEN_SCALE = 1.75;
export class DiagramScene {
  /** Settles once the icons of the current board have loaded. */
  public ready: Promise<void> = Promise.resolve();
  private document: DiagramDocument;
  private readonly scene = new Scene();
  private palette: ScenePalette = defaultTheme.scene;
  private backdrop = createBackdrop(this.palette);
  private readonly labels = new LabelAtlas(this.palette);
  private grid = new GridHelper(16000, 320);
  private readonly ambient = new AmbientLight('#c9def1', 2);
  private readonly fog = new FogExp2('#0b111a', FOG_DENSITY);
  private readonly view = new BoardView();
  private get camera() {
    return this.view.camera;
  }
  private get target() {
    return this.view.target;
  }
  // MSAA is off: the FXAA pass gives similar edges for a fraction of the cost.
  private readonly renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
  });
  private readonly antialias = new AntialiasPass();
  private motionUntil = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly content = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  /** Picking boxes are never drawn, so they all share one material. */
  private readonly pickMaterial = new MeshBasicMaterial();
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
  /** Short bright dashes that march from source to target. */
  private readonly flowMaterial = new LineMaterial({
    color: '#ffffff',
    linewidth: 3.6,
    transparent: true,
    depthWrite: false,
    dashed: true,
    dashSize: 12,
    gapSize: 38,
  });
  private flowLines: LineSegments2 | undefined;
  private distancesDirty = false;
  private flowing = true;
  private hasFlowEdges = false;
  private readonly animators = new Set<(time: number) => boolean>();
  private edgeGeometry: LineSegmentsGeometry | undefined;
  /** Flow dashes keep their own copy so inactive routes can go still. */
  private flowGeometry: LineSegmentsGeometry | undefined;
  private flowPositions: Float32Array<ArrayBufferLike> = new Float32Array();
  private flowBuffer: InterleavedBuffer | undefined;
  private inactive = new Set<string>();
  private edgeBuffer: InterleavedBuffer | undefined;
  private readonly tiles = new Map<string, Tile>();
  private readonly scratchColor = new Color();
  private readonly dimColor = new Color();
  private readonly edges = new Map<string, number>();
  private edgePositions = new BufferAttribute(new Float32Array(), 3);
  private readonly edgeLabels = new Map<string, Object3D>();
  private readonly nodeIndex = new Map<string, DiagramNode>();
  private readonly edgeIndex = new Map<string, DiagramEdge>();
  private readonly incident = new Map<string, Set<string>>();
  /** Tile footprints for routing; dropped whenever anything moves. */
  private obstacleCache: Obstacle[] | undefined;
  private fanCache: Fans | undefined;
  private get obstacles(): Obstacle[] {
    this.obstacleCache ??= obstaclesOf(this.nodeIndex);
    return this.obstacleCache;
  }
  private get fans(): Fans {
    this.fanCache ??= fansOf(this.edgeIndex.values(), this.nodeIndex);
    return this.fanCache;
  }
  /** Invisible picking boxes, one per tile, rebuilt on load. */
  private pickables: Mesh[] = [];
  private readonly viewProjection = new Matrix4();
  private readonly scratchA = new Vector3();
  private readonly scratchB = new Vector3();
  /** Something besides the animation clock changed since the last frame. */
  private dirty = true;
  private readonly ray = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly point = new Vector3();
  private readonly observer: ResizeObserver;
  private frame = 0;
  private width = 1;
  private height = 1;
  private mode: ViewMode = 'isometric';
  private tool: Tool = 'select';
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
  private selectedEdge: string | undefined;
  private hoveredEdge: string | undefined;
  private edgeColors: Float32Array<ArrayBufferLike> = new Float32Array();
  private edgeColorBuffer: InterleavedBuffer | undefined;
  public onSelectEdge: (id: string | undefined) => void = () => {};
  private journeyCaption = '';
  public onJourneyCaption: (caption: string) => void = () => {};
  private setJourneyCaption(caption: string): void {
    this.journeyCaption = caption;
    this.onJourneyCaption(caption);
  }
  public onJourneyHop: (edgeId: string) => void = () => {};
  public onJourneyEnd: () => void = () => {};
  public onJourneyBranches: (nodeId: string) => {
    mode: 'all' | 'ask' | 'fixed';
    edges: string[];
  } = () => ({ mode: 'all', edges: [] });
  public onJourneyChoose: (
    nodeId: string,
    edges: readonly string[],
  ) => Promise<string | undefined> = async () => undefined;
  public onJourneyCancelChoice: () => void = () => {};
  private journey: JourneyPlayer | undefined;
  /** Double-click on a node, a connection, or empty board. */
  public onEditRequest: (target: EditTarget) => void = () => {};
  public onPlace: (tool: 'text' | 'note', x: number, z: number) => void =
    () => {};
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
  /** A finished sketch-tool stroke, for the editor to recognise. */
  public onSketch: (stroke: SketchStroke) => void = () => {};
  /** Nodes and connections rubbed out with a pen's eraser end. */
  public onErase: (nodes: string[], edges: string[]) => void = () => {};
  /** A pen touched the board for the first time, or a mouse took over. */
  public onPenInput: (pen: boolean) => void = () => {};
  /** One completed resize; children shift so they stay put in world space. */
  public onResize: (changes: ResizeChange[]) => void = () => {};
  private selected: string | undefined;
  private disposed = false;
  /** Disposers for detached boards, run once the next frame is drawn. */
  private retired: (() => void)[] = [];
  private flushRetired(): void {
    for (const dispose of this.retired.splice(0)) dispose();
  }
  private labelTimer: ReturnType<typeof setTimeout> | undefined;
  /** Canvas pixels per world unit for new text and notes; follows zoom. */
  private annotationScale = 2;
  /** Redraw captions and notes at their new size once zooming pauses. */
  private sharpenLabelsSoon(labels: boolean): void {
    clearTimeout(this.labelTimer);
    this.labelTimer = setTimeout(() => {
      if (this.disposed) return;
      if (labels) this.retired.push(this.labels.redraw());
      this.sharpenAnnotations();
      this.invalidate();
    }, 160);
  }
  /** Text and notes drawn too soft, or far too large, for the current view. */
  private staleAnnotations(): { tile: Tile; scale: number }[] {
    const ratio = this.renderer.getPixelRatio();
    const stale: { tile: Tile; scale: number }[] = [];
    for (const tile of this.tiles.values()) {
      const root = tile.annotation?.root;
      if (!root) continue;
      // The canvas size limit in createAnnotation caps very large notes.
      const scale = rasterBucket(
        ratio / this.pixelSize(tile.group.position),
        16,
      );
      const current = Number(root.userData.resolution);
      if (
        (scale > current + 1e-6 && !root.userData.capped) ||
        scale * 2 < current - 1e-6
      )
        stale.push({ tile, scale });
    }
    return stale;
  }
  private sharpenAnnotations(): void {
    for (const { tile, scale } of this.staleAnnotations()) {
      const old = tile.annotation;
      if (!old) continue;
      const annotation = createAnnotation(tile.node, this.palette, scale);
      tile.group.remove(old.root);
      tile.group.add(annotation.root);
      tile.annotation = annotation;
      this.retired.push(old.dispose);
      this.annotationScale = scale;
    }
  }
  /** Redraw captions for the current view now, before a capture. */
  private sharpenLabels(): void {
    this.scene.updateMatrixWorld();
    if (
      this.labels.sync(this.camera, this.height, this.renderer.getPixelRatio())
    )
      this.retired.push(this.labels.redraw());
    this.sharpenAnnotations();
    this.scene.updateMatrixWorld();
  }
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
    palette: ScenePalette = defaultTheme.scene,
  ) {
    this.document = document;
    // Match the display (up to 2×): a lower ratio is upscaled and blurs text.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor('#000000', 0);
    // Resize and connect handles are drawn on the overlay layer.
    this.ray.layers.enable(OVERLAY_LAYER);
    this.scene.fog = this.fog;
    // render() updates world matrices itself, and only when something moved.
    this.scene.matrixWorldAutoUpdate = false;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Architecture diagram canvas',
    );
    this.host.append(this.renderer.domElement);
    this.gestures = new PointerGestures(
      this.gestureBoard(),
      this,
      this.scene,
      this.host,
    );
    this.scene.add(this.ports);
    this.scene.add(this.content, this.ambient);
    const light = new DirectionalLight('#ffe5bf', 2);
    light.position.set(-200, 500, 300);
    this.scene.add(light);
    this.applyPalette(palette);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('wheel', this.wheel, {
      passive: false,
    });
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
  private applyPalette(palette: ScenePalette): void {
    this.palette = palette;
    this.labels.palette = palette;
    this.backdrop.dispose();
    this.backdrop = createBackdrop(palette);
    this.scene.background = this.backdrop;
    this.fog.color.set(palette.fog);
    this.ambient.intensity = palette.ambient;
    this.scene.remove(this.grid);
    this.grid.dispose();
    // Same colour for the centre lines: an axis cutting the board reads as a bug.
    this.grid = new GridHelper(16000, 320, palette.grid[1], palette.grid[1]);
    this.grid.position.y = -12;
    if (!Array.isArray(this.grid.material)) {
      this.grid.material.transparent = true;
      this.grid.material.opacity = palette.gridOpacity;
    }
    this.scene.add(this.grid);
    this.portMaterial.color.set(palette.port);
    this.handleMaterial.color.set(palette.handle);
    this.gestures.setPalette(palette);
    this.flowMaterial.color.set(palette.flow);
    this.haloMaterial.opacity = palette.haloOpacity;
    const width = palette.edgeWidth ?? 1.6;
    this.edgeMaterial.linewidth = width;
    this.haloMaterial.linewidth = width * 5;
    const flow = palette.flowStyle ?? DEFAULT_FLOW;
    this.flowMaterial.linewidth = flow.width;
    this.flowMaterial.dashSize = flow.dash;
    this.flowMaterial.gapSize = flow.gap;
  }
  /** Repaint the whole board in a new theme, keeping the current selection. */
  public setPalette(palette: ScenePalette): void {
    const ids = this.selection;
    const edge = this.selectedEdge;
    this.applyPalette(palette);
    this.load(this.document);
    if (edge) this.selectEdge(edge);
    else this.selectMany(ids);
  }
  /**
   * Detach the current board. Its GPU resources are freed after the next
   * frame: three drops a shader program as soon as its last material is
   * disposed, so freeing them first would recompile every board shader on
   * each load. The replacement materials pick up the still-live programs.
   */
  private releaseContent(): void {
    const annotations = [...this.tiles.values()].flatMap((tile) =>
      tile.annotation ? [tile.annotation] : [],
    );
    const { bodies, details, edgeGeometry, flowGeometry, lanes } = this;
    const labels = this.labels.retire();
    this.lanes = undefined;
    this.retired.push(() => {
      lanes?.dispose();
      for (const annotation of annotations) annotation.dispose();
      bodies?.dispose();
      details?.dispose();
      edgeGeometry?.dispose();
      flowGeometry?.dispose();
      labels();
    });
    this.bodies = undefined;
    this.details = undefined;
    this.edgeGeometry = undefined;
    this.flowGeometry = undefined;
    this.flowBuffer = undefined;
    this.edgeBuffer = undefined;
    this.content.clear();
    this.tiles.clear();
    this.pickables = [];
    this.edges.clear();
    this.edgeLabels.clear();
    this.incident.clear();
    this.nodeIndex.clear();
    this.edgeIndex.clear();
  }
  public load(document: DiagramDocument): void {
    // History may already have changed parent IDs. Do not refresh the old scene
    // against that edited graph while replacing its node index.
    this.gestures.reset();
    this.stopJourney();
    this.hoveredEdge = undefined;
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
      this.palette,
    );
    this.content.add(this.bodies.root);
    this.details = new TileDetails(
      document.nodes.length,
      this.tileOutline.getAttribute('position'),
      this.palette,
    );
    this.content.add(this.details.root);
    for (const [index, node] of document.nodes.entries()) {
      this.nodeIndex.set(node.id, node);
      const group = new Group();
      const mesh = new Mesh(
        node.shape ? this.shapeGeometries[node.shape] : this.geometry,
        this.pickMaterial,
      );
      mesh.scale.set(node.width, pickHeight(node), node.depth);
      mesh.userData.nodeId = node.id;
      mesh.visible = false;
      group.add(mesh);
      this.pickables.push(mesh);
      if (isAnnotation(node)) {
        const annotation = createAnnotation(
          node,
          this.palette,
          this.annotationScale,
        );
        group.add(annotation.root);
        this.content.add(group);
        // Annotations carry their own text; the placeholder keeps Tile uniform.
        this.tiles.set(node.id, {
          index,
          node,
          group,
          label: new Group(),
          annotation,
        });
        continue;
      }
      let headerIcon: Object3D | undefined;
      const component = findService(node.serviceId ?? node.label);
      if (node.kind === 'group' && component?.icon) {
        headerIcon = this.labels.create(component.id, this.camera.zoom, 'icon');
        group.add(headerIcon);
      }
      if (node.kind === 'service' && !node.shape) {
        const glyph = this.labels.create(
          component?.id ?? node.label,
          this.camera.zoom,
          'icon',
        );
        glyph.position.y = 28;
        glyph.userData.nodeWidth = node.width;
        glyph.userData.nodeDepth = node.depth;
        group.add(glyph);
      }
      const label = this.labels.create(
        node.label,
        this.camera.zoom,
        node.kind === 'group' ? 'group' : 'node',
        {
          width: node.width,
          depth: node.depth,
          ...(node.fontSize ? { fontSize: node.fontSize } : {}),
          ...(node.wrap ? { wrap: true } : {}),
        },
      );
      label.userData.captionBelow = node.kind === 'service' && !node.shape;
      label.userData.nodeWidth = node.width;
      label.userData.nodeDepth = node.depth;
      placeLabel(label, node);
      group.add(label);
      this.content.add(group);
      const tile: Tile = {
        index,
        node,
        group,
        label,
        ...(headerIcon ? { headerIcon } : {}),
      };
      this.positionHeaderIcon(tile);
      this.tiles.set(node.id, tile);
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
    this.inactive = inactiveEdges(document);
    this.hasFlowEdges = document.edges.some(
      (e) => e.relationship !== 'dependency',
    );
    this.flowPositions = new Float32Array(document.edges.length * 42);
    this.flowGeometry = new LineSegmentsGeometry().setPositions(
      this.flowPositions,
    );
    const flow = this.flowGeometry.getAttribute('instanceStart');
    if (flow instanceof InterleavedBufferAttribute) {
      this.flowBuffer = flow.data;
      this.flowBuffer.setUsage(DynamicDrawUsage);
      this.flowPositions = flow.data.array as Float32Array;
    }
    this.flowLines = new LineSegments2(this.flowGeometry, this.flowMaterial);
    this.flowLines.frustumCulled = false;
    this.flowLines.visible = this.flowing;
    this.flowLines.renderOrder = 2;
    this.content.add(halo, connections, this.flowLines);
    this.distancesDirty = true;
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
    const bands = laneBands(document);
    if (bands) {
      this.lanes = createLaneBands(bands, this.palette, (text) =>
        this.labels.create(text, this.camera.zoom, 'group'),
      );
      this.content.add(this.lanes.root);
    }
    this.labels.finish(this.content);
    this.updatePositions();
    this.invalidate();
    this.onSelect(undefined);
    this.loadIcons(document);
  }
  /** Fetch the icons this board shows that are not loaded yet, then redraw. */
  private loadIcons(document: DiagramDocument): void {
    const ids: string[] = [];
    for (const node of document.nodes) {
      const service = findService(node.serviceId ?? node.label);
      if (service?.icon) ids.push(service.id);
    }
    const missing = missingServiceImages(ids);
    if (!missing.length) return;
    this.ready = loadServiceImages(missing)
      .then(() => {
        if (this.disposed || this.document !== document) return;
        const edge = this.selectedEdge;
        const selection = this.selection;
        this.load(document);
        if (edge) this.selectEdge(edge);
        else this.selectMany(selection);
      })
      .catch((error) => this.onError(String(error)));
  }
  private positionHeaderIcon(tile: Tile): void {
    if (!tile.headerIcon) return;
    const { width, depth } = tile.node;
    tile.headerIcon.position.set(width / 2 - 28, 6, -depth / 2 + 24);
    tile.headerIcon.userData.nodeWidth = width >= 120 ? 100 : 0;
    tile.headerIcon.userData.nodeDepth = 40;
    // Reserve the right side of the boundary header for its icon.
    tile.label.userData.nodeWidth = Math.max(30, width - 80);
    tile.label.position.x =
      -width / 2 + Math.min(Math.max(30, width - 80) / 2, 150);
  }
  private updatePositions(): void {
    this.obstacleCache = undefined;
    this.fanCache = undefined;
    for (const tile of this.tiles.values()) {
      const p = worldPosition(tile.node, this.nodeIndex);
      this.positionHeaderIcon(tile);
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
    const { points, targetPort } = routeEdge(
      edge,
      this.nodeIndex,
      this.obstacles,
      this.fans,
    );
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
    // Inactive routes collapse to a point in the flow copy: no marching dashes.
    const route = this.edgePositions.array;
    const base = index * 42;
    const still = this.inactive.has(id) || edge.relationship === 'dependency';
    for (let i = 0; i < 42; i++)
      this.flowPositions[base + i] =
        route[still ? base + (i % 3) : base + i] ?? 0;
    if (this.flowBuffer) {
      this.flowBuffer.addUpdateRange(base, 42);
      this.flowBuffer.needsUpdate = true;
    }
    this.distancesDirty = true;
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
  /** Pan just enough to bring a node on screen; the zoom stays put. */
  public reveal(id: string): void {
    const tile = this.tiles.get(id);
    const point = this.nodeScreenPosition(id);
    if (!tile || !point) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = point.x - rect.left,
      y = point.y - rect.top;
    if (x > 120 && x < this.width - 300 && y > 120 && y < this.height - 120)
      return;
    this.fitted = false;
    this.target.x = tile.group.position.x;
    this.target.z = tile.group.position.z;
    this.setView(this.mode);
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
  /**
   * Slide the camera by a screen distance, measured on the board plane at the
   * centre of the view, so a key pan feels the same at any zoom or view.
   */
  public panByPixels(dx: number, dy: number): void {
    const ground = (x: number, y: number) => {
      this.pointer.set((x / this.width) * 2, (-y / this.height) * 2);
      this.ray.setFromCamera(this.pointer, this.camera);
      return this.ray.ray.intersectPlane(this.plane, new Vector3());
    };
    const from = ground(0, 0);
    const across = ground(dx, 0);
    const along = ground(0, dy);
    if (!from || !across || !along) return;
    this.inMotion();
    this.fitted = false;
    // Both views keep board rows horizontal: screen x is board x, screen y is
    // board z. Taking one axis from each ray drops perspective's sideways drift.
    this.target.x += across.x - from.x;
    this.target.z += along.z - from.z;
    this.setView(this.mode);
    this.invalidate();
  }
  public setTool(tool: Tool): void {
    this.cancelInteraction();
    this.tool = tool;
    this.renderer.domElement.style.cursor = this.toolCursor();
  }
  private toolCursor(): string {
    return this.tool === 'pan'
      ? 'grab'
      : this.tool === 'connect'
        ? 'crosshair'
        : this.tool === 'text'
          ? 'text'
          : this.tool === 'note'
            ? 'copy'
            : this.tool === 'sketch'
              ? 'crosshair'
              : 'default';
  }
  /** Complete a drag, resize or stroke in progress, reporting its result. */
  public finishInteraction(): void {
    this.gestures.finish();
  }
  /** Abandon a gesture in progress and put the board back as it was. */
  public cancelInteraction = (): void => {
    this.gestures.cancel();
  };
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
    if (this.lanes) {
      const box = this.lanes.bounds;
      minX = Math.min(minX, box.minX);
      maxX = Math.max(maxX, box.maxX);
      minZ = Math.min(minZ, box.minZ);
      maxZ = Math.max(maxZ, box.maxZ);
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

  /** Swimlane bands drawn under the board, when it shows lanes. */
  private lanes: LaneBandsView | undefined;
  /** Pointer input: drag, resize, marquee, connect, sketch, erase, pan. */
  private readonly gestures: PointerGestures;
  /** The narrow view of this scene that pointer gestures work through. */
  private gestureBoard(): GestureBoard {
    const scene = this;
    return {
      get canvas() {
        return scene.renderer.domElement;
      },
      get tool() {
        return scene.tool;
      },
      get snapping() {
        return scene.snapping;
      },
      get nodeIndex() {
        return scene.nodeIndex;
      },
      get selection() {
        return scene.selection;
      },
      get selected() {
        return scene.selected;
      },
      get selectedIds() {
        return scene.selectedIds;
      },
      get selectedEdge() {
        return scene.selectedEdge;
      },
      locate: (event) => this.locate(event),
      aimAt: (x, z) => {
        const projected = this.scratchA.set(x, 0, z).project(this.camera);
        this.pointer.set(projected.x, projected.y);
        this.ray.setFromCamera(this.pointer, this.camera);
      },
      nodeAt: () => this.nodeAt(),
      handleAt: () => this.handleAt(),
      pickNodes: () => this.ray.intersectObjects(this.pickables, false),
      edgeAt: (event) => this.edgeAt(event),
      nodesInScreenRect: (rect) =>
        nodesInSelectionRect(
          this.nodeIndex,
          this.camera,
          this.width,
          this.height,
          rect,
        ),
      viewportSize: () => ({ width: this.width, height: this.height }),
      pixelSize: (point) => this.pixelSize(point),
      tileNode: (id) => this.tiles.get(id)?.node,
      tilePosition: (id) => this.tiles.get(id)?.group.position,
      tileNodes: () => [...this.tiles.values()].map((tile) => tile.node),
      worldRect: (id) => this.worldRect(this.tiles.get(id)),
      applySize: (id) => {
        const tile = this.tiles.get(id);
        if (tile) this.applySize(tile);
      },
      refreshPositions: (ids) => this.refreshPositions(ids),
      updatePositions: () => this.updatePositions(),
      panBoard: (dx, dz) => {
        this.fitted = false;
        this.target.x += dx;
        this.target.z += dz;
        this.setView(this.mode);
      },
      setCursor: (cursor) => {
        this.renderer.domElement.style.cursor = cursor;
      },
      toolCursor: () => this.toolCursor(),
      hoverEdge: (edge) => {
        if (edge === this.hoveredEdge) return;
        const previous = this.hoveredEdge;
        this.hoveredEdge = edge;
        if (previous) this.paintEdge(previous);
        if (edge) this.paintEdge(edge);
        this.invalidate();
      },
      select: (id, additive) => this.select(id, additive),
      selectEdge: (id) => this.selectEdge(id),
      selectMany: (ids) => this.selectMany(ids),
      setPrimary: (id) => {
        this.selected = id;
      },
      inMotion: () => this.inMotion(),
      invalidate: () => this.invalidate(),
    };
  }
  private locate(event: {
    clientX: number;
    clientY: number;
  }): Vector3 | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / this.width) * 2 - 1,
      (-(event.clientY - rect.top) / this.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.point) ?? undefined;
  }
  /** Topmost node under the last located ray; services win over boundaries. */
  private nodeAt(): string | undefined {
    const hits = this.ray.intersectObjects(this.pickables, false);
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
    const a = this.scratchA;
    const b = this.scratchB;
    // Same result as Vector3.project, with one matrix product per point.
    const projection = this.viewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    let best: string | undefined;
    let bestDistance = this.gestures.penInput ? 7 * PEN_SCALE : 7;
    for (const [id, index] of this.edges) {
      for (let segment = 0; segment < 5; segment++) {
        const offset = index * 14 + segment * 2;
        a.fromBufferAttribute(this.edgePositions, offset).applyMatrix4(
          projection,
        );
        b.fromBufferAttribute(this.edgePositions, offset + 1).applyMatrix4(
          projection,
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
  private worldRect(tile: Tile | undefined): Rect {
    if (!tile) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    return worldRect(tile.node, this.nodeIndex);
  }
  private applySize(tile: Tile): void {
    const mesh = tile.group.children[0];
    if (mesh instanceof Mesh)
      mesh.scale.set(tile.node.width, pickHeight(tile.node), tile.node.depth);
    for (const child of tile.group.children) {
      child.userData.nodeWidth = tile.node.width;
      child.userData.nodeDepth = tile.node.depth;
    }
    // Stretch the drawn annotation live; it is redrawn crisply on commit.
    const root = tile.annotation?.root;
    if (root)
      root.scale.set(
        tile.node.width / root.userData.width,
        1,
        tile.node.depth / root.userData.depth,
      );
  }
  public refreshPosition(id: string): void {
    this.refreshPositions([id]);
  }
  /**
   * Re-place several moved nodes at once: tiles first, then each affected
   * route exactly once against the final obstacles.
   */
  private refreshPositions(ids: readonly string[]): void {
    const tiles: Tile[] = [];
    for (const id of ids) {
      const tile = this.tiles.get(id);
      if (tile) tiles.push(tile);
    }
    if (!tiles.length) return;
    this.obstacleCache = undefined;
    this.fanCache = undefined;
    if (tiles.some((tile) => tile.node.kind === 'group'))
      this.updatePositions();
    else {
      const routes = new Set<string>();
      for (const tile of tiles) {
        const position = worldPosition(tile.node, this.nodeIndex);
        tile.group.position.set(position.x, position.level * 4, position.z);
        this.bodies?.update(
          tile.node,
          tile.group.position,
          this.selectedIds.has(tile.node.id),
        );
        this.details?.update(tile.index, tile.node, tile.group.position);
        for (const edgeId of this.incident.get(tile.node.id) ?? [])
          routes.add(edgeId);
      }
      for (const edgeId of routes) this.updateEdge(edgeId);
    }
    for (const tile of tiles) {
      placeLabel(tile.label, tile.node);
      this.positionHeaderIcon(tile);
    }
    this.invalidate();
  }
  /** Keep selection handles a constant on-screen size around the selected node. */
  private syncHandles(): void {
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    if (!tile) return;
    const { x, y, z } = tile.group.position;
    const top = y + (tile.node.kind === 'group' ? 2 : 13);
    const scale = this.gestures.penInput ? PEN_SCALE : 1;
    const halfW = tile.node.width / 2;
    const halfD = tile.node.depth / 2;
    for (const handle of this.ports.children) {
      const resize: unknown = handle.userData.resize;
      const port: unknown = handle.userData.port;
      handle.position.set(x, top, z);
      const pixel = this.pixelSize(handle.position) * scale;
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
            -this.scratchA
              .copy(point)
              .applyMatrix4(this.camera.matrixWorldInverse).z,
          )
        : 1;
    return (2 * depth) / (this.height * projectionY);
  }
  private wheel = (event: WheelEvent): void => {
    this.inMotion();
    this.fitted = false;
    event.preventDefault();
    const before = this.locate(event)?.clone();
    this.camera.zoom = this.view.clampZoom(
      this.camera.zoom * Math.exp(-event.deltaY * 0.001),
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
  /** Screen rectangle covering a node's top face, for overlay editors. */
  public nodeScreenRect(
    id: string,
  ): { left: number; top: number; width: number; height: number } | undefined {
    const tile = this.tiles.get(id);
    if (!tile) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { x, y, z } = tile.group.position;
    const top = y + pickHeight(tile.node) / 2;
    let left = Infinity,
      right = -Infinity,
      upper = Infinity,
      lower = -Infinity;
    const point = new Vector3();
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        point
          .set(
            x + (sx * tile.node.width) / 2,
            top,
            z + (sz * tile.node.depth) / 2,
          )
          .project(this.camera);
        const px = rect.left + ((point.x + 1) * this.width) / 2;
        const py = rect.top + ((1 - point.y) * this.height) / 2;
        left = Math.min(left, px);
        right = Math.max(right, px);
        upper = Math.min(upper, py);
        lower = Math.max(lower, py);
      }
    return { left, top: upper, width: right - left, height: lower - upper };
  }
  /** Client position of a connection's label anchor. */
  public edgeScreenPosition(id: string): { x: number; y: number } | undefined {
    const index = this.edges.get(id);
    const edge = this.edgeIndex.get(id);
    if (index === undefined || !edge) return;
    const { points } = routeEdge(
      edge,
      this.nodeIndex,
      this.obstacles,
      this.fans,
    );
    const { point } = routeMidpoint(points);
    const projected = new Vector3(point.x, 8, point.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) * this.width) / 2,
      y: rect.top + ((1 - projected.y) * this.height) / 2,
    };
  }
  /** World units per screen pixel around a node; overlay editors match zoom. */
  public nodePixelScale(id: string): number {
    const tile = this.tiles.get(id);
    return tile ? 1 / this.pixelSize(tile.group.position) : 1;
  }
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
    const previous = [...this.selectedIds];
    this.selectedIds.clear();
    for (const id of ids) if (this.tiles.has(id)) this.selectedIds.add(id);
    this.selected = [...this.selectedIds].at(-1);
    // Only tiles entering or leaving the selection change colour.
    for (const id of new Set([...previous, ...this.selectedIds])) {
      const tile = this.tiles.get(id);
      if (tile)
        this.bodies?.update(
          tile.node,
          tile.group.position,
          this.selectedIds.has(id),
        );
    }
    this.ports.clear();
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    // Handles only for a single selection; a multi-selection moves as a unit.
    if (!tile || this.selectedIds.size !== 1) return;
    for (const port of ['north', 'east', 'south', 'west'] as const) {
      const mesh = new Mesh(this.portGeometry, this.portMaterial);
      mesh.userData.nodeId = tile.node.id;
      mesh.userData.port = port;
      mesh.renderOrder = 12;
      this.ports.add(overlay(mesh));
    }
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 0, 1]) {
        if (!sx && !sz) continue;
        const handle = new Mesh(this.handleGeometry, this.handleMaterial);
        handle.userData.nodeId = tile.node.id;
        handle.userData.resize = [sx, sz];
        handle.renderOrder = 13;
        this.ports.add(overlay(handle));
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
    // A branch off the active route fades toward the sky.
    if (
      (this.inactive.has(id) ||
        this.edgeIndex.get(id)?.relationship === 'dependency') &&
      id !== this.selectedEdge &&
      id !== this.hoveredEdge
    )
      this.scratchColor.lerp(this.dimColor.set(this.palette.sky[1]), 0.68);
    const { r, g, b } = this.scratchColor;
    for (let i = index * 42, end = i + 42; i < end; i += 3) {
      this.edgeColors[i] = r;
      this.edgeColors[i + 1] = g;
      this.edgeColors[i + 2] = b;
    }
    this.edgeColorBuffer.addUpdateRange(index * 42, 42);
    this.edgeColorBuffer.needsUpdate = true;
  }
  public refresh(): void {
    this.updatePositions();
    this.invalidate();
  }
  /** Draw fast while the view moves, then once at full quality when it rests. */
  private inMotion(): void {
    this.motionUntil = performance.now() + 200;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.invalidate();
    }, 220);
  }
  private invalidate(): void {
    this.dirty = true;
    this.schedule();
  }
  /** Request a frame without marking the board changed (animation ticks). */
  private schedule(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }
  /** Walk a person along the arrows from the given nodes, looping until stopped. */
  public onJourneyPermit: (edge: string) => boolean = () => true;
  public playJourney(
    starts: readonly string[],
    networkPath?: { path: string[]; allowed: boolean },
  ): void {
    const virtual = new Map<string, DiagramEdge>();
    if (networkPath)
      for (let i = 1; i < networkPath.path.length; i++) {
        const source = networkPath.path[i - 1],
          target = networkPath.path[i];
        if (source && target)
          virtual.set(`reachability:${i}`, {
            id: `reachability:${i}`,
            source,
            target,
            label: '',
          });
      }
    const edgeAt = (id: string) => virtual.get(id) ?? this.edgeIndex.get(id);
    this.journey?.dispose();
    this.journey = new JourneyPlayer(
      {
        add: (object) => this.scene.add(overlay(object)),
        remove: (object) => this.scene.remove(object),
        animate: (step) => this.animate(step),
        route: (id) => {
          const edge = edgeAt(id);
          const source = edge && this.tiles.get(edge.source);
          const target = edge && this.tiles.get(edge.target);
          if (!edge || !source || !target) return;
          const y =
            Math.max(source.group.position.y, target.group.position.y) + 8;
          return routeEdge(
            edge,
            this.nodeIndex,
            this.obstacles,
            this.fans,
          ).points.map((p) => new Vector3(p.x, y, p.z));
        },
        node: (id) => {
          const tile = this.tiles.get(id);
          if (!tile) return;
          const point = tile.group.position.clone();
          point.y += pickHeight(tile.node) / 2 + 1;
          return {
            point,
            radius: Math.max(tile.node.width, tile.node.depth) * 0.62,
          };
        },
        branches: (id) =>
          networkPath
            ? {
                mode: 'all',
                edges: [...virtual.values()]
                  .filter((e) => e.source === id)
                  .map((e) => e.id),
              }
            : this.onJourneyBranches(id),
        choose: (id, edges) => this.onJourneyChoose(id, edges),
        cancelChoice: () => this.onJourneyCancelChoice(),
        target: (id) => edgeAt(id)?.target,
        onVisit: (id) => {
          const node = this.nodeIndex.get(id);
          this.setJourneyCaption(
            node
              ? `${node.label}${node.journeyCaption ? `\n${node.journeyCaption}` : ''}`
              : '',
          );
        },
        onHop: (id) => this.onJourneyHop(id),
        permit: (id) => {
          const permitted = networkPath
            ? networkPath.allowed
            : this.onJourneyPermit(id);
          if (!permitted)
            this.setJourneyCaption(`Blocked · ${this.journeyCaption}`);
          return permitted;
        },
        onFinish: () => this.onJourneyEnd(),
      },
      this.palette,
    );
    this.journey.start(starts);
  }
  public stopJourney(): void {
    this.setJourneyCaption('');
    this.journey?.dispose();
    const playing = this.journey?.playing;
    this.journey = undefined;
    if (playing !== undefined) this.onJourneyEnd();
  }
  public get journeyPlaying(): boolean {
    return this.journey?.playing ?? false;
  }
  /** Toggle the marching data-flow dashes on every connection. */
  public setFlow(on: boolean): void {
    this.flowing = on;
    if (this.flowLines) this.flowLines.visible = on;
    this.invalidate();
  }
  public get flow(): boolean {
    return this.flowing;
  }
  /**
   * Register per-frame work; the callback returns false once it is finished.
   * While anything animates, the board renders every frame; otherwise it idles.
   */
  public animate(step: (time: number) => boolean): () => void {
    this.animators.add(step);
    this.invalidate();
    return () => {
      this.animators.delete(step);
      this.invalidate();
    };
  }
  private get animating(): boolean {
    return (
      this.content.visible &&
      ((this.flowing && this.hasFlowEdges) || this.animators.size > 0)
    );
  }
  /** Captures pass `quality` so exports never use the FXAA path. */
  private render(quality = false): void {
    const start = performance.now();
    if (this.distancesDirty && this.flowLines) {
      this.flowLines.computeLineDistances();
      this.distancesDirty = false;
    }
    const flow = this.palette.flowStyle ?? DEFAULT_FLOW;
    this.flowMaterial.dashOffset =
      -((start / 1000) * flow.speed) % (flow.dash + flow.gap);
    const changed = this.dirty || quality;
    this.dirty = false;
    this.fog.density = FOG_DENSITY * this.view.fogScale;
    const stepping = this.animators.size > 0;
    for (const step of this.animators)
      if (!step(start)) this.animators.delete(step);
    // Marching dashes only move a uniform: transforms, handles and caption
    // placement are recomputed only when the camera or board changed.
    if (changed) this.syncHandles();
    if (changed || stepping) this.scene.updateMatrixWorld();
    if (changed) {
      const labels = this.labels.sync(
        this.camera,
        this.height,
        this.renderer.getPixelRatio(),
      );
      if (labels || this.staleAnnotations().length)
        this.sharpenLabelsSoon(labels);
    }
    // Count the board's draw calls, not only the final screen pass.
    this.renderer.info.reset();
    this.antialias.render(
      this.renderer,
      this.scene,
      this.camera,
      // MSAA costs several times FXAA on integrated GPUs: keep it for a
      // board at rest, not one redrawn every frame for flow or a journey.
      quality || (start >= this.motionUntil && !this.animating),
    );
    this.flushRetired();
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.frames++;
    this.metrics.lastRenderMs = performance.now() - start;
    if (this.animating) this.schedule();
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
  /**
   * A crisp image of the whole diagram, cropped to its content, regardless of
   * the current pan, zoom or panels. The view is restored afterwards.
   */
  public captureDiagram(): Promise<Blob> {
    if (!this.tiles.size)
      return Promise.reject(Error('Nothing to capture yet.'));
    const restoreView = this.view.snapshot();
    const fitted = this.fitted;
    const ratio = this.renderer.getPixelRatio();
    const hovered = this.hoveredEdge;
    this.hoveredEdge = undefined;
    if (hovered) this.paintEdge(hovered);
    this.ports.visible = false;
    this.view.setPanelVisible(false);
    this.fit();
    this.renderer.setPixelRatio(Math.min(3, Math.max(2, devicePixelRatio)));
    this.sharpenLabels();
    this.render(true);
    const crop = this.contentBounds(28);
    const scale = this.renderer.getPixelRatio();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    // Copy in the same task as the render, while the drawing buffer is valid.
    canvas
      .getContext('2d')
      ?.drawImage(
        this.renderer.domElement,
        crop.left * scale,
        crop.top * scale,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height);
    restoreView();
    this.fitted = fitted;
    this.ports.visible = true;
    if (hovered) {
      this.hoveredEdge = hovered;
      this.paintEdge(hovered);
    }
    this.onZoom(this.view.percent);
    this.invalidate();
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error('PNG encoding failed'))),
        'image/png',
      ),
    );
  }
  /** Screen box (CSS px) around every tile, caption and connection. */
  private contentBounds(padding: number): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    const point = new Vector3();
    const add = (x: number, y: number, z: number) => {
      point.set(x, y, z).project(this.camera);
      const px = ((point.x + 1) * this.width) / 2;
      const py = ((1 - point.y) * this.height) / 2;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    };
    for (const tile of this.tiles.values()) {
      const { x, y, z } = tile.group.position;
      const w = tile.node.width / 2,
        d = tile.node.depth / 2;
      // Captions hang below service tiles; leave room for them.
      const caption = tile.node.kind === 'service' && !tile.node.shape ? 70 : 0;
      for (const sx of [-w, w])
        for (const sz of [-d, d + caption])
          for (const sy of [-12, 40]) add(x + sx, y + sy, z + sz);
    }
    for (let i = 0; i < this.edgePositions.count; i++)
      add(
        this.edgePositions.getX(i),
        this.edgePositions.getY(i),
        this.edgePositions.getZ(i),
      );
    left = Math.max(0, Math.floor(left - padding));
    top = Math.max(0, Math.floor(top - padding));
    right = Math.min(this.width, Math.ceil(right + padding));
    bottom = Math.min(this.height, Math.ceil(bottom + padding));
    return { left, top, width: right - left, height: bottom - top };
  }
  public gifFrame(maxWidth = 640, maxHeight = 480): HTMLCanvasElement {
    this.render(true);
    const canvas = document.createElement('canvas');
    const source = this.renderer.domElement;
    const scale = Math.min(
      1,
      maxWidth / source.width,
      maxHeight / source.height,
    );
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    context?.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (context && this.journeyCaption)
      drawCaption(context, canvas.width, canvas.height, this.journeyCaption);
    return canvas;
  }
  public png(): Promise<Blob> {
    this.render(true);
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
    clearTimeout(this.settleTimer);
    clearTimeout(this.labelTimer);
    this.observer.disconnect();
    this.releaseContent();
    this.flushRetired();
    this.grid.dispose();
    for (const geometry of Object.values(this.shapeGeometries))
      geometry.dispose();
    this.portGeometry.dispose();
    this.portMaterial.dispose();
    this.handleGeometry.dispose();
    this.handleMaterial.dispose();
    this.geometry.dispose();
    this.pickMaterial.dispose();
    this.tileOutline.dispose();
    this.haloMaterial.dispose();
    this.flowMaterial.dispose();
    this.journey?.dispose();
    this.animators.clear();
    this.edgeMaterial.dispose();
    this.backdrop.dispose();
    this.antialias.dispose();
    this.renderer.dispose();
    this.gestures.dispose();
    this.renderer.domElement.remove();
  }
}
