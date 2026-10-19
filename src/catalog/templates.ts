import type { DiagramDocument, DiagramNode } from '../domain/document';
import { sampleDocument, starterDocument } from '../domain/document';
import { dataPipelineExample } from './data-pipeline';
import { kubernetesExample } from './kubernetes';
import {
  approvalExample,
  containerDeliveryExample,
  internalKubernetesExample,
  privateWorkerExample,
} from './more-examples';
import { vpcExample } from './networking';
import { securityDemo } from './security';
import { boundaryColors, findService } from './services';
export interface Template {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
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
      width: 160,
      depth: 100,
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
    id: 'private-worker',
    name: 'Private worker egress',
    category: 'AWS',
    subcategory: 'Security',
    description:
      'Compare allowed outbound HTTPS through a NAT gateway with blocked SSH and unsolicited inbound traffic.',
    create: privateWorkerExample,
  },
  {
    id: 'container-delivery',
    name: 'Container image delivery',
    category: 'AWS',
    subcategory: 'Containers',
    description:
      'See a CI pipeline publish an image to ECR and deploy an ECS service behind a load balancer.',
    create: containerDeliveryExample,
  },
  {
    id: 'kubernetes-internal',
    name: 'Internal service communication',
    category: 'Kubernetes',
    subcategory: 'Applications',
    description:
      'Follow frontend Pods through an internal API Service to backend Pods inside one namespace.',
    create: internalKubernetesExample,
  },
  {
    id: 'approval',
    name: 'Approval workflow',
    category: 'General',
    subcategory: 'Flowcharts',
    description:
      'Explore an approval decision with separate approve and revise branches, including a revision loop.',
    create: approvalExample,
  },
  {
    id: 'starter',
    name: 'Two-service starter',
    category: 'AWS',
    subcategory: 'Applications',
    description:
      'Start small with a Lambda function reading and writing DynamoDB.',
    create: starterDocument,
  },
  {
    id: 'security-demo',
    category: 'AWS',
    subcategory: 'Security',
    description:
      'Explore IAM membership, application roles, and security groups with six allowed and denied traffic scenarios.',
    name: 'security demo',
    create: securityDemo,
  },
  {
    id: 'data-pipeline',
    category: 'AWS',
    subcategory: 'Data pipelines',
    description:
      'Stream e-commerce changes through Kinesis, Firehose, and Lambda to S3, Athena, and SageMaker AI.',
    name: 'Data Pipeline Example',
    create: dataPipelineExample,
  },
  {
    id: 'kubernetes',
    category: 'Kubernetes',
    subcategory: 'Applications',
    description:
      'Follow a public request through Ingress and Service to replicated Pods; see how a Deployment manages them.',
    name: 'Kubernetes · web application',
    create: kubernetesExample,
  },
  {
    id: 'vpc',
    category: 'AWS',
    subcategory: 'Networking',
    description:
      'Explore public and private subnets across two availability zones, with an internet gateway and database tiers.',
    name: 'VPC · public and private subnets',
    create: () => vpcExample(),
  },
  {
    id: 'networking',
    category: 'AWS',
    subcategory: 'Networking',
    description:
      'Walk through HTTPS ingress, blocked database access, and private egress through NAT gateways.',
    name: 'Networking journey demo',
    create: () => vpcExample(true),
  },
  {
    id: 'serverless',
    category: 'AWS',
    subcategory: 'Applications',
    description:
      'Connect API Gateway, Lambda, DynamoDB, SQS, and S3 in a small serverless application.',
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
    category: 'AWS',
    subcategory: 'Applications',
    description:
      'Trace the request path from a load balancer through EC2 to a relational database.',
    name: 'Three-tier application',
    create: () => architecture('Three-tier application', ['elb', 'ec2', 'rds']),
  },
  {
    id: 'events',
    category: 'AWS',
    subcategory: 'Data pipelines',
    description:
      'Queue EventBridge events for Lambda processing and store the results in DynamoDB.',
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
    category: 'AWS',
    subcategory: 'Containers',
    description:
      'Follow DNS and load balancing to an ECS application backed by a relational database.',
    name: 'Container service',
    create: () =>
      architecture('Container service', ['route53', 'elb', 'ecs', 'rds']),
  },
  {
    id: 'flowchart',
    category: 'General',
    subcategory: 'Flowcharts',
    description:
      'Learn the basic start, process, and decision shapes in a small editable flow.',
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
          width: 160,
          depth: 100,
          color: '#d9b677',
        },
        {
          id: 'step',
          kind: 'service',
          shape: 'process',
          label: 'Process',
          x: 0,
          z: 0,
          width: 160,
          depth: 100,
          color: '#d9b677',
        },
        {
          id: 'decision',
          kind: 'service',
          shape: 'decision',
          label: 'Ready?',
          x: 260,
          z: 0,
          width: 160,
          depth: 100,
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
