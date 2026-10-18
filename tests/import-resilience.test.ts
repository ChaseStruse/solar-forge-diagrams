import { expect, test } from 'bun:test';
import { parseDocument, serializeDocument } from '../src/domain/document';
import { importInfrastructure } from '../src/import/infrastructure';

const hcl = (content: string) =>
  importInfrastructure([{ name: 'main.tf', content }]);
const healthy = 'resource "aws_vpc" "healthy" { cidr_block = "10.0.0.0/16" }';

test('object/list comprehensions and nested interpolation quotes stay opaque and resource-local', () => {
  const result = hcl(`${healthy}
resource "aws_instance" "object" {
  tags = { for k, v in var.tags : k => v if v != "}" }
  private_ip = "10.0.0.10"
}
resource "aws_instance" "format" {
  name = "\${format("%s", var.env)}"
}
resource "aws_instance" "list" {
  security_groups = [for group in var.groups : group]
}`);
  expect(
    result.document.nodes.find((n) => n.id === 'resource:aws_vpc.healthy')
      ?.network?.incomplete,
  ).toBeUndefined();
  for (const id of ['object', 'format', 'list']) {
    const node = result.document.nodes.find(
      (n) => n.id === `resource:aws_instance.${id}`,
    );
    expect(node).toBeDefined();
    expect(node?.network?.incomplete?.length).toBeGreaterThan(0);
  }
  expect(parseDocument(serializeDocument(result.document))).toEqual(
    result.document,
  );
});

test('interpolated firewall CIDR and variable ACL priority omit unsafe rules and preserve valid siblings', () => {
  const result = hcl(`${healthy}
resource "aws_security_group" "office" {
  vpc_id = aws_vpc.healthy.id
  ingress { protocol = "tcp" from_port = 22 to_port = 22 cidr_blocks = ["\${var.office}/32"] }
  ingress { protocol = "tcp" from_port = 443 to_port = 443 cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_network_acl" "office" {
  vpc_id = aws_vpc.healthy.id
  ingress { protocol = "tcp" rule_no = var.priority action = "allow" from_port = 22 to_port = 22 cidr_block = "0.0.0.0/0" }
  ingress { protocol = "tcp" rule_no = 200 action = "allow" from_port = 443 to_port = 443 cidr_block = "0.0.0.0/0" }
}`);
  for (const id of ['aws_security_group.office', 'aws_network_acl.office']) {
    const policy = result.document.nodes.find(
      (n) => n.id === `resource:${id}`,
    )?.policy;
    expect(policy?.incomplete?.length).toBeGreaterThan(0);
    if (!policy || policy.kind === 'route-table')
      throw Error('Missing firewall');
    expect(policy.rules.length).toBe(1);
    expect(policy.rules[0]?.fromPort).toBe(443);
  }
  expect(result.warnings.some((w) => w.includes('CIDR'))).toBe(true);
  expect(result.warnings.some((w) => w.includes('rule number'))).toBe(true);
});

test('unsupported static counts produce one incomplete placeholder without expanding', () => {
  for (const count of [101, 1000000, -1, 1.5]) {
    const result = hcl(
      `${healthy}\nresource "aws_instance" "many" { count = ${count} }`,
    );
    const instances = result.document.nodes.filter(
      (n) => n.serviceId === 'aws.ec2',
    );
    expect(instances.length).toBe(1);
    expect(instances[0]?.network?.incomplete?.join()).toContain('not expanded');
    expect(result.warnings.length).toBeGreaterThan(0);
  }
});

test('invalid literal IPv4, routes, ports and duplicate ACL priorities become incomplete', () => {
  const result = hcl(`${healthy}
resource "aws_instance" "bad" { private_ip = "invalid" }
resource "aws_route_table" "bad" { vpc_id = aws_vpc.healthy.id route { cidr_block = "invalid" gateway_id = "local" } }
resource "aws_network_acl" "bad" {
  ingress { protocol = "tcp" rule_no = 100 action = "allow" from_port = 443 to_port = 443 cidr_block = "0.0.0.0/0" }
  ingress { protocol = "tcp" rule_no = 100 action = "allow" from_port = 443 to_port = 443 cidr_block = "0.0.0.0/0" }
  ingress { protocol = "tcp" rule_no = 200 action = "allow" from_port = 70000 to_port = 80000 cidr_block = "0.0.0.0/0" }
}`);
  expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  expect(parseDocument(serializeDocument(result.document))).toEqual(
    result.document,
  );
});

test('AWS imports include one unconnected external Internet actor outside boundaries', () => {
  const result = hcl(healthy);
  const actors = result.document.nodes.filter(
    (n) => n.serviceId === 'actor.internet',
  );
  expect(actors.length).toBe(1);
  expect(actors[0]?.parentId).toBeUndefined();
  expect(
    result.document.edges.some(
      (e) => e.source === actors[0]?.id || e.target === actors[0]?.id,
    ),
  ).toBe(false);
  const compose = importInfrastructure([
    { name: 'compose.yaml', content: 'services:\n  app:\n    image: nginx\n' },
  ]);
  expect(
    compose.document.nodes.some((n) => n.serviceId === 'actor.internet'),
  ).toBe(false);
});

test('unterminated HCL templates still report malformed input', () => {
  expect(() =>
    hcl(`resource "aws_instance" "x" { name = "\${format("%s", var.env)" }`),
  ).toThrow();
});

test('literal braces and nested template arguments do not consume following resources', () => {
  const result = hcl(`${healthy}
resource "aws_instance" "labels" {
  tags = { open = "{" close = "}" "for" = "literal" }
  labels = ["]", "[", ",", "}"]
  name = "prefix-\${format("%s-%s", var.env, "\${var.region}")}-suffix"
}
resource "aws_instance" "next" { private_ip = "10.0.0.12" }`);
  expect(
    result.document.nodes.find((n) => n.id === 'resource:aws_instance.next')
      ?.network?.ip,
  ).toBe('10.0.0.12');
});
