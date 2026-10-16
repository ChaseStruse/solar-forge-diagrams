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
