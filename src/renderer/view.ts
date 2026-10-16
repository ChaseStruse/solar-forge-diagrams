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
export class BoardView {
  public readonly target = new Vector3();
  private readonly spatial = new PerspectiveCamera(20, 1, 20, 80000);
  private readonly plan = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80000);
  private mode: ViewMode = 'isometric';
  private width = 1;
  private height = 1;
  private distance = 1600;
  private rightInset = 260;
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
    } else
      camera.position.set(
        this.target.x,
        this.target.y + this.distance * Math.sin(ELEVATION),
        this.target.z + this.distance * Math.cos(ELEVATION),
      );
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
  public zoomBy(factor: number): void {
    this.camera.zoom = Math.min(4, Math.max(0.1, this.camera.zoom * factor));
    this.update();
  }
  public get percent(): number {
    return Math.round(this.camera.zoom * 100);
  }
}
