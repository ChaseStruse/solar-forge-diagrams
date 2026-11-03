import { expect, test } from 'bun:test';
import { findExamples } from '../src/catalog/example-library';
import {
  buildingBlocksTour,
  detailDiagramsTour,
  journeyForksTour,
  networkFlowTour,
  swimlanesTour,
} from '../src/catalog/feature-examples';
import { parseDocument, serializeDocument } from '../src/domain/document';
import { journeyBranches, journeyStarts } from '../src/domain/journey';
import { laneAt, laneBands } from '../src/domain/lanes';
import { evaluateTraffic } from '../src/domain/network';

test('feature tours are listed together and each has a walkthrough note', () => {
  expect(findExamples('', 'Feature tours').length).toBe(5);
  for (const create of [
    buildingBlocksTour,
    detailDiagramsTour,
    journeyForksTour,
    networkFlowTour,
    swimlanesTour,
  ]) {
    const note = create().nodes.find((n) => n.kind === 'note');
    expect(note?.label).toStartWith('1. ');
  }
});

test('detail tour links resolve, including a detail inside a detail', () => {
  const doc = detailDiagramsTour();
  const ids = new Set(doc.details?.map((d) => d.id));
  const links = [doc, ...(doc.details ?? []).map((d) => d.document)]
    .flatMap((board) => board.nodes)
    .flatMap((n) => (n.detailId ? [n.detailId] : []));
  expect(links.sort()).toEqual(['order-service', 'orders-table', 'payment']);
  for (const link of links) expect(ids.has(link)).toBe(true);
});

test('network flow scenarios allow and block the paths the note describes', () => {
  const doc = networkFlowTour();
  const rule = (target: string) =>
    doc.edges.find((e) => e.source === 'internet' && e.target === target)
      ?.networkRule;
  const allowed = (scenario: string) => {
    const traffic = doc.scenarios?.find((s) => s.id === scenario)?.traffic;
    if (!traffic) throw Error('Missing scenario');
    return ['lb', 'bastion'].filter(
      (target) => evaluateTraffic(rule(target), traffic).allowed,
    );
  };
  expect(journeyStarts(doc)).toEqual(['internet']);
  expect(allowed('https-anywhere')).toEqual(['lb']);
  expect(allowed('ssh-office')).toEqual(['bastion']);
  expect(allowed('ssh-stranger')).toEqual([]);
});

test('journey tour shows ask, every-branch and active-route forks', () => {
  const doc = journeyForksTour();
  expect(journeyBranches(doc, 'check').mode).toBe('ask');
  expect(journeyBranches(doc, 'dashboard')).toMatchObject({
    mode: 'all',
    edges: ['dashboard-widgets', 'dashboard-visit'],
  });
  expect(journeyBranches(doc, 'visit')).toEqual({
    mode: 'fixed',
    edges: ['visit-stream'],
  });
});

test('swimlane tour opens in lanes with every step owned and in its lane', () => {
  const doc = swimlanesTour();
  expect(doc.lanes).toEqual({
    direction: 'right',
    order: ['Customer', 'Storefront', 'Payment service', 'Warehouse'],
  });
  const bands = laneBands(doc);
  if (!bands) throw Error('No lanes');
  const stepsOnly = doc.nodes.filter((n) => n.kind === 'service');
  expect(stepsOnly).toHaveLength(12);
  for (const n of stepsOnly) {
    expect(n.owner).toBeTruthy();
    expect(laneAt(bands, n)).toBe(n.owner ?? '');
    expect(n.journeyCaption).toBeTruthy();
  }
  // Heading above the lanes, walkthrough below: neither inside a band.
  for (const id of ['title', 'guide']) {
    const n = doc.nodes.find((m) => m.id === id);
    expect(n && laneAt(bands, n)).toBeUndefined();
  }
  expect(journeyStarts(doc)).toEqual(['cart']);
  // The journey crosses teams: at least five handoffs on the happy path.
  const owner = new Map(doc.nodes.map((n) => [n.id, n.owner]));
  const happy = [
    'cart',
    'review',
    'signed',
    'address',
    'charge',
    'approved',
    'order',
    'pick',
    'ship',
    'arrives',
  ];
  const handoffs = happy
    .slice(1)
    .filter((id, i) => owner.get(id) !== owner.get(happy[i] ?? ''));
  expect(handoffs.length).toBeGreaterThanOrEqual(5);
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
});
