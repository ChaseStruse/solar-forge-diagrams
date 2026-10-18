import { boundaryColors, findService, legacyColors } from '../catalog/services';
import { parseNetworkRule, parseTraffic } from './network';
import {
  parseResourceNetwork,
  parseResourcePolicy,
  type ResourceNetwork,
  type ResourcePolicy,
} from './policies';

export type Port = 'north' | 'east' | 'south' | 'west';
export interface DiagramNode {
  detailId?: string;
  journeyCaption?: string;
  network?: ResourceNetwork;
  policy?: ResourcePolicy;
  id: string;
  /** Text and notes are annotations: free text, or text on a sticky note. */
  kind: 'service' | 'group' | 'text' | 'note';
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
  /** World-unit font size for text and notes. */
  fontSize?: number;
  /**
   * What a journey does where this node has several outgoing connections:
   * walk them all, ask which way, or always take one connection.
   */
  journey?: { mode: 'all' | 'ask' } | { mode: 'fixed'; edge: string };
  metadata?: {
    region?: string;
    environment?: string;
    resourceName?: string;
    notes?: string;
    tags?: string;
  };
}
export interface JourneyTraffic {
  protocol: 'tcp' | 'udp' | 'icmp';
  port: number;
  sourceIp: string;
  direction: 'ingress' | 'egress';
}
export interface NetworkRule {
  action: 'allow' | 'deny';
  protocol: 'any' | JourneyTraffic['protocol'];
  port?: number;
  sourceCidr?: string;
  direction: 'any' | JourneyTraffic['direction'];
}
export interface DiagramEdge {
  relationship?: 'dependency' | 'network';
  networkRule?: NetworkRule;
  id: string;
  source: string;
  target: string;
  label: string;
  sourcePort?: Port;
  targetPort?: Port;
  routing?: 'horizontal' | 'vertical';
  bend?: number;
}
export interface TrafficScenario {
  id: string;
  name: string;
  traffic: JourneyTraffic;
  sourceId?: string;
  targetId?: string;
}
export interface DiagramDocument {
  /** Flat project library: detail boards can link to other boards by ID. */
  details?: { id: string; document: DiagramDocument }[];
  scenarios?: TrafficScenario[];
  version: 1;
  traffic?: JourneyTraffic;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object');
  return Object.fromEntries(Object.entries(value));
}
export const MAX_TEXT = 4000;
const nodeKinds = new Set(['service', 'group', 'text', 'note']);
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT)
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
  const result = parseBoard(json);
  const input = record(JSON.parse(json));
  if (input.details !== undefined) {
    if (!Array.isArray(input.details) || input.details.length > 100)
      throw Error('Invalid detail diagram library');
    const ids = new Set<string>();
    result.details = input.details.map((value: unknown) => {
      const entry = record(value);
      const id = text(entry.id, 'detail ID');
      if (!id || ids.has(id)) throw Error('Duplicate detail ID');
      ids.add(id);
      const board = record(entry.document);
      if (board.details !== undefined)
        throw Error('Detail libraries must be flat');
      return { id, document: parseBoard(JSON.stringify(board)) };
    });
  }
  const ids = new Set(result.details?.map((entry) => entry.id));
  for (const board of [
    result,
    ...(result.details?.map((entry) => entry.document) ?? []),
  ])
    for (const node of board.nodes)
      if (node.detailId && !ids.has(node.detailId))
        throw Error('Missing detail diagram');
  return result;
}
function parseBoard(json: string): DiagramDocument {
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
    if (!nodeKinds.has(String(n.kind))) throw new Error('Invalid node kind');
    const node: DiagramNode = {
      id: text(n.id, 'node ID'),
      kind: n.kind as DiagramNode['kind'],
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
    if (n.detailId !== undefined) node.detailId = text(n.detailId, 'detail ID');
    if (n.journeyCaption !== undefined)
      node.journeyCaption = text(n.journeyCaption, 'journey caption');
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
    if (legacyColors.has(node.color.toLowerCase())) {
      const service = node.serviceId ? findService(node.serviceId) : undefined;
      if (service && node.kind === 'service') node.color = service.color;
      else if (node.boundary) node.color = boundaryColors[node.boundary];
    }
    if (n.fontSize !== undefined) {
      const size = finite(n.fontSize);
      if (size < 4 || size > 400) throw Error('Invalid font size');
      node.fontSize = size;
    }
    if (n.journey !== undefined) {
      const journey = record(n.journey);
      if (journey.mode === 'all' || journey.mode === 'ask')
        node.journey = { mode: journey.mode };
      else if (journey.mode === 'fixed')
        node.journey = { mode: 'fixed', edge: text(journey.edge, 'branch') };
      else throw Error('Invalid journey branch mode');
    }
    if (n.network !== undefined) node.network = parseResourceNetwork(n.network);
    if (n.policy !== undefined) node.policy = parseResourcePolicy(n.policy);
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
  for (const node of nodes) {
    const requirePolicy = (id: string, kind?: ResourcePolicy['kind']) => {
      const target = byId.get(id);
      if (!target || (kind && target.policy?.kind !== kind))
        throw Error(`Invalid network resource reference: ${id}`);
    };
    for (const id of node.network?.securityGroupIds ?? [])
      requirePolicy(id, 'security-group');
    for (const id of node.network?.networkIds ?? []) requirePolicy(id);
    if (node.network?.routeTableId)
      requirePolicy(node.network.routeTableId, 'route-table');
    if (node.network?.networkAclId)
      requirePolicy(node.network.networkAclId, 'network-acl');
    if (node.policy?.kind === 'route-table')
      for (const r of node.policy.routes) {
        if (!['local', 'blackhole'].includes(r.target)) requirePolicy(r.target);
      }
    else
      for (const r of node.policy?.rules ?? [])
        if (r.peerGroupId) requirePolicy(r.peerGroupId, 'security-group');
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
    if (e.relationship !== undefined) {
      if (e.relationship !== 'network' && e.relationship !== 'dependency')
        throw Error('Invalid relationship');
      edge.relationship = e.relationship;
    }
    if (e.routing !== undefined) {
      if (e.routing !== 'horizontal' && e.routing !== 'vertical')
        throw Error('Invalid routing');
      edge.routing = e.routing;
    }
    if (e.bend !== undefined) edge.bend = finite(e.bend);
    if (e.networkRule !== undefined)
      edge.networkRule = parseNetworkRule(e.networkRule);
    edgeIds.add(edge.id);
    return edge;
  });
  let scenarios: TrafficScenario[] | undefined;
  if (input.scenarios !== undefined) {
    if (!Array.isArray(input.scenarios) || input.scenarios.length > 100)
      throw Error('Invalid scenarios');
    const ids = new Set<string>();
    scenarios = input.scenarios.map((value: unknown) => {
      const scenario = record(value);
      const id = text(scenario.id, 'scenario ID');
      const name = text(scenario.name, 'scenario name');
      if (!id || !name.trim() || ids.has(id))
        throw Error('Invalid or duplicate scenario');
      ids.add(id);
      const result: TrafficScenario = {
        id,
        name,
        traffic: parseTraffic(scenario.traffic),
      };
      for (const key of ['sourceId', 'targetId'] as const) {
        if (scenario[key] !== undefined) result[key] = text(scenario[key], key);
      }
      return result;
    });
  }
  return {
    version: 1,
    title: text(input.title, 'title'),
    ...(scenarios ? { scenarios } : {}),
    nodes,
    edges,
    ...(input.traffic !== undefined
      ? { traffic: parseTraffic(input.traffic) }
      : {}),
  };
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
        boundary: 'region',
        x: 0,
        z: 0,
        width: 940,
        depth: 900,
        color: '#00a4a6',
      },
      {
        id: 'vpc',
        kind: 'group',
        label: 'Application boundary',
        boundary: 'vpc',
        x: 50,
        z: 10,
        width: 650,
        depth: 720,
        color: '#8c4fff',
        parentId: 'region',
      },
      {
        id: 'gateway',
        kind: 'service',
        label: 'API Gateway',
        serviceId: 'aws.api-gateway',
        x: -280,
        z: -110,
        width: 160,
        depth: 100,
        color: '#8c4fff',
        parentId: 'region',
      },
      {
        id: 'lambda',
        kind: 'service',
        label: 'Lambda',
        serviceId: 'aws.lambda',
        x: -40,
        z: -80,
        width: 160,
        depth: 100,
        color: '#ed7100',
        parentId: 'vpc',
      },
      {
        id: 'db',
        kind: 'service',
        label: 'DynamoDB',
        serviceId: 'aws.dynamodb',
        x: 190,
        z: -80,
        width: 160,
        depth: 100,
        color: '#c925d1',
        parentId: 'vpc',
      },
      {
        id: 'queue',
        kind: 'service',
        label: 'SQS',
        serviceId: 'aws.sqs',
        x: -40,
        z: 310,
        width: 160,
        depth: 100,
        color: '#e7157b',
        parentId: 'vpc',
      },
      {
        id: 'storage',
        kind: 'service',
        label: 'S3',
        serviceId: 'aws.s3',
        x: 190,
        z: 310,
        width: 160,
        depth: 100,
        color: '#7aa116',
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
        width: 160,
        depth: 100,
        color: '#ed7100',
      },
      {
        id: 'database',
        serviceId: 'aws.dynamodb',
        kind: 'service',
        label: 'DynamoDB',
        x: 300,
        z: 0,
        width: 160,
        depth: 100,
        color: '#c925d1',
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
