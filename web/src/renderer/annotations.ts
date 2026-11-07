import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { DiagramNode } from '../domain/document';
import { fitText, fontSize } from '../domain/text';
import type { ScenePalette } from '../themes';

export const NOTE_HEIGHT = 8;
const slab = new BoxGeometry(1, 1, 1);

/**
 * Text and sticky notes lie flat on the board, drawn into their own canvas so
 * they wrap, scale with zoom and export with the scene.
 */
export function createAnnotation(
  node: DiagramNode,
  palette: ScenePalette,
  /** Canvas pixels per world unit wanted; capped to a 4096 px canvas. */
  wanted = 3,
): { root: Group; dispose: () => void } {
  const note = node.kind === 'note';
  const root = new Group();
  root.userData.width = node.width;
  root.userData.depth = node.depth;
  const limit = 4096 / Math.max(node.width, node.depth);
  const resolution = Math.min(wanted, limit);
  root.userData.resolution = resolution;
  root.userData.capped = wanted > limit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(node.width * resolution));
  canvas.height = Math.max(2, Math.round(node.depth * resolution));
  const context = canvas.getContext('2d');
  if (!context) throw Error('Annotation canvas unavailable');
  context.scale(resolution, resolution);
  const padding = note ? 14 : 4;
  const family = palette.labelFont ?? 'Inter, system-ui, sans-serif';
  if (note) {
    // Paper with a folded corner.
    const fold = Math.min(22, node.width / 5, node.depth / 5);
    context.fillStyle = palette.monochrome ? palette.note.paper : node.color;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(node.width, 0);
    context.lineTo(node.width, node.depth - fold);
    context.lineTo(node.width - fold, node.depth);
    context.lineTo(0, node.depth);
    context.closePath();
    context.fill();
    if (palette.monochrome) {
      // Inked comic-panel edge instead of a coloured sheet.
      context.lineWidth = 3;
      context.strokeStyle = palette.note.text;
      context.stroke();
    }
    context.fillStyle = '#00000022';
    context.beginPath();
    context.moveTo(node.width, node.depth - fold);
    context.lineTo(node.width - fold, node.depth - fold);
    context.lineTo(node.width - fold, node.depth);
    context.closePath();
    context.fill();
  }
  const { size, lines } = fitText(
    node.label,
    node.width - padding * 2,
    node.depth - padding * 2,
    fontSize(node),
    (text, size) => {
      context.font = `${note ? 500 : 600} ${size}px ${family}`;
      return context.measureText(text).width;
    },
  );
  context.font = `${note ? 500 : 600} ${size}px ${family}`;
  context.fillStyle = note ? palette.note.text : palette.text;
  context.textBaseline = 'top';
  const lineHeight = size * 1.28;
  context.save();
  context.beginPath();
  context.rect(
    padding,
    padding,
    node.width - padding * 2,
    node.depth - padding * 2,
  );
  context.clip();
  for (const [index, line] of lines.entries())
    context.fillText(line, padding, padding + index * lineHeight);
  context.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const plane = new PlaneGeometry(node.width, node.depth);
  plane.rotateX(-Math.PI / 2);
  const face = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const surface = new Mesh(plane, face);
  surface.position.y = note ? NOTE_HEIGHT / 2 + 0.6 : 1.5;
  surface.renderOrder = 3;
  root.add(surface);
  let body: MeshLambertMaterial | undefined;
  if (note) {
    body = new MeshLambertMaterial({ color: node.color });
    body.color.multiplyScalar(0.75);
    const paper = new Mesh(slab, body);
    paper.scale.set(node.width, NOTE_HEIGHT, node.depth);
    root.add(paper);
    const shadow = new Mesh(
      plane,
      new MeshBasicMaterial({
        color: palette.shadow,
        transparent: true,
        opacity: palette.shadowOpacity,
        depthWrite: false,
      }),
    );
    shadow.position.set(6, -NOTE_HEIGHT / 2 - 0.5, 8);
    root.add(shadow);
  }
  return {
    root,
    dispose: () => {
      texture.dispose();
      plane.dispose();
      face.dispose();
      body?.dispose();
      for (const child of root.children)
        if (
          child instanceof Mesh &&
          child.material !== face &&
          child.material !== body
        )
          child.material.dispose();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
