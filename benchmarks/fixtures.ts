import type { DiagramDocument } from '../src/domain/document';

/** Deterministic nested boards; counts include three nested group boundaries. */
export function benchmarkDocument(
  nodeCount = 500,
  edgeCount = 750,
): DiagramDocument {
  if (
    !Number.isInteger(nodeCount) ||
    !Number.isInteger(edgeCount) ||
    nodeCount < 5 ||
    edgeCount < 0
  )
    throw new Error('Invalid fixture dimensions');
  const columns = Math.ceil(Math.sqrt(nodeCount));
  const nodes: DiagramDocument['nodes'] = [
    {
      id: 'root',
      kind: 'group',
      label: 'Benchmark region',
      x: 0,
      z: 0,
      width: columns * 200,
      depth: columns * 150,
      color: '#27323b',
    },
  ];
  for (let i = 1; i < nodeCount; i++)
    nodes.push({
      id: `n${i}`,
      kind: i < 3 ? 'group' : 'service',
      label: i < 3 ? `Boundary ${i}` : `Service ${i}`,
      x: i < 3 ? 0 : ((i % columns) - columns / 2) * 190,
      z: i < 3 ? 0 : (Math.floor(i / columns) - columns / 2) * 140,
      width: i < 3 ? columns * (200 - i * 4) : 130,
      depth: i < 3 ? columns * (150 - i * 4) : 80,
      color: '#ed983c',
      parentId: i === 1 ? 'root' : i === 2 ? 'n1' : 'n2',
    });
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    id: `e${i}`,
    source: `n${(i % (nodeCount - 3)) + 3}`,
    target: `n${((i + 1) % (nodeCount - 3)) + 3}`,
    label: `Flow ${i}`,
  }));
  return {
    version: 1,
    title: `${nodeCount} nodes / ${edgeCount} edges`,
    nodes,
    edges,
  };
}
