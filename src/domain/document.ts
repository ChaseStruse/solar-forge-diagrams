export type Port = 'north' | 'east' | 'south' | 'west';
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
  serviceId?: string;
  shape?: 'process' | 'decision' | 'terminal';
  boundary?: 'account' | 'region' | 'vpc' | 'zone' | 'subnet';
  metadata?: {
    region?: string;
    environment?: string;
    resourceName?: string;
    notes?: string;
    tags?: string;
  };
}
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  sourcePort?: Port;
  targetPort?: Port;
  routing?: 'horizontal' | 'vertical';
  bend?: number;
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
    if (n.serviceId !== undefined)
      node.serviceId = text(n.serviceId, 'service ID');
    if (n.shape !== undefined) {
      if (
        n.shape !== 'process' &&
        n.shape !== 'decision' &&
        n.shape !== 'terminal'
      )
        throw Error('Invalid flowchart shape');
      node.shape = n.shape;
    }
    if (n.boundary !== undefined) {
      if (
        !['account', 'region', 'vpc', 'zone', 'subnet'].includes(
          String(n.boundary),
        )
      )
        throw Error('Invalid boundary kind');
      node.boundary = n.boundary as NonNullable<DiagramNode['boundary']>;
    }
    if (n.metadata !== undefined) {
      const metadata = record(n.metadata);
      node.metadata = {};
      for (const key of [
        'region',
        'environment',
        'resourceName',
        'notes',
        'tags',
      ] as const)
        if (metadata[key] !== undefined)
          node.metadata[key] = text(metadata[key], key);
    }
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
    const edge: DiagramEdge = {
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
    for (const key of ['sourcePort', 'targetPort'] as const) {
      const value = e[key];
      if (value !== undefined) {
        if (
          value !== 'north' &&
          value !== 'east' &&
          value !== 'south' &&
          value !== 'west'
        )
          throw Error('Invalid named port');
        edge[key] = value;
      }
    }
    if (e.routing !== undefined) {
      if (e.routing !== 'horizontal' && e.routing !== 'vertical')
        throw Error('Invalid routing');
      edge.routing = e.routing;
    }
    if (e.bend !== undefined) edge.bend = finite(e.bend);
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
        depth: 900,
        color: '#27323b',
      },
      {
        id: 'vpc',
        kind: 'group',
        label: 'Application boundary',
        x: 50,
        z: 10,
        width: 650,
        depth: 720,
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
        z: 310,
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
        z: 310,
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

/** A clear first board matching the reference's two-node composition. */
export function starterDocument(): DiagramDocument {
  return {
    version: 1,
    title: 'Untitled architecture',
    nodes: [
      {
        id: 'function',
        serviceId: 'aws.lambda',
        kind: 'service',
        label: 'Lambda',
        x: -300,
        z: 0,
        width: 180,
        depth: 150,
        color: '#f6bd72',
      },
      {
        id: 'database',
        serviceId: 'aws.dynamodb',
        kind: 'service',
        label: 'DynamoDB',
        x: 300,
        z: 0,
        width: 180,
        depth: 150,
        color: '#82b7df',
      },
    ],
    edges: [
      {
        id: 'request',
        source: 'function',
        target: 'database',
        label: 'Read / write',
      },
    ],
  };
}
