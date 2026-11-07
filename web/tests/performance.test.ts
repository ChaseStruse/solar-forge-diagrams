import { expect, test } from 'bun:test';
import { fitText } from '../src/domain/text';
import { importInfrastructure } from '../src/import/infrastructure';

test('text fitting measures each distinct line once, at the preferred size', () => {
  const calls: number[] = [];
  const measure = (line: string, size: number) => {
    calls.push(size);
    return line.length * size * 0.6;
  };
  const long = 'Application load balancer for the public web tier';
  const result = fitText(long, 90, 30, 20, measure);
  expect(result.size).toBeLessThan(20);
  expect(new Set(calls)).toEqual(new Set([20]));
  // The size search reuses widths instead of re-measuring every iteration.
  expect(calls.length).toBeLessThan(80);
  // A label that already fits keeps its preferred size without a search.
  expect(fitText('Lambda', 200, 100, 20, measure).size).toBe(20);
});

test('attribute references resolve to the longest resource address', () => {
  const subnets = Array.from(
    { length: 300 },
    (_, i) =>
      `resource "aws_subnet" "s${i}" {\n vpc_id = aws_vpc.main.id\n cidr_block = "10.0.${i % 250}.0/24"\n}`,
  ).join('\n');
  const instances = Array.from(
    { length: 300 },
    (_, i) =>
      `resource "aws_instance" "i${i}" {\n subnet_id = aws_subnet.s${i}.id\n}`,
  ).join('\n');
  const { document } = importInfrastructure([
    {
      name: 'main.tf',
      content: `resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }\n${subnets}\n${instances}`,
    },
  ]);
  const parent = (id: string) =>
    document.nodes.find((n) => n.id === `resource:${id}`)?.parentId;
  expect(parent('aws_instance.i7')).toBe('resource:aws_subnet.s7');
  expect(parent('aws_instance.i299')).toBe('resource:aws_subnet.s299');
  expect(
    document.nodes
      .filter((n) => n.id.startsWith('resource:aws_subnet.'))
      .every((n) =>
        document.nodes
          .find((z) => z.id === n.parentId)
          ?.parentId?.startsWith('resource:aws_vpc.main'),
      ),
  ).toBe(true);
});
