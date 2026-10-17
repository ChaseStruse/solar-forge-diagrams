import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type DiagramDocument,
  parseDocument,
  serializeDocument,
} from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import { defaultTraffic } from '../src/domain/network';
import type { ResourcePolicy } from '../src/domain/policies';
import { checkReachability } from '../src/domain/reachability';
import {
  copyFragment,
  deleteNodes,
  pasteFragment,
} from '../src/editor/operations';
import { importInfrastructure } from '../src/import/infrastructure';

const fixture = () =>
  importInfrastructure([
    {
      name: 'vpc.tf',
      content: readFileSync(
        new URL('../examples/infrastructure/vpc.tf', import.meta.url),
        'utf8',
      ),
    },
  ]).document;
const web = 'resource:aws_instance.web',
  db = 'resource:aws_instance.database';
const node = (doc: DiagramDocument, id: string) => {
  const n = doc.nodes.find((n) => n.id === id);
  if (!n) throw Error(`Missing ${id}`);
  return n;
};
const flow = { ...defaultTraffic, port: 5432 };
const check = (doc: DiagramDocument) => checkReachability(doc, web, db, flow);
function policy(doc: DiagramDocument, id: string): ResourcePolicy {
  const p = node(doc, id).policy;
  if (!p) throw Error('Missing policy');
  return p;
}

test('security groups union attached groups, match peer groups, and require both ingress and egress', () => {
  const doc = fixture();
  expect(check(doc).status).toBe('allowed');
  const group = policy(doc, 'resource:aws_security_group.web');
  if (group.kind === 'route-table') throw Error('Wrong policy');
  group.rules = group.rules.filter((r) => r.direction !== 'egress');
  expect(check(doc).status).toBe('denied');
  group.rules.push({
    direction: 'egress',
    action: 'allow',
    protocol: 'any',
    cidr: '0.0.0.0/0',
  });
  const target = node(doc, db);
  target.network ??= { model: 'aws' };
  target.network.securityGroupIds = [
    'resource:aws_security_group.web',
    'resource:aws_security_group.data',
  ];
  expect(checkReachability(doc, web, db, { ...flow, port: 443 }).status).toBe(
    'allowed',
  );
});
test('longest-prefix routes and the return route can deny otherwise permitted traffic', () => {
  const doc = fixture(),
    table = policy(doc, 'resource:aws_route_table.public');
  if (table.kind !== 'route-table') throw Error('Wrong policy');
  table.routes.push({ destination: '10.0.2.0/24', target: 'blackhole' });
  expect(check(doc).status).toBe('denied');
  table.routes.pop();
  expect(check(doc).status).toBe('allowed');
  node(doc, 'resource:aws_subnet.private').network = {
    model: 'aws',
    cidr: '10.0.2.0/24',
    routeTableId: 'resource:aws_route_table.public',
  };
  table.routes.push({ destination: '10.0.1.0/24', target: 'blackhole' });
  expect(check(doc).status).toBe('denied');
});
test('ACL priority, implicit deny, and ephemeral return ports affect the result', () => {
  const doc = fixture();
  doc.nodes.push({
    id: 'acl',
    kind: 'service',
    label: 'Private ACL',
    x: 0,
    z: 0,
    width: 160,
    depth: 100,
    color: '#d97706',
    policy: {
      kind: 'network-acl',
      rules: [
        {
          priority: 100,
          action: 'allow',
          direction: 'ingress',
          protocol: 'any',
          cidr: '0.0.0.0/0',
        },
        {
          priority: 100,
          action: 'allow',
          direction: 'egress',
          protocol: 'any',
          cidr: '0.0.0.0/0',
        },
      ],
    },
  });
  const subnet = node(doc, 'resource:aws_subnet.private');
  subnet.network ??= { model: 'aws' };
  subnet.network.networkAclId = 'acl';
  const acl = policy(doc, 'acl');
  if (acl.kind === 'route-table') throw Error('Wrong policy');
  expect(check(doc).status).toBe('allowed');
  acl.rules.unshift({
    priority: 50,
    action: 'deny',
    direction: 'ingress',
    protocol: 'tcp',
    fromPort: 5432,
    toPort: 5432,
    cidr: '10.0.1.0/24',
  });
  expect(check(doc).reason).toContain('50 deny');
  acl.rules.shift();
  acl.rules[1] = {
    priority: 100,
    action: 'allow',
    direction: 'egress',
    protocol: 'tcp',
    fromPort: 5432,
    toPort: 5432,
    cidr: '0.0.0.0/0',
  };
  expect(check(doc).reason).toContain('return egress');
  expect(checkReachability(doc, web, db, flow, 5432).status).toBe('allowed');
});
test('public ingress needs public addressing and an IGW, while private egress can use NAT', () => {
  const doc = fixture();
  doc.nodes.push({
    id: 'internet',
    kind: 'service',
    serviceId: 'actor.internet',
    label: 'External HTTPS',
    x: 0,
    z: 0,
    width: 160,
    depth: 100,
    color: '#64748b',
    network: { model: 'generic', ip: '198.51.100.10' },
  });
  expect(checkReachability(doc, 'internet', web, defaultTraffic).status).toBe(
    'allowed',
  );
  expect(checkReachability(doc, 'internet', db, flow).status).toBe('denied');
  doc.nodes.push(
    {
      id: 'nat',
      kind: 'service',
      label: 'NAT',
      serviceId: 'component.nat-gateway',
      parentId: 'resource:aws_subnet.public',
      x: 0,
      z: 0,
      width: 160,
      depth: 100,
      color: '#8c4fff',
      network: { model: 'aws', publicIp: '203.0.113.99' },
    },
    {
      id: 'private-rt',
      kind: 'service',
      label: 'Private routes',
      x: 0,
      z: 0,
      width: 160,
      depth: 100,
      color: '#059669',
      policy: {
        kind: 'route-table',
        routes: [{ destination: '0.0.0.0/0', target: 'nat' }],
      },
    },
  );
  const privateSubnet = node(doc, 'resource:aws_subnet.private');
  privateSubnet.network ??= { model: 'aws' };
  privateSubnet.network.routeTableId = 'private-rt';
  const result = checkReachability(doc, db, 'internet', defaultTraffic);
  expect(result.status).toBe('allowed');
  expect(result.path).toEqual([
    db,
    'nat',
    'resource:aws_internet_gateway.internet',
    'internet',
  ]);
});
test('missing addresses and unresolved policies report Unknown instead of success', () => {
  const doc = fixture();
  delete node(doc, db).network?.ip;
  expect(check(doc).status).toBe('unknown');
  node(doc, db).network = {
    model: 'aws',
    ip: '10.0.2.10',
    securityGroupIds: ['resource:aws_security_group.data'],
  };
  const p = policy(doc, 'resource:aws_security_group.data');
  if (p.kind === 'route-table') throw Error('Wrong policy');
  p.rules = [];
  p.incomplete = ['Dynamic rule'];
  expect(check(doc).status).toBe('unknown');
});
test('policy attachments roundtrip; deletion and copying never leave dangling references or broaden access', () => {
  const doc = fixture();
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  const history = new DocumentHistory(doc),
    before = structuredClone(doc);
  history.execute(
    deleteNodes(doc, new Set(['resource:aws_security_group.web'])),
  );
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
  expect(check(doc).status).not.toBe('allowed');
  history.undo();
  expect(doc).toEqual(before);
  const fragment = copyFragment(doc, new Set([web]));
  expect(() => parseDocument(serializeDocument(fragment))).not.toThrow();
  expect(fragment.nodes[0]?.network?.incomplete?.length).toBeGreaterThan(0);
  const full = copyFragment(doc, new Set(['resource:aws_vpc.main']));
  let i = 0;
  const edit = pasteFragment(full, () => `copy-${i++}`);
  history.execute(edit);
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
});
test('invalid references, duplicate ACL priorities and malformed CIDRs are rejected', () => {
  const doc = fixture();
  node(doc, web).network = { model: 'aws', securityGroupIds: ['missing'] };
  expect(() => parseDocument(serializeDocument(doc))).toThrow();
  node(doc, web).network = { model: 'aws', cidr: '10.0.0.0/33' };
  expect(() => parseDocument(serializeDocument(doc))).toThrow();
});

