import type { InterleavedBufferAttribute } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { DiagramNode } from '../domain/document';
import type { ScenePalette } from '../themes';
import { tinted } from './tile-bodies';

/** Shared insets, shadows, and wire edges cost three draws for the entire board. */
export class TileDetails {
  public readonly root = new Group();
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly faceMaterial = new MeshLambertMaterial({ color: '#ffffff' });
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly outlineMaterial = new LineBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
  });
  private readonly outlineGeometry = new BufferGeometry();
  private readonly positions: BufferAttribute;
  private readonly colors: BufferAttribute;
  private readonly color = new Color();
  private readonly faces: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  /** Unit-box outline vertices, copied once out of the shared geometry. */
  private readonly template: Float32Array;

  constructor(
    count: number,
    source: BufferAttribute | InterleavedBufferAttribute,
    private readonly palette: ScenePalette,
  ) {
    this.template = new Float32Array(source.count * 3);
    for (let vertex = 0; vertex < source.count; vertex++) {
      this.template[vertex * 3] = source.getX(vertex);
      this.template[vertex * 3 + 1] = source.getY(vertex);
      this.template[vertex * 3 + 2] = source.getZ(vertex);
    }
    this.shadowMaterial = new MeshBasicMaterial({
      color: palette.shadow,
      transparent: true,
      opacity: palette.shadowOpacity,
      depthWrite: false,
    });
    this.faces = new InstancedMesh(this.plane, this.faceMaterial, count);
    this.shadows = new InstancedMesh(this.plane, this.shadowMaterial, count);
    for (const mesh of [this.faces, this.shadows]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    this.positions = new BufferAttribute(
      new Float32Array(count * source.count * 3),
      3,
    ).setUsage(DynamicDrawUsage);
    this.outlineGeometry.setAttribute('position', this.positions);
    this.colors = new BufferAttribute(
      new Float32Array(count * source.count * 3),
      3,
    ).setUsage(DynamicDrawUsage);
    this.outlineGeometry.setAttribute('color', this.colors);
    const outlines = new LineSegments(
      this.outlineGeometry,
      this.outlineMaterial,
    );
    outlines.frustumCulled = false;
    this.root.add(this.faces, this.shadows, outlines);
  }
  public update(index: number, node: DiagramNode, world: Vector3): void {
    if (node.kind === 'service' && !node.shape) {
      this.position.set(world.x, world.y + 12.5, world.z);
      this.scale.set(node.width * 0.82, node.depth * 0.76, 1);
      this.faces.setMatrixAt(
        index,
        this.matrix.compose(this.position, this.rotation, this.scale),
      );
      this.faces.setColorAt(
        index,
        tinted(
          this.color,
          this.palette.face,
          node.color,
          this.palette.faceTint,
        ),
      );
      if (this.faces.instanceColor) {
        this.faces.instanceColor.addUpdateRange(index * 3, 3);
        this.faces.instanceColor.needsUpdate = true;
      }
      this.position.set(world.x + 8, world.y - 14, world.z + 11);
      this.scale.set(node.width * 1.04, node.depth * 1.05, 1);
      this.shadows.setMatrixAt(
        index,
        this.matrix.compose(this.position, this.rotation, this.scale),
      );
    } else {
      this.matrix.makeScale(0, 0, 0);
      this.faces.setMatrixAt(index, this.matrix);
      this.shadows.setMatrixAt(index, this.matrix);
    }
    this.faces.instanceMatrix.addUpdateRange(index * 16, 16);
    this.faces.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.addUpdateRange(index * 16, 16);
    this.shadows.instanceMatrix.needsUpdate = true;
    tinted(
      this.color,
      this.palette.outline,
      node.color,
      node.kind === 'group' ? 0.85 : this.palette.outlineTint,
    );
    const template = this.template;
    const start = index * template.length;
    const colors = this.colors.array;
    const { r, g, b } = this.color;
    for (let i = start, end = start + template.length; i < end; i += 3) {
      colors[i] = r;
      colors[i + 1] = g;
      colors[i + 2] = b;
    }
    this.colors.addUpdateRange(start, template.length);
    this.colors.needsUpdate = true;
    // Shapes and annotations draw their own outline (or none).
    const flat = !!node.shape || node.kind === 'text' || node.kind === 'note';
    const sx = flat ? 0 : node.width;
    const sy = flat ? 0 : node.kind === 'group' ? 2 : 24;
    const sz = flat ? 0 : node.depth;
    const positions = this.positions.array;
    for (let i = 0; i < template.length; i += 3) {
      positions[start + i] = world.x + (template[i] ?? 0) * sx;
      positions[start + i + 1] = world.y + (template[i + 1] ?? 0) * sy;
      positions[start + i + 2] = world.z + (template[i + 2] ?? 0) * sz;
    }
    this.positions.addUpdateRange(start, template.length);
    this.positions.needsUpdate = true;
  }
  public dispose(): void {
    this.faces.dispose();
    this.shadows.dispose();
    this.plane.dispose();
    this.outlineGeometry.dispose();
    this.faceMaterial.dispose();
    this.shadowMaterial.dispose();
    this.outlineMaterial.dispose();
    this.root.clear();
  }
}
