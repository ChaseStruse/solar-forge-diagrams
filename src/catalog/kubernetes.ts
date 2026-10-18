import type { DiagramDocument, DiagramNode } from '../domain/document';
import { findService } from './services';

/** Traffic reaches Pods through a Service; Deployment arrows describe management only. */
export function kubernetesExample(): DiagramDocument {
  function node(
    id: string,
    serviceId: string,
    label: string,
    x: number,
    z: number,
    parentId?: string,
  ): DiagramNode {
    const service = findService(serviceId);
    if (!service) throw Error('Missing Kubernetes template component');
    return {
      id,
      serviceId,
      label,
      kind: service.kind,
      color: service.color,
      x,
      z,
      width: 160,
      depth: 100,
      ...(parentId ? { parentId } : {}),
    };
  }
  const namespace = {
    ...node(
      'namespace',
      'kubernetes.namespace',
      'Namespace · production',
      100,
      0,
    ),
    width: 1100,
    depth: 660,
  };
  const client = node('client', 'actor.internet', 'Web clients', -650, 0);
  const ingress = node(
    'ingress',
    'kubernetes.ingress',
    'Ingress · web.example.test',
    -360,
    0,
    namespace.id,
  );
  const service = node(
    'service',
    'kubernetes.service',
    'Service · web',
    -60,
    0,
    namespace.id,
  );
  const deployment = node(
    'deployment',
    'kubernetes.deployment',
    'Deployment · web (2 replicas)',
    260,
    -200,
    namespace.id,
  );
  const podA = node(
    'pod-a',
    'kubernetes.pod',
    'Pod · web-1',
    260,
    0,
    namespace.id,
  );
  const podB = node(
    'pod-b',
    'kubernetes.pod',
    'Pod · web-2',
    260,
    200,
    namespace.id,
  );
  client.journeyCaption =
    'The client sends an HTTPS request to the application.';
  ingress.journeyCaption =
    'An ingress controller implements this HTTP routing rule and forwards to the web Service.';
  service.journeyCaption =
    'The Service selects healthy web Pods. The diagram shows both possible backends.';
  podA.journeyCaption =
    'The application container handles the request in a Pod.';
  podB.journeyCaption =
    'This second Pod is another replica of the application.';
  namespace.metadata = {
    notes:
      'Namespace is a logical scope, not a network-isolation rule. Traffic arrows illustrate the application path; Kubernetes NetworkPolicy and ingress-controller behavior are not simulated.',
  };
  deployment.metadata = {
    notes:
      'The Deployment manages Pods through a ReplicaSet (omitted here). Dashed management arrows do not carry application traffic.',
  };
  return {
    version: 1,
    title: 'Kubernetes · web application',
    nodes: [namespace, client, ingress, service, deployment, podA, podB],
    edges: [
      {
        id: 'https',
        source: client.id,
        target: ingress.id,
        label: 'HTTPS',
        relationship: 'network',
      },
      {
        id: 'ingress-service',
        source: ingress.id,
        target: service.id,
        label: 'HTTP route',
        relationship: 'network',
      },
      {
        id: 'service-pod-a',
        source: service.id,
        target: podA.id,
        label: 'Selected backend',
        relationship: 'network',
      },
      {
        id: 'service-pod-b',
        source: service.id,
        target: podB.id,
        label: 'Selected backend',
        relationship: 'network',
      },
      {
        id: 'deployment-pod-a',
        source: deployment.id,
        target: podA.id,
        label: 'Manages via ReplicaSet',
        relationship: 'dependency',
      },
      {
        id: 'deployment-pod-b',
        source: deployment.id,
        target: podB.id,
        label: 'Manages via ReplicaSet',
        relationship: 'dependency',
      },
    ],
  };
}
