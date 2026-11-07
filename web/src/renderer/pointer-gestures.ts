import { type Intersection, type Object3D, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { type DiagramNode, isPort, type Port } from '../domain/document';
import { nearestPort, type Point, portPosition } from '../domain/routing';
import type { ScenePalette } from '../themes';
import { OverlayLine } from './overlay-line';
import type { DiagramScene, SketchStroke, Tool } from './scene';
import {
  type ScreenPoint,
  type SelectionRect,
  selectionRect,
} from './selection';
import { type Rect, snapToNeighbours } from './smart-guides';

/** Pointer Events button number for a pen's eraser end. */
const ERASER_BUTTON = 5;
/** Screen pixels a pen may wobble on a tap before it counts as a drag. */
const PEN_TAP_SLOP = 6;

interface Box {
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** Both views keep +X screen-right and +Z screen-down, so cursors map directly. */
function resizeCursor(sx: number, sz: number): string {
  if (!sx) return 'ns-resize';
  if (!sz) return 'ew-resize';
  return sx * sz > 0 ? 'nwse-resize' : 'nesw-resize';
}

/** Scene callbacks a gesture reports to; read at call time. */
export type GestureEvents = Pick<
  DiagramScene,
  | 'onPlace'
  | 'onConnect'
  | 'onMove'
  | 'onMoves'
  | 'onResize'
  | 'onSketch'
  | 'onErase'
  | 'onEditRequest'
  | 'onContextMenu'
  | 'onPenInput'
>;

/**
 * What gestures need from the board: picking under the pointer, node
 * geometry, live repositioning, selection and the view. The scene implements
 * it; gestures never touch the camera, renderer or meshes directly.
 */
export interface GestureBoard {
  readonly canvas: HTMLCanvasElement;
  readonly tool: Tool;
  readonly snapping: boolean;
  /** Aim the picking ray at a pointer; returns where it meets the board. */
  locate(event: { clientX: number; clientY: number }): Vector3 | undefined;
  /** Aim the picking ray at a point on the board plane. */
  aimAt(x: number, z: number): void;
  /** Topmost node under the ray; services win over boundaries. */
  nodeAt(): string | undefined;
  /** Resize or port handle under the ray. */
  handleAt(): Object3D | undefined;
  /** Every node mesh under the ray, nearest first. */
  pickNodes(): Intersection[];
  /** Nearest connection within a few pixels of a pointer. */
  edgeAt(event: { clientX: number; clientY: number }): string | undefined;
  /** Nodes whose centres fall inside a canvas-pixel rectangle. */
  nodesInScreenRect(rect: SelectionRect): string[];
  viewportSize(): { width: number; height: number };
  /** World units covered by one screen pixel at a point. */
  pixelSize(point: Vector3): number;
  /** The node drawn by a tile, by id. */
  tileNode(id: string): DiagramNode | undefined;
  /** Where a tile is drawn, including its nesting height. */
  tilePosition(id: string): { x: number; y: number; z: number } | undefined;
  /** Every node drawn on the board, in tile order. */
  tileNodes(): DiagramNode[];
  readonly nodeIndex: ReadonlyMap<string, DiagramNode>;
  /** A node's box in world coordinates. */
  worldRect(id: string): Rect;
  /** Restretch a tile after its node's size changed. */
  applySize(id: string): void;
  refreshPositions(ids: readonly string[]): void;
  updatePositions(): void;
  /** Move the camera target by a board-space offset. */
  panBoard(dx: number, dz: number): void;
  setCursor(cursor: string): void;
  /** The cursor of the active tool over empty board. */
  toolCursor(): string;
  hoverEdge(id: string | undefined): void;
  readonly selection: readonly string[];
  /** The primary selected node, which handles and the inspector follow. */
  readonly selected: string | undefined;
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedEdge: string | undefined;
  select(id: string | undefined, additive?: boolean): void;
  selectEdge(id: string | undefined): void;
  selectMany(ids: readonly string[]): void;
  /** Make an already-selected node the primary one without reselecting. */
  setPrimary(id: string): void;
  /** A gesture is moving the view or board: draw cheaply for a moment. */
  inMotion(): void;
  invalidate(): void;
}

/**
 * Pointer input on the board: select, drag, resize, marquee, connect,
 * sketch, erase, pan, place text, context menu and double-click. Each
 * gesture's state lives here; the board is changed only through
 * GestureBoard and the outcome is reported through the scene callbacks.
 */
export class PointerGestures {
  /** The last pointer was a pen: handles and hit areas are pen-sized. */
  public penInput = false;
  private activePointer: number | undefined;
  private connectionStart: { id: string; port?: Port } | undefined;
  /** The pen stroke being drawn with the sketch tool. */
  private stroke:
    | {
        points: { x: number; z: number }[];
        last: ScreenPoint;
        from: string | undefined;
      }
    | undefined;
  /** Nodes and connections the eraser has passed over in this stroke. */
  private erasing: { nodes: Set<string>; edges: Set<string> } | undefined;
  /** Where a pen drag started, until it moves far enough to be a drag. */
  private dragSlop: ScreenPoint | undefined;
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
    | {
        id: string;
        x: number;
        z: number;
        startX: number;
        startZ: number;
        /** World box of the grabbed node at drag start. */
        box: Rect;
        /** Boxes of everything not moving, for alignment guides. */
        others: Rect[];
      }
    | undefined;
  private pan: { x: number; z: number } | undefined;
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
  private readonly selectionBox = document.createElement('div');
  /** Dashed line from a connection's start to the pointer. */
  private readonly preview: OverlayLine;
  /** The sketch tool's live pen stroke. */
  private readonly ink: OverlayLine;
  /** Smart guides shown while dragging. */
  private readonly guides: OverlayLine;

  constructor(
    private readonly board: GestureBoard,
    private readonly events: GestureEvents,
    overlays: Object3D,
    container: HTMLElement,
  ) {
    const changed = () => board.invalidate();
    this.preview = new OverlayLine(
      overlays,
      new LineMaterial({
        color: '#ffc778',
        linewidth: 2,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        dashed: true,
        dashSize: 10,
        gapSize: 7,
      }),
      11,
      changed,
    );
    this.ink = new OverlayLine(
      overlays,
      new LineMaterial({
        color: '#ffc778',
        linewidth: 3,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
      12,
      changed,
    );
    this.guides = new OverlayLine(
      overlays,
      new LineMaterial({
        color: '#ff2a6d',
        linewidth: 1.5,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        dashed: true,
        dashSize: 8,
        gapSize: 6,
      }),
      11,
      changed,
    );
    this.selectionBox.className = 'selection-box';
    this.selectionBox.hidden = true;
    this.selectionBox.setAttribute('aria-hidden', 'true');
    container.append(this.selectionBox);
    const canvas = board.canvas;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancelListener);
    canvas.addEventListener('lostpointercapture', this.lostCapture);
    canvas.addEventListener('mousedown', this.preventNativeDrag);
    canvas.addEventListener('dragstart', this.preventNativeDrag);
    canvas.addEventListener('contextmenu', this.context);
    canvas.addEventListener('dblclick', this.doubleClick);
  }

  setPalette(palette: ScenePalette): void {
    this.preview.material.color.set(palette.edgeSelected);
    this.ink.material.color.set(palette.edgeSelected);
    this.guides.material.color.set(palette.guide);
  }

  /** Forget any gesture in progress without reporting or undoing it. */
  reset(): void {
    this.releasePointer();
    this.marquee = undefined;
    this.selectionBox.hidden = true;
    this.drag = undefined;
    this.dragOrigins = [];
    this.resizing = undefined;
    this.pan = undefined;
    this.connectionStart = undefined;
    this.preview.clear();
    this.stroke = undefined;
    this.erasing = undefined;
    this.ink.clear();
  }

  /** Complete the gesture in progress as if the pointer were released. */
  finish(): void {
    this.up();
  }

  /** Abandon the gesture in progress and put the board back as it was. */
  cancel = (): void => {
    this.marquee = undefined;
    this.dragSlop = undefined;
    this.stroke = undefined;
    this.ink.clear();
    if (this.erasing) {
      this.erasing = undefined;
      this.board.selectMany([]);
    }
    this.selectionBox.hidden = true;
    this.releasePointer();
    if (this.resizing) {
      const node = this.board.tileNode(this.resizing.id);
      if (node) {
        Object.assign(node, this.resizing.from);
        this.board.applySize(node.id);
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
    this.guides.clear();
    this.connectionStart = undefined;
    this.preview.clear();
    this.board.updatePositions();
    this.board.invalidate();
  };

  dispose(): void {
    this.cancel();
    const canvas = this.board.canvas;
    canvas.removeEventListener('pointerdown', this.down);
    canvas.removeEventListener('pointermove', this.move);
    canvas.removeEventListener('pointerup', this.up);
    canvas.removeEventListener('pointercancel', this.cancelListener);
    canvas.removeEventListener('lostpointercapture', this.lostCapture);
    canvas.removeEventListener('mousedown', this.preventNativeDrag);
    canvas.removeEventListener('dragstart', this.preventNativeDrag);
    canvas.removeEventListener('contextmenu', this.context);
    canvas.removeEventListener('dblclick', this.doubleClick);
    this.preview.dispose();
    this.ink.dispose();
    this.guides.dispose();
    this.selectionBox.remove();
  }

  private canvasPoint(event: { clientX: number; clientY: number }) {
    const rect = this.board.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private down = (event: PointerEvent): void => {
    const board = this.board;
    this.notePointer(event);
    const eraser = event.button === ERASER_BUTTON;
    if (this.activePointer !== undefined || (event.button > 2 && !eraser))
      return;
    // Claim canvas gestures before WebKit/GTK can interpret an unhandled drag.
    event.preventDefault();
    const point = board.locate(event);
    if (!point) return;
    this.activePointer = event.pointerId;
    if (event.isTrusted) board.canvas.setPointerCapture(event.pointerId);
    if (
      event.button === 1 ||
      event.button === 2 ||
      event.altKey ||
      board.tool === 'pan'
    ) {
      this.pan = { x: point.x, z: point.z };
      return;
    }
    if (eraser) {
      this.erasing = { nodes: new Set(), edges: new Set() };
      this.eraseAt(event);
      return;
    }
    if (board.tool === 'sketch') {
      this.stroke = {
        points: [{ x: point.x, z: point.z }],
        last: this.canvasPoint(event),
        from: board.nodeAt(),
      };
      return;
    }
    if (board.tool === 'text' || board.tool === 'note') {
      this.releasePointer();
      this.events.onPlace(board.tool, Math.round(point.x), Math.round(point.z));
      return;
    }
    const handle = board.handleAt();
    if (handle) {
      const id: unknown = handle.userData.nodeId;
      const node = typeof id === 'string' ? board.tileNode(id) : undefined;
      const resize: unknown = handle.userData.resize;
      if (node && Array.isArray(resize)) {
        const [sx, sz] = resize as [number, number];
        this.resizing = {
          id: node.id,
          sx,
          sz,
          start: { x: point.x, z: point.z },
          from: { x: node.x, z: node.z, width: node.width, depth: node.depth },
          children: board
            .tileNodes()
            .filter((child) => child.parentId === node.id)
            .map((child) => ({ node: child, x: child.x, z: child.z })),
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
    if (board.tool === 'select') {
      const edge = board.edgeAt(event);
      if (edge) {
        board.selectEdge(edge);
        this.releasePointer();
        return;
      }
    }
    const id = board.nodeAt();
    if (board.tool === 'connect') {
      if (id) {
        if (this.connectionStart) {
          this.events.onConnect(
            this.connectionStart.id,
            undefined,
            id,
            undefined,
          );
          this.connectionStart = undefined;
          this.preview.clear();
        } else {
          board.select(id);
          this.connectionStart = { id };
          this.showPreview(point);
        }
      }
      return;
    }
    const hitNode = id ? board.tileNode(id) : undefined;
    if (!id || (hitNode?.kind === 'group' && !board.selectedIds.has(id))) {
      const start = this.canvasPoint(event);
      this.marquee = {
        start,
        end: start,
        initial: board.selection,
        additive: event.shiftKey,
        clickId: id,
        active: false,
      };
      return;
    }
    if (event.shiftKey || !board.selectedIds.has(id))
      board.select(id, event.shiftKey);
    else board.setPrimary(id);
    const node = board.selected ? board.tileNode(board.selected) : undefined;
    if (!node) return;
    this.dragOrigins = board
      .tileNodes()
      .filter((candidate) => {
        if (!board.selectedIds.has(candidate.id)) return false;
        let parent = candidate.parentId;
        while (parent) {
          if (board.selectedIds.has(parent)) return false;
          parent = board.nodeIndex.get(parent)?.parentId;
        }
        return true;
      })
      .map((moving) => ({ node: moving, x: moving.x, z: moving.z }));
    const moving = new Set(this.dragOrigins.map((o) => o.node.id));
    const movingOrInside = (candidate: DiagramNode) => {
      for (let at: string | undefined = candidate.id; at; ) {
        if (moving.has(at)) return true;
        at = board.nodeIndex.get(at)?.parentId;
      }
      return false;
    };
    if (event.pointerType === 'pen')
      this.dragSlop = { x: event.clientX, y: event.clientY };
    this.drag = {
      id: node.id,
      x: point.x,
      z: point.z,
      startX: node.x,
      startZ: node.z,
      box: board.worldRect(node.id),
      others: board
        .tileNodes()
        .filter((other) => !movingOrInside(other))
        .map((other) => board.worldRect(other.id)),
    };
  };

  private hover(event: PointerEvent): void {
    const board = this.board;
    if (!board.locate(event)) return;
    const handle = board.handleAt();
    const resize: unknown = handle?.userData.resize;
    let cursor = board.toolCursor();
    let edge: string | undefined;
    if (Array.isArray(resize)) {
      const [sx, sz] = resize as [number, number];
      cursor = resizeCursor(sx, sz);
    } else if (handle) cursor = 'crosshair';
    else if (board.tool === 'select') {
      edge = board.edgeAt(event);
      if (edge) cursor = 'pointer';
      else if (board.nodeAt()) cursor = 'move';
    }
    board.setCursor(cursor);
    board.hoverEdge(edge);
  }

  private move = (event: PointerEvent): void => {
    const board = this.board;
    if (this.activePointer === undefined) {
      this.notePointer(event);
      this.hover(event);
      return;
    }
    if (event.pointerId !== this.activePointer) return;
    event.preventDefault();
    board.inMotion();
    if (this.erasing) {
      this.eraseAt(event);
      return;
    }
    if (this.stroke) {
      this.extendStroke(event);
      return;
    }
    if (this.marquee) {
      const { width, height } = board.viewportSize();
      const at = this.canvasPoint(event);
      this.marquee.end = {
        x: Math.max(0, Math.min(width, at.x)),
        y: Math.max(0, Math.min(height, at.y)),
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
    const point = board.locate(event);
    if (!point) return;
    if (this.connectionStart) {
      this.showPreview(point);
      return;
    }
    if (this.resizing) {
      const { sx, sz, start, from } = this.resizing;
      const node = board.tileNode(this.resizing.id);
      if (!node) return;
      const step = board.snapping ? 10 : 1;
      const size = (base: number, delta: number) =>
        Math.max(30, Math.round((base + delta) / step) * step);
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
      board.applySize(node.id);
      board.refreshPositions([node.id]);
      return;
    }
    if (this.pan) {
      board.panBoard(this.pan.x - point.x, this.pan.z - point.z);
      return;
    }
    if (!this.drag) return;
    if (!board.tileNode(this.drag.id)) return;
    // A pen tap wobbles a little; do not nudge the node until it really moves.
    if (this.dragSlop) {
      if (
        Math.hypot(
          event.clientX - this.dragSlop.x,
          event.clientY - this.dragSlop.y,
        ) < PEN_TAP_SLOP
      )
        return;
      this.dragSlop = undefined;
    }
    const step = board.snapping ? 10 : 1;
    let dx = Math.round((point.x - this.drag.x) / step) * step;
    let dz = Math.round((point.z - this.drag.z) / step) * step;
    if (!event.ctrlKey) {
      const snapped = this.alignToNeighbours(this.drag, dx, dz);
      dx = snapped.dx;
      dz = snapped.dz;
    } else this.guides.clear();
    for (const origin of this.dragOrigins) {
      origin.node.x = origin.x + dx;
      origin.node.z = origin.z + dz;
    }
    board.refreshPositions(this.dragOrigins.map((origin) => origin.node.id));
  };

  /**
   * Smart guides: pull the grabbed node's edges or centre onto a neighbour's
   * when within a few pixels, and draw the line it snapped to.
   */
  private alignToNeighbours(
    drag: NonNullable<PointerGestures['drag']>,
    dx: number,
    dz: number,
  ): { dx: number; dz: number } {
    const box = drag.box;
    const threshold =
      8 *
      this.board.pixelSize(
        new Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2),
      );
    const snapped = snapToNeighbours(box, drag.others, dx, dz, threshold);
    this.guides.set(snapped.segments);
    return { dx: snapped.dx, dz: snapped.dz };
  }

  /** Track whether a pen or a mouse is driving, and size handles to match. */
  private notePointer(event: PointerEvent): void {
    const pen = event.pointerType === 'pen';
    if (pen === this.penInput) return;
    this.penInput = pen;
    this.events.onPenInput(pen);
    this.board.invalidate();
  }

  private extendStroke(event: PointerEvent): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const screen = this.canvasPoint(event);
    // Skip sub-pixel jitter; the recogniser resamples anyway.
    if (Math.hypot(screen.x - stroke.last.x, screen.y - stroke.last.y) < 2)
      return;
    const point = this.board.locate(event);
    if (!point) return;
    stroke.last = screen;
    stroke.points.push({ x: point.x, z: point.z });
    this.showInk(stroke.points);
  }

  private finishStroke(
    stroke: NonNullable<PointerGestures['stroke']>,
  ): SketchStroke {
    const board = this.board;
    const result: SketchStroke = { points: stroke.points };
    const first = stroke.points[0];
    const last = stroke.points.at(-1);
    const from = stroke.from ? board.nodeIndex.get(stroke.from) : undefined;
    if (from && first)
      result.from = {
        id: from.id,
        port: nearestPort(from, first, board.nodeIndex),
      };
    if (last) {
      // Ray from the last point, so a stroke ending on a tile's top counts.
      board.aimAt(last.x, last.z);
      const id = board.nodeAt();
      const to = id ? board.nodeIndex.get(id) : undefined;
      if (to)
        result.to = { id: to.id, port: nearestPort(to, last, board.nodeIndex) };
    }
    return result;
  }

  private showInk(points: readonly { x: number; z: number }[]): void {
    if (points.length < 2) return;
    const positions: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; z: number };
      const b = points[i] as { x: number; z: number };
      positions.push(a.x, 30, a.z, b.x, 30, b.z);
    }
    this.ink.set(positions);
  }

  /** Mark whatever the eraser is over; boundaries are left alone. */
  private eraseAt(event: PointerEvent): void {
    const board = this.board;
    const erasing = this.erasing;
    if (!erasing || !board.locate(event)) return;
    const edge = board.edgeAt(event);
    if (edge) erasing.edges.add(edge);
    const id: unknown = board.pickNodes().find((h) => {
      const hit: unknown = h.object.userData.nodeId;
      return (
        typeof hit === 'string' && board.nodeIndex.get(hit)?.kind !== 'group'
      );
    })?.object.userData.nodeId;
    if (typeof id === 'string' && !erasing.nodes.has(id)) {
      erasing.nodes.add(id);
      board.selectMany([...erasing.nodes]);
    }
  }

  private showPreview(point: Vector3): void {
    const start = this.connectionStart;
    const node = start ? this.board.tileNode(start.id) : undefined;
    const at = start ? this.board.tilePosition(start.id) : undefined;
    if (!start || !node || !at) return;
    const from = start.port
      ? portPosition(node, start.port, this.board.nodeIndex)
      : { x: at.x, z: at.z };
    const y = at.y + 14;
    this.preview.set([from.x, y, from.z, point.x, y, point.z]);
  }

  private up = (event?: PointerEvent): void => {
    const board = this.board;
    if (event && event.pointerId !== this.activePointer) return;
    this.dragSlop = undefined;
    if (this.erasing) {
      const { nodes, edges } = this.erasing;
      this.erasing = undefined;
      this.releasePointer();
      if (nodes.size || edges.size) this.events.onErase([...nodes], [...edges]);
      return;
    }
    if (this.stroke) {
      if (event) this.extendStroke(event);
      const stroke = this.stroke;
      this.stroke = undefined;
      this.releasePointer();
      this.ink.clear();
      this.events.onSketch(this.finishStroke(stroke));
      return;
    }
    if (this.marquee) {
      if (event) this.move(event);
      const marquee = this.marquee;
      this.marquee = undefined;
      this.selectionBox.hidden = true;
      if (marquee.active) {
        const ids = board.nodesInScreenRect(
          selectionRect(marquee.start, marquee.end),
        );
        board.selectMany(
          marquee.additive ? [...new Set([...marquee.initial, ...ids])] : ids,
        );
      } else board.select(marquee.clickId, marquee.additive);
    }
    this.releasePointer();
    if (this.resizing) {
      const { id, from, children } = this.resizing;
      this.resizing = undefined;
      const node = board.tileNode(id);
      if (
        node &&
        (node.width !== from.width ||
          node.depth !== from.depth ||
          node.x !== from.x ||
          node.z !== from.z)
      )
        this.events.onResize([
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
    if (this.connectionStart && event && board.tool !== 'connect') {
      const start = this.connectionStart;
      this.connectionStart = undefined;
      this.preview.clear();
      const point = board.locate(event);
      const target = board
        .pickNodes()
        .find((h) => h.object.userData.nodeId !== start.id);
      const id: unknown = target?.object.userData.nodeId;
      const node = typeof id === 'string' ? board.nodeIndex.get(id) : undefined;
      if (node && point)
        this.events.onConnect(
          start.id,
          start.port,
          node.id,
          nearestPort(node, point, board.nodeIndex),
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
    this.guides.clear();
    if (moves.length === 1) {
      const move = moves[0];
      if (move) this.events.onMove(move.id, move.from, move.to);
    } else if (moves.length) this.events.onMoves(moves);
  };

  private cancelListener = (): void => this.cancel();
  private lostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointer) this.cancel();
  };
  private releasePointer(): void {
    const pointer = this.activePointer;
    this.activePointer = undefined;
    const canvas = this.board.canvas;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
  }
  private preventNativeDrag = (event: Event): void => event.preventDefault();

  private context = (event: MouseEvent): void => {
    const board = this.board;
    event.preventDefault();
    const edge = board.edgeAt(event);
    if (edge) board.selectEdge(edge);
    else if (!board.selectedEdge || board.selectedIds.size) {
      // Right-clicking an unselected node acts on that node.
      board.locate(event);
      const id = board.nodeAt();
      if (id && !board.selectedIds.has(id)) board.select(id);
    }
    this.events.onContextMenu(event.clientX, event.clientY);
  };

  private doubleClick = (event: MouseEvent): void => {
    const board = this.board;
    if (board.tool !== 'select') return;
    const edge = board.edgeAt(event);
    if (edge) {
      this.events.onEditRequest({ kind: 'edge', id: edge });
      return;
    }
    const point = board.locate(event);
    const id = board.nodeAt();
    if (id) {
      board.select(id);
      this.events.onEditRequest({ kind: 'node', id });
      return;
    }
    if (point)
      this.events.onEditRequest({
        kind: 'empty',
        x: Math.round(point.x),
        z: Math.round(point.z),
      });
  };
}
