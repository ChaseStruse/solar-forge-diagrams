import {
  type CollectionTag,
  parseDocument as parseYaml,
  type ScalarTag,
} from 'yaml';
import { parseDocument, serializeDocument } from '../domain/document';
import { importAws } from './aws';
import { importCompose } from './compose';
import { parseHcl } from './hcl';
import {
  type ImportResult,
  type InfrastructureFile,
  list,
  obj,
  type Resource,
} from './types';
export type ImportFormat = 'auto' | 'terraform' | 'cloudformation' | 'compose';
/** Terraform arguments that placement, routing or firewall analysis reads. */
const networkAttributes = new Set([
  'vpc_id',
  'subnet_id',
  'subnet_ids',
  'subnets',
  'availability_zone',
  'cidr_block',
  'private_ip',
  'public_ip',
  'associate_public_ip_address',
  'map_public_ip_on_launch',
  'vpc_security_group_ids',
  'security_groups',
  'security_group_id',
  'ingress',
  'egress',
  'route',
  'network_acl_id',
  'route_table_id',
  'destination_cidr_block',
  'gateway_id',
  'nat_gateway_id',
  'internet_gateway_id',
  'instance_id',
  'network_interface_id',
  'transit_gateway_id',
  'vpc_peering_connection_id',
  'db_subnet_group_name',
  'type',
  'protocol',
  'ip_protocol',
  'from_port',
  'to_port',
  'cidr_blocks',
  'cidr_ipv4',
  'self',
  'source_security_group_id',
  'referenced_security_group_id',
  'rule_no',
  'rule_number',
  'rule_action',
  'action',
]);
const cfnTypes: Record<string, string> = {
  VPC: 'aws_vpc',
  Subnet: 'aws_subnet',
  Instance: 'aws_instance',
  SecurityGroup: 'aws_security_group',
  SecurityGroupIngress: 'aws_vpc_security_group_ingress_rule',
  SecurityGroupEgress: 'aws_vpc_security_group_egress_rule',
  NetworkAcl: 'aws_network_acl',
  NetworkAclEntry: 'aws_network_acl_rule',
  SubnetNetworkAclAssociation: 'aws_network_acl_association',
  RouteTable: 'aws_route_table',
  Route: 'aws_route',
  SubnetRouteTableAssociation: 'aws_route_table_association',
  InternetGateway: 'aws_internet_gateway',
  VPCGatewayAttachment: 'aws_internet_gateway_attachment',
  NatGateway: 'aws_nat_gateway',
};
const propertyNames: Record<string, string> = {
  VpcId: 'vpc_id',
  SubnetId: 'subnet_id',
  AvailabilityZone: 'availability_zone',
  CidrBlock: 'cidr_block',
  MapPublicIpOnLaunch: 'map_public_ip_on_launch',
  PrivateIpAddress: 'private_ip',
  PublicIp: 'public_ip',
  SecurityGroupIds: 'vpc_security_group_ids',
  GroupSet: 'vpc_security_group_ids',
  SecurityGroups: 'security_groups',
  SecurityGroupIngress: 'ingress',
  SecurityGroupEgress: 'egress',
  IpProtocol: 'protocol',
  FromPort: 'from_port',
  ToPort: 'to_port',
  SourceSecurityGroupId: 'source_security_group_id',
  DestinationSecurityGroupId: 'source_security_group_id',
  GroupId: 'security_group_id',
  NetworkAclId: 'network_acl_id',
  Egress: 'egress',
  RuleNumber: 'rule_number',
  RuleAction: 'rule_action',
  RouteTableId: 'route_table_id',
  DestinationCidrBlock: 'destination_cidr_block',
  GatewayId: 'gateway_id',
  NatGatewayId: 'nat_gateway_id',
  InternetGatewayId: 'internet_gateway_id',
  SubnetIds: 'subnet_ids',
  Subnets: 'subnets',
  DBSubnetGroupName: 'db_subnet_group_name',
};
function yaml(content: string): unknown {
  const names = [
    'Ref',
    'GetAtt',
    'Sub',
    'GetAZs',
    'ImportValue',
    'Condition',
    'Join',
    'Select',
    'Split',
    'FindInMap',
    'If',
    'Base64',
    'Cidr',
    'And',
    'Equals',
    'Not',
    'Or',
    'Length',
    'ToJsonString',
    'Transform',
  ];
  const customTags: (ScalarTag | CollectionTag)[] = [];
  for (const name of names) {
    const key = name === 'Ref' ? 'Ref' : `Fn::${name}`;
    customTags.push({
      tag: `!${name}`,
      resolve: (value) => ({ [key]: value }),
    });
    customTags.push({
      tag: `!${name}`,
      collection: 'seq',
      resolve: (value) => ({ [key]: value.toJSON() }),
    });
    customTags.push({
      tag: `!${name}`,
      collection: 'map',
      resolve: (value) => ({ [key]: value.toJSON() }),
    });
  }
  const doc = parseYaml(content, { customTags, merge: true, uniqueKeys: true });
  if (doc.warnings.some((w) => w.code === 'TAG_RESOLVE_FAILED'))
    throw Error(
      'Unsupported YAML tag. Use explicit CloudFormation intrinsic objects or JSON.',
    );
  if (doc.errors.length)
    throw Error(doc.errors.map((e) => e.message).join('\n'));
  return doc.toJS({ maxAliasCount: 100 });
}
function resolve(
  value: unknown,
  parameters: Record<string, unknown>,
  depth = 0,
): unknown {
  if (depth > 64) return { $expr: 'unresolved expression' };
  const o = obj(value);
  if (typeof o.$expr === 'string') {
    const name = o.$expr;
    if (Object.hasOwn(parameters, name))
      return resolve(parameters[name], parameters, depth + 1);
    return value;
  }
  if (typeof o.Ref === 'string' && Object.hasOwn(parameters, o.Ref))
    return resolve(parameters[o.Ref], parameters, depth + 1);
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{(var\.[\w-]+|local\.[\w-]+)\}$/)?.[1];
    if (exact && Object.hasOwn(parameters, exact))
      return resolve(parameters[exact], parameters, depth + 1);
    return value;
  }
  if (Array.isArray(value))
    return value.map((v) => resolve(v, parameters, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, resolve(v, parameters, depth + 1)]),
    );
  return value;
}
function cfn(root: Record<string, unknown>, warnings: string[]): Resource[] {
  const parameters = Object.fromEntries(
    Object.entries(obj(root.Parameters))
      .filter(([, v]) => Object.hasOwn(obj(v), 'Default'))
      .map(([k, v]) => [k, obj(v).Default]),
  );
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') {
      const o = obj(value);
      if (o.Ref || Object.keys(o).some((k) => k.startsWith('Fn::')))
        return resolve(value, parameters);
      const result = Object.fromEntries(
        Object.entries(o).map(([k, v]) => [propertyNames[k] ?? k, convert(v)]),
      );
      if (o.CidrIp !== undefined) result.cidr_blocks = [convert(o.CidrIp)];
      if (o.CidrIpv6 !== undefined)
        result.ipv6_cidr_blocks = [convert(o.CidrIpv6)];
      if (o.PortRange) {
        result.from_port = obj(o.PortRange).From;
        result.to_port = obj(o.PortRange).To;
      }
      return result;
    }
    return value;
  };
  return Object.entries(obj(root.Resources)).map(([id, value]) => {
    const resource = obj(value),
      type = String(resource.Type ?? 'Unknown');
    let tfType = type.startsWith('AWS::EC2::')
      ? cfnTypes[type.slice(10)]
      : undefined;
    const other: Record<string, string> = {
      'AWS::RDS::DBInstance': 'aws_db_instance',
      'AWS::RDS::DBSubnetGroup': 'aws_db_subnet_group',
      'AWS::S3::Bucket': 'aws_s3_bucket',
      'AWS::DynamoDB::Table': 'aws_dynamodb_table',
      'AWS::Lambda::Function': 'aws_lambda_function',
      'AWS::ECS::Service': 'aws_ecs_service',
      'AWS::ECS::Cluster': 'aws_ecs_cluster',
      'AWS::EKS::Cluster': 'aws_eks_cluster',
      'AWS::SQS::Queue': 'aws_sqs_queue',
      'AWS::SNS::Topic': 'aws_sns_topic',
      'AWS::Cognito::UserPool': 'aws_cognito_user_pool',
      'AWS::Cognito::IdentityPool': 'aws_cognito_identity_pool',
      'AWS::WAFv2::WebACL': 'aws_wafv2_web_acl',
      'AWS::Shield::Protection': 'aws_shield_protection',
      'AWS::ElasticLoadBalancingV2::LoadBalancer': 'aws_lb',
    };
    tfType ??= other[type] ?? type;
    const values = obj(convert(resource.Properties));
    const tags = list(obj(resource.Properties).Tags);
    values.tags = Object.fromEntries(
      tags
        .filter((t) => typeof obj(t).Key === 'string')
        .map((t) => [String(obj(t).Key), obj(t).Value]),
    );
    if (
      tfType === 'aws_security_group' &&
      obj(resource.Properties).SecurityGroupEgress === undefined
    )
      values.__default_egress = true;
    if (tfType === 'aws_instance') {
      const interfaces = list(obj(resource.Properties).NetworkInterfaces);
      if (interfaces.length) {
        const ni = obj(convert(interfaces[0]));
        values.subnet_id ??= ni.subnet_id;
        values.vpc_security_group_ids ??= ni.vpc_security_group_ids;
        values.private_ip ??= ni.private_ip;
        if (obj(interfaces[0]).AssociatePublicIpAddress !== undefined)
          values.associate_public_ip_address = obj(
            interfaces[0],
          ).AssociatePublicIpAddress;
        if (interfaces.length > 1)
          values.__incomplete = 'Multiple network interfaces are not expanded';
      }
    }
    if (
      resource.Condition ||
      Object.keys(obj(resource.Properties)).some((k) => k === 'Fn::If')
    ) {
      values.__incomplete = 'Conditional CloudFormation resource is unresolved';
      values.__conditional = true;
      warnings.push(`${id}: CloudFormation conditions are not evaluated`);
    }
    values.depends_on = resource.DependsOn;
    return { id, type: tfType, values };
  });
}
function terraformJson(
  root: Record<string, unknown>,
  warnings: string[],
): Resource[] {
  const resources: Resource[] = [];
  const walk = (module: unknown): void => {
    const m = obj(module);
    for (const value of list(m.resources)) {
      const r = obj(value);
      if (r.mode === 'data') continue;
      resources.push({
        id: String(r.address ?? `${r.type}.${r.name}`),
        type: String(r.type),
        values: obj(r.values),
      });
    }
    for (const child of list(m.child_modules)) walk(child);
  };
  walk(obj(root.planned_values).root_module ?? obj(root.values).root_module);
  if (!resources.length && root.resource)
    for (const [type, values] of Object.entries(obj(root.resource)))
      for (const [name, value] of Object.entries(obj(values)))
        resources.push({ id: `${type}.${name}`, type, values: obj(value) });
  const changes = list(root.resource_changes);
  const fallback = resources.length === 0;
  const unknowns = new Map<string, string[]>();
  for (const value of changes) {
    const r = obj(value),
      change = obj(r.change);
    const keys = Object.keys(obj(change.after_unknown)).filter(
      (key) =>
        [
          'vpc_id',
          'subnet_id',
          'vpc_security_group_ids',
          'ingress',
          'egress',
          'route',
        ].includes(key) && obj(change.after_unknown)[key],
    );
    if (keys.length) unknowns.set(String(r.address), keys);
    if (fallback && change.after && r.mode !== 'data')
      resources.push({
        id: String(r.address),
        type: String(r.type),
        values: obj(change.after),
      });
  }
  // Plan configuration retains references even when evaluated IDs are unknown.
  const byAddress = new Map<string, Resource>();
  for (const resource of resources)
    if (!byAddress.has(resource.id)) byAddress.set(resource.id, resource);
  const config = (module: unknown, prefix = ''): void => {
    const m = obj(module);
    for (const raw of list(m.resources)) {
      const r = obj(raw),
        existing = byAddress.get(
          String(r.address).startsWith('module.')
            ? String(r.address)
            : prefix + String(r.address),
        );
      if (!existing) continue;
      for (const [key, value] of Object.entries(obj(r.expressions)))
        if (
          existing.values[key] === undefined ||
          existing.values[key] === null ||
          (Array.isArray(existing.values[key]) &&
            !(existing.values[key] as unknown[]).length)
        ) {
          const refs = list(obj(value).references).filter(
            (r): r is string =>
              typeof r === 'string' &&
              !r.startsWith('var.') &&
              !r.startsWith('data.'),
          );
          if (refs.length)
            existing.values[key] =
              key.endsWith('_ids') ||
              key === 'security_groups' ||
              key === 'subnets'
                ? [...new Set(refs)].map((r) => ({ $expr: prefix + r }))
                : { $expr: prefix + refs[0] };
        }
    }
    for (const [name, call] of Object.entries(obj(m.module_calls)))
      config(obj(call).module, `${prefix}module.${name}.`);
  };
  config(obj(root.configuration).root_module);
  for (const r of resources) {
    const keys = (unknowns.get(r.id) ?? []).filter(
      (key) => r.values[key] === undefined || r.values[key] === null,
    );
    if (keys.length) {
      r.values.__incomplete = `Plan has unknown values: ${keys.join(', ')}`;
      warnings.push(`${r.id}: ${r.values.__incomplete}`);
    }
  }
  return resources;
}
export function importInfrastructure(
  files: InfrastructureFile[],
  requested: ImportFormat = 'auto',
): ImportResult {
  if (!files.length || files.length > 256)
    throw Error('Choose 1–256 infrastructure files');
  if (files.reduce((sum, f) => sum + f.content.length, 0) > 50_000_000)
    throw Error('Infrastructure input exceeds 50 MB');
  const warnings: string[] = [],
    title =
      files.length === 1
        ? `Imported · ${files[0]?.name}`
        : 'Imported Terraform architecture';
  const terraform =
    requested === 'terraform' ||
    (requested === 'auto' && files.some((f) => /\.tf$/i.test(f.name)));
  let result: ImportResult;
  if (terraform && files.every((f) => /\.tf$/i.test(f.name))) {
    const blocks = files.flatMap((f) => parseHcl(f.content)),
      parameters: Record<string, unknown> = {};
    for (const b of blocks) {
      if (b.type === 'variable' && b.labels[0] && b.body.default !== undefined)
        parameters[`var.${b.labels[0]}`] = b.body.default;
      if (b.type === 'locals')
        for (const [k, v] of Object.entries(b.body))
          parameters[`local.${k}`] = v;
    }
    const defaultRegion = blocks.find(
      (b) => b.type === 'provider' && b.labels[0] === 'aws',
    )?.body.region;
    const resources: Resource[] = [];
    for (const b of blocks) {
      if (b.type === 'module') {
        warnings.push(
          `Module ${b.labels[0]} is not expanded; import terraform show -json for evaluated modules`,
        );
        continue;
      }
      if (b.type !== 'resource') continue;
      const type = b.labels[0],
        name = b.labels[1];
      if (!type || !name) throw Error('Terraform resource needs type and name');
      const values = obj(resolve(b.body, parameters));
      let count = typeof values.count === 'number' ? values.count : 1;
      const invalidCount = count < 0 || !Number.isInteger(count) || count > 100;
      if (invalidCount) {
        values.__incomplete =
          'Terraform count is outside the supported 0–100 range; instances were not expanded';
        warnings.push(`${type}.${name}: ${values.__incomplete}`);
        count = 1;
      }
      if (
        values.for_each ||
        (values.count !== undefined && typeof values.count !== 'number')
      ) {
        values.__incomplete =
          'for_each/count is unresolved; import evaluated Terraform JSON';
        warnings.push(`${type}.${name}: instances were not expanded`);
      }
      const complex = (value: unknown): boolean => {
        if (typeof value === 'string')
          return (
            (value.includes('${') || value.includes('%{')) &&
            /[({]/.test(value.replace(/\$\{/g, ''))
          );
        if (Array.isArray(value)) return value.some(complex);
        const record = obj(value);
        if (
          typeof record.$expr === 'string' &&
          (record.$expr.startsWith('[') || /[({]/.test(record.$expr))
        )
          return true;
        return Object.values(record).some(complex);
      };
      // Only attributes the network model reads can make a resource incomplete;
      // computed tags, names or descriptions do not affect reachability.
      const unsupported = Object.keys(values).filter(
        (key) => networkAttributes.has(key) && complex(values[key]),
      );
      if (unsupported.length)
        values.__incomplete ??= `Unsupported Terraform expression in ${unsupported.join(', ')}; import evaluated Terraform JSON`;
      for (let i = 0; i < count; i++)
        resources.push({
          id: `${type}.${name}${values.count !== undefined && !invalidCount && typeof values.count === 'number' ? `[${i}]` : ''}`,
          type,
          values: structuredClone(values),
          ...(typeof resolve(defaultRegion, parameters) === 'string'
            ? { region: String(resolve(defaultRegion, parameters)) }
            : {}),
        });
    }
    result = importAws(resources, title, 'Terraform HCL', warnings);
  } else {
    if (files.length !== 1)
      throw Error('Select multiple .tf files together, or one JSON/YAML file');
    const file = files[0];
    if (!file) throw Error('No file');
    const root = obj(
      file.content.trimStart().startsWith('{')
        ? JSON.parse(file.content.trimStart())
        : yaml(file.content),
    );
    const format =
      requested === 'auto'
        ? root.Resources
          ? 'cloudformation'
          : root.services
            ? 'compose'
            : 'terraform'
        : requested;
    result =
      format === 'compose'
        ? importCompose(root, title)
        : format === 'cloudformation'
          ? importAws(cfn(root, warnings), title, 'CloudFormation', warnings)
          : importAws(
              terraformJson(root, warnings),
              title,
              'Terraform JSON',
              warnings,
            );
  }
  // The exact document that the editor receives must pass portable validation.
  result.document = parseDocument(serializeDocument(result.document));
  return result;
}
