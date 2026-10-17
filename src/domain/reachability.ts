import type { DiagramDocument, DiagramNode, JourneyTraffic } from './document';
import { cidrContains, type FirewallRule } from './policies';

export type ReachabilityStatus = 'allowed' | 'denied' | 'unknown';
export interface ReachabilityResult {
  status: ReachabilityStatus;
  reason: string;
  path: string[];
  checks: string[];
}
type Check = { status: ReachabilityStatus; reason: string };
const allow = (reason: string): Check => ({ status: 'allowed', reason });
const deny = (reason: string): Check => ({ status: 'denied', reason });
const unknown = (reason: string): Check => ({ status: 'unknown', reason });
export function ancestor(
  doc: DiagramDocument,
  node: DiagramNode,
  kind: DiagramNode['boundary'],
): DiagramNode | undefined {
  const index = new Map(doc.nodes.map((n) => [n.id, n]));
  let current: DiagramNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.boundary === kind) return current;
    seen.add(current.id);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return undefined;
}
function matches(
  rule: FirewallRule,
  direction: 'ingress' | 'egress',
  traffic: JourneyTraffic,
  port: number,
  peerIp: string | undefined,
  groups: string[],
): boolean | undefined {
  if (
    rule.direction !== direction ||
    (rule.protocol !== 'any' && rule.protocol !== traffic.protocol)
  )
    return false;
  if (
    traffic.protocol !== 'icmp' &&
    rule.protocol !== 'any' &&
    rule.fromPort !== undefined &&
    (port < rule.fromPort || port > (rule.toPort ?? rule.fromPort))
  )
    return false;
  if (rule.peerGroupId) return groups.includes(rule.peerGroupId);
  if (rule.cidr)
    return rule.cidr.endsWith('/0')
      ? true
      : peerIp
        ? cidrContains(rule.cidr, peerIp)
        : undefined;
  return true;
}
/** Evaluate a forward connection plus stateless ACL return traffic. SG replies are stateful. */
export function checkReachability(
  doc: DiagramDocument,
  sourceId: string,
  targetId: string,
  traffic: JourneyTraffic,
  sourcePort = 49152,
): ReachabilityResult {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const source = nodes.get(sourceId),
    target = nodes.get(targetId);
  const checks: string[] = [];
  let path = [sourceId, targetId];
  const finish = (check: Check): ReachabilityResult => ({
    ...check,
    path,
    checks,
  });
  if (!source || !target)
    return finish(unknown('Source or destination no longer exists'));
  if (sourceId === targetId) return finish(allow('Same resource'));
  if (!source.network && !target.network)
    return finish(
      unknown(
        'Enable resource networking; diagram arrows alone do not establish reachability',
      ),
    );
  const sourceVpc = ancestor(doc, source, 'vpc'),
    targetVpc = ancestor(doc, target, 'vpc');
  const sourceSubnet = ancestor(doc, source, 'subnet'),
    targetSubnet = ancestor(doc, target, 'subnet');
  const sourceIp =
    source.network?.ip ?? (!sourceVpc ? traffic.sourceIp : undefined);
  const targetIp = target.network?.ip ?? target.network?.publicIp;
  const sg = (
    node: DiagramNode,
    direction: 'ingress' | 'egress',
    peer: DiagramNode,
    peerIp?: string,
    peerGroups = true,
  ): Check => {
    const ids = node.network?.securityGroupIds;
    if (!ids?.length) {
      if (
        node.network?.model === 'aws' &&
        !node.policy &&
        !node.serviceId?.startsWith('component.')
      )
        return unknown(`${node.label}: security groups are not modeled`);
      return allow(`${node.label}: no security-group restriction modeled`);
    }
    let incomplete = false;
    for (const id of ids) {
      const owner = nodes.get(id);
      const policy = owner?.policy;
      if (owner?.network?.incomplete?.length) {
        incomplete = true;
        continue;
      }
      if (!policy || policy.kind !== 'security-group') {
        incomplete = true;
        continue;
      }
      incomplete ||= !!policy.incomplete?.length;
      for (const rule of policy.rules) {
        const match = matches(
          rule,
          direction,
          traffic,
          traffic.port,
          peerIp,
          peerGroups ? (peer.network?.securityGroupIds ?? []) : [],
        );
        if (match)
          return allow(
            `${node.label}: ${direction} allowed by ${nodes.get(id)?.label}`,
          );
        if (match === undefined) incomplete = true;
      }
    }
    return incomplete
      ? unknown(
          `${node.label}: incomplete ${direction} security-group rules or peer address`,
        )
      : deny(`${node.label}: no ${direction} security-group allow rule`);
  };
  if (
    source.network?.model === 'compose' &&
    target.network?.model === 'compose'
  ) {
    if (source.network.incomplete?.length || target.network.incomplete?.length)
      return finish(unknown('Compose network attachments are incomplete'));
    const shared = (source.network.networkIds ?? []).filter((id) =>
      target.network?.networkIds?.includes(id),
    );
    if (!shared.length)
      return finish(deny('Containers have no shared network'));
    path = [sourceId, shared[0] ?? '', targetId];
    const verdicts = [
      sg(source, 'egress', target, targetIp),
      sg(target, 'ingress', source, sourceIp),
    ];
    checks.push(
      'Containers share a Compose network',
      ...verdicts.map((v) => `${v.status}: ${v.reason}`),
    );
    return finish(
      verdicts.find((v) => v.status === 'denied') ??
        verdicts.find((v) => v.status === 'unknown') ??
        allow('Shared Compose network and attached policies allow traffic'),
    );
  }
  const acl = (
    subnet: DiagramNode | undefined,
    direction: 'ingress' | 'egress',
    peerIp: string | undefined,
    port: number,
    reply: boolean,
  ): Check => {
    if (!subnet?.network?.networkAclId)
      return allow(
        `${subnet?.label ?? 'External network'}: no ACL restriction modeled (default allow assumed)`,
      );
    const owner = nodes.get(subnet.network.networkAclId),
      policy = owner?.policy;
    if (
      !policy ||
      policy.kind !== 'network-acl' ||
      policy.incomplete?.length ||
      owner?.network?.incomplete?.length
    )
      return unknown(`${subnet.label}: incomplete network ACL`);
    for (const rule of [...policy.rules].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    )) {
      const match = matches(rule, direction, traffic, port, peerIp, []);
      if (match === undefined)
        return unknown(`${subnet.label}: ACL peer address unknown`);
      if (match)
        return (rule.action === 'allow' ? allow : deny)(
          `${subnet.label}: ${reply ? 'return ' : ''}${direction} ACL rule ${rule.priority} ${rule.action}`,
        );
    }
    return deny(
      `${subnet.label}: ${reply ? 'return ' : ''}${direction} ACL implicit deny`,
    );
  };
  const route = (
    node: DiagramNode,
    ip: string | undefined,
    destination: DiagramNode,
    visited = new Set<string>(),
  ): { check: Check; path: string[] } => {
    if (visited.has(node.id))
      return { check: deny('Routing loop'), path: [node.id] };
    visited.add(node.id);
    const vpc = ancestor(doc, node, 'vpc'),
      subnet = ancestor(doc, node, 'subnet');
    if (!ip)
      return {
        check: unknown('Destination IPv4 address is unknown'),
        path: [node.id, destination.id],
      };
    if (vpc && !vpc.network?.cidr)
      return {
        check: unknown(
          'VPC CIDR is missing; the implicit local route cannot be resolved',
        ),
        path: [node.id, destination.id],
      };
    const table = subnet?.network?.routeTableId
      ? nodes.get(subnet.network.routeTableId)
      : undefined;
    if (table?.policy?.incomplete?.length || table?.network?.incomplete?.length)
      return {
        check: unknown(`Incomplete routes in ${table.label}`),
        path: [node.id, destination.id],
      };
    const routes =
      table?.policy?.kind === 'route-table' ? [...table.policy.routes] : [];
    if (vpc?.network?.cidr)
      routes.push({ destination: vpc.network.cidr, target: 'local' });
    const selected = routes
      .filter((r) => cidrContains(r.destination, ip))
      .sort(
        (a, b) =>
          Number(b.destination.split('/')[1]) -
          Number(a.destination.split('/')[1]),
      )[0];
    if (!selected)
      return {
        check: vpc
          ? deny(`${subnet?.label ?? vpc.label}: no route to ${ip}`)
          : unknown('External routing is not modeled'),
        path: [node.id, destination.id],
      };
    checks.push(
      `${subnet?.label ?? node.label}: longest-prefix route ${selected.destination} → ${selected.target}`,
    );
    if (selected.target === 'blackhole')
      return {
        check: deny('Route is a blackhole'),
        path: [node.id, destination.id],
      };
    if (selected.target === 'local') {
      if (vpc?.id !== ancestor(doc, destination, 'vpc')?.id)
        return {
          check: deny('Local route does not reach the destination VPC'),
          path: [node.id, destination.id],
        };
      return {
        check: allow('Local VPC route'),
        path: [node.id, destination.id],
      };
    }
    const gateway = nodes.get(selected.target);
    if (!gateway)
      return {
        check: unknown('Route target missing'),
        path: [node.id, destination.id],
      };
    if (gateway.network?.incomplete?.length)
      return {
        check: unknown(`Incomplete gateway settings: ${gateway.label}`),
        path: [node.id, gateway.id, destination.id],
      };
    if (gateway.serviceId === 'component.internet-gateway') {
      if (ancestor(doc, gateway, 'vpc')?.id !== vpc?.id)
        return {
          check: deny('Internet gateway is not attached to this VPC'),
          path: [node.id, gateway.id, destination.id],
        };
      return {
        check: allow('Internet gateway route'),
        path: [node.id, gateway.id, destination.id],
      };
    }
    if (gateway.serviceId === 'component.nat-gateway') {
      const onward = route(gateway, ip, destination, visited);
      if (onward.check.status !== 'allowed')
        return { check: onward.check, path: [node.id, ...onward.path] };
      if (
        !onward.path.some(
          (id) => nodes.get(id)?.serviceId === 'component.internet-gateway',
        )
      )
        return {
          check: deny('NAT has no onward internet-gateway route'),
          path: [node.id, ...onward.path],
        };
      return { check: onward.check, path: [node.id, ...onward.path] };
    }
    return {
      check: unknown(`Unsupported route target: ${gateway.label}`),
      path: [node.id, gateway.id, destination.id],
    };
  };
  const verdicts: Check[] = [];
  if (
    [source, target, sourceSubnet, targetSubnet, sourceVpc, targetVpc].some(
      (n) => n?.network?.incomplete?.length,
    )
  )
    verdicts.push(
      unknown('Resource network contains unresolved infrastructure values'),
    );
  if (
    (source.network?.model === 'aws' && !sourceVpc) ||
    (target.network?.model === 'aws' && !targetVpc)
  )
    verdicts.push(
      unknown('An AWS endpoint has no modeled VPC/subnet placement'),
    );
  if (!sourceVpc && targetVpc) {
    if (target.network?.exposure === 'private')
      verdicts.push(
        deny(
          'Destination has no public address; internet ingress cannot use NAT',
        ),
      );
    else if (target.network?.exposure !== 'public' && !target.network?.publicIp)
      verdicts.push(
        unknown('Destination public-address assignment is unknown'),
      );
    const reply = route(target, sourceIp, source);
    path = [sourceId, ...reply.path.slice(1, -1).reverse(), targetId];
    verdicts.push(reply.check);
    if (
      reply.check.status === 'allowed' &&
      !reply.path.some(
        (id) => nodes.get(id)?.serviceId === 'component.internet-gateway',
      )
    )
      verdicts.push(
        deny('Public ingress needs an internet-gateway return route'),
      );
    if (
      reply.path.some(
        (id) => nodes.get(id)?.serviceId === 'component.nat-gateway',
      )
    )
      verdicts.push(deny('NAT does not allow unsolicited public ingress'));
  } else if (sourceVpc) {
    const forward = route(source, targetIp, target);
    path = forward.path;
    verdicts.push(forward.check);
    if (targetVpc && sourceVpc.id === targetVpc.id)
      verdicts.push(route(target, sourceIp, source).check);
    if (targetVpc && sourceVpc.id !== targetVpc.id)
      verdicts.push(unknown('Cross-VPC routing is not supported'));
    if (
      !targetVpc &&
      path.some(
        (id) => nodes.get(id)?.serviceId === 'component.internet-gateway',
      ) &&
      !path.some(
        (id) => nodes.get(id)?.serviceId === 'component.nat-gateway',
      ) &&
      source.network?.exposure !== 'public' &&
      !source.network?.publicIp
    )
      verdicts.push(
        (source.network?.exposure === 'private' ? deny : unknown)(
          'Internet-gateway egress requires a public address or NAT',
        ),
      );
  } else
    verdicts.push(
      unknown('No supported network topology between these resources'),
    );
  const translated = path.find(
    (id) => nodes.get(id)?.serviceId === 'component.nat-gateway',
  );
  const ingressPeer = translated
    ? nodes.get(translated)?.network?.publicIp
    : sourceIp;
  verdicts.push(
    sg(source, 'egress', target, targetIp),
    sg(target, 'ingress', source, ingressPeer, !translated),
  );
  if (!sourceSubnet || sourceSubnet.id !== targetSubnet?.id) {
    verdicts.push(
      acl(sourceSubnet, 'egress', targetIp, traffic.port, false),
      acl(targetSubnet, 'ingress', ingressPeer, traffic.port, false),
      acl(targetSubnet, 'egress', ingressPeer, sourcePort, true),
      acl(sourceSubnet, 'ingress', targetIp, sourcePort, true),
    );
  }
  checks.push(...verdicts.map((v) => `${v.status}: ${v.reason}`));
  return finish(
    verdicts.find((v) => v.status === 'denied') ??
      verdicts.find((v) => v.status === 'unknown') ??
      allow(
        'Routes, security groups, and request/return ACL rules allow this modeled flow',
      ),
  );
}
