import { describe, expect, test } from 'bun:test';
import { benchmarkDocument } from '../benchmarks/fixtures';
import {
  parseDocument,
  sampleDocument,
  serializeDocument,
  worldPosition,
} from '../src/domain/document';

describe('portable documents', () => {
  test('round trips the sample and nested positions', () => {
    const doc = sampleDocument();
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    const node = doc.nodes.find((n) => n.id === 'lambda');
    if (!node) throw new Error('Missing fixture');
    expect(
      worldPosition(node, new Map(doc.nodes.map((n) => [n.id, n]))),
    ).toEqual({ x: 10, z: -70, level: 2 });
  });
  test('rejects future versions, cycles, duplicate IDs and dangling edges', () => {
    const doc = sampleDocument();
    expect(() => parseDocument(JSON.stringify({ ...doc, version: 2 }))).toThrow(
      'version',
    );
    expect(() =>
      parseDocument(
        JSON.stringify({ ...doc, nodes: [...doc.nodes, doc.nodes[0]] }),
      ),
    ).toThrow('Duplicate');
    expect(() =>
      parseDocument(
        JSON.stringify({
          ...doc,
          nodes: doc.nodes.map((n) =>
            n.id === 'region' ? { ...n, parentId: 'vpc' } : n,
          ),
        }),
      ),
    ).toThrow('cycle');
    expect(() =>
      parseDocument(
        JSON.stringify({
          ...doc,
          edges: [
            { id: 'bad', source: 'missing', target: 'lambda', label: '' },
          ],
        }),
      ),
    ).toThrow('reference');
  });
  test('rejects invalid coordinates and oversized input', () => {
    const doc = sampleDocument();
    expect(() =>
      parseDocument(
        JSON.stringify({
          ...doc,
          nodes: doc.nodes.map((n) => ({ ...n, width: -1 })),
        }),
      ),
    ).toThrow();
    expect(() => parseDocument(' '.repeat(10_000_001))).toThrow('limit');
  });
  test('benchmark graphs have reproducible valid counts', () => {
    for (const [nodes, edges] of [
      [500, 750],
      [2000, 3000],
    ]) {
      const doc = parseDocument(
        serializeDocument(benchmarkDocument(nodes, edges)),
      );
      expect(doc.nodes).toHaveLength(nodes ?? 0);
      expect(doc.edges).toHaveLength(edges ?? 0);
    }
  });
});
