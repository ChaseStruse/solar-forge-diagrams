import type { DiagramDocument } from '../src/domain/document';

/** Deterministic nested boards; counts include the root group. */
export function benchmarkDocument(
  nodeCount = 500,
  edgeCount = 750,
): DiagramDocument {
  if (nodeCount < 3 || edgeCount < 0)
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
      kind: 'service',
      label: `Service ${i}`,
      x: ((i % columns) - columns / 2) * 190,
      z: (Math.floor(i / columns) - columns / 2) * 140,
      width: 130,
      depth: 80,
      color: '#ed983c',
      parentId: 'root',
    });
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    id: `e${i}`,
    source: `n${(i % (nodeCount - 1)) + 1}`,
    target: `n${((i + 1) % (nodeCount - 1)) + 1}`,
    label: `Flow ${i}`,
  }));
  return {
    version: 1,
    title: `${nodeCount} nodes / ${edgeCount} edges`,
    nodes,
    edges,
  };
}
