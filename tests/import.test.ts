import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseDocument, serializeDocument } from '../src/domain/document';
import { defaultTraffic } from '../src/domain/network';
import { checkReachability } from '../src/domain/reachability';
import { importInfrastructure } from '../src/import/infrastructure';

const example = (name: string) => ({
  name,
  content: readFileSync(
    new URL(`../examples/infrastructure/${name}`, import.meta.url),
    'utf8',
  ),
});

test('Terraform HCL imports boundaries, references, security groups and route associations', () => {
  const result = importInfrastructure([example('vpc.tf')]);
  expect(result.warnings).toEqual([]);
  const doc = result.document,
    web = doc.nodes.find((n) => n.label === 'HTTPS web'),
    db = doc.nodes.find((n) => n.label === 'Private PostgreSQL');
  if (!web || !db) throw Error('Missing workloads');
  expect(web.network?.securityGroupIds).toEqual([
    'resource:aws_security_group.web',
  ]);
  expect(
    doc.nodes.find((n) => n.id === 'resource:aws_subnet.public')?.network
      ?.routeTableId,
  ).toBe('resource:aws_route_table.public');
  expect(
    checkReachability(doc, web.id, db.id, { ...defaultTraffic, port: 5432 })
      .status,
  ).toBe('allowed');
  expect(
    checkReachability(doc, web.id, db.id, { ...defaultTraffic, port: 22 })
      .status,
  ).toBe('denied');
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
});
test('CloudFormation YAML resolves short references and implicit default SG egress', () => {
  const result = importInfrastructure([example('cloudformation.yaml')]);
  expect(result.warnings).toEqual([]);
  const web = result.document.nodes.find((n) => n.id === 'resource:Web');
  expect(web?.network?.securityGroupIds).toEqual(['resource:WebSecurityGroup']);
  expect(
    result.document.nodes.find((n) => n.id === 'resource:InternetGateway')
      ?.parentId,
  ).toBe('resource:Vpc');
  const policy = result.document.nodes.find(
    (n) => n.id === 'resource:WebSecurityGroup',
  )?.policy;
  expect(
    policy?.kind === 'security-group' &&
      policy.rules.some((r) => r.direction === 'egress'),
  ).toBe(true);
});
test('Compose imports dependencies, multiple network attachments and isolation', () => {
  const result = importInfrastructure([example('docker-compose.yaml')]);
  const doc = result.document;
  expect(
    checkReachability(
      doc,
      'compose:service:web',
      'compose:service:api',
      defaultTraffic,
    ).status,
  ).toBe('allowed');
  expect(
    checkReachability(
      doc,
      'compose:service:web',
      'compose:service:database',
      defaultTraffic,
    ).status,
  ).toBe('denied');
  expect(doc.edges.every((e) => e.relationship === 'dependency')).toBe(true);
});
test('Terraform show JSON includes resources in child modules and avoids retaining secret attributes', () => {
  const content = JSON.stringify({
    values: {
      root_module: {
        child_modules: [
          {
            resources: [
              {
                address: 'module.a.aws_instance.web',
                type: 'aws_instance',
                values: {
                  private_ip: '10.0.0.2',
                  user_data: 'secret-do-not-retain',
                  id: 'i-123',
                },
              },
            ],
          },
        ],
      },
    },
  });
  const doc = importInfrastructure([{ name: 'state.json', content }]).document;
  expect(
    doc.nodes.some((n) => n.id === 'resource:module.a.aws_instance.web'),
  ).toBe(true);
  expect(serializeDocument(doc)).not.toContain('secret-do-not-retain');
});
test('HCL defaults resolve across files and unsupported module expansion is reported', () => {
  const result = importInfrastructure([
    {
      name: 'vars.tf',
      content:
        'variable "region" { default = "us-west-2" }\nprovider "aws" { region = var.region }\nmodule "external" { source = "example/module" }',
    },
    {
      name: 'main.tf',
      content: 'resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }',
    },
  ]);
  expect(result.document.nodes.some((n) => n.label === 'us-west-2')).toBe(true);
  expect(result.warnings.some((w) => w.includes('not expanded'))).toBe(true);
});
test('malformed or ambiguous import input fails without producing a partial document', () => {
  expect(() =>
    importInfrastructure([
      { name: 'x.tf', content: 'resource "aws_vpc" "v" {' },
    ]),
  ).toThrow();
  expect(() =>
    importInfrastructure([
      { name: 'x.yaml', content: 'services: {a: {}, a: {}}' },
    ]),
  ).toThrow();
  expect(() =>
    importInfrastructure([{ name: 'x.json', content: '{}' }]),
  ).toThrow();
});

