import { ipv4 } from './network';
export type Protocol = 'any' | 'tcp' | 'udp' | 'icmp';
export interface FirewallRule {
  action: 'allow' | 'deny';
  direction: 'ingress' | 'egress';
  protocol: Protocol;
  fromPort?: number;
  toPort?: number;
  cidr?: string;
  peerGroupId?: string;
  priority?: number;
}
export type ResourcePolicy =
  | {
      kind: 'security-group' | 'network-acl';
      rules: FirewallRule[];
      incomplete?: string[];
    }
  | {
      kind: 'route-table';
      routes: { destination: string; target: string }[];
      incomplete?: string[];
    };
export interface ResourceNetwork {
  model: 'aws' | 'compose' | 'generic';
  ip?: string;
  publicIp?: string;
  cidr?: string;
  exposure?: 'public' | 'private' | 'unknown';
  securityGroupIds?: string[];
  routeTableId?: string;
  networkAclId?: string;
  networkIds?: string[];
  incomplete?: string[];
}
export const policyObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Expected network settings object');
  return v as Record<string, unknown>;
};
export function cidrContains(cidr: string, ip: string): boolean {
  const [address, bits, ...rest] = cidr.split('/');
  if (
    !address ||
    bits === undefined ||
    !/^\d{1,2}$/.test(bits) ||
    Number(bits) > 32 ||
    rest.length
  )
    throw Error('Invalid IPv4 CIDR');
  const mask =
    Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (ipv4(address) & mask) === (ipv4(ip) & mask);
}
function str(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 4000)
    throw Error('Invalid network value');
  return v;
}
function strings(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 2000) throw Error('Invalid network list');
  return v.map(str);
}
function port(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 65535)
    throw Error('Invalid port range');
  return v;
}
export function parseResourceNetwork(value: unknown): ResourceNetwork {
  const r = policyObject(value);
  if (!['aws', 'compose', 'generic'].includes(String(r.model)))
    throw Error('Invalid network model');
  const n: ResourceNetwork = { model: r.model as ResourceNetwork['model'] };
  for (const key of ['ip', 'publicIp'] as const)
    if (r[key] !== undefined) {
      n[key] = str(r[key]);
      ipv4(n[key]);
    }
  if (r.cidr !== undefined) {
    n.cidr = str(r.cidr);
    cidrContains(n.cidr, '0.0.0.0');
  }
  if (r.exposure !== undefined) {
    if (!['public', 'private', 'unknown'].includes(String(r.exposure)))
      throw Error('Invalid public address setting');
    n.exposure = r.exposure as NonNullable<ResourceNetwork['exposure']>;
  }
  for (const key of ['securityGroupIds', 'networkIds', 'incomplete'] as const)
    if (r[key] !== undefined) n[key] = strings(r[key]);
  for (const key of ['routeTableId', 'networkAclId'] as const)
    if (r[key] !== undefined) n[key] = str(r[key]);
  return n;
}
export function parseResourcePolicy(value: unknown): ResourcePolicy {
  const p = policyObject(value);
  const incomplete =
    p.incomplete !== undefined ? { incomplete: strings(p.incomplete) } : {};
  if (p.kind === 'route-table') {
    if (!Array.isArray(p.routes) || p.routes.length > 2000)
      throw Error('Invalid routes');
    return {
      kind: 'route-table',
      ...incomplete,
      routes: p.routes.map((value) => {
        const r = policyObject(value),
          destination = str(r.destination);
        cidrContains(destination, '0.0.0.0');
        return { destination, target: str(r.target) };
      }),
    };
  }
  if (p.kind !== 'security-group' && p.kind !== 'network-acl')
    throw Error('Invalid resource policy');
  if (!Array.isArray(p.rules) || p.rules.length > 2000)
    throw Error('Invalid firewall rules');
  const priorities = new Set<string>();
  const rules = p.rules.map((value) => {
    const r = policyObject(value);
    if (
      !['ingress', 'egress'].includes(String(r.direction)) ||
      !['allow', 'deny'].includes(String(r.action)) ||
      !['any', 'tcp', 'udp', 'icmp'].includes(String(r.protocol))
    )
      throw Error('Invalid firewall rule');
    if (p.kind === 'security-group' && r.action !== 'allow')
      throw Error('Security groups only support allow rules');
    const rule: FirewallRule = {
      action: r.action as FirewallRule['action'],
      direction: r.direction as FirewallRule['direction'],
      protocol: r.protocol as Protocol,
    };
    if (r.fromPort !== undefined) rule.fromPort = port(r.fromPort);
    if (r.toPort !== undefined) rule.toPort = port(r.toPort);
    if (
      (rule.fromPort === undefined) !== (rule.toPort === undefined) ||
      (rule.fromPort ?? 0) > (rule.toPort ?? 65535)
    )
      throw Error('Invalid port range');
    if (r.cidr !== undefined) {
      rule.cidr = str(r.cidr);
      cidrContains(rule.cidr, '0.0.0.0');
    }
    if (r.peerGroupId !== undefined) rule.peerGroupId = str(r.peerGroupId);
    if (rule.cidr && rule.peerGroupId)
      throw Error('Choose CIDR or security-group peer');
    if (p.kind === 'network-acl') {
      if (
        rule.peerGroupId ||
        typeof r.priority !== 'number' ||
        !Number.isInteger(r.priority) ||
        r.priority < 1 ||
        r.priority > 32766
      )
        throw Error('ACL rules need a priority from 1–32766 and a CIDR peer');
      rule.priority = r.priority;
      const key = `${rule.direction}:${rule.priority}`;
      if (priorities.has(key)) throw Error('Duplicate ACL priority');
      priorities.add(key);
    }
    return rule;
  });
  return { kind: p.kind, rules, ...incomplete };
}
