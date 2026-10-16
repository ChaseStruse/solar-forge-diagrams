import type { DiagramDocument, DiagramNode } from '../domain/document';
import { sampleDocument } from '../domain/document';
import { boundaryColors, findService } from './services';
export interface Template {
  id: string;
  name: string;
  create: () => DiagramDocument;
}
function architecture(title: string, ids: readonly string[]): DiagramDocument {
  const group: DiagramNode = {
    id: 'vpc',
    kind: 'group',
    label: 'Application / VPC',
    boundary: 'vpc',
    x: 0,
    z: 0,
    width: ids.length * 260 + 100,
    depth: 360,
    color: boundaryColors.vpc,
  };
  const nodes = ids.map((id, index): DiagramNode => {
    const service = findService(`aws.${id}`);
    if (!service) throw Error('Missing template service');
    return {
      id: `service-${index}`,
      kind: 'service',
      serviceId: service.id,
      label: service.label,
      color: service.color,
      x: (index - (ids.length - 1) / 2) * 260,
      z: 0,
      width: 150,
      depth: 96,
      parentId: group.id,
    };
  });
  return {
    version: 1,
    title,
    nodes: [group, ...nodes],
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      source: `service-${index}`,
      target: node.id,
      label: '',
      sourcePort: 'east',
      targetPort: 'west',
    })),
  };
}
export const templates: Template[] = [
  {
    id: 'serverless',
    name: 'Serverless API',
    create: () => {
      const doc = sampleDocument();
      for (const node of doc.nodes) {
        const service = findService(node.label);
        if (service) node.serviceId = service.id;
      }
      return doc;
    },
  },
  {
    id: 'three-tier',
    name: 'Three-tier application',
    create: () => architecture('Three-tier application', ['elb', 'ec2', 'rds']),
  },
  {
    id: 'events',
    name: 'Event pipeline',
    create: () =>
      architecture('Event pipeline', [
        'eventbridge',
        'sqs',
        'lambda',
        'dynamodb',
      ]),
  },
  {
    id: 'containers',
    name: 'Container service',
    create: () =>
      architecture('Container service', ['route53', 'elb', 'ecs', 'rds']),
  },
  {
    id: 'flowchart',
    name: 'Simple flowchart',
    create: () => ({
      version: 1,
      title: 'Simple flowchart',
      nodes: [
        {
          id: 'start',
          kind: 'service',
          shape: 'terminal',
          label: 'Start',
          x: -260,
          z: 0,
          width: 150,
          depth: 90,
          color: '#d9b677',
        },
        {
          id: 'step',
          kind: 'service',
          shape: 'process',
          label: 'Process',
          x: 0,
          z: 0,
          width: 150,
          depth: 96,
          color: '#d9b677',
        },
        {
          id: 'decision',
          kind: 'service',
          shape: 'decision',
          label: 'Ready?',
          x: 260,
          z: 0,
          width: 170,
          depth: 120,
          color: '#d9b677',
        },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'step', label: '' },
        { id: 'b', source: 'step', target: 'decision', label: 'Next' },
      ],
    }),
  },
];
