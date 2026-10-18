import type { DiagramDocument, DiagramNode } from '../domain/document';
import { defaultTraffic } from '../domain/network';
import { findService } from './services';

function example(title: string) {
  const doc: DiagramDocument = { version: 1, title, nodes: [], edges: [] };
  function node(
    id: string,
    serviceId: string,
    label: string,
    x: number,
    z: number,
    parentId?: string,
  ): DiagramNode {
    const service = findService(serviceId);
    if (!service) throw Error(`Missing example component: ${serviceId}`);
    const result: DiagramNode = {
      id,
      serviceId,
      label,
      kind: service.kind,
      color: service.color,
      x,
      z,
      width: 220,
      depth: 100,
      ...(parentId ? { parentId } : {}),
      ...(service.shape ? { shape: service.shape } : {}),
      ...(service.boundary ? { boundary: service.boundary } : {}),
    };
    doc.nodes.push(result);
    return result;
  }
  function edge(
    source: string,
    target: string,
    label: string,
    dependency = false,
  ) {
    doc.edges.push({
      id: `${source}-${target}`,
      source,
      target,
      label,
      ...(dependency ? { relationship: 'dependency' as const } : {}),
    });
  }
  return { doc, node, edge };
}

export function privateWorkerExample(): DiagramDocument {
  const { doc, node, edge } = example('Private worker egress');
  const vpc = node('vpc', 'boundary.vpc', 'VPC · 10.20.0.0/16', 0, 0);
  Object.assign(vpc, { width: 1760, depth: 1080 });
  vpc.network = { model: 'aws', cidr: '10.20.0.0/16' };
  const privateSubnet = node(
    'private',
    'boundary.subnet',
    'Private worker subnet',
    -440,
    80,
    'vpc',
  );
  Object.assign(privateSubnet, { width: 720, depth: 820 });
  privateSubnet.network = {
    model: 'aws',
    cidr: '10.20.2.0/24',
    routeTableId: 'private-routes',
  };
  const publicSubnet = node(
    'public',
    'boundary.subnet',
    'Public NAT subnet',
    440,
    80,
    'vpc',
  );
  Object.assign(publicSubnet, { width: 720, depth: 820 });
  publicSubnet.network = {
    model: 'aws',
    cidr: '10.20.1.0/24',
    routeTableId: 'public-routes',
  };
  const worker = node('worker', 'aws.ec2', 'Private worker', 0, 0, 'private');
  worker.network = {
    model: 'aws',
    ip: '10.20.2.10',
    exposure: 'private',
    securityGroupIds: ['worker-sg'],
  };
  worker.journeyCaption =
    'A private worker initiates HTTPS requests. It has no public address or inbound security-group rules.';
  const sg = node(
    'worker-sg',
    'component.firewall',
    'Worker SG · outbound 443',
    0,
    -230,
    'private',
  );
  sg.policy = {
    kind: 'security-group',
    rules: [
      {
        action: 'allow',
        direction: 'egress',
        protocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        cidr: '0.0.0.0/0',
      },
    ],
  };
  const nat = node(
    'nat',
    'component.nat-gateway',
    'NAT gateway',
    0,
    0,
    'public',
  );
  nat.network = {
    model: 'aws',
    ip: '10.20.1.10',
    publicIp: '203.0.113.20',
    exposure: 'public',
  };
  nat.journeyCaption =
    'The NAT gateway translates outbound connections and their replies; it does not accept unsolicited inbound connections.';
  node(
    'igw',
    'component.internet-gateway',
    'Internet gateway',
    650,
    -350,
    'vpc',
  );
  const privateRoutes = node(
    'private-routes',
    'component.route-table',
    'Default route · NAT',
    0,
    240,
    'private',
  );
  privateRoutes.policy = {
    kind: 'route-table',
    routes: [{ destination: '0.0.0.0/0', target: 'nat' }],
  };
  const publicRoutes = node(
    'public-routes',
    'component.route-table',
    'Default route · IGW',
    0,
    240,
    'public',
  );
  publicRoutes.policy = {
    kind: 'route-table',
    routes: [{ destination: '0.0.0.0/0', target: 'igw' }],
  };
  const external = node(
    'external',
    'actor.internet',
    'External HTTPS API',
    1160,
    80,
  );
  external.network = { model: 'generic', ip: '198.51.100.40' };
  edge('worker', 'external', 'Outbound HTTPS · 443');
  edge('worker-sg', 'worker', '', true);
  edge('private-routes', 'nat', '0.0.0.0/0', true);
  edge('public-routes', 'igw', '0.0.0.0/0', true);
  doc.traffic = {
    ...defaultTraffic,
    sourceIp: '10.20.2.10',
    direction: 'egress',
  };
  doc.scenarios = [
    {
      id: 'worker-https',
      name: 'Allow · worker → HTTPS API',
      sourceId: 'worker',
      targetId: 'external',
      traffic: { ...doc.traffic },
    },
    {
      id: 'worker-ssh',
      name: 'Deny · worker → SSH',
      sourceId: 'worker',
      targetId: 'external',
      traffic: { ...doc.traffic, port: 22 },
    },
    {
      id: 'inbound',
      name: 'Deny · unsolicited Internet → worker',
      sourceId: 'external',
      targetId: 'worker',
      traffic: { ...defaultTraffic, sourceIp: '198.51.100.40' },
    },
  ];
  doc.nodes.push({
    id: 'guide',
    kind: 'note',
    label:
      'Use Traffic scenarios to compare HTTPS, SSH, and unsolicited inbound access.\nThe reachability trace follows worker → NAT → IGW → API.\nReplies are stateful; subnet ACLs use the default allow assumption.',
    x: -140,
    z: -740,
    width: 1020,
    depth: 240,
    color: '#ffe29a',
    fontSize: 24,
  });
  return doc;
}

