import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  Port,
} from '../domain/document';
import { boardBuilder } from './builder';

/** Editable e-commerce data pipeline from the supplied architecture reference. */
export function dataPipelineExample(): DiagramDocument {
  const nodes: DiagramNode[] = [
    {
      id: 'pipeline',
      kind: 'group',
      label: 'Automated data pipeline',
      x: -80,
      z: 40,
      width: 1400,
      depth: 680,
      color: '#334d80',
    },
    {
      id: 'app',
      kind: 'group',
      label: 'E-commerce app',
      x: -10,
      z: -640,
      width: 460,
      depth: 200,
      color: '#334d80',
    },
  ];
  const edges: DiagramEdge[] = [];
  const { node, edge } = boardBuilder(
    { nodes, edges },
    { width: 180, depth: 100 },
  );
  const connect = (
    id: string,
    source: string,
    target: string,
    label: string,
    sourcePort: Port,
    targetPort: Port,
    relationship?: DiagramEdge['relationship'],
  ) =>
    edge(source, target, label, {
      id,
      sourcePort,
      targetPort,
      ...(relationship ? { relationship } : {}),
    });

  node('customers', 'actor.user', 'Customers', 0, 10, 'app');
  node('dynamodb', 'aws.dynamodb', 'Amazon DynamoDB', -1060, 240);
  node(
    'kinesis',
    'aws.kinesis-data-streams',
    'Amazon Kinesis Data Streams',
    -510,
    200,
    'pipeline',
  ).journeyCaption = 'Ingest changes from the e-commerce DynamoDB table.';
  node(
    'firehose',
    'aws.data-firehose',
    'Amazon Data Firehose',
    -170,
    200,
    'pipeline',
  ).journeyCaption =
    'Firehose invokes Lambda to transform records, then delivers the processed data to S3.';
  node('lambda', 'aws.lambda', 'AWS Lambda', -170, -80, 'pipeline');
  node('s3', 'aws.s3', 'Amazon S3 (CSV)', 170, 200, 'pipeline');
  node(
    'catalog',
    'aws.glue-data-catalog',
    'AWS Glue Data Catalog',
    510,
    200,
    'pipeline',
  ).metadata = {
    notes:
      'The catalog stores table metadata for the CSV data in S3. The catalog connections describe metadata access, not movement of the CSV objects.',
  };
  node('sagemaker', 'aws.sagemaker-ai', 'Amazon SageMaker AI', 880, -40);
  node(
    'model',
    'aws.sagemaker-ai-model',
    'Recommendation model',
    880,
    -400,
  ).width = 260;
  node('ml-engineer', 'actor.user', 'ML engineer', 1210, -40);
  node('athena', 'aws.athena', 'Amazon Athena', 430, 700).metadata = {
    notes:
      'Athena uses Glue table metadata to query the CSV objects in S3. The S3 query connection is omitted to match the reference layout.',
  };
  node('data-scientist', 'actor.user', 'Data scientist', 760, 700);
  node('analytics', 'flow.process', 'Query results / analytics', 430, 1000);

  connect(
    'app-write',
    'customers',
    'dynamodb',
    'Update / retrieve data',
    'west',
    'north',
  );
  connect('app-read', 'dynamodb', 'customers', '', 'north', 'west');
  connect('ingest', 'dynamodb', 'kinesis', 'Ingest data', 'east', 'west');
  connect('stream', 'kinesis', 'firehose', '', 'east', 'west');
  connect('process', 'firehose', 'lambda', 'Process data', 'north', 'south');
  connect('processed', 'lambda', 'firehose', '', 'south', 'north');
  connect('deliver', 'firehose', 's3', 'Deliver data', 'east', 'west');
  connect(
    'catalog-data',
    's3',
    'catalog',
    'Catalog data',
    'east',
    'west',
    'dependency',
  );
  connect(
    'catalog-location',
    'catalog',
    's3',
    '',
    'west',
    'east',
    'dependency',
  );
  connect('training-data', 's3', 'sagemaker', 'Training data', 'north', 'west');
  connect('train', 'sagemaker', 'model', 'Train model', 'north', 'south');
  connect(
    'recommend',
    'model',
    'customers',
    'Real-time recommendations',
    'north',
    'east',
  );
  connect(
    'ml-workflow',
    'ml-engineer',
    'sagemaker',
    'Build / train',
    'west',
    'east',
    'dependency',
  );
  connect(
    'query-metadata',
    'catalog',
    'athena',
    'Table metadata',
    'south',
    'north',
    'dependency',
  );
  connect(
    'query',
    'data-scientist',
    'athena',
    'Ad-hoc queries',
    'west',
    'east',
    'dependency',
  );
  connect('results', 'athena', 'analytics', 'Query results', 'south', 'north');

  return { version: 1, title: 'Data Pipeline Example', nodes, edges };
}
