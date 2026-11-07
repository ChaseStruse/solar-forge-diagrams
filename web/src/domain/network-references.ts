import type { DiagramDocument, DiagramNode } from './document';
import type { Change } from './history';
/** Remap copied references; missing policies become explicitly incomplete, never unrestricted. */
export function remapNetwork(
  node: DiagramNode,
  ids: ReadonlyMap<string, string>,
): DiagramNode {
  const value = structuredClone(node);
  const missing = (where: { incomplete?: string[] }, message: string) => {
    where.incomplete ??= [];
    if (!where.incomplete.includes(message)) where.incomplete.push(message);
  };
  const net = value.network;
  if (net) {
    for (const key of ['securityGroupIds', 'networkIds'] as const)
      if (net[key])
        net[key] = net[key].flatMap((id) => {
          const mapped = ids.get(id);
          if (mapped) return [mapped];
          missing(net, `Missing attached resource ${id}`);
          return [];
        });
    for (const key of ['networkAclId', 'routeTableId'] as const)
      if (net[key]) {
        const mapped = ids.get(net[key]);
        if (mapped) net[key] = mapped;
        else {
          missing(net, `Missing attached resource ${net[key]}`);
          delete net[key];
        }
      }
  }
  const policy = value.policy;
  if (policy?.kind === 'route-table') {
    for (const route of policy.routes)
      if (!['local', 'blackhole'].includes(route.target))
        route.target = ids.get(route.target) ?? 'blackhole';
  } else if (policy) {
    policy.rules = policy.rules.flatMap((rule) => {
      if (!rule.peerGroupId) return [rule];
      const id = ids.get(rule.peerGroupId);
      if (id) return [{ ...rule, peerGroupId: id }];
      missing(policy, `Missing peer security group ${rule.peerGroupId}`);
      return [];
    });
  }
  return value;
}
export function cleanNetworkChanges(
  doc: DiagramDocument,
  changes: Change<DiagramNode>[],
): Change<DiagramNode>[] {
  const requested = new Map(changes.map((c) => [c.id, c]));
  const ids = new Map(
    doc.nodes
      .filter((n) => requested.get(n.id)?.value !== null)
      .map((n) => [n.id, n.id]),
  );
  for (const change of changes) if (change.value) ids.set(change.id, change.id);
  for (const node of doc.nodes) {
    const change = requested.get(node.id);
    if (change?.value === null) continue;
    const original = change?.value ?? node,
      next = remapNetwork(original, ids);
    if (JSON.stringify(original) !== JSON.stringify(next))
      requested.set(node.id, { id: node.id, value: next });
  }
  return [...requested.values()];
}
