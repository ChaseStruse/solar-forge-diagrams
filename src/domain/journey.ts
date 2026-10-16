import type { DiagramDocument } from './document';

/**
 * Where a journey begins: the selected node if it leads anywhere, otherwise
 * every actor (people, the internet), otherwise every node nothing points to.
 */
export function journeyStarts(
  doc: DiagramDocument,
  selected?: string,
): string[] {
  const outgoing = new Set(doc.edges.map((edge) => edge.source));
  const incoming = new Set(doc.edges.map((edge) => edge.target));
  if (selected && outgoing.has(selected)) return [selected];
  const actors = doc.nodes.filter(
    (node) => node.serviceId?.startsWith('actor.') && outgoing.has(node.id),
  );
  if (actors.length) return actors.map((node) => node.id);
  const sources = doc.nodes.filter(
    (node) => outgoing.has(node.id) && !incoming.has(node.id),
  );
  if (sources.length) return sources.map((node) => node.id);
  // Everything sits on a cycle: start anywhere.
  const first = doc.edges[0]?.source;
  return first ? [first] : [];
}

export type BranchMode = 'all' | 'ask' | 'fixed';
/**
 * Which connections a journey follows out of a node. Decision shapes ask by
 * default; everything else walks every branch. A fixed branch that no longer
 * exists falls back to asking.
 */
export function journeyBranches(
  doc: DiagramDocument,
  nodeId: string,
): { mode: BranchMode; edges: string[] } {
  const edges = doc.edges.filter((e) => e.source === nodeId).map((e) => e.id);
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || edges.length < 2) return { mode: 'all', edges };
  const setting = node.journey ?? {
    mode: node.shape === 'decision' ? 'ask' : 'all',
  };
  if (setting.mode === 'fixed')
    return edges.includes(setting.edge)
      ? { mode: 'fixed', edges: [setting.edge] }
      : { mode: 'ask', edges };
  return { mode: setting.mode, edges };
}
