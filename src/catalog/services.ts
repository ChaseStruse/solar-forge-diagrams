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
    '#ed7100',
  ],
  [
    'api-gateway',
    'API Gateway',
    'Amazon-API-Gateway',
    'Networking',
    'api rest http gateway',
    '#8c4fff',
  ],
  [
    'dynamodb',
    'DynamoDB',
    'Amazon-DynamoDB',
    'Database',
    'nosql key value database',
    '#c925d1',
  ],
  [
    's3',
    'S3',
    'Amazon-Simple-Storage-Service',
    'Storage',
    'bucket object storage',
    '#7aa116',
  ],
  [
    'ec2',
    'EC2',
    'Amazon-EC2',
    'Compute',
    'virtual machine instance vm',
    '#ed7100',
  ],
  [
    'ecs',
    'ECS',
    'Amazon-Elastic-Container-Service',
    'Compute',
    'containers docker fargate',
    '#ed7100',
  ],
  [
    'eks',
    'EKS',
    'Amazon-Elastic-Kubernetes-Service',
    'Compute',
    'kubernetes k8s containers',
    '#ed7100',
  ],
  [
    'ecr',
    'ECR',
    'Amazon-Elastic-Container-Registry',
    'Containers',
    'container registry docker images repository elastic',
    '#ed7100',
  ],
  [
    'fargate',
    'Fargate',
    'AWS-Fargate',
    'Containers',
    'serverless containers tasks ecs eks',
    '#ed7100',
  ],
  [
    'rds',
    'RDS',
    'Amazon-RDS',
    'Database',
    'relational postgres mysql database',
    '#c925d1',
  ],
  [
    'cloudfront',
    'CloudFront',
    'Amazon-CloudFront',
    'Networking',
    'cdn edge cache',
    '#8c4fff',
  ],
  [
    'route53',
    'Route 53',
    'Amazon-Route-53',
    'Networking',
    'dns domain routing',
    '#8c4fff',
  ],
  [
    'sqs',
    'SQS',
    'Amazon-Simple-Queue-Service',
    'Integration',
    'queue messaging',
    '#e7157b',
  ],
  [
    'sns',
    'SNS',
    'Amazon-Simple-Notification-Service',
    'Integration',
    'notification pubsub topic',
    '#e7157b',
  ],
  [
    'eventbridge',
    'EventBridge',
    'Amazon-EventBridge',
    'Integration',
    'events bus rules',
    '#e7157b',
  ],
  [
    'elb',
    'Load balancer',
    'Elastic-Load-Balancing',
    'Networking',
    'elb alb nlb load balancing',
    '#8c4fff',
  ],
];
/** Official AWS architecture group colours. */
export const boundaryColors = {
  account: '#e7157b',
  region: '#00a4a6',
  vpc: '#8c4fff',
  zone: '#00a4a6',
  subnet: '#7aa116',
} as const;
/** Pastel defaults from earlier releases; documents using them adopt the catalog colour. */
export const legacyColors: ReadonlySet<string> = new Set([
  '#f6bd72',
  '#b9a0e4',
  '#82b7df',
  '#a8cf88',
  '#e5a0c0',
  '#a568ce',
  '#ed983c',
  '#548bc4',
  '#cb6186',
  '#79a950',
  '#d9a15f',
]);
export const componentColors: Record<string, string> = {
  docker: '#2496ed',
  container: '#326ce5',
  'container-image': '#0d9488',
  'github-actions': '#24292f',
  git: '#f05032',
  pipeline: '#7c3aed',
  'internet-gateway': '#8c4fff',
  'nat-gateway': '#c084fc',
  firewall: '#d97706',
  'route-table': '#059669',
};
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
  ...(
    [
      ['docker', 'Docker', 'Containers', 'docker engine whale runtime'],
      ['container', 'Container', 'Containers', 'running container workload'],
      [
        'container-image',
        'Container image',
        'Containers',
        'oci image artifact registry',
      ],
      [
        'github-actions',
        'GitHub Actions',
        'DevOps',
        'github actions workflow ci cd automation',
      ],
      ['git', 'Git repository', 'DevOps', 'git source code version control'],
      ['pipeline', 'CI/CD pipeline', 'DevOps', 'build test deploy delivery'],
      [
        'internet-gateway',
        'Internet gateway',
        'Networking',
        'vpc igw inbound outbound internet',
      ],
      [
        'nat-gateway',
        'NAT gateway',
        'Networking',
        'vpc nat private egress outbound',
      ],
      [
        'firewall',
        'Security group',
        'Networking',
        'firewall security ingress egress allow deny',
      ],
      [
        'route-table',
        'Route table',
        'Networking',
        'routes routing subnet gateway',
      ],
    ] as const
  ).map(([id, label, category, aliases]) => ({
    id: `component.${id}`,
    label,
    category,
    aliases,
    color: componentColors[id] ?? '#4c9aff',
    glyph: '◇',
    description: `${category} · ${label}`,
    kind: 'service' as const,
    asset: `components/${id}.svg`,
    icon: new URL(`../../assets/components/${id}.svg`, import.meta.url).href,
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
    asset: `aws/${file.toLowerCase()}.svg`,
    icon: new URL(`../../assets/aws/${file.toLowerCase()}.svg`, import.meta.url)
      .href,
  })),
  ...(
    [
      [
        'user',
        'User',
        'A person using the system',
        'person customer client human',
        '#3f8cff',
      ],
      [
        'internet',
        'Internet',
        'Clients on the public internet',
        'web browser clients public',
        '#5a6b86',
      ],
    ] as const
  ).map(([id, label, description, aliases, color]) => ({
    id: `actor.${id}`,
    label,
    color,
    glyph: id === 'user' ? '☺' : '◍',
    description,
    category: 'Actors',
    aliases: `actor ${aliases}`,
    kind: 'service' as const,
    asset: `actors/${id}.svg`,
    icon: new URL(`../../assets/actors/${id}.svg`, import.meta.url).href,
  })),
  {
    id: 'note.text',
    label: 'Text',
    color: '#ffffff',
    glyph: 'T',
    description: 'Free text on the board',
    category: 'Annotations',
    aliases: 'text label heading title caption annotation',
    kind: 'text' as const,
  },
  {
    id: 'note.sticky',
    label: 'Sticky note',
    color: '#ffd84d',
    glyph: '▤',
    description: 'A note pinned to the board',
    category: 'Annotations',
    aliases: 'note sticky comment memo annotation todo',
    kind: 'note' as const,
  },
  ...(['account', 'region', 'vpc', 'zone', 'subnet'] as const).map(
    (boundary) => ({
      id: `boundary.${boundary}`,
      label:
        boundary === 'vpc'
          ? 'VPC'
          : boundary === 'zone'
            ? 'Availability zone'
            : boundary.charAt(0).toUpperCase() + boundary.slice(1),
      color: boundaryColors[boundary],
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
