import type { JourneyTraffic, NetworkRule } from './document';
export const defaultTraffic: JourneyTraffic = {
  protocol: 'tcp',
  port: 443,
  sourceIp: '203.0.113.10',
  direction: 'ingress',
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid network settings');
  return value as Record<string, unknown>;
}
export function ipv4(ip: string): number {
  const parts = ip.split('.');
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    throw Error('Enter a valid IPv4 address');
  return parts.reduce((n, p) => (n * 256 + Number(p)) >>> 0, 0);
}
function cidr(value: string): { address: number; mask: number } {
  const [ip, bits, ...rest] = value.split('/');
  if (
    !ip ||
    bits === undefined ||
    !/^\d{1,2}$/.test(bits) ||
    Number(bits) > 32 ||
    rest.length
  )
    throw Error('Enter a valid IPv4 CIDR');
  return {
    address: ipv4(ip),
    mask: Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0,
  };
}
function port(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  )
    throw Error('Port must be 1–65535');
  return value;
}
export function parseTraffic(value: unknown): JourneyTraffic {
  const t = object(value);
  if (
    !['tcp', 'udp', 'icmp'].includes(String(t.protocol)) ||
    !['ingress', 'egress'].includes(String(t.direction)) ||
    typeof t.sourceIp !== 'string'
  )
    throw Error('Invalid journey traffic');
  ipv4(t.sourceIp);
  return {
    protocol: t.protocol as JourneyTraffic['protocol'],
    port: port(t.port),
    sourceIp: t.sourceIp,
    direction: t.direction as JourneyTraffic['direction'],
  };
}
export function parseNetworkRule(value: unknown): NetworkRule {
  const r = object(value);
  if (
    !['allow', 'deny'].includes(String(r.action)) ||
    !['any', 'tcp', 'udp', 'icmp'].includes(String(r.protocol)) ||
    !['any', 'ingress', 'egress'].includes(String(r.direction))
  )
    throw Error('Invalid connection rule');
  const result: NetworkRule = {
    action: r.action as NetworkRule['action'],
    protocol: r.protocol as NetworkRule['protocol'],
    direction: r.direction as NetworkRule['direction'],
  };
  if (r.port !== undefined) result.port = port(r.port);
  if (r.sourceCidr !== undefined) {
    if (typeof r.sourceCidr !== 'string') throw Error('Invalid source CIDR');
    cidr(r.sourceCidr);
    result.sourceCidr = r.sourceCidr;
  }
  return result;
}
/** Each connection describes one permitted flow; mismatches stop at its source. */
export function evaluateTraffic(
  rule: NetworkRule | undefined,
  traffic: JourneyTraffic,
): { allowed: boolean; reason: string } {
  if (!rule) return { allowed: true, reason: 'No traffic restriction' };
  if (rule.action === 'deny')
    return { allowed: false, reason: 'Explicit deny' };
  if (rule.protocol !== 'any' && rule.protocol !== traffic.protocol)
    return {
      allowed: false,
      reason: `Requires ${rule.protocol.toUpperCase()}`,
    };
  if (rule.direction !== 'any' && rule.direction !== traffic.direction)
    return { allowed: false, reason: `Requires ${rule.direction}` };
  if (
    rule.port !== undefined &&
    traffic.protocol !== 'icmp' &&
    rule.port !== traffic.port
  )
    return { allowed: false, reason: `Requires port ${rule.port}` };
  if (rule.sourceCidr) {
    const { address, mask } = cidr(rule.sourceCidr);
    if ((ipv4(traffic.sourceIp) & mask) !== (address & mask))
      return { allowed: false, reason: `Source outside ${rule.sourceCidr}` };
  }
  return { allowed: true, reason: 'Traffic allowed' };
}
