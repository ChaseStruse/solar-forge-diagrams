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
