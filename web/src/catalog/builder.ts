import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
} from '../domain/document';
import { findService } from './services';

/**
 * A component from the catalog, as the palette would add it: the service's
 * kind, colour, shape and boundary type, at the given position and size.
 */
function serviceNode(
  id: string,
  serviceId: string,
  label: string,
  x: number,
  z: number,
  size: { width: number; depth: number },
  extra: Partial<DiagramNode> = {},
): DiagramNode {
  const service = findService(serviceId);
  if (!service) throw Error(`Missing catalog component: ${serviceId}`);
  return {
    id,
    serviceId,
    label,
    kind: service.kind,
    color: service.color,
    x,
    z,
    width: size.width,
    depth: size.depth,
    ...(service.shape ? { shape: service.shape } : {}),
    ...(service.boundary ? { boundary: service.boundary } : {}),
    ...extra,
  };
}

/**
 * Helpers for building an example board: `node` adds a catalog component
 * (inside `parent` when given a group ID, or with extra fields), and `edge`
 * adds a connection whose ID defaults to `source-target`.
 */
export function boardBuilder(
  board: Pick<DiagramDocument, 'nodes' | 'edges'>,
  size: { width: number; depth: number },
) {
  function node(
    id: string,
    serviceId: string,
    label: string,
    x: number,
    z: number,
    parent: string | Partial<DiagramNode> = {},
  ): DiagramNode {
    const extra = typeof parent === 'string' ? { parentId: parent } : parent;
    const result = serviceNode(id, serviceId, label, x, z, size, extra);
    board.nodes.push(result);
    return result;
  }
  function edge(
    source: string,
    target: string,
    label = '',
    extra: Partial<DiagramEdge> = {},
  ): DiagramEdge {
    const result: DiagramEdge = {
      id: `${source}-${target}`,
      source,
      target,
      label,
      ...extra,
    };
    board.edges.push(result);
    return result;
  }
  return { node, edge };
}
