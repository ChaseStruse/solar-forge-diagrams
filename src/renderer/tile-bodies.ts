import type { BufferGeometry } from 'three';
import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { DiagramNode } from '../domain/document';

/** Render shared bodies in at most five draws; separate invisible meshes provide picking. */
export class TileBodies {
  public readonly root = new Group();
  private readonly entries = new Map<
    string,
    { mesh: InstancedMesh; index: number }
  >();
  private readonly meshes: InstancedMesh[] = [];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly color = new Color();
  constructor(
    nodes: readonly DiagramNode[],
    box: BufferGeometry,
    shapes: Record<'process' | 'decision' | 'terminal', BufferGeometry>,
  ) {
    for (const kind of [
      'service',
      'group',
      'process',
      'decision',
      'terminal',
    ] as const) {
      const members = nodes.filter((node) =>
        node.shape ? node.shape === kind : node.kind === kind,
      );
      if (!members.length) continue;
      const group = kind === 'group';
      const material = new MeshLambertMaterial({
        color: '#ffffff',
        transparent: group,
        opacity: group ? 0.12 : 1,
        depthWrite: !group,
      });
      const geometry =
        kind === 'process' || kind === 'decision' || kind === 'terminal'
          ? shapes[kind]
          : box;
      const mesh = new InstancedMesh(geometry, material, members.length);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      members.forEach((node, index) => {
        this.entries.set(node.id, { mesh, index });
        mesh.setColorAt(index, this.color.set(group ? '#172c3a' : '#172b3a'));
      });
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }
  public update(node: DiagramNode, position: Vector3, selected = false): void {
    const entry = this.entries.get(node.id);
    if (!entry) return;
    this.scale.set(node.width, node.kind === 'group' ? 2 : 24, node.depth);
    entry.mesh.setMatrixAt(
      entry.index,
      this.matrix.compose(position, this.rotation, this.scale),
    );
    entry.mesh.instanceMatrix.addUpdateRange(entry.index * 16, 16);
    entry.mesh.instanceMatrix.needsUpdate = true;
    entry.mesh.setColorAt(
      entry.index,
      this.color.set(
        selected ? '#715035' : node.kind === 'group' ? '#172c3a' : '#172b3a',
      ),
    );
    if (entry.mesh.instanceColor) {
      entry.mesh.instanceColor.addUpdateRange(entry.index * 3, 3);
      entry.mesh.instanceColor.needsUpdate = true;
    }
  }
  public dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
    this.root.clear();
    this.entries.clear();
  }
}
