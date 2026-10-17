import type {
  DiagramDocument,
  DiagramNode,
  NetworkRule,
} from '../domain/document';
import { defaultTraffic } from '../domain/network';
import { boundaryColors, findService } from './services';

/** Two availability zones with isolated data tiers, matching the reference. */
export function vpcExample(demo = false): DiagramDocument {
  const doc: DiagramDocument = {
    version: 1,
    title: demo
      ? 'Networking journey · HTTPS and private egress'
      : 'VPC · public and private subnets',
    nodes: [],
    edges: [],
    traffic: { ...defaultTraffic },
  };
  function boundary(
    id: string,
    label: string,
    type: NonNullable<DiagramNode['boundary']>,
    x: number,
    z: number,
    width: number,
    depth: number,
    parentId?: string,
  ) {
    doc.nodes.push({
      id,
      label,
      kind: 'group',
      boundary: type,
      x,
      z,
      width,
      depth,
      color: boundaryColors[type],
      ...(parentId ? { parentId } : {}),
    });
  }
  function service(
    id: string,
    label: string,
    serviceId: string,
    x: number,
    z: number,
    parentId?: string,
  ) {
    const def = findService(serviceId);
    if (!def) throw Error('Missing networking component');
    doc.nodes.push({
      id,
      label,
      serviceId,
      kind: 'service',
      x,
      z,
      width: 160,
      depth: 100,
      color: def.color,
      ...(parentId ? { parentId } : {}),
    });
  }
  function connect(
    id: string,
    source: string,
    target: string,
    label: string,
    networkRule?: NetworkRule,
  ) {
    doc.edges.push({
      id,
      source,
      target,
      label,
      ...(networkRule ? { networkRule } : {}),
    });
  }
  boundary('region', 'AWS Region', 'region', 0, 0, 2200, 1300);
  boundary('vpc', 'VPC · 10.0.0.0/16', 'vpc', 70, 30, 1960, 1160, 'region');
  for (const [i, zone] of ['a', 'b'].entries()) {
    boundary(
      `az-${zone}`,
      `Availability zone ${zone.toUpperCase()}`,
      'zone',
      i === 0 ? -360 : 360,
      30,
      660,
      1000,
      'vpc',
    );
    boundary(
      `public-${zone}`,
      `Public subnet ${i + 1} · 10.0.${i}.0/24`,
      'subnet',
      0,
      -240,
      600,
      400,
      `az-${zone}`,
    );
    boundary(
      `private-${zone}`,
      `Private subnet ${i + 1} · 10.0.${i + 10}.0/24`,
      'subnet',
      0,
      240,
      600,
      400,
      `az-${zone}`,
    );
    service(
      `web-${zone}`,
      `EC2 web ${zone.toUpperCase()}`,
      'aws.ec2',
      -140,
      20,
      `public-${zone}`,
    );
    service(
      `web2-${zone}`,
      demo
        ? `NAT gateway ${zone.toUpperCase()}`
        : `EC2 app ${zone.toUpperCase()}`,
      demo ? 'component.nat-gateway' : 'aws.ec2',
      140,
      20,
      `public-${zone}`,
    );
    service(
      `db-${zone}`,
      `RDS ${zone.toUpperCase()}`,
      'aws.rds',
      -140,
      20,
      `private-${zone}`,
    );
    service(
      `db2-${zone}`,
      demo
        ? `Private worker ${zone.toUpperCase()}`
        : `RDS replica ${zone.toUpperCase()}`,
      demo ? 'component.container' : 'aws.rds',
      140,
      20,
      `private-${zone}`,
    );
  }
  service('user', 'User', 'actor.user', -1280, -240);
  service('internet', 'Internet', 'actor.internet', -1280, 0);
  service(
    'igw',
    'Internet gateway',
    'component.internet-gateway',
    -880,
    -100,
    'vpc',
  );
  connect('client', 'user', 'internet', 'Request');
  connect(
    'gateway',
    'internet',
    'igw',
    'Public route',
    demo
      ? {
          action: 'allow',
          protocol: 'tcp',
          port: 443,
          direction: 'ingress',
          sourceCidr: '0.0.0.0/0',
        }
      : undefined,
  );
  for (const zone of ['a', 'b']) {
    connect(
      `https-${zone}`,
      'igw',
      `web-${zone}`,
      'HTTPS · 443',
      demo
        ? { action: 'allow', protocol: 'tcp', port: 443, direction: 'ingress' }
        : undefined,
    );
    connect(
      `data-${zone}`,
      `web-${zone}`,
      `db-${zone}`,
      'Application → database',
    );
    if (demo) {
      connect(
        `blocked-${zone}`,
        'internet',
        `db-${zone}`,
        'No direct internet → database',
        { action: 'deny', protocol: 'any', direction: 'any' },
      );
      connect(
        `egress-${zone}`,
        `db2-${zone}`,
        `web2-${zone}`,
        'Private egress via NAT',
        {
          action: 'allow',
          protocol: 'tcp',
          port: 443,
          direction: 'egress',
          sourceCidr: '10.0.0.0/16',
        },
      );
      connect(`nat-${zone}`, `web2-${zone}`, 'igw', 'Outbound route');
    }
  }
  if (demo) {
    connect('outbound-internet', 'igw', 'internet', 'Internet egress', {
      action: 'allow',
      protocol: 'any',
      direction: 'egress',
    });
    service(
      'routes',
      'Public route · 0.0.0.0/0 → IGW',
      'component.route-table',
      -880,
      -400,
      'vpc',
    );
    service(
      'security',
      'Web SG · TCP 443 ingress',
      'component.firewall',
      -880,
      300,
      'vpc',
    );
  }
  return doc;
}
