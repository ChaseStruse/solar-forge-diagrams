import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
} from 'three';
import { LANE_HEADER, type LaneBands, laneName } from '../domain/lanes';
import type { ScenePalette } from '../themes';

/** Lane tints, cycled; quiet enough to sit under tiles in every theme. */
const LANE_HUES = [
  '#35e0f0',
  '#b48cff',
  '#ffb547',
  '#58e39b',
  '#ff6fa8',
  '#6aa8ff',
];
/** Just above the grid, below every tile and connection. */
const FLOOR = -10;

export interface LaneBandsView {
  root: Group;
  /** Board-space box around every band, for fitting the view. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dispose(): void;
}

/**
 * Swimlane bands on the board floor: a tinted strip per owner, a stronger
 * header strip at the start of the flow, and the owner's name in it.
 */
export function createLaneBands(
  lanes: LaneBands,
  palette: ScenePalette,
  label: (text: string) => Object3D,
): LaneBandsView {
  const root = new Group();
  root.name = 'lanes';
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const materials: MeshBasicMaterial[] = [];
  const down = lanes.direction === 'down';
  // Board coordinates from along-the-flow (main) and across (cross) values.
  const place = (
    mesh: Object3D,
    main: number,
    cross: number,
    length: number,
    size: number,
  ) => {
    mesh.position.set(down ? cross : main, FLOOR, down ? main : cross);
    mesh.scale.set(down ? size : length, 1, down ? length : size);
  };
  const strip = (color: string, opacity: number) => {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    materials.push(material);
    const mesh = new Mesh(plane, material);
    mesh.renderOrder = -1;
    return mesh;
  };
  const length = lanes.to - lanes.from;
  const header = LANE_HEADER - 60;
  for (const [i, band] of lanes.bands.entries()) {
    const hue = palette.monochrome
      ? palette.group
      : (LANE_HUES[i % LANE_HUES.length] ?? palette.group);
    const size = band.end - band.start;
    const middle = (band.start + band.end) / 2;
    const body = strip(hue, i % 2 ? 0.05 : 0.09);
    place(body, lanes.from + length / 2, middle, length, size);
    const head = strip(hue, 0.22);
    place(head, lanes.from + header / 2, middle, header, size);
    // A thin edge marks where one lane meets the next.
    const edge = strip(hue, 0.5);
    place(edge, lanes.from + length / 2, band.start + 2, length, 4);
    const name = label(laneName(band.owner));
    name.position.set(
      down ? middle : lanes.from + header / 2,
      2,
      down ? lanes.from + header / 2 : middle,
    );
    name.userData.nodeWidth = header;
    name.userData.nodeDepth = size;
    root.add(body, head, edge, name);
  }
  const first = lanes.bands[0]?.start ?? 0;
  const last = lanes.bands.at(-1)?.end ?? 0;
  return {
    root,
    bounds: down
      ? { minX: first, maxX: last, minZ: lanes.from, maxZ: lanes.to }
      : { minX: lanes.from, maxX: lanes.to, minZ: first, maxZ: last },
    dispose() {
      plane.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
