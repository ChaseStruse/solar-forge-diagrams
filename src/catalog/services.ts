import type { DiagramNode } from '../domain/document';
export interface ComponentDefinition {
  id: string;
  label: string;
  color: string;
  glyph: string;
  description: string;
  category: string;
  aliases: string;
  kind: DiagramNode['kind'];
  shape?: DiagramNode['shape'];
  boundary?: DiagramNode['boundary'];
  icon?: string;
  asset?: string;
}
const aws: readonly (readonly [
  string,
  string,
  string,
  string,
  string,
  string,
])[] = [
  [
    'lambda',
    'Lambda',
    'AWS-Lambda',
    'Compute',
    'function serverless',
    '#f6bd72',
  ],
  [
    'api-gateway',
    'API Gateway',
    'Amazon-API-Gateway',
    'Networking',
    'api rest http gateway',
    '#b9a0e4',
  ],
  [
    'dynamodb',
    'DynamoDB',
    'Amazon-DynamoDB',
    'Database',
    'nosql key value database',
    '#82b7df',
  ],
  [
    's3',
    'S3',
    'Amazon-Simple-Storage-Service',
    'Storage',
    'bucket object storage',
    '#a8cf88',
  ],
  [
    'ec2',
    'EC2',
    'Amazon-EC2',
    'Compute',
    'virtual machine instance vm',
    '#f6bd72',
  ],
  [
    'ecs',
    'ECS',
    'Amazon-Elastic-Container-Service',
    'Compute',
    'containers docker fargate',
    '#f6bd72',
  ],
  [
    'eks',
    'EKS',
    'Amazon-Elastic-Kubernetes-Service',
    'Compute',
    'kubernetes k8s containers',
    '#f6bd72',
  ],
  [
    'rds',
    'RDS',
    'Amazon-RDS',
    'Database',
    'relational postgres mysql database',
    '#82b7df',
  ],
  [
    'cloudfront',
    'CloudFront',
    'Amazon-CloudFront',
    'Networking',
    'cdn edge cache',
    '#b9a0e4',
  ],
  [
    'route53',
    'Route 53',
    'Amazon-Route-53',
    'Networking',
    'dns domain routing',
    '#b9a0e4',
  ],
  [
    'sqs',
    'SQS',
    'Amazon-Simple-Queue-Service',
    'Integration',
    'queue messaging',
    '#e5a0c0',
  ],
  [
    'sns',
    'SNS',
    'Amazon-Simple-Notification-Service',
    'Integration',
    'notification pubsub topic',
    '#e5a0c0',
  ],
  [
    'eventbridge',
    'EventBridge',
    'Amazon-EventBridge',
    'Integration',
    'events bus rules',
    '#e5a0c0',
  ],
  [
    'elb',
    'Load balancer',
    'Elastic-Load-Balancing',
    'Networking',
    'elb alb nlb load balancing',
    '#b9a0e4',
  ],
];
export const services: ComponentDefinition[] = [
  ...(['process', 'decision', 'terminal'] as const).map((shape) => ({
    id: `flow.${shape}`,
    label:
      shape === 'process'
        ? 'Process'
        : shape === 'decision'
          ? 'Decision'
          : 'Start / end',
    color: '#d9b677',
    glyph: shape === 'decision' ? '◇' : shape === 'terminal' ? '○' : '▭',
    description:
      shape === 'decision'
        ? 'Branch a flow with a question'
        : shape === 'terminal'
          ? 'Begin or finish a flow'
          : 'A step in your flow',
    category: 'Flowchart',
    aliases: 'flow chart shape',
    kind: 'service' as const,
    shape,
  })),
  ...aws.map(([id, label, file, category, aliases, color]) => ({
    id: `aws.${id}`,
    label,
    color,
    glyph: label === 'Lambda' ? 'λ' : label.slice(0, 3),
    description: `AWS · ${category}`,
    category,
    aliases,
    kind: 'service' as const,
    asset: `${file.toLowerCase()}.svg`,
    icon: new URL(`../../assets/aws/${file.toLowerCase()}.svg`, import.meta.url)
      .href,
  })),
  ...(['account', 'region', 'vpc', 'zone', 'subnet'] as const).map(
    (boundary) => ({
      id: `boundary.${boundary}`,
      label:
        boundary === 'vpc'
          ? 'VPC'
          : boundary === 'zone'
            ? 'Availability zone'
            : boundary.charAt(0).toUpperCase() + boundary.slice(1),
      color: '#d9a15f',
      glyph: '▱',
      description: 'Nested architecture boundary',
      category: 'Boundaries',
      aliases: 'group account region vpc availability zone subnet',
      kind: 'group' as const,
      boundary,
    }),
  ),
];
export function findService(
  idOrLabel: string,
): ComponentDefinition | undefined {
  return services.find(
    (service) =>
      service.id === idOrLabel ||
      service.label.toLowerCase() === idOrLabel.toLowerCase(),
  );
}
export function serviceGlyph(label: string): string {
  return findService(label)?.glyph ?? '◇';
}
