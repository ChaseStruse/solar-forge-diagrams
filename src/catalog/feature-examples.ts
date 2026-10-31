import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  NetworkRule,
} from '../domain/document';
import { defaultTraffic } from '../domain/network';
import { findService } from './services';

/**
 * Small boards that each show off one feature, with sticky notes that walk
 * through it step by step. They teach the app rather than model real systems.
 */
const NOTE_FONT = 28;
function board(title: string) {
  const doc: DiagramDocument = { version: 1, title, nodes: [], edges: [] };
  function node(
    id: string,
    serviceId: string,
    label: string,
    x: number,
    z: number,
    extra: Partial<DiagramNode> = {},
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
      width: 200,
      depth: 100,
      ...(service.shape ? { shape: service.shape } : {}),
      ...(service.boundary ? { boundary: service.boundary } : {}),
      ...extra,
    };
    doc.nodes.push(result);
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
    doc.edges.push(result);
    return result;
  }
  /**
   * A walkthrough sticky note; lines become numbered steps. Its depth is
   * estimated from the wrapped text so the note fits what it says, so it is
   * placed by its top edge.
   */
  function steps(
    id: string,
    lines: readonly string[],
    x: number,
    top: number,
    width: number,
  ) {
    const charsPerLine = Math.floor((width - 60) / (NOTE_FONT * 0.46));
    const rows = lines.reduce(
      (total, line) => total + Math.ceil((line.length + 3) / charsPerLine),
      0,
    );
    const depth = Math.round(rows * NOTE_FONT * 1.35 + 60);
    doc.nodes.push({
      id,
      kind: 'note',
      serviceId: 'note.sticky',
      label: lines.map((line, i) => `${i + 1}. ${line}`).join('\n'),
      x,
      z: top + depth / 2,
      width,
      depth,
      color: '#ffe29a',
      fontSize: NOTE_FONT,
    });
  }
  function heading(id: string, label: string, x: number, z: number) {
    doc.nodes.push({
      id,
      kind: 'text',
      serviceId: 'note.text',
      label,
      x,
      z,
      width: 1000,
      depth: 70,
      color: '#ffffff',
      fontSize: 34,
    });
  }
  return { doc, node, edge, steps, heading };
}

export function detailDiagramsTour(): DiagramDocument {
  const main = board('Feature tour · Detail diagrams');
  main.heading('title', 'Detail diagrams: one project, many boards', 0, -220);
  main.node('user', 'actor.user', 'Customer', -660, 0);
  main.node('api', 'aws.api-gateway', 'Orders API', -330, 0);
  main.node('orders', 'aws.lambda', 'Order service', 0, 0, {
    detailId: 'order-service',
  });
  main.node('table', 'aws.dynamodb', 'Orders table', 330, 0, {
    detailId: 'orders-table',
  });
  main.edge('user', 'api', 'HTTPS');
  main.edge('api', 'orders', 'POST /orders');
  main.edge('orders', 'table', 'Write order');
  main.steps(
    'guide',
    [
      'Order service and Orders table each link to their own detail board. In Layers they show ↳ Open detail ↗.',
      'Double-click Order service to open the board inside it.',
      'Use ← Back above the canvas to come back here.',
      'To add your own, select any tile, open Detail diagram in the properties panel and choose Create detail diagram.',
    ],
    0,
    170,
    1100,
  );

  const service = board('Order service · inside the function');
  service.heading('title', 'Inside Order service', 0, -300);
  service.node('received', 'flow.terminal', 'Order received', -660, 0);
  service.node('validate', 'flow.process', 'Validate order', -330, 0);
  service.node('stock', 'flow.decision', 'In stock?', 0, 0);
  service.node('pay', 'flow.process', 'Take payment', 330, -140, {
    detailId: 'payment',
  });
  service.node('sorry', 'flow.process', 'Email customer', 330, 140);
  service.node('done', 'flow.terminal', 'Order confirmed', 660, -140);
  service.edge('received', 'validate');
  service.edge('validate', 'stock');
  service.edge('stock', 'pay', 'Yes');
  service.edge('stock', 'sorry', 'No');
  service.edge('pay', 'done');
  service.steps(
    'guide',
    [
      'This board lives inside Order service. The project name above the canvas shows where you are.',
      'Detail boards can link onward: double-click Take payment to go one level deeper.',
      '← Back returns one level at a time.',
    ],
    0,
    300,
    1100,
  );

  const payment = board('Take payment · card check');
  payment.heading('title', 'Inside Take payment', 0, -280);
  payment.node('authorise', 'flow.process', 'Authorise card', -330, 0);
  payment.node('approved', 'flow.decision', 'Approved?', 0, 0);
  payment.node('paid', 'flow.terminal', 'Paid', 330, -140);
  payment.node('declined', 'flow.terminal', 'Declined', 330, 140);
  payment.edge('authorise', 'approved');
  payment.edge('approved', 'paid', 'Yes');
  payment.edge('approved', 'declined', 'No');
  payment.steps(
    'guide',
    [
      'Two levels deep. Every board shares one project file, one save and one undo history.',
      'Press ← Back twice to reach the main board.',
    ],
    0,
    300,
    1000,
  );

  const table = board('Orders table · key design');
  table.heading('title', 'Inside Orders table', 0, -200);
  table.node('pk', 'flow.process', 'Partition key · customerId', -300, 0, {
    width: 260,
  });
  table.node('sk', 'flow.process', 'Sort key · orderId', 0, 0, {
    width: 260,
  });
  table.node('gsi', 'flow.process', 'Index · by status', 300, 0, {
    width: 260,
  });
  table.steps(
    'guide',
    [
      'A detail board can hold anything: notes, a flowchart, or a closer look at one resource like this table.',
      'Press ← Back to return.',
    ],
    0,
    160,
    1000,
  );

  return {
    ...main.doc,
    details: [
      { id: 'order-service', document: service.doc },
      { id: 'payment', document: payment.doc },
      { id: 'orders-table', document: table.doc },
    ],
  };
}

