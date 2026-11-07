import type { DiagramDocument, DiagramEdge } from './document';

/**
 * Where a journey begins: the selected node if it leads anywhere, otherwise
 * every actor (people, the internet), otherwise every node nothing points to.
 */
export function journeyStarts(
  doc: DiagramDocument,
  selected?: string,
): string[] {
  const flowEdges = doc.edges.filter((e) => e.relationship !== 'dependency');
  const outgoing = new Set(flowEdges.map((edge) => edge.source));
  const incoming = new Set(flowEdges.map((edge) => edge.target));
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
  const first = flowEdges[0]?.source;
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
  const edges = doc.edges
    .filter((e) => e.source === nodeId && e.relationship !== 'dependency')
    .map((e) => e.id);
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
/**
 * Connections switched off by a chosen active route: the other branches of
 * that fork, and everything downstream that only they lead to.
 */
export function inactiveEdges(doc: DiagramDocument): Set<string> {
  const inactive = new Set<string>();
  if (!doc.nodes.some((node) => node.journey?.mode === 'fixed'))
    return inactive;
  const outgoing = new Map<string, DiagramEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const edge of doc.edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }
  const queue: DiagramEdge[] = [];
  const switchOff = (edge: DiagramEdge) => {
    if (inactive.has(edge.id)) return;
    inactive.add(edge.id);
    queue.push(edge);
  };
  for (const node of doc.nodes) {
    if (node.journey?.mode !== 'fixed') continue;
    const { mode, edges } = journeyBranches(doc, node.id);
    if (mode !== 'fixed') continue;
    for (const edge of outgoing.get(node.id) ?? [])
      if (!edges.includes(edge.id)) switchOff(edge);
  }
  // A node reached only through inactive connections passes that on.
  const inactiveIncoming = new Map<string, number>();
  for (let edge = queue.pop(); edge; edge = queue.pop()) {
    const count = (inactiveIncoming.get(edge.target) ?? 0) + 1;
    inactiveIncoming.set(edge.target, count);
    if (count === incomingCount.get(edge.target))
      for (const next of outgoing.get(edge.target) ?? []) switchOff(next);
  }
  return inactive;
}

/** Name a branch by its connection label, else by where it leads. */
export function branchName(doc: DiagramDocument, edgeId: string): string {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return 'Connection';
  const target = doc.nodes.find((n) => n.id === edge.target)?.label ?? '';
  return edge.label ? `${edge.label} → ${target}` : `→ ${target}`;
}
