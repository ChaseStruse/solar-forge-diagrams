import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export type ViewMode = 'isometric' | 'top';
export interface BoardBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

/**
 * Centered camera: horizontal rows stay horizontal in both editor views.
 * The 2.5D view uses a narrow lens from a fairly high angle, so tiles read as
 * gently tilted slabs rather than steep trapezoids.
 */
const ELEVATION = (52 * Math.PI) / 180;
/** Camera distance the zoom limits are tuned for. */
const REFERENCE_DISTANCE = 1600;
/** Roughly where a small board fits; farther away, fog stops thickening. */
const FOG_DISTANCE = 2800;
const MIN_ZOOM = 0.05;
/** Orbit tilt limits: low enough to see tiles side-on, never upside down. */
export const MIN_PITCH = (12 * Math.PI) / 180;
export const MAX_PITCH = (89 * Math.PI) / 180;
/** Radians of orbit per screen pixel dragged. */
const ORBIT_SPEED = 0.006;
const MAX_ZOOM = 4;
export class BoardView {
  public readonly target = new Vector3();
  private readonly spatial = new PerspectiveCamera(20, 1, 20, 80000);
  private readonly plan = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80000);
  private mode: ViewMode = 'isometric';
  private width = 1;
  private height = 1;
  private distance = REFERENCE_DISTANCE;
  private rightInset = 260;
  /** Experimental 3D orbit: turn around the target and tilt the view. */
  private yaw = 0;
  private pitch = ELEVATION;
  public get camera(): PerspectiveCamera | OrthographicCamera {
    return this.mode === 'top' ? this.plan : this.spatial;
  }
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.plan.left = -width / 2;
    this.plan.right = width / 2;
    this.plan.top = height / 2;
    this.plan.bottom = -height / 2;
    this.spatial.aspect = width / height;
    this.update();
  }
  public setPanelVisible(visible: boolean): void {
    this.rightInset = visible ? 260 : 0;
    this.update();
  }
  public setMode(mode: ViewMode): void {
    this.mode = mode;
    this.update();
  }
  public update(): void {
    const camera = this.camera;
    camera.up.set(0, 1, 0);
    if (this.mode === 'top') {
      camera.up.set(0, 0, -1);
      camera.position.set(this.target.x, 3000, this.target.z);
    } else {
      const flat = this.distance * Math.cos(this.pitch);
      camera.position.set(
        this.target.x + flat * Math.sin(this.yaw),
        this.target.y + this.distance * Math.sin(this.pitch),
        this.target.z + flat * Math.cos(this.yaw),
      );
    }
    camera.lookAt(this.target);
    camera.setViewOffset(
      this.width,
      this.height,
      (this.width < 800 ? 0 : this.rightInset) / 2 - 28,
      0,
      this.width,
      this.height,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  public fit(bounds: BoardBounds): void {
    this.target.set(
      (bounds.minX + bounds.maxX) / 2,
      bounds.maxY / 3,
      (bounds.minZ + bounds.maxZ) / 2,
    );
    const inset = this.width < 800 ? 0 : this.rightInset;
    const availableWidth = Math.max(this.width - inset - 150, 200);
    const availableHeight = Math.max(this.height - 240, 200);
    this.plan.zoom = Math.min(
      2,
      availableWidth / Math.max(bounds.maxX - bounds.minX, 200),
      availableHeight / Math.max(bounds.maxZ - bounds.minZ, 200),
    );
    this.spatial.zoom = 1;
    const point = new Vector3();
    const previousMode = this.mode;
    this.mode = 'isometric';
    let low = 200;
    let high = 60000;
    for (let step = 0; step < 14; step++) {
      this.distance = (low + high) / 2;
      this.update();
      let fits = true;
      for (const x of [bounds.minX, bounds.maxX])
        for (const y of [0, bounds.maxY])
          for (const z of [bounds.minZ, bounds.maxZ]) {
            point.set(x, y, z).project(this.spatial);
            const px = ((point.x + 1) * this.width) / 2;
            const py = ((1 - point.y) * this.height) / 2;
            if (
              px < 100 ||
              px > this.width - inset - 38 ||
              py < 135 ||
              py > this.height - 140 ||
              point.z > 1
            )
              fits = false;
          }
      if (fits) high = this.distance;
      else low = this.distance;
    }
    this.distance = high;
    this.mode = previousMode;
    this.update();
  }
  /** Turn and tilt the 2.5D camera by a screen drag, in pixels. */
  public orbit(dx: number, dy: number): void {
    this.yaw = (this.yaw - dx * ORBIT_SPEED) % (Math.PI * 2);
    this.pitch = Math.min(
      MAX_PITCH,
      Math.max(MIN_PITCH, this.pitch + dy * ORBIT_SPEED),
    );
    this.update();
  }
  /** Back to the standard 2.5D angle. */
  public resetOrbit(): void {
    this.yaw = 0;
    this.pitch = ELEVATION;
    this.update();
  }
  /** Whether the camera has been turned from the standard angle. */
  public get orbited(): boolean {
    return this.yaw !== 0 || this.pitch !== ELEVATION;
  }
  /** Everything needed to put the camera back exactly where it was. */
  public snapshot(): () => void {
    const target = this.target.clone();
    const { distance, rightInset, mode, yaw, pitch } = this;
    const spatialZoom = this.spatial.zoom;
    const planZoom = this.plan.zoom;
    return () => {
      this.target.copy(target);
      this.distance = distance;
      this.rightInset = rightInset;
      this.mode = mode;
      this.yaw = yaw;
      this.pitch = pitch;
      this.spatial.zoom = spatialZoom;
      this.plan.zoom = planZoom;
      this.update();
    };
  }
  /**
   * The 2.5D camera backs away to fit a large board, so its zoom ceiling grows
   * with that distance: tiles can always be magnified to the same on-screen
   * size, however big the board is.
   */
  public clampZoom(zoom: number): number {
    const reach =
      this.mode === 'top' ? 1 : Math.max(1, this.distance / REFERENCE_DISTANCE);
    return Math.min(MAX_ZOOM * reach, Math.max(MIN_ZOOM, zoom));
  }
  /**
   * Fog density multiplier. Fog is atmosphere relative to the view: a large
   * board seen from far away must not fade into the fog colour.
   */
  public get fogScale(): number {
    return this.mode === 'top' ? 1 : Math.min(1, FOG_DISTANCE / this.distance);
  }
  public zoomBy(factor: number): void {
    this.camera.zoom = this.clampZoom(this.camera.zoom * factor);
    this.update();
  }
  public get percent(): number {
    return Math.round(this.camera.zoom * 100);
  }
}
