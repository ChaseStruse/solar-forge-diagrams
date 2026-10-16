import type { InterleavedBufferAttribute } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
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

/** Shared insets, shadows, and wire edges cost three draws for the entire board. */
export class TileDetails {
  public readonly root = new Group();
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly faceMaterial = new MeshLambertMaterial({ color: '#345064' });
  private readonly shadowMaterial = new MeshBasicMaterial({
    color: '#02080d',
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private readonly outlineMaterial = new LineBasicMaterial({
    color: '#778895',
    transparent: true,
    opacity: 0.7,
  });
  private readonly outlineGeometry = new BufferGeometry();
  private readonly positions: BufferAttribute;
  private readonly faces: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  private readonly position = new Vector3();
  private readonly scale = new Vector3();

  constructor(
    count: number,
    private readonly source: BufferAttribute | InterleavedBufferAttribute,
  ) {
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
    for (const mesh of [this.faces, this.shadows]) {
      mesh.instanceMatrix.addUpdateRange(index * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (let vertex = 0; vertex < this.source.count; vertex++)
      this.positions.setXYZ(
        index * this.source.count + vertex,
        world.x + this.source.getX(vertex) * (node.shape ? 0 : node.width),
        world.y +
          this.source.getY(vertex) *
            (node.shape ? 0 : node.kind === 'group' ? 2 : 24),
        world.z + this.source.getZ(vertex) * (node.shape ? 0 : node.depth),
      );
    this.positions.addUpdateRange(
      index * this.source.count * 3,
      this.source.count * 3,
    );
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
