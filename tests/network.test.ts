import { expect, test } from 'bun:test';
import { vpcExample } from '../src/catalog/networking';
import { parseDocument, serializeDocument } from '../src/domain/document';
import { DocumentHistory } from '../src/domain/history';
import {
  defaultTraffic,
  evaluateTraffic,
  parseNetworkRule,
  parseTraffic,
} from '../src/domain/network';

test('traffic rules allow HTTPS, reject wrong ports, sources, protocols and directions', () => {
  const rule = parseNetworkRule({
    action: 'allow',
    protocol: 'tcp',
    port: 443,
    sourceCidr: '10.0.0.0/16',
    direction: 'egress',
  });
  const traffic = {
    ...defaultTraffic,
    sourceIp: '10.0.10.10',
    direction: 'egress' as const,
  };
  expect(evaluateTraffic(rule, traffic).allowed).toBe(true);
  for (const change of [
    { port: 22 },
    { sourceIp: '10.1.0.1' },
    { protocol: 'udp' as const },
    { direction: 'ingress' as const },
  ])
    expect(evaluateTraffic(rule, { ...traffic, ...change }).allowed).toBe(
      false,
    );
  expect(
    evaluateTraffic({ ...rule, sourceCidr: '0.0.0.0/0' }, traffic).allowed,
  ).toBe(true);
  expect(
    evaluateTraffic({ ...rule, sourceCidr: '10.0.10.10/32' }, traffic).allowed,
  ).toBe(true);
  expect(evaluateTraffic({ ...rule, action: 'deny' }, traffic).allowed).toBe(
    false,
  );
  expect(evaluateTraffic(undefined, traffic).allowed).toBe(true);
});
test('network configuration rejects malformed input and survives save and undo', () => {
  for (const sourceIp of ['256.0.0.1', '1.2.3', 'x.x.x.x'])
    expect(() => parseTraffic({ ...defaultTraffic, sourceIp })).toThrow();
  expect(() =>
    parseNetworkRule({
      action: 'allow',
      protocol: 'any',
      direction: 'any',
      sourceCidr: '0.0.0.0/33',
    }),
  ).toThrow();
  expect(() => parseTraffic({ ...defaultTraffic, port: 65536 })).toThrow();
  const doc = vpcExample(true);
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  const history = new DocumentHistory(doc);
  const before = structuredClone(doc.traffic);
  history.execute({
    type: 'traffic',
    from: before,
    to: { ...defaultTraffic, port: 22 },
  });
  expect(doc.traffic?.port).toBe(22);
  history.undo();
  expect(doc.traffic).toEqual(before);
  history.redo();
  expect(doc.traffic?.port).toBe(22);
});
