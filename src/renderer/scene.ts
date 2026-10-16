import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
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
import { portPosition, routeEdge } from '../domain/routing';
import { createBackdrop } from './backdrop';
import { LabelAtlas } from './labels';
import { TileBodies } from './tile-bodies';
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
  private tool: 'select' | 'pan' | 'connect' = 'select';
  public snapping = true;
  private readonly selectedIds = new Set<string>();
  private readonly portGeometry = new SphereGeometry(5, 8, 6);
  private readonly portMaterial = new MeshBasicMaterial({
    color: '#ffc778',
    depthTest: false,
  });
  private readonly ports = new Group();
  private connectionStart: { id: string; port: Port } | undefined;
  public onConnect: (
    source: string,
    sourcePort: Port,
    target: string,
    targetPort: Port,
  ) => void = () => {};
  public onMoves: (
    moves: {
      id: string;
      from: { x: number; z: number };
      to: { x: number; z: number };
    }[],
  ) => void = () => {};
  public onContextMenu: (x: number, y: number) => void = () => {};
  public onResize: (
    id: string,
    from: { width: number; depth: number },
    to: { width: number; depth: number },
  ) => void = () => {};
  private resizing:
    | { id: string; width: number; depth: number; x: number; z: number }
    | undefined;
  private dragOrigins: { node: DiagramNode; x: number; z: number }[] = [];
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
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.z - start.z);
    if (this.edgeBuffer) {
      this.edgeBuffer.addUpdateRange(index * 42, 42);
      this.edgeBuffer.needsUpdate = true;
    }
    const label = this.edgeLabels.get(id);
    if (label) {
      label.position.set((start.x + end.x) / 2, y + 8, (start.z + end.z) / 2);
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
    const portHit = this.ray.intersectObjects(this.ports.children, false)[0];
    if (portHit) {
      const id: unknown = portHit.object.userData.nodeId;
      if (portHit.object.userData.resize && typeof id === 'string') {
        const node = this.tiles.get(id)?.node;
        if (node)
          this.resizing = {
            id,
            width: node.width,
            depth: node.depth,
            x: point.x,
            z: point.z,
          };
        return;
      }
      const port: unknown = portHit.object.userData.port;
      if (
        typeof id === 'string' &&
        (port === 'north' ||
          port === 'east' ||
          port === 'south' ||
          port === 'west')
      ) {
        this.connectionStart = { id, port };
        return;
      }
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
    if (this.tool === 'connect') {
      if (typeof id === 'string') {
        if (this.connectionStart) {
          this.onConnect(
            this.connectionStart.id,
            this.connectionStart.port,
            id,
            'west',
          );
          this.connectionStart = undefined;
        } else {
          this.select(id);
          this.connectionStart = { id, port: 'east' };
        }
      }
      return;
    }
    if (event.shiftKey || typeof id !== 'string' || !this.selectedIds.has(id))
      this.select(typeof id === 'string' ? id : undefined, event.shiftKey);
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
  private move = (event: PointerEvent): void => {
    const point = this.locate(event);
    if (!point) return;
    if (this.resizing) {
      const tile = this.tiles.get(this.resizing.id);
      if (!tile) return;
      const step = this.snapping ? 10 : 1;
      tile.node.width = Math.max(
        30,
        Math.round(
          (this.resizing.width + (point.x - this.resizing.x) * 2) / step,
        ) * step,
      );
      tile.node.depth = Math.max(
        30,
        Math.round(
          (this.resizing.depth + (point.z - this.resizing.z) * 2) / step,
        ) * step,
      );
      const mesh = tile.group.children[0];
      if (mesh instanceof Mesh)
        mesh.scale.set(
          tile.node.width,
          tile.node.kind === 'group' ? 2 : 24,
          tile.node.depth,
        );
      tile.label.userData.nodeWidth = tile.node.width;
      this.refreshPosition(tile.node.id);
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
    if (this.selected === id) {
      const p = tile.group.position;
      for (const port of this.ports.children) {
        const name: unknown = port.userData.port;
        port.position.set(
          p.x +
            (port.userData.resize
              ? tile.node.width / 2
              : name === 'east'
                ? tile.node.width / 2
                : name === 'west'
                  ? -tile.node.width / 2
                  : 0),
          p.y + 18,
          p.z +
            (port.userData.resize
              ? tile.node.depth / 2
              : name === 'south'
                ? tile.node.depth / 2
                : name === 'north'
                  ? -tile.node.depth / 2
                  : 0),
        );
      }
    }
    this.invalidate();
  }
  private up = (event?: PointerEvent): void => {
    if (this.resizing) {
      const resizing = this.resizing;
      this.resizing = undefined;
      const node = this.tiles.get(resizing.id)?.node;
      if (
        node &&
        (node.width !== resizing.width || node.depth !== resizing.depth)
      )
        this.onResize(
          node.id,
          { width: resizing.width, depth: resizing.depth },
          { width: node.width, depth: node.depth },
        );
    }
    if (this.connectionStart && event && this.tool !== 'connect') {
      this.locate(event);
      const hits = this.ray.intersectObjects(
        [...this.tiles.values()]
          .map((t) => t.group.children[0])
          .filter((m): m is Mesh => m instanceof Mesh),
        false,
      );
      const target = hits.find(
        (h) => h.object.userData.nodeId !== this.connectionStart?.id,
      );
      const id: unknown = target?.object.userData.nodeId;
      if (typeof id === 'string')
        this.onConnect(
          this.connectionStart.id,
          this.connectionStart.port,
          id,
          'west',
        );
      this.connectionStart = undefined;
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
    if (this.resizing) {
      const node = this.tiles.get(this.resizing.id)?.node;
      if (node) {
        node.width = this.resizing.width;
        node.depth = this.resizing.depth;
        const mesh = this.tiles.get(node.id)?.group.children[0];
        if (mesh instanceof Mesh)
          mesh.scale.set(
            node.width,
            node.kind === 'group' ? 2 : 24,
            node.depth,
          );
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
    this.updatePositions();
    this.invalidate();
  };
  private cancel = (): void => this.cancelInteraction();
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
  public select(id: string | undefined, additive = false): void {
    const ids = additive ? new Set(this.selectedIds) : new Set<string>();
    if (id) {
      if (additive && ids.has(id)) ids.delete(id);
      else ids.add(id);
    }
    this.selectMany([...ids]);
  }
  public selectMany(ids: readonly string[]): void {
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
    if (tile)
      for (const port of ['north', 'east', 'south', 'west'] as const) {
        const mesh = new Mesh(this.portGeometry, this.portMaterial);
        mesh.position.set(
          tile.group.position.x +
            (port === 'east'
              ? tile.node.width / 2
              : port === 'west'
                ? -tile.node.width / 2
                : 0),
          tile.group.position.y + 18,
          tile.group.position.z +
            (port === 'south'
              ? tile.node.depth / 2
              : port === 'north'
                ? -tile.node.depth / 2
                : 0),
        );
        mesh.userData.nodeId = tile.node.id;
        mesh.userData.port = port;
        mesh.renderOrder = 12;
        this.ports.add(mesh);
      }
    if (tile) {
      const handle = new Mesh(this.portGeometry, this.portMaterial);
      handle.position.set(
        tile.group.position.x + tile.node.width / 2,
        tile.group.position.y + 18,
        tile.group.position.z + tile.node.depth / 2,
      );
      handle.scale.setScalar(1.5);
      handle.userData.nodeId = tile.node.id;
      handle.userData.resize = true;
      handle.renderOrder = 12;
      this.ports.add(handle);
    }
    this.onSelect(tile?.node);
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
    const position =
      port === 'resize'
        ? {
            x: tile.group.position.x + tile.node.width / 2,
            z: tile.group.position.z + tile.node.depth / 2,
          }
        : portPosition(tile.node, port, this.nodeIndex);
    const point = new Vector3(
      position.x,
      tile.group.position.y + 18,
      position.z,
    ).project(this.camera);
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
    for (const geometry of Object.values(this.shapeGeometries))
      geometry.dispose();
    this.portGeometry.dispose();
    this.portMaterial.dispose();
    this.geometry.dispose();
    this.tileOutline.dispose();
    this.haloMaterial.dispose();
    this.edgeMaterial.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