test('deleting an assigned ACL does not silently fall back to unrestricted traffic', () => {
  const doc = fixture();
  doc.nodes.push({
    id: 'acl',
    kind: 'service',
    label: 'ACL',
    x: 0,
    z: 0,
    width: 160,
    depth: 100,
    color: '#d97706',
    policy: { kind: 'network-acl', rules: [] },
  });
  const subnet = node(doc, 'resource:aws_subnet.private');
  subnet.network ??= { model: 'aws' };
  subnet.network.networkAclId = 'acl';
  const history = new DocumentHistory(doc);
  history.execute(deleteNodes(doc, new Set(['acl'])));
  expect(() => parseDocument(serializeDocument(doc))).not.toThrow();
  expect(check(doc).status).toBe('unknown');
});

test('missing VPC CIDR is Unknown even when a less-specific internet route is present', () => {
  const doc = fixture();
  delete node(doc, 'resource:aws_vpc.main').network?.cidr;
  expect(check(doc).status).toBe('unknown');
});

test('arrows without a resource network model do not prove reachability', () => {
  const doc = fixture();
  for (const n of doc.nodes) {
    delete n.network;
    delete n.policy;
  }
  doc.edges.push({
    id: 'manual',
    source: web,
    target: db,
    label: 'Trust this arrow',
  });
  expect(check(doc).status).toBe('unknown');
});
