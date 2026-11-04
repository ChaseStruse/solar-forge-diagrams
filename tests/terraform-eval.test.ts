/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: HCL templates are the test data. */
import { expect, test } from 'bun:test';
import { parseDocument, serializeDocument } from '../src/domain/document';
import {
  Evaluator,
  parseExpression,
  type Scope,
  Unknown,
  type Value,
} from '../src/import/hcl-expr';
import { callFunction } from '../src/import/hcl-functions';
import { importInfrastructure } from '../src/import/infrastructure';

/** Evaluate one expression with a few variables in scope. */
const evaluate = (text: string, vars: Record<string, Value> = {}): Value => {
  const scope: Scope = {
    root(name) {
      if (name === 'var') return vars;
      if (name === 'aws_subnet') return new Unknown('aws_subnet', true);
      throw Error(`Unknown name ${name}`);
    },
    call: (name, args) => callFunction(name, args),
  };
  return new Evaluator(scope, text).evaluate(parseExpression(text));
};
const tf = (files: Record<string, string>) =>
  importInfrastructure(
    Object.entries(files).map(([name, content]) => ({ name, content })),
  );
const nodeOf = (doc: ReturnType<typeof tf>['document'], id: string) =>
  doc.nodes.find((n) => n.id === `resource:${id}`);

test('operators, conditionals, collections and for expressions', () => {
  expect(evaluate('1 + 2 * 3 - 4 / 2')).toBe(5);
  expect(evaluate('!(1 < 2) || 3 >= 3 && "a" == "a"')).toBe(true);
  expect(evaluate('var.env == "prod" ? 3 : 1', { env: 'prod' })).toBe(3);
  expect(
    evaluate('[for s in var.xs : upper(s) if s != "b"]', {
      xs: ['a', 'b', 'c'],
    }),
  ).toEqual(['A', 'C']);
  expect(
    evaluate('{for k, v in var.m : v => k}', { m: { a: 'x', b: 'y' } }),
  ).toEqual({ x: 'a', y: 'b' });
  expect(
    evaluate('{for s in var.xs : substr(s, 0, 1) => s...}', {
      xs: ['apple', 'avocado', 'banana'],
    }),
  ).toEqual({ a: ['apple', 'avocado'], b: ['banana'] });
  expect(
    evaluate('var.list[*].name', { list: [{ name: 'a' }, { name: 'b' }] }),
  ).toEqual(['a', 'b']);
  expect(evaluate('{ a = 1, "b" = 2 }.b')).toBe(2);
  expect(evaluate('var.xs[1]', { xs: [10, 20] })).toBe(20);
});

test('templates interpolate, branch, loop and strip whitespace', () => {
  expect(evaluate('"web-${var.env}-${1 + 1}"', { env: 'prod' })).toBe(
    'web-prod-2',
  );
  expect(evaluate('"${var.n}"', { n: 5 })).toBe(5);
  expect(
    evaluate('"%{ if var.on }yes%{ else }no%{ endif }"', { on: false }),
  ).toBe('no');
  expect(
    evaluate('"%{ for x in var.xs ~} [${x}] %{~ endfor }"', { xs: [1, 2] }),
  ).toBe('[1][2]');
  expect(evaluate('"literal $${not} \\"quoted\\""')).toBe(
    'literal ${not} "quoted"',
  );
});

test('pure functions, including IPv4 CIDR maths', () => {
  expect(evaluate('cidrsubnet("10.0.0.0/16", 8, 2)')).toBe('10.0.2.0/24');
  expect(evaluate('cidrhost("10.0.1.0/24", 10)')).toBe('10.0.1.10');
  expect(evaluate('cidrhost("10.0.1.0/24", -2)')).toBe('10.0.1.254');
  expect(evaluate('cidrnetmask("172.16.0.0/12")')).toBe('255.240.0.0');
  expect(evaluate('cidrsubnets("10.1.0.0/16", 4, 4, 8)')).toEqual([
    '10.1.0.0/20',
    '10.1.16.0/20',
    '10.1.32.0/24',
  ]);
  expect(evaluate('format("%s-%03d", "app", 7)')).toBe('app-007');
  expect(evaluate('merge({a = 1}, {b = 2}, {a = 3})')).toEqual({ a: 3, b: 2 });
  expect(evaluate('lookup({a = 1}, "b", 9)')).toBe(9);
  expect(evaluate('element(["a", "b"], 3)')).toBe('b');
  expect(evaluate('flatten([[1], [2, [3]]])')).toEqual([1, 2, 3]);
  expect(evaluate('zipmap(["a", "b"], [1, 2])')).toEqual({ a: 1, b: 2 });
  expect(evaluate('length(range(1, 10, 3))')).toBe(3);
  expect(evaluate('join(",", sort(toset(["b", "a", "b"])))')).toBe('a,b');
  expect(evaluate('try(var.missing.x, "fallback")', {})).toBe('fallback');
  expect(evaluate('can(var.missing.x)', {})).toBe(false);
  expect(evaluate('replace("a-b-c", "/-/", "_")')).toBe('a_b_c');
});