export function networkFlowTour(): DiagramDocument {
  const { doc, node, edge, steps, heading } = board(
    'Feature tour · Network flow',
  );
  heading(
    'title',
    'Network flow: rules decide which paths traffic takes',
    0,
    -340,
  );
  const allow = (port: number, sourceCidr?: string): NetworkRule => ({
    action: 'allow',
    protocol: 'tcp',
    port,
    direction: 'ingress',
    ...(sourceCidr ? { sourceCidr } : {}),
  });
  node('internet', 'actor.internet', 'Internet', -720, 0).journeyCaption =
    'Traffic starts on the public internet. The current Journey traffic settings decide which arrows it may cross.';
  node('lb', 'aws.elb', 'Load balancer', -140, -170).journeyCaption =
    'The load balancer only accepts HTTPS on port 443, from anywhere.';
  node('web', 'aws.ec2', 'Web server', 280, -170).journeyCaption =
    'Allowed HTTPS reaches the web server.';
  node('bastion', 'aws.ec2', 'Bastion host', -140, 170).journeyCaption =
    'Only SSH on port 22 from the office range 198.51.100.0/24 gets here.';
  edge('internet', 'lb', 'HTTPS · 443', { networkRule: allow(443) });
  edge('lb', 'web', 'Forward');
  edge('internet', 'bastion', 'SSH · 22 · office', {
    networkRule: allow(22, '198.51.100.0/24'),
  });
  doc.traffic = { ...defaultTraffic };
  doc.scenarios = [
    {
      id: 'https-anywhere',
      name: 'HTTPS from anywhere',
      traffic: { ...defaultTraffic },
    },
    {
      id: 'ssh-office',
      name: 'SSH from the office',
      traffic: { ...defaultTraffic, port: 22, sourceIp: '198.51.100.10' },
    },
    {
      id: 'ssh-stranger',
      name: 'SSH from a stranger',
      traffic: { ...defaultTraffic, port: 22, sourceIp: '203.0.113.66' },
    },
  ];
  steps(
    'guide',
    [
      'Press P to play the journey. HTTPS on port 443 reaches the web server; the bastion path flashes red and stops, because its rule only allows port 22.',
      'Open Traffic in the bottom bar, pick SSH from the office, choose Use scenario, then press P. Now only the bastion path is allowed.',
      'Try SSH from a stranger: same port, but the source address is outside 198.51.100.0/24, so both paths stop.',
      'Click an arrow and open Journey traffic rule to see or change its rule. Arrows without a rule let everything through.',
    ],
    -220,
    320,
    1150,
  );
  return doc;
}

