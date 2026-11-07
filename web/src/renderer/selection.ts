import { type Camera, Vector3 } from 'three';
import { type DiagramNode, worldPosition } from '../domain/document';

export interface ScreenPoint {
  x: number;
  y: number;
}
export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function selectionRect(a: ScreenPoint, b: ScreenPoint): SelectionRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Screen-space bounds work in both Plan and the perspective 2.5D view. */
export function nodesInSelectionRect(
  nodes: ReadonlyMap<string, DiagramNode>,
  camera: Camera,
  width: number,
  height: number,
  rectangle: SelectionRect,
): string[] {
  const ids: string[] = [];
  const point = new Vector3();
  for (const node of nodes.values()) {
    const position = worldPosition(node, nodes);
    const halfHeight = node.kind === 'group' ? 1 : 12;
    const bounds = {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    };
    let visible = false;
    for (const x of [-node.width / 2, node.width / 2])
      for (const y of [-halfHeight, halfHeight])
        for (const z of [-node.depth / 2, node.depth / 2]) {
          point
            .set(position.x + x, position.level * 4 + y, position.z + z)
            .project(camera);
          if (point.z >= -1 && point.z <= 1) visible = true;
          const px = ((point.x + 1) * width) / 2;
          const py = ((1 - point.y) * height) / 2;
          bounds.left = Math.min(bounds.left, px);
          bounds.right = Math.max(bounds.right, px);
          bounds.top = Math.min(bounds.top, py);
          bounds.bottom = Math.max(bounds.bottom, py);
        }
    if (!visible) continue;
    // A small marquee inside a boundary selects its children, not the whole parent.
    const selected =
      node.kind === 'group'
        ? bounds.left >= rectangle.left &&
          bounds.right <= rectangle.right &&
          bounds.top >= rectangle.top &&
          bounds.bottom <= rectangle.bottom
        : bounds.right >= rectangle.left &&
          bounds.left <= rectangle.right &&
          bounds.bottom >= rectangle.top &&
          bounds.top <= rectangle.bottom;
    if (selected) ids.push(node.id);
  }
  return ids;
}
