import { findService } from '../catalog/services';
import type { DiagramNode } from '../domain/document';
import { layoutDocument } from '../domain/layout';
import type { ImportResult } from './types';
import { list, obj, str } from './types';
export function importCompose(
  root: Record<string, unknown>,
  title: string,
): ImportResult {
  const warnings: string[] = [],
    nodes: DiagramNode[] = [],
    edges: ImportResult['document']['edges'] = [];
  const definitions = obj(root.services);
  if (!Object.keys(definitions).length)
    throw Error('Compose file has no services');
  if (Object.keys(definitions).length > 2000)
    throw Error('Compose import exceeds 2000 services');
  const networks = new Map<string, string>();
  const network = (name: string): string => {
    const existing = networks.get(name);
    if (existing) return existing;
    const id = `compose:network:${name}`;
    networks.set(name, id);
    const def = obj(obj(root.networks)[name]);
    const cidr = str(obj(list(obj(def.ipam).config)[0]).subnet);
    nodes.push({
      id,
      kind: 'group',
      boundary: 'vpc',
      label: `Network · ${name}`,
      x: 0,
      z: 0,
      width: 500,
      depth: 300,
      color: '#326ce5',
      network: { model: 'compose', ...(cidr ? { cidr } : {}) },
    });
    return id;
  };
  for (const [name, value] of Object.entries(definitions)) {
    const service = obj(value),
      declared = service.networks;
    const names = Array.isArray(declared)
      ? declared.filter((v): v is string => typeof v === 'string')
      : declared
        ? Object.keys(obj(declared))
        : ['default'];
    const ids = names.map(network),
      addresses = names
        .map((n) => str(obj(obj(declared)[n]).ipv4_address))
        .filter((v): v is string => !!v);
    const incomplete: string[] = [];
    if (service.network_mode) {
      incomplete.push(
        `Unsupported network_mode: ${String(service.network_mode)}`,
      );
      warnings.push(`${name}: ${incomplete[0]}`);
    }
    const def = findService('component.container');
    nodes.push({
      id: `compose:service:${name}`,
      kind: 'service',
      serviceId: 'component.container',
      label: name,
      x: 0,
      z: 0,
      width: 160,
      depth: 100,
      color: def?.color ?? '#326ce5',
      ...(ids[0] ? { parentId: ids[0] } : {}),
      network: {
        model: 'compose',
        networkIds: ids,
        ...(addresses[0] ? { ip: addresses[0] } : {}),
        ...(incomplete.length ? { incomplete } : {}),
      },
      metadata: {
        resourceName: name,
        notes:
          `Image: ${str(service.image) ?? (service.build ? 'local build' : 'unspecified')}\nPublished ports: ${list(
            service.ports,
          )
            .map((p) =>
              typeof p === 'object'
                ? `${obj(p).published ?? ''}:${obj(p).target ?? ''}`
                : String(p),
            )
            .join(', ')}`.slice(0, 4000),
      },
    });
    const depends = Array.isArray(service.depends_on)
      ? service.depends_on
      : Object.keys(obj(service.depends_on));
    for (const target of [
      ...depends,
      ...list(service.links).map((v) => String(v).split(':')[0]),
    ]) {
      if (typeof target !== 'string' || !definitions[target]) {
        warnings.push(`${name}: unresolved dependency ${String(target)}`);
        continue;
      }
      edges.push({
        id: `compose:dependency:${name}:${target}`,
        source: `compose:service:${name}`,
        target: `compose:service:${target}`,
        label: 'depends on',
        relationship: 'dependency',
      });
    }
    if (service.build)
      warnings.push(
        `${name}: build instructions are represented but never executed`,
      );
  }
  return {
    format: 'Docker Compose',
    warnings,
    document: layoutDocument({
      version: 1,
      title,
      nodes,
      edges: [...new Map(edges.map((e) => [e.id, e])).values()],
    }),
  };
}
