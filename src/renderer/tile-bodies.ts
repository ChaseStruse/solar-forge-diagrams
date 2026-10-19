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
import type { ScenePalette } from '../themes';

/** A theme base colour tinted toward a node's own colour. */
export function tinted(
  target: Color,
  base: string,
  tint: string,
  amount: number,
): Color {
  return target.copy(parsed(base)).lerp(parsed(tint), amount);
}
/** CSS colour strings parse (and convert to linear) once, not per tile update. */
const colors = new Map<string, Color>();
function parsed(style: string): Color {
  let color = colors.get(style);
  if (!color) {
    if (colors.size > 4096) colors.clear();
    color = new Color(style);
    colors.set(style, color);
  }
  return color;
}

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
    private readonly palette: ScenePalette,
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
        opacity: group ? palette.groupOpacity : 1,
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
        mesh.setColorAt(index, this.paint(node, false));
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
    entry.mesh.setColorAt(entry.index, this.paint(node, selected));
    if (entry.mesh.instanceColor) {
      entry.mesh.instanceColor.addUpdateRange(entry.index * 3, 3);
      entry.mesh.instanceColor.needsUpdate = true;
    }
  }
  private paint(node: DiagramNode, selected: boolean): Color {
    const palette = this.palette;
    if (node.kind === 'group')
      tinted(
        this.color,
        palette.group,
        node.color,
        palette.monochrome ? 0 : 0.35,
      );
    else
      tinted(
        this.color,
        palette.tile,
        node.color,
        palette.monochrome ? 0 : palette.tileTint,
      );
    if (selected) this.color.lerp(parsed(palette.selected), 0.12);
    return this.color;
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