test('unknown values stay unknown, keeping reference addresses', () => {
  const ref = evaluate('aws_subnet.private[2].id');
  expect(ref).toBeInstanceOf(Unknown);
  expect((ref as Unknown).text).toBe('aws_subnet.private[2].id');
  expect((ref as Unknown).ref).toBe(true);
  // Unknown inputs make computed results unknown, not wrong.
  const computed = evaluate('cidrsubnet(var.cidr, 8, 1)', {
    cidr: new Unknown('var.cidr'),
  });
  expect(computed).toBeInstanceOf(Unknown);
  // Structural functions pass unknown items through.
  const listed = evaluate('element(concat([aws_subnet.a.id], ["x"]), 0)');
  expect((listed as Unknown).text).toBe('aws_subnet.a.id');
  // Files and clocks are never read.
  expect(() => evaluate('file("secret.txt")')).toThrow('not evaluated');
  // A runaway range is refused rather than hanging the import.
  expect(() => evaluate('range(100000000)')).toThrow();
});

test('count and for_each expand instances that references can reach', () => {
  const { document: doc, warnings } = tf({
    'main.tf': `
variable "azs" { default = ["us-east-1a", "us-east-1b"] }
variable "apps" {
  default = { web = { port = 443 }, admin = { port = 8443 } }
}
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  availability_zone = var.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
}
resource "aws_security_group" "app" {
  for_each = var.apps
  name     = "app-\${each.key}"
  vpc_id   = aws_vpc.main.id
  ingress {
    protocol    = "tcp"
    from_port   = each.value.port
    to_port     = each.value.port
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}
resource "aws_instance" "app" {
  for_each               = toset(keys(var.apps))
  subnet_id              = element(aws_subnet.private[*].id, 1)
  vpc_security_group_ids = [aws_security_group.app[each.key].id]
  tags = { Name = "\${each.key} server" }
}`,
  });
  expect(warnings).toEqual([]);
  const subnet = nodeOf(doc, 'aws_subnet.private[1]');
  expect(subnet?.network?.cidr).toBe('10.0.11.0/24');
  expect(nodeOf(doc, 'aws_subnet.private[0]')?.network?.cidr).toBe(
    '10.0.10.0/24',
  );
  const web = nodeOf(doc, 'aws_instance.app["web"]');
  expect(web?.label).toBe('web server');
  expect(web?.parentId).toBe(subnet?.id);
  expect(web?.network?.securityGroupIds).toEqual([
    'resource:aws_security_group.app["web"]',
  ]);
  const admin = nodeOf(doc, 'aws_security_group.app["admin"]');
  if (admin?.policy?.kind !== 'security-group') throw Error('Missing group');
  expect(admin.policy.rules[0]?.fromPort).toBe(8443);
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
});

test('dynamic blocks expand, with iterators; unknown ones mark the resource', () => {
  const { document: doc } = tf({
    'main.tf': `
locals {
  rules = [
    { port = 80, cidr = "0.0.0.0/0" },
    { port = 443, cidr = "0.0.0.0/0" },
  ]
}
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress {
    protocol = "tcp"
    from_port = 22
    to_port = 22
    cidr_blocks = ["10.0.0.0/8"]
  }
  dynamic "ingress" {
    for_each = local.rules
    iterator = rule
    content {
      protocol    = "tcp"
      from_port   = rule.value.port
      to_port     = rule.value.port
      cidr_blocks = [rule.value.cidr]
    }
  }
}
resource "aws_security_group" "unknown" {
  vpc_id = aws_vpc.main.id
  dynamic "ingress" {
    for_each = var.not_set
    content { protocol = "tcp" }
  }
}`,
  });
  const web = nodeOf(doc, 'aws_security_group.web');
  if (web?.policy?.kind !== 'security-group') throw Error('Missing group');
  expect(web.policy.rules.map((r) => r.fromPort).sort()).toEqual([22, 443, 80]);
  expect(
    nodeOf(doc, 'aws_security_group.unknown')?.policy?.incomplete?.join(' '),
  ).toContain('Dynamic ingress');
});

