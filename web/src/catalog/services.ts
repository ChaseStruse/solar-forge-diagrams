import type { DiagramNode } from '../domain/document';
import { moreAwsServices } from './aws-services';
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
  policyKind?: NonNullable<DiagramNode['policy']>['kind'];
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
  [
    'kinesis-data-streams',
    'Kinesis Data Streams',
    'Amazon-Kinesis-Data-Streams',
    'Analytics',
    'stream ingest real time data pipeline',
    '#8c4fff',
  ],
  [
    'data-firehose',
    'Data Firehose',
    'Amazon-Data-Firehose',
    'Analytics',
    'kinesis firehose delivery streaming data pipeline',
    '#8c4fff',
  ],
  [
    'glue-data-catalog',
    'Glue Data Catalog',
    'AWS-Glue-Data-Catalog',
    'Analytics',
    'metadata schema tables catalog data pipeline',
    '#8c4fff',
  ],
  [
    'athena',
    'Athena',
    'Amazon-Athena',
    'Analytics',
    'sql query analytics s3 data pipeline',
    '#8c4fff',
  ],
  [
    'sagemaker-ai',
    'SageMaker AI',
    'Amazon-SageMaker-AI',
    'Machine Learning',
    'ml machine learning train recommendations data pipeline unified studio',
    '#01a88d',
  ],
  [
    'sagemaker-ai-model',
    'SageMaker AI model',
    'Amazon-SageMaker-AI-Model',
    'Machine Learning',
    'ml model inference real time recommendations',
    '#01a88d',
  ],
  [
    'iam',
    'IAM',
    'AWS-Identity-and-Access-Management',
    'Security',
    'identity access management users groups permissions policies security',
    '#dd344c',
  ],
  [
    'iam-role',
    'IAM role',
    'AWS-IAM-Role',
    'Security',
    'identity access role assume sts temporary credentials instance profile',
    '#dd344c',
  ],
  [
    'cognito',
    'Cognito',
    'Amazon-Cognito',
    'Security',
    'identity user pool sign in sign up login auth authentication oauth oidc saml federation',
    '#dd344c',
  ],
  [
    'waf',
    'WAF',
    'AWS-WAF',
    'Security',
    'web application firewall acl rules bot sql injection xss rate limit',
    '#dd344c',
  ],
  [
    'shield',
    'Shield',
    'AWS-Shield',
    'Security',
    'ddos protection mitigation advanced edge',
    '#dd344c',
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
  'network-acl': '#d9534f',
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
        'network-acl',
        'Network ACL',
        'Networking',
        'nacl network access control list subnet firewall',
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
    ...(id === 'firewall'
      ? { policyKind: 'security-group' as const }
      : id === 'network-acl'
        ? { policyKind: 'network-acl' as const }
        : id === 'route-table'
          ? { policyKind: 'route-table' as const }
          : {}),
    asset: `components/${id}.svg`,
    icon: new URL(`../../assets/components/${id}.svg`, import.meta.url).href,
  })),
  ...(
    [
      ['pod', 'Pod', 'pod pods workload containers'],
      [
        'deployment',
        'Deployment',
        'deployment deploy replicas rollout controller',
      ],
      ['service', 'Service', 'service svc clusterip discovery load balancing'],
      ['ingress', 'Ingress', 'ingress ing http https routing controller'],
      ['namespace', 'Namespace', 'namespace ns group boundary scope'],
    ] as const
  ).map(([id, label, aliases]) => ({
    id: `kubernetes.${id}`,
    label,
    color: '#326ce5',
    glyph: id === 'namespace' ? '▱' : '⬡',
    description:
      id === 'namespace'
        ? 'Kubernetes · namespace boundary'
        : `Kubernetes · ${label}`,
    category: 'Kubernetes',
    aliases: `kubernetes k8s kube ${aliases}`,
    kind: id === 'namespace' ? ('group' as const) : ('service' as const),
    asset: `kubernetes/${id}.svg`,
    icon: new URL(`../../assets/kubernetes/${id}.svg`, import.meta.url).href,
  })),
  ...[...aws, ...moreAwsServices].map(
    ([id, label, file, category, aliases, color]) => ({
      id: `aws.${id}`,
      label,
      color,
      glyph: label === 'Lambda' ? 'λ' : label.slice(0, 3),
      description: `AWS · ${category}`,
      category,
      aliases,
      kind: 'service' as const,
      asset: `aws/${file.toLowerCase()}.svg`,
      // Served at a fixed path; see vite.config.ts.
      icon: `${import.meta.env?.BASE_URL ?? '/'}assets/aws/${file.toLowerCase()}.svg`,
    }),
  ),
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
/** Catalog positions by id and by lower-case label; the first entry wins. */
const byId = new Map<string, number>();
const byLabel = new Map<string, number>();
for (const [index, service] of services.entries()) {
  if (!byId.has(service.id)) byId.set(service.id, index);
  const label = service.label.toLowerCase();
  if (!byLabel.has(label)) byLabel.set(label, index);
}
/** The first catalog entry whose id or label (any case) matches. */
export function findService(
  idOrLabel: string,
): ComponentDefinition | undefined {
  const id = byId.get(idOrLabel) ?? Infinity;
  const label = byLabel.get(idOrLabel.toLowerCase()) ?? Infinity;
  return services[Math.min(id, label)];
}
export function serviceGlyph(label: string): string {
  return findService(label)?.glyph ?? '◇';
}
