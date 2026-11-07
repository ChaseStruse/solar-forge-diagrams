import { boundaryColors, findService } from '../catalog/services';
import type { DiagramNode } from '../domain/document';
import { layoutDocument } from '../domain/layout';
import { ipv4 } from '../domain/network';
import {
  cidrContains,
  type FirewallRule,
  type ResourcePolicy,
} from '../domain/policies';
import { type ImportResult, list, obj, type Resource, str } from './types';

const catalog: Record<string, string> = {
  aws_instance: 'aws.ec2',
  aws_db_instance: 'aws.rds',
  aws_dynamodb_table: 'aws.dynamodb',
  aws_s3_bucket: 'aws.s3',
  aws_lambda_function: 'aws.lambda',
  aws_ecs_service: 'aws.ecs',
  aws_ecs_cluster: 'aws.ecs',
  aws_eks_cluster: 'aws.eks',
  aws_ecr_repository: 'aws.ecr',
  aws_lb: 'aws.elb',
  aws_alb: 'aws.elb',
  aws_sqs_queue: 'aws.sqs',
  aws_sns_topic: 'aws.sns',
  aws_cognito_user_pool: 'aws.cognito',
  aws_cognito_identity_pool: 'aws.cognito',
  aws_wafv2_web_acl: 'aws.waf',
  aws_waf_web_acl: 'aws.waf',
  aws_shield_protection: 'aws.shield',
  aws_internet_gateway: 'component.internet-gateway',
  aws_nat_gateway: 'component.nat-gateway',
  aws_security_group: 'component.firewall',
  aws_network_acl: 'component.network-acl',
  aws_route_table: 'component.route-table',
  aws_default_route_table: 'component.route-table',
};
const associations = new Set([
  'aws_route_table_association',
  'aws_main_route_table_association',
  'aws_network_acl_association',
  'aws_network_acl_rule',
  'aws_route',
  'aws_security_group_rule',
  'aws_vpc_security_group_ingress_rule',
  'aws_vpc_security_group_egress_rule',
  'aws_internet_gateway_attachment',
  'aws_db_subnet_group',
]);
export function importAws(
  resources: Resource[],
  title: string,
  format: string,
  warnings: string[],
): ImportResult {
  if (!resources.length)
    throw Error('No managed infrastructure resources found');
  if (resources.length > 5000) throw Error('Import exceeds 5000 resources');
  const byId = new Map(resources.map((r) => [r.id, r]));
  if (byId.size !== resources.length)
    throw Error('Duplicate infrastructure resource address');
  const aliases = new Map<string, string>();
  for (const r of resources) {
    aliases.set(r.id, r.id);
    if (typeof r.values.id === 'string') aliases.set(r.values.id, r.id);
  }
  // Attribute references resolve to the longest resource address before a dot.
  const prefixes = new Map<string, Resource | undefined>();
  const byPrefix = (raw: string): Resource | undefined => {
    if (prefixes.has(raw)) return prefixes.get(raw);
    let found = byId.get(raw);
    for (
      let i = raw.lastIndexOf('.');
      !found && i > 0;
      i = raw.lastIndexOf('.', i - 1)
    )
      found = byId.get(raw.slice(0, i));
    prefixes.set(raw, found);
    return found;
  };
  const ref = (value: unknown): Resource | undefined => {
    if (typeof value === 'string' && aliases.has(value))
      return byId.get(aliases.get(value) ?? '');
    const o = obj(value);
    const raw =
      str(o.$expr) ??
      str(o.Ref) ??
      str(o['Fn::GetAtt'])?.split('.')[0] ??
      (Array.isArray(o['Fn::GetAtt']) ? str(o['Fn::GetAtt'][0]) : undefined) ??
      str(value)?.match(/^\$\{(.+)\}$/)?.[1];
    if (!raw) return undefined;
    const direct = aliases.get(raw);
    if (direct) return byId.get(direct);
    return byPrefix(raw);
  };
  const literal = (v: unknown): string | undefined =>
    typeof v === 'string' && !v.includes('${') && !v.includes('%{')
      ? v
      : undefined;
  const validCidr = (value: unknown): value is string => {
    if (!literal(value)) return false;
    try {
      cidrContains(String(value), '0.0.0.0');
      return true;
    } catch {
      return false;
    }
  };
  const nodes: DiagramNode[] = [],
    nodeByResource = new Map<string, DiagramNode>(),
    regions = new Map<string, string>();
  const region = (name: string): string => {
    const existing = regions.get(name);
    if (existing) return existing;
    const id = `region:${name}`;
    regions.set(name, id);
    nodes.push({
      id,
      kind: 'group',
      boundary: 'region',
      label: name,
      x: 0,
      z: 0,
      width: 1000,
      depth: 800,
      color: boundaryColors.region,
    });
    return id;
  };
  const parentVpc = (r: Resource): Resource | undefined => ref(r.values.vpc_id);
  const nodeId = (r: Resource) => `resource:${r.id}`;
  const incomplete = (node: DiagramNode, message: string, policy = false) => {
    warnings.push(`${node.label}: ${message}`);
    if (policy && node.policy) {
      node.policy.incomplete ??= [];
      node.policy.incomplete.push(message);
    } else if (node.network) {
      node.network.incomplete ??= [];
      node.network.incomplete.push(message);
    }
  };
  for (const r of resources) {
    if (associations.has(r.type)) continue;
    const boundary =
      r.type === 'aws_vpc'
        ? 'vpc'
        : r.type === 'aws_subnet'
          ? 'subnet'
          : undefined;
    const service = findService(catalog[r.type] ?? 'flow.process');
    const tags = obj(r.values.tags),
      label = literal(tags.Name) ?? literal(r.values.name) ?? r.id;
    const node: DiagramNode = {
      id: nodeId(r),
      kind: boundary ? 'group' : 'service',
      label: label.slice(0, 4000),
      x: 0,
      z: 0,
      width: boundary ? 500 : 160,
      depth: boundary ? 320 : 100,
      color: boundary
        ? boundaryColors[boundary]
        : (service?.color ?? '#64748b'),
      ...(boundary
        ? { boundary }
        : { serviceId: service?.id ?? 'flow.process' }),
      network: { model: 'aws' },
      metadata: { resourceName: r.id, notes: r.type },
    };
    if (!boundary && !catalog[r.type]) {
      node.shape = 'process';
      warnings.push(`${r.id}: ${r.type} uses a generic resource box`);
    }
    for (const [key, source] of [
      ['ip', 'private_ip'],
      ['publicIp', 'public_ip'],
      ['cidr', 'cidr_block'],
    ] as const) {
      const value = literal(r.values[source]);
      if (value) {
        try {
          if (key === 'cidr') {
            if (!validCidr(value)) throw Error('Invalid CIDR');
          } else ipv4(value);
          if (node.network) node.network[key] = value;
        } catch {
          incomplete(node, `Invalid or unresolved ${source}`);
        }
      } else if (r.values[source] !== undefined && r.values[source] !== null)
        incomplete(node, `Unresolved ${source}`);
    }
    if (node.network && r.type === 'aws_instance')
      node.network.exposure =
        node.network.publicIp || r.values.associate_public_ip_address === true
          ? 'public'
          : r.values.associate_public_ip_address === false ||
              r.values.public_ip === ''
            ? 'private'
            : 'unknown';
    if (r.type === 'aws_security_group')
      node.policy = { kind: 'security-group', rules: [] };
    if (r.type === 'aws_network_acl')
      node.policy = { kind: 'network-acl', rules: [] };
    if (r.type === 'aws_route_table' || r.type === 'aws_default_route_table')
      node.policy = { kind: 'route-table', routes: [] };
    if (r.values.__conditional)
      incomplete(node, 'Resource condition is unresolved');
    if (r.values.dynamic)
      incomplete(
        node,
        'Dynamic blocks require evaluated Terraform JSON',
        !!node.policy,
      );
    if (r.values.__incomplete)
      incomplete(node, String(r.values.__incomplete), !!node.policy);
    nodes.push(node);
    nodeByResource.set(r.id, node);
  }
  const vpcFor = (r: Resource): Resource | undefined => {
    const v = parentVpc(r);
    if (v) return v;
    const subnet = ref(r.values.subnet_id) ?? ref(list(r.values.subnets)[0]);
    return subnet ? parentVpc(subnet) : undefined;
  };
  const zones = new Map<string, string>();
  for (const r of resources) {
    const node = nodeByResource.get(r.id);
    if (!node) continue;
    for (const key of ['vpc_id', 'subnet_id'] as const)
      if (r.values[key] !== undefined && !ref(r.values[key]))
        incomplete(node, `Unresolved ${key}`);
    const vpc = r.type === 'aws_vpc' ? undefined : vpcFor(r),
      parent = vpc ? nodeByResource.get(vpc.id) : undefined;
    const reg =
      r.region ??
      literal(r.values.availability_zone)?.match(/^(.+-\d+)[a-z]$/)?.[1] ??
      'Imported AWS region';
    node.parentId = parent?.id ?? region(reg);
    if (r.type === 'aws_subnet' && parent) {
      const zone = literal(r.values.availability_zone) ?? 'Unspecified AZ',
        key = `${parent.id}:zone:${zone}`;
      if (!zones.has(key)) {
        zones.set(key, key);
        nodes.push({
          id: key,
          kind: 'group',
          boundary: 'zone',
          label: zone,
          x: 0,
          z: 0,
          width: 600,
          depth: 400,
          color: boundaryColors.zone,
          parentId: parent.id,
        });
      }
      node.parentId = key;
    } else if (r.type !== 'aws_vpc') {
      let subnet = ref(r.values.subnet_id) ?? ref(list(r.values.subnets)[0]);
      const dbGroup = ref(r.values.db_subnet_group_name);
      if (!subnet && dbGroup) subnet = ref(list(dbGroup.values.subnet_ids)[0]);
      const subnetNode = subnet ? nodeByResource.get(subnet.id) : undefined;
      if (subnetNode) node.parentId = subnetNode.id;
      if (
        (list(r.values.subnets).length > 1 ||
          (dbGroup && list(dbGroup.values.subnet_ids).length > 1)) &&
        node.kind === 'service'
      )
        incomplete(
          node,
          'Multi-subnet resource shown in its first subnet; interfaces are not expanded',
        );
    }
    if (
      r.type === 'aws_instance' &&
      node.network &&
      node.network.exposure === 'unknown'
    ) {
      const subnet = ref(r.values.subnet_id);
      if (subnet?.values.map_public_ip_on_launch === true)
        node.network.exposure = 'public';
      if (subnet?.values.map_public_ip_on_launch === false)
        node.network.exposure = 'private';
    }
    const groupValues =
      r.values.vpc_security_group_ids ?? r.values.security_groups;
    if (groupValues !== undefined && node.network) {
      node.network.securityGroupIds = [];
      for (const value of list(groupValues)) {
        const group = ref(value);
        if (
          group &&
          nodeByResource.get(group.id)?.policy?.kind === 'security-group'
        )
          node.network.securityGroupIds.push(nodeId(group));
        else incomplete(node, 'Unresolved security-group attachment');
      }
    }
  }
  const policyFor = (
    value: unknown,
    kind: ResourcePolicy['kind'],
  ): DiagramNode | undefined => {
    const r = ref(value),
      node = r ? nodeByResource.get(r.id) : undefined;
    return node?.policy?.kind === kind ? node : undefined;
  };
  const firewall = (
    owner: DiagramNode,
    raw: unknown,
    direction: 'ingress' | 'egress',
    acl = false,
  ): void => {
    if (!owner.policy || owner.policy.kind === 'route-table') return;
    const r = obj(raw),
      proto = String(r.protocol ?? r.ip_protocol ?? '-1').toLowerCase();
    const protocols: Record<string, FirewallRule['protocol']> = {
      '-1': 'any',
      '6': 'tcp',
      '17': 'udp',
      '1': 'icmp',
      all: 'any',
      tcp: 'tcp',
      udp: 'udp',
      icmp: 'icmp',
    };
    const protocol = protocols[proto];
    if (!protocol) {
      incomplete(owner, `Unsupported IP protocol ${proto}`, true);
      return;
    }
    const rawCidrs = list(r.cidr_blocks ?? r.cidr_ipv4 ?? r.cidr_block);
    const cidrs = rawCidrs.filter(validCidr);
    if (cidrs.length !== rawCidrs.length)
      incomplete(owner, 'Invalid or unresolved firewall CIDR', true);
    const peers = list(
      r.security_groups ??
        r.referenced_security_group_id ??
        r.source_security_group_id,
    ).map(ref);
    if (
      list(r.ipv6_cidr_blocks).length ||
      r.ipv6_cidr_block ||
      r.cidr_ipv6 ||
      list(r.prefix_list_ids).length
    )
      incomplete(
        owner,
        'IPv6 or prefix-list firewall rules are not supported',
        true,
      );
    if (!cidrs.length && !peers.length && !r.self) {
      incomplete(owner, 'Firewall rule peer is unresolved', true);
      return;
    }
    if (peers.some((p) => !p))
      incomplete(owner, 'Unresolved security-group rule peer', true);
    const base: FirewallRule = {
      action:
        acl && (r.action === 'deny' || r.rule_action === 'deny')
          ? 'deny'
          : 'allow',
      direction,
      protocol,
    };
    const from = Number(r.from_port),
      to = Number(r.to_port);
    if (protocol !== 'any' && protocol !== 'icmp') {
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to > 65535 ||
        from > to
      ) {
        incomplete(owner, 'Unresolved firewall port range', true);
        return;
      }
      base.fromPort = from;
      base.toPort = to;
    }
    if (
      protocol === 'icmp' &&
      Number(r.from_port) !== -1 &&
      r.from_port !== undefined
    )
      incomplete(owner, 'ICMP type/code restrictions are not evaluated', true);
    if (acl) {
      const priority = Number(r.rule_no ?? r.rule_number);
      if (!Number.isInteger(priority) || priority < 1 || priority > 32766) {
        incomplete(owner, 'Invalid or unresolved ACL rule number', true);
        return;
      }
      if (!['allow', 'deny'].includes(String(r.action ?? r.rule_action))) {
        incomplete(owner, 'Invalid or unresolved ACL rule action', true);
        return;
      }
      if (
        owner.policy.rules.some(
          (rule) => rule.priority === priority && rule.direction === direction,
        ) ||
        cidrs.length !== 1 ||
        peers.length ||
        r.self
      ) {
        incomplete(
          owner,
          'ACL rule requires a unique priority and one IPv4 CIDR',
          true,
        );
        return;
      }
      base.priority = priority;
    }
    for (const cidr of cidrs) owner.policy.rules.push({ ...base, cidr });
    for (const peer of peers)
      if (
        peer &&
        nodeByResource.get(peer.id)?.policy?.kind === 'security-group'
      )
        owner.policy.rules.push({ ...base, peerGroupId: nodeId(peer) });
    if (r.self) owner.policy.rules.push({ ...base, peerGroupId: owner.id });
  };
  const addRoute = (owner: DiagramNode, raw: unknown): void => {
    if (owner.policy?.kind !== 'route-table') return;
    const r = obj(raw),
      destination = literal(r.cidr_block ?? r.destination_cidr_block);
    if (!validCidr(destination)) {
      incomplete(owner, 'Unresolved or non-IPv4 route destination', true);
      return;
    }
    const rawTarget =
      r.gateway_id ??
      r.nat_gateway_id ??
      r.instance_id ??
      r.network_interface_id ??
      r.transit_gateway_id ??
      r.vpc_peering_connection_id;
    let target: string | undefined;
    if (rawTarget === 'local') target = 'local';
    else if (r.state === 'blackhole') target = 'blackhole';
    else {
      const resource = ref(rawTarget);
      if (resource && nodeByResource.has(resource.id))
        target = nodeId(resource);
    }
    if (!target) {
      incomplete(owner, 'Unresolved or unsupported route target', true);
      return;
    }
    owner.policy.routes.push({ destination, target });
  };
  const markPolicies = (kind: ResourcePolicy['kind'], message: string) => {
    for (const node of nodes)
      if (node.policy?.kind === kind) incomplete(node, message, true);
  };
  const markSubnets = (message: string) => {
    for (const node of nodes)
      if (node.boundary === 'subnet') incomplete(node, message);
  };
  for (const r of resources) {
    const node = nodeByResource.get(r.id);
    if (associations.has(r.type) && r.values.__conditional) {
      if (r.type.includes('security_group'))
        markPolicies(
          'security-group',
          `Conditional rule ${r.id} is unresolved`,
        );
      else if (r.type === 'aws_network_acl_rule')
        markPolicies(
          'network-acl',
          `Conditional ACL rule ${r.id} is unresolved`,
        );
      else if (r.type === 'aws_route')
        markPolicies('route-table', `Conditional route ${r.id} is unresolved`);
      else markSubnets(`Conditional association ${r.id} is unresolved`);
      continue;
    }
    if (node?.policy && node.policy.kind !== 'route-table') {
      for (const direction of ['ingress', 'egress'] as const)
        for (const rule of list(r.values[direction]))
          firewall(node, rule, direction, node.policy.kind === 'network-acl');
      if (
        r.values.__default_egress &&
        node.policy.kind === 'security-group' &&
        !list(r.values.egress).length
      )
        node.policy.rules.push({
          action: 'allow',
          direction: 'egress',
          protocol: 'any',
          cidr: '0.0.0.0/0',
        });
      if (node.policy.kind === 'network-acl')
        for (const id of list(r.values.subnet_ids)) {
          const subnet = ref(id),
            n = subnet ? nodeByResource.get(subnet.id) : undefined;
          if (n?.network) n.network.networkAclId = node.id;
          else incomplete(node, 'Unresolved ACL subnet attachment', true);
        }
    }
    if (node?.policy?.kind === 'route-table')
      for (const route of list(r.values.route)) addRoute(node, route);
    if (
      [
        'aws_security_group_rule',
        'aws_vpc_security_group_ingress_rule',
        'aws_vpc_security_group_egress_rule',
      ].includes(r.type)
    ) {
      const owner = policyFor(r.values.security_group_id, 'security-group');
      if (owner)
        firewall(
          owner,
          r.values,
          r.type.endsWith('egress_rule') || r.values.type === 'egress'
            ? 'egress'
            : 'ingress',
        );
      else {
        warnings.push(`${r.id}: security group owner unresolved`);
        markPolicies('security-group', `Unresolved rule owner: ${r.id}`);
      }
    }
    if (r.type === 'aws_network_acl_rule') {
      const owner = policyFor(r.values.network_acl_id, 'network-acl');
      if (owner)
        firewall(
          owner,
          r.values,
          r.values.egress === true ? 'egress' : 'ingress',
          true,
        );
      else {
        warnings.push(`${r.id}: ACL owner unresolved`);
        markPolicies('network-acl', `Unresolved ACL rule owner: ${r.id}`);
      }
    }
    if (r.type === 'aws_route') {
      const owner = policyFor(r.values.route_table_id, 'route-table');
      if (owner) addRoute(owner, r.values);
      else {
        warnings.push(`${r.id}: route table unresolved`);
        markPolicies('route-table', `Unresolved route owner: ${r.id}`);
      }
    }
    if (
      r.type === 'aws_route_table_association' ||
      r.type === 'aws_network_acl_association'
    ) {
      const subnet = ref(r.values.subnet_id),
        n = subnet ? nodeByResource.get(subnet.id) : undefined;
      const acl = r.type === 'aws_network_acl_association',
        owner = policyFor(
          r.values[acl ? 'network_acl_id' : 'route_table_id'],
          acl ? 'network-acl' : 'route-table',
        );
      if (n?.network && owner)
        n.network[acl ? 'networkAclId' : 'routeTableId'] = owner.id;
      else {
        warnings.push(`${r.id}: unresolved subnet association`);
        markSubnets(`Unresolved subnet association: ${r.id}`);
      }
    }
    if (r.type === 'aws_main_route_table_association') {
      const vpc = ref(r.values.vpc_id),
        owner = policyFor(r.values.route_table_id, 'route-table');
      if (vpc && owner)
        for (const subnet of resources.filter(
          (s) => s.type === 'aws_subnet' && parentVpc(s)?.id === vpc.id,
        )) {
          const n = nodeByResource.get(subnet.id);
          if (n?.network && !n.network.routeTableId)
            n.network.routeTableId = owner.id;
        }
    }
    if (r.type === 'aws_internet_gateway_attachment') {
      const gateway = ref(r.values.internet_gateway_id),
        vpc = ref(r.values.vpc_id),
        n = gateway ? nodeByResource.get(gateway.id) : undefined;
      if (n && vpc) n.parentId = nodeId(vpc);
      else if (n) incomplete(n, `Unresolved gateway attachment: ${r.id}`);
      else warnings.push(`${r.id}: unresolved gateway attachment`);
    }
  }
  const edges: ImportResult['document']['edges'] = [];
  const refs = (value: unknown, found = new Set<string>()): Set<string> => {
    const direct = ref(value);
    if (direct) found.add(direct.id);
    if (Array.isArray(value)) for (const child of value) refs(child, found);
    else if (value && typeof value === 'object')
      for (const child of Object.values(obj(value))) refs(child, found);
    return found;
  };
  const nodeIndex = new Map(nodes.map((n) => [n.id, n]));
  for (const r of resources)
    if (nodeByResource.has(r.id))
      for (const dependency of refs(r.values)) {
        if (dependency === r.id || !nodeByResource.has(dependency)) continue;
        const source = nodeId(r),
          target = nodeId(byId.get(dependency) as Resource);
        let parent = nodeIndex.get(source)?.parentId;
        let containment = false;
        while (parent) {
          if (parent === target) {
            containment = true;
            break;
          }
          parent = nodeIndex.get(parent)?.parentId;
        }
        if (containment) continue;
        edges.push({
          id: `dependency:${r.id}:${dependency}`,
          source,
          target,
          label: 'references',
          relationship: 'dependency',
        });
      }
  if (nodes.length) {
    const internet = findService('actor.internet');
    nodes.push({
      id: 'import:internet',
      kind: 'service',
      serviceId: 'actor.internet',
      label: 'Internet',
      x: 0,
      z: 0,
      width: 160,
      depth: 100,
      color: internet?.color ?? '#5a6b86',
      metadata: {
        notes:
          'External traffic source/destination for reachability checks. Uses the scenario source IPv4; no connectivity is inferred from this actor.',
      },
    });
  }
  return {
    format,
    warnings: [...new Set(warnings)],
    document: layoutDocument({ version: 1, title, nodes, edges }),
  };
}