test('local modules expand with inputs, outputs, count and for_each', () => {
  const { document: doc, warnings } = tf({
    'main.tf': `
module "network" {
  source = "./modules/network"
  cidr   = var.cidr
  name   = "core"
}
module "app" {
  source    = "./modules/app"
  for_each  = toset(["blue", "green"])
  subnet_id = module.network.public_subnet_id
  label     = each.key
}
module "remote" {
  source = "terraform-aws-modules/vpc/aws"
}
module "missing" {
  source = "./modules/missing"
}`,
    'terraform.tfvars': 'cidr = "10.8.0.0/16"',
    'modules/network/main.tf': `
variable "cidr" {}
variable "name" { default = "x" }
resource "aws_vpc" "this" {
  cidr_block = var.cidr
  tags = { Name = "\${var.name} vpc" }
}
resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.this.id
  cidr_block = cidrsubnet(var.cidr, 8, 0)
  map_public_ip_on_launch = true
}
output "public_subnet_id" { value = aws_subnet.public.id }`,
    'modules/app/main.tf': `
variable "subnet_id" {}
variable "label" {}
resource "aws_instance" "server" {
  subnet_id = var.subnet_id
  tags = { Name = "\${var.label} app" }
}`,
  });
  const vpc = nodeOf(doc, 'module.network.aws_vpc.this');
  expect(vpc?.label).toBe('core vpc');
  const subnet = nodeOf(doc, 'module.network.aws_subnet.public');
  expect(subnet?.network?.cidr).toBe('10.8.0.0/24');
  for (const colour of ['blue', 'green']) {
    const server = nodeOf(doc, `module.app["${colour}"].aws_instance.server`);
    expect(server?.label).toBe(`${colour} app`);
    expect(server?.parentId).toBe(subnet?.id);
  }
  expect(
    warnings.some(
      (w) => w.includes('module.remote') && w.includes('not expanded'),
    ),
  ).toBe(true);
  expect(
    warnings.some(
      (w) => w.includes('module.missing') && w.includes('were not chosen'),
    ),
  ).toBe(true);
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
});

test('tfvars apply in Terraform order, and unset network variables are reported', () => {
  const files = {
    'main.tf': `
variable "cidr" { default = "10.0.0.0/16" }
variable "office" {}
resource "aws_vpc" "main" { cidr_block = var.cidr }
resource "aws_security_group" "office" {
  vpc_id = aws_vpc.main.id
  ingress { protocol = "tcp" from_port = 22 to_port = 22 cidr_blocks = [var.office] }
}`,
    'terraform.tfvars': 'cidr = "10.1.0.0/16"',
    'prod.auto.tfvars': 'cidr = "10.2.0.0/16"',
  };
  const { document: doc, warnings } = tf(files);
  expect(nodeOf(doc, 'aws_vpc.main')?.network?.cidr).toBe('10.2.0.0/16');
  expect(warnings.join(' ')).toContain(
    'Variables without a value decide network settings: office',
  );
  const set = tf({ ...files, 'office.tfvars': 'office = "198.51.100.7/32"' });
  expect(set.warnings.join(' ')).not.toContain('office');
});

test('file() is reported and left unknown; it never blocks the import', () => {
  const { document: doc, warnings } = tf({
    'main.tf': `
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
resource "aws_instance" "web" {
  user_data = file("init.sh")
  tags = { Name = "web" }
}`,
  });
  expect(nodeOf(doc, 'aws_instance.web')?.label).toBe('web');
  expect(warnings.join(' ')).toContain('file() reads files');
});

test('the modules example imports as a folder and its storefront is reachable', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { checkReachability } = await import('../src/domain/reachability');
  const root = 'examples/infrastructure/modules-project';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const files = walk(root).map((path) => ({
    name: relative(root, path),
    content: readFileSync(path, 'utf8'),
  }));
  const { document: doc, warnings } = importInfrastructure(files);
  expect(warnings).toEqual([]);
  const store = nodeOf(doc, 'module.service["storefront"].aws_instance.this');
  expect(store?.label).toBe('storefront (443)');
  const subnet = nodeOf(doc, 'module.network.aws_subnet.public[0]');
  expect(subnet?.network?.cidr).toBe('10.20.0.0/24');
  expect(store?.parentId).toBe(subnet?.id);
  expect(doc.nodes.some((n) => n.label === 'us-east-1')).toBe(true);
  if (!store) throw Error('Missing storefront');
  const traffic = (port: number, sourceIp = '203.0.113.10') => ({
    protocol: 'tcp' as const,
    port,
    sourceIp,
    direction: 'ingress' as const,
  });
  expect(
    checkReachability(doc, 'import:internet', store.id, traffic(443)).status,
  ).toBe('allowed');
  expect(
    checkReachability(doc, 'import:internet', store.id, traffic(22)).status,
  ).toBe('denied');
  expect(
    checkReachability(
      doc,
      'import:internet',
      store.id,
      traffic(22, '198.51.100.9'),
    ).status,
  ).toBe('allowed');
});
