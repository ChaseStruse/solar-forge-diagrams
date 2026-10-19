import type {
  DiagramDocument,
  DiagramNode,
  TrafficScenario,
} from '../domain/document';
import { defaultTraffic } from '../domain/network';
import type { FirewallRule } from '../domain/policies';
import { boundaryColors, findService } from './services';

/** Identity relationships plus editable, evaluated network policy examples. */
export function securityDemo(): DiagramDocument {
  const doc: DiagramDocument = {
    version: 1,
    title: 'security demo',
    nodes: [],
    edges: [],
    traffic: { ...defaultTraffic },
    scenarios: [],
  };
  function node(
    id: string,
    serviceId: string,
    label: string,
    x: number,
    z: number,
    parentId?: string,
  ): DiagramNode {
    const service = findService(serviceId);
    if (!service) throw Error(`Missing security component: ${serviceId}`);
    const result: DiagramNode = {
      id,
      kind: service.kind,
      serviceId,
      label,
      x,
      z,
      width: 220,
      depth: 100,
      color: service.color,
      ...(service.boundary ? { boundary: service.boundary } : {}),
      ...(parentId ? { parentId } : {}),
    };
    doc.nodes.push(result);
    return result;
  }
  function connect(
    source: string,
    target: string,
    label: string,
    relationship: 'network' | 'dependency' = 'dependency',
  ) {
    doc.edges.push({
      id: `${source}-${target}`,
      source,
      target,
      label,
      relationship,
    });
  }
  function tcp(
    direction: FirewallRule['direction'],
    port: number,
    peer: { cidr: string } | { peerGroupId: string },
  ): FirewallRule {
    return {
      action: 'allow',
      direction,
      protocol: 'tcp',
      fromPort: port,
      toPort: port,
      ...peer,
    };
  }

  const identity = node(
    'identity',
    'aws.iam',
    'IAM · identity and permissions',
    0,
    -650,
  );
  Object.assign(identity, { kind: 'group', width: 2200, depth: 400 });
  node(
    'operator',
    'actor.user',
    'IAM user · operator',
    -700,
    0,
    'identity',
  ).metadata = {
    notes:
      'Illustrates IAM user-group membership. The group policy grants read-only ELB inspection; IAM decisions and sign-in are not evaluated by this demo.',
  };
  node('operators', 'aws.iam', 'IAM group · operators', 0, 0, 'identity');
  node(
    'read-policy',
    'aws.iam',
    'ELB read-only policy',
    700,
    0,
    'identity',
  ).metadata = {
    notes:
      'Illustrative identity policy attached to the operators group: Allow elasticloadbalancing:Describe* with Resource "*". Members can inspect ELB configuration; this does not grant network access or permission to change it.',
  };
  connect('operator', 'operators', 'Member of');
  connect('operators', 'read-policy', 'Attached policy');

  const vpc = node('vpc', 'boundary.vpc', 'VPC · 10.0.0.0/16', 0, 250);
  Object.assign(vpc, { width: 2600, depth: 1080, color: boundaryColors.vpc });
  vpc.network = { model: 'aws', cidr: '10.0.0.0/16' };
  for (const [id, label, x, cidr] of [
    ['public', 'Public edge subnet', -760, '10.0.1.0/24'],
    ['private-app', 'Private application subnet', 0, '10.0.2.0/24'],
    ['private-data', 'Private database subnet', 760, '10.0.3.0/24'],
  ] as const) {
    const subnet = node(id, 'boundary.subnet', label, x, 80, 'vpc');
    Object.assign(subnet, { width: 620, depth: 780 });
    subnet.network = {
      model: 'aws',
      cidr,
      ...(id === 'public' ? { routeTableId: 'public-routes' } : {}),
    };
  }
  const internet = node(
    'internet',
    'actor.internet',
    'Internet clients',
    -1580,
    330,
  );
  internet.network = { model: 'generic', ip: '198.51.100.10' };
  const gateway = node(
    'igw',
    'component.internet-gateway',
    'Internet gateway',
    -1180,
    80,
    'vpc',
  );
  gateway.width = 140;
  const routes = node(
    'public-routes',
    'component.route-table',
    'Public route · IGW',
    0,
    230,
    'public',
  );
  routes.policy = {
    kind: 'route-table',
    routes: [{ destination: '0.0.0.0/0', target: 'igw' }],
  };

  const elb = node('elb', 'aws.elb', 'ELB · Application LB', 0, 0, 'public');
  elb.network = {
    model: 'aws',
    ip: '10.0.1.10',
    exposure: 'public',
    securityGroupIds: ['elb-sg'],
  };
  elb.journeyCaption =
    'The internet-facing ELB accepts HTTPS on 443. It opens a separate connection to the application on 8080.';
  elb.metadata = {
    notes:
      'Logical ALB endpoint with a representative private address for policy checks. A real ALB spans subnets in multiple availability zones; the second public subnet, target group, certificate and health checks are omitted. This evaluator checks individual network hops, not ELB listener behavior.',
  };
  const app = node('app', 'aws.ec2', 'EC2 · private app', 0, 0, 'private-app');
  app.network = {
    model: 'aws',
    ip: '10.0.2.10',
    exposure: 'private',
    securityGroupIds: ['app-sg'],
  };
  app.journeyCaption =
    'Only the ELB security group can reach application port 8080. Database connections use TCP 5432.';
  const db = node(
    'database',
    'aws.rds',
    'RDS · PostgreSQL',
    0,
    0,
    'private-data',
  );
  db.network = {
    model: 'aws',
    ip: '10.0.3.10',
    exposure: 'private',
    securityGroupIds: ['db-sg'],
  };
  db.journeyCaption =
    'Only the application security group can initiate connections to PostgreSQL. The database has no public exposure.';

  const elbSg = node(
    'elb-sg',
    'component.firewall',
    'ELB SG · HTTPS only',
    0,
    -230,
    'public',
  );
  elbSg.policy = {
    kind: 'security-group',
    rules: [
      tcp('ingress', 443, { cidr: '0.0.0.0/0' }),
      tcp('egress', 8080, { peerGroupId: 'app-sg' }),
    ],
  };
  const appSg = node(
    'app-sg',
    'component.firewall',
    'App SG · ELB only',
    0,
    -230,
    'private-app',
  );
  appSg.policy = {
    kind: 'security-group',
    rules: [
      tcp('ingress', 8080, { peerGroupId: 'elb-sg' }),
      tcp('egress', 5432, { peerGroupId: 'db-sg' }),
    ],
  };
  const dbSg = node(
    'db-sg',
    'component.firewall',
    'DB SG · app only',
    0,
    -230,
    'private-data',
  );
  dbSg.policy = {
    kind: 'security-group',
    rules: [tcp('ingress', 5432, { peerGroupId: 'app-sg' })],
  };
  dbSg.metadata = {
    notes:
      'No new outbound database connections are allowed. Responses to allowed inbound connections are stateful. No subnet ACL is assigned; the checker assumes a default allow ACL.',
  };
  connect('elb-sg', 'elb', 'Attached SG');
  connect('app-sg', 'app', 'Attached SG');
  connect('db-sg', 'database', 'Attached SG');
  connect('public-routes', 'igw', '0.0.0.0/0');
  connect('internet', 'elb', 'HTTPS · 443', 'network');
  connect('elb', 'app', 'Target · 8080', 'network');
  connect('app', 'database', 'PostgreSQL · 5432', 'network');

  const role = node(
    'app-role',
    'aws.iam-role',
    'IAM role · app reader',
    0,
    1050,
  );
  role.metadata = {
    notes:
      'EC2 assumes this service role through an instance profile. Trust principal: ec2.amazonaws.com. Illustrative permission: s3:GetObject on arn:aws:s3:::security-demo-config/app/*. Temporary credentials replace stored access keys. IAM and S3 API/network access are outside this network demo.',
  };
  node('config-bucket', 'aws.s3', 'S3 · app configuration', 760, 1050);
  connect('app', 'app-role', 'Instance profile');
  connect('app-role', 'config-bucket', 's3:GetObject · app/*');

  doc.nodes.push({
    id: 'guide',
    kind: 'note',
    label:
      'Try the saved Traffic scenarios.\nHTTPS → ELB, ELB → app, app → DB: allowed.\nDirect Internet → DB and ELB → DB: denied.\nIAM arrows describe permissions; network checks evaluate routes and security groups.',
    x: -760,
    z: 1050,
    width: 650,
    depth: 280,
    fontSize: 22,
    color: '#ffe29a',
  });
  function scenario(
    id: string,
    name: string,
    sourceId: string,
    targetId: string,
    port: number,
  ): TrafficScenario {
    return {
      id,
      name,
      sourceId,
      targetId,
      traffic: { ...defaultTraffic, sourceIp: '198.51.100.10', port },
    };
  }
  doc.scenarios = [
    scenario(
      'https-elb',
      'Allow · Internet → ELB · 443',
      'internet',
      'elb',
      443,
    ),
    scenario('elb-app', 'Allow · ELB → app · 8080', 'elb', 'app', 8080),
    scenario(
      'app-db',
      'Allow · app → PostgreSQL · 5432',
      'app',
      'database',
      5432,
    ),
    scenario(
      'direct-db',
      'Deny · Internet → database · 5432',
      'internet',
      'database',
      5432,
    ),
    scenario('elb-db', 'Deny · ELB → database · 5432', 'elb', 'database', 5432),
    scenario('ssh-app', 'Deny · ELB → app SSH · 22', 'elb', 'app', 22),
  ];
  return doc;
}