test('Terraform plan configuration recovers unresolved resource references', () => {
  const content = JSON.stringify({
    planned_values: {
      root_module: {
        resources: [
          {
            address: 'aws_vpc.main',
            type: 'aws_vpc',
            values: { cidr_block: '10.0.0.0/16' },
          },
          {
            address: 'aws_subnet.a',
            type: 'aws_subnet',
            values: { cidr_block: '10.0.1.0/24', vpc_id: null },
          },
        ],
      },
    },
    resource_changes: [
      { address: 'aws_subnet.a', change: { after_unknown: { vpc_id: true } } },
    ],
    configuration: {
      root_module: {
        resources: [
          {
            address: 'aws_subnet.a',
            expressions: { vpc_id: { references: ['aws_vpc.main.id'] } },
          },
        ],
      },
    },
  });
  const result = importInfrastructure([{ name: 'plan.json', content }]);
  const subnet = result.document.nodes.find(
    (n) => n.id === 'resource:aws_subnet.a',
  );
  expect(subnet?.network?.incomplete).toBeUndefined();
  expect(result.warnings).toEqual([]);
  const az = result.document.nodes.find((n) => n.id === subnet?.parentId);
  expect(az?.parentId).toBe('resource:aws_vpc.main');
});
test('CloudFormation GetAtt sequence syntax imports peer security group references', () => {
  const content = `Resources:\n  Group:\n    Type: AWS::EC2::SecurityGroup\n    Properties: {}\n  App:\n    Type: AWS::EC2::Instance\n    Properties:\n      SecurityGroupIds: [!GetAtt [Group, GroupId]]\n`;
  const doc = importInfrastructure([{ name: 'stack.yaml', content }]).document;
  expect(
    doc.nodes.find((n) => n.id === 'resource:App')?.network?.securityGroupIds,
  ).toEqual(['resource:Group']);
});

test('conditional security groups never supply unconditional permission', () => {
  const Ref = (id: string) => ({ Ref: id });
  const instance = (ip: string) => ({
    Type: 'AWS::EC2::Instance',
    Properties: {
      SubnetId: Ref('Subnet'),
      PrivateIpAddress: ip,
      SecurityGroupIds: [Ref('Group')],
    },
  });
  const root = {
    Resources: {
      Vpc: { Type: 'AWS::EC2::VPC', Properties: { CidrBlock: '10.0.0.0/16' } },
      Subnet: {
        Type: 'AWS::EC2::Subnet',
        Properties: { VpcId: Ref('Vpc'), CidrBlock: '10.0.1.0/24' },
      },
      Group: {
        Type: 'AWS::EC2::SecurityGroup',
        Condition: 'EnableGroup',
        Properties: {
          VpcId: Ref('Vpc'),
          SecurityGroupIngress: [
            {
              IpProtocol: 'tcp',
              FromPort: 443,
              ToPort: 443,
              CidrIp: '0.0.0.0/0',
            },
          ],
        },
      },
      A: instance('10.0.1.10'),
      B: instance('10.0.1.11'),
    },
  };
  const result = importInfrastructure([
    { name: 'conditional.json', content: JSON.stringify(root) },
  ]);
  expect(
    checkReachability(
      result.document,
      'resource:A',
      'resource:B',
      defaultTraffic,
    ).status,
  ).toBe('unknown');
  expect(result.warnings.some((w) => w.includes('condition'))).toBe(true);
});

test('manually attached resource policies also restrict shared Compose networks', () => {
  const doc = importInfrastructure([example('docker-compose.yaml')]).document;
  doc.nodes.push({
    id: 'api-policy',
    kind: 'service',
    label: 'API policy',
    x: 0,
    z: 0,
    width: 160,
    depth: 100,
    color: '#d97706',
    policy: { kind: 'security-group', rules: [] },
  });
  const api = doc.nodes.find((n) => n.id === 'compose:service:api');
  if (!api?.network) throw Error('Missing API');
  api.network.securityGroupIds = ['api-policy'];
  expect(
    checkReachability(doc, 'compose:service:web', api.id, defaultTraffic)
      .status,
  ).toBe('denied');
  const policy = doc.nodes.find((n) => n.id === 'api-policy')?.policy;
  if (!policy || policy.kind === 'route-table') throw Error('Missing policy');
  policy.rules.push({
    action: 'allow',
    direction: 'ingress',
    protocol: 'tcp',
    fromPort: 443,
    toPort: 443,
    cidr: '0.0.0.0/0',
  });
  expect(
    checkReachability(doc, 'compose:service:web', api.id, defaultTraffic)
      .status,
  ).toBe('allowed');
});
test('Cognito, WAF and Shield resources import with their catalog icons', () => {
  const terraform = importInfrastructure([
    {
      name: 'edge.tf',
      content: `resource "aws_cognito_user_pool" "users" { name = "users" }
resource "aws_wafv2_web_acl" "edge" { name = "edge" }
resource "aws_shield_protection" "cdn" { name = "cdn" }`,
    },
  ]);
  const services = terraform.document.nodes
    .flatMap((n) => (n.serviceId?.startsWith('aws.') ? [n.serviceId] : []))
    .sort();
  expect(services).toEqual(['aws.cognito', 'aws.shield', 'aws.waf']);
  const cloudformation = importInfrastructure([
    {
      name: 'edge.json',
      content: JSON.stringify({
        Resources: {
          Users: { Type: 'AWS::Cognito::UserPool', Properties: {} },
          Edge: { Type: 'AWS::WAFv2::WebACL', Properties: {} },
          Cdn: { Type: 'AWS::Shield::Protection', Properties: {} },
        },
      }),
    },
  ]);
  expect(
    cloudformation.document.nodes
      .flatMap((n) => (n.serviceId?.startsWith('aws.') ? [n.serviceId] : []))
      .sort(),
  ).toEqual(['aws.cognito', 'aws.shield', 'aws.waf']);
});
