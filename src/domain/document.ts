export interface DiagramNode {
  id: string;
  kind: 'service' | 'group';
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
  parentId?: string;
}
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}
export interface DiagramDocument {
  version: 1;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > 1000)
    throw new Error(`Invalid ${name}`);
  return value;
}
function finite(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1_000_000
  )
    throw new Error('Invalid coordinate');
  return value;
}
export function parseDocument(json: string): DiagramDocument {
  if (json.length > 10_000_000) throw new Error('Document exceeds 10 MB limit');
  const input = record(JSON.parse(json));
  if (input.version !== 1) throw new Error('Unsupported document version');
  if (
    !Array.isArray(input.nodes) ||
    !Array.isArray(input.edges) ||
    input.nodes.length > 10_000 ||
    input.edges.length > 30_000
  )
    throw new Error('Invalid graph size');
  const nodes = input.nodes.map((value: unknown): DiagramNode => {
    const n = record(value);
    if (n.kind !== 'service' && n.kind !== 'group')
      throw new Error('Invalid node kind');
    const node: DiagramNode = {
      id: text(n.id, 'node ID'),
      kind: n.kind,
      label: text(n.label, 'label'),
      x: finite(n.x),
      z: finite(n.z),
      width: finite(n.width),
      depth: finite(n.depth),
      color: text(n.color, 'color'),
    };
    if (
      !node.id ||
      node.width <= 0 ||
      node.depth <= 0 ||
      !/^#[0-9a-f]{6}$/i.test(node.color)
    )
      throw new Error('Invalid node geometry or color');
    if (n.parentId !== undefined) node.parentId = text(n.parentId, 'parent ID');
    return node;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error('Duplicate node ID');
  for (const node of nodes) {
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent !== undefined) {
      if (visited.has(parent)) throw new Error('Group cycle');
      visited.add(parent);
      const group = byId.get(parent);
      if (!group || group.kind !== 'group')
        throw new Error('Invalid parent group');
      parent = group.parentId;
    }
  }
  const edgeIds = new Set<string>();
  const edges = input.edges.map((value: unknown): DiagramEdge => {
    const e = record(value);
    const edge = {
      id: text(e.id, 'edge ID'),
      source: text(e.source, 'source'),
      target: text(e.target, 'target'),
      label: text(e.label, 'label'),
    };
    if (
      !edge.id ||
      edgeIds.has(edge.id) ||
      !byId.has(edge.source) ||
      !byId.has(edge.target)
    )
      throw new Error('Invalid edge reference');
    edgeIds.add(edge.id);
    return edge;
  });
  return { version: 1, title: text(input.title, 'title'), nodes, edges };
}
export function serializeDocument(document: DiagramDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
export function worldPosition(
  node: DiagramNode,
  nodes: ReadonlyMap<string, DiagramNode>,
): { x: number; z: number; level: number } {
  let x = node.x;
  let z = node.z;
  let level = 0;
  let parent = node.parentId;
  while (parent !== undefined) {
    const group = nodes.get(parent);
    if (!group) throw new Error('Missing parent');
    x += group.x;
    z += group.z;
    level += 1;
    parent = group.parentId;
  }
  return { x, z, level };
}
export function sampleDocument(): DiagramDocument {
  return {
    version: 1,
    title: 'Serverless application',
    nodes: [
      {
        id: 'region',
        kind: 'group',
        label: 'AWS / us-east-1',
        x: 0,
        z: 0,
        width: 940,
        depth: 610,
        color: '#27323b',
      },
      {
        id: 'vpc',
        kind: 'group',
        label: 'Application boundary',
        x: 50,
        z: 10,
        width: 650,
        depth: 400,
        color: '#34413b',
        parentId: 'region',
      },
      {
        id: 'gateway',
        kind: 'service',
        label: 'API Gateway',
        x: -280,
        z: -110,
        width: 150,
        depth: 96,
        color: '#a568ce',
        parentId: 'region',
      },
      {
        id: 'lambda',
        kind: 'service',
        label: 'Lambda',
        x: -40,
        z: -80,
        width: 150,
        depth: 96,
        color: '#ed983c',
        parentId: 'vpc',
      },
      {
        id: 'db',
        kind: 'service',
        label: 'DynamoDB',
        x: 190,
        z: -80,
        width: 150,
        depth: 96,
        color: '#548bc4',
        parentId: 'vpc',
      },
      {
        id: 'queue',
        kind: 'service',
        label: 'SQS',
        x: -40,
        z: 110,
        width: 150,
        depth: 96,
        color: '#cb6186',
        parentId: 'vpc',
      },
      {
        id: 'storage',
        kind: 'service',
        label: 'S3',
        x: 190,
        z: 110,
        width: 150,
        depth: 96,
        color: '#79a950',
        parentId: 'vpc',
      },
    ],
    edges: [
      { id: 'request', source: 'gateway', target: 'lambda', label: 'HTTPS' },
      { id: 'write', source: 'lambda', target: 'db', label: 'Read / write' },
      { id: 'event', source: 'lambda', target: 'queue', label: 'Events' },
      { id: 'archive', source: 'queue', target: 'storage', label: 'Archive' },
    ],
  };
}
