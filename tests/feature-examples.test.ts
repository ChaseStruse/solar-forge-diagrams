import { expect, test } from 'bun:test';
import { findExamples } from '../src/catalog/example-library';
import {
  buildingBlocksTour,
  detailDiagramsTour,
  journeyForksTour,
  networkFlowTour,
} from '../src/catalog/feature-examples';
import { journeyBranches, journeyStarts } from '../src/domain/journey';
import { evaluateTraffic } from '../src/domain/network';

test('feature tours are listed together and each has a walkthrough note', () => {
  expect(findExamples('', 'Feature tours').length).toBe(4);
  for (const create of [
    buildingBlocksTour,
    detailDiagramsTour,
    journeyForksTour,
    networkFlowTour,
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