export function containerDeliveryExample(): DiagramDocument {
  const { doc, node, edge } = example('Container image delivery');
  node(
    'ci',
    'component.github-actions',
    'Build and deploy workflow',
    -560,
    -400,
  ).journeyCaption =
    'The workflow builds a container image and deploys a new ECS task definition using that image.';
  node('registry', 'aws.ecr', 'ECR · versioned images', 0, -400);
  node('clients', 'actor.internet', 'Web clients', -560, 100);
  node('elb', 'aws.elb', 'Application load balancer', 0, 100);
  node('ecs', 'aws.ecs', 'ECS · application tasks', 560, 100).metadata = {
    notes:
      'Image delivery arrows describe build and deployment dependencies. The ECS service runs application tasks; roles, subnet placement, security groups and load-balancer health checks are omitted.',
  };
  node('logs', 'component.container', 'New task revision', 560, -400);
  edge('ci', 'registry', 'Push image', true);
  edge('registry', 'logs', 'Image reference', true);
  edge('logs', 'ecs', 'Deploy revision', true);
  edge('clients', 'elb', 'HTTPS');
  edge('elb', 'ecs', 'Healthy targets');
  return doc;
}

export function internalKubernetesExample(): DiagramDocument {
  const { doc, node, edge } = example('Internal service communication');
  const namespace = node(
    'namespace',
    'kubernetes.namespace',
    'Namespace · application',
    0,
    0,
  );
  Object.assign(namespace, { width: 1820, depth: 920 });
  namespace.metadata = {
    notes:
      'A namespace is a logical resource scope. No Ingress is needed for this internal Service path. NetworkPolicy, DNS resolution, scheduling and service routing are not simulated.',
  };
  node(
    'frontend',
    'kubernetes.pod',
    'Frontend Pod',
    -620,
    0,
    'namespace',
  ).journeyCaption =
    'The frontend calls the internal API by its Kubernetes Service name.';
  node(
    'api-service',
    'kubernetes.service',
    'Service · internal API',
    -120,
    0,
    'namespace',
  ).journeyCaption =
    'The Service selects a backend Pod. The two arrows show alternative healthy replicas.';
  node(
    'api-a',
    'kubernetes.pod',
    'API Pod · replica 1',
    530,
    -200,
    'namespace',
  );
  node('api-b', 'kubernetes.pod', 'API Pod · replica 2', 530, 200, 'namespace');
  node(
    'deployment',
    'kubernetes.deployment',
    'Deployment · API',
    -120,
    -290,
    'namespace',
  ).metadata = {
    notes:
      'The Deployment manages API replicas through an omitted ReplicaSet. Management arrows do not carry application traffic.',
  };
  edge('frontend', 'api-service', 'HTTP · internal API');
  edge('api-service', 'api-a', 'Selected backend');
  edge('api-service', 'api-b', 'Selected backend');
  edge('deployment', 'api-a', '', true);
  edge('deployment', 'api-b', '', true);
  return doc;
}

export function approvalExample(): DiagramDocument {
  const { doc, node, edge } = example('Approval workflow');
  node('start', 'flow.terminal', 'Request received', -700, 0);
  node('review', 'flow.process', 'Review request', -250, 0);
  node('decision', 'flow.decision', 'Approved?', 200, 0).journeyCaption =
    'Choose Approve to finish, or Revise to update the request and submit it for another review.';
  node('done', 'flow.terminal', 'Approved', 700, 0);
  node('revise', 'flow.process', 'Revise request', 200, 360);
  edge('start', 'review', 'Submit');
  edge('review', 'decision', 'Decide');
  edge('decision', 'done', 'Approve');
  edge('decision', 'revise', 'Revise');
  edge('revise', 'review', 'Resubmit');
  return doc;
}