export function journeyForksTour(): DiagramDocument {
  const { doc, node, edge, steps, heading } = board(
    'Feature tour · Journeys and forks',
  );
  heading('title', 'Journeys: three ways to handle a fork', 0, -330);
  node('start', 'flow.terminal', 'Visitor arrives', -900, 0).journeyCaption =
    'A visitor opens the site. Press P to follow them.';
  node('signin', 'flow.process', 'Sign in', -600, 0).journeyCaption =
    'They enter their password.';
  node('check', 'flow.decision', 'Password OK?', -300, 0).journeyCaption =
    'A decision asks which way to go: click a branch or press its number.';
  node('retry', 'flow.process', 'Try again', -300, 260).journeyCaption =
    'A wrong password loops back to Sign in.';
  node('dashboard', 'flow.process', 'Dashboard', 0, 0, {
    journey: { mode: 'all' },
  }).journeyCaption = 'Dashboard takes every branch at once.';
  node('widgets', 'flow.process', 'Load widgets', 330, -170).journeyCaption =
    'One traveller loads the widgets…';
  node('visit', 'flow.process', 'Record visit', 330, 170).journeyCaption =
    '…while another records the visit.';
  node('stream', 'flow.terminal', 'Live analytics', 760, 60).journeyCaption =
    'Record visit always streams: Stream is its active route.';
  node('batch', 'flow.terminal', 'Nightly report', 760, 280).journeyCaption =
    'The nightly batch route is now active.';
  edge('start', 'signin');
  edge('signin', 'check');
  edge('check', 'dashboard', 'Yes');
  edge('check', 'retry', 'No');
  edge('retry', 'signin', 'Retry');
  edge('dashboard', 'widgets', 'Show');
  edge('dashboard', 'visit', 'Log');
  const stream = edge('visit', 'stream', 'Stream');
  edge('visit', 'batch', 'Nightly batch');
  const visit = doc.nodes.find((n) => n.id === 'visit');
  if (visit) visit.journey = { mode: 'fixed', edge: stream.id };
  steps(
    'guide',
    [
      'Press P. The journey pauses at Password OK? and asks which way. Choose No to loop through Try again, then Yes.',
      'At Dashboard it takes every branch at once.',
      'Record visit always takes Stream, its active route; Nightly batch is dimmed. Right-click Nightly batch and choose Make active route to switch.',
      'Select any tile with several arrows and change Journey at this fork in the properties panel.',
    ],
    -70,
    420,
    1500,
  );
  return doc;
}

export function buildingBlocksTour(): DiagramDocument {
  const { doc, node, edge, steps, heading } = board(
    'Feature tour · Building blocks',
  );
  heading('title', 'Building blocks: boundaries, lanes and notes', 0, -400);
  node('vpc', 'boundary.vpc', 'VPC · 10.0.0.0/16', -260, 0, {
    width: 980,
    depth: 560,
  });
  node('subnet', 'boundary.subnet', 'Private subnet', 0, 30, {
    width: 880,
    depth: 420,
    parentId: 'vpc',
  });
  node('app', 'aws.ecs', 'App', -220, 0, { parentId: 'subnet' });
  node('queue', 'aws.sqs', 'Job queue', 220, 0, { parentId: 'subnet' });
  node('bucket', 'aws.s3', 'Config bucket', 520, -120);
  node('user', 'actor.user', 'User', -1000, 0);
  edge('user', 'app', 'Uses');
  edge('app', 'queue');
  edge('queue', 'app');
  edge('app', 'bucket', 'Reads config', { relationship: 'dependency' });
  steps(
    'guide',
    [
      'Boundaries nest: the subnet sits inside the VPC. Drag the VPC and everything inside moves with it.',
      'App and Job queue are connected both ways (jobs out, results back), so each direction gets its own lane.',
      'Reads config is a dependency: it describes a relationship, not traffic. It stays still when Flow is on, and journeys skip it.',
      'Hold WASD or the arrow keys to move the view, scroll to zoom, and press F to fit.',
      'Press T for text or N for a sticky note like this one. Double-click any tile to rename it.',
    ],
    -240,
    340,
    1400,
  );
  return doc;
}
