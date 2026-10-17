import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import type { DiagramNode } from '../src/domain/document';
import { nodesInSelectionRect, selectionRect } from '../src/renderer/selection';
import { BoardView } from '../src/renderer/view';

const nodes: DiagramNode[] = [
  {
    id: 'boundary',
    kind: 'group',
    label: 'VPC',
    x: 400,
    z: 200,
    width: 700,
    depth: 400,
    color: '#123456',
  },
  {
    id: 'a',
    kind: 'service',
    label: 'A',
    parentId: 'boundary',
    x: -100,
    z: 0,
    width: 80,
    depth: 60,
    color: '#123456',
  },
  {
    id: 'b',
    kind: 'service',
    label: 'B',
    parentId: 'boundary',
    x: 100,
    z: 0,
    width: 80,
    depth: 60,
    color: '#123456',
  },
  {
    id: 'outside',
    kind: 'service',
    label: 'Outside',
    x: 1000,
    z: 200,
    width: 80,
    depth: 60,
    color: '#123456',
  },
];
const index = new Map(nodes.map((node) => [node.id, node]));

for (const mode of ['top', 'isometric'] as const) {
  test(`${mode}: a rectangle selects nested services in either drag direction without their boundary`, () => {
    const view = new BoardView();
    view.resize(1440, 1000);
    view.fit({ minX: 50, maxX: 1040, minZ: 0, maxZ: 400, maxY: 24 });
    view.setMode(mode);
    const a = new Vector3(245, 20, 145).project(view.camera);
    const b = new Vector3(555, 0, 255).project(view.camera);
    const from = { x: ((a.x + 1) * 1440) / 2, y: ((1 - a.y) * 1000) / 2 };
    const to = { x: ((b.x + 1) * 1440) / 2, y: ((1 - b.y) * 1000) / 2 };
    expect(
      nodesInSelectionRect(
        index,
        view.camera,
        1440,
        1000,
        selectionRect(from, to),
      ),
    ).toEqual(['a', 'b']);
    expect(
      nodesInSelectionRect(
        index,
        view.camera,
        1440,
        1000,
        selectionRect(to, from),
      ),
    ).toEqual(['a', 'b']);
    expect(
      nodesInSelectionRect(index, view.camera, 1440, 1000, {
        left: 0,
        top: 0,
        right: 1440,
        bottom: 1000,
      }),
    ).toEqual(['boundary', 'a', 'b', 'outside']);
    expect(
      nodesInSelectionRect(index, view.camera, 1440, 1000, {
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
      }),
    ).toEqual([]);
  });
}
