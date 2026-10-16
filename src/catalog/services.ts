export const services = [
  {
    label: 'API Gateway',
    color: '#b9a0e4',
    glyph: '⌘',
    description: 'Connect and route API requests',
  },
  {
    label: 'Lambda',
    color: '#f6bd72',
    glyph: 'λ',
    description: 'Run event-driven functions',
  },
  {
    label: 'DynamoDB',
    color: '#82b7df',
    glyph: '▤',
    description: 'Store and query application data',
  },
  {
    label: 'SQS',
    color: '#e5a0c0',
    glyph: '≋',
    description: 'Decouple services with queues',
  },
  {
    label: 'S3',
    color: '#a8cf88',
    glyph: 'S3',
    description: 'Store objects and static assets',
  },
] as const;
export function serviceGlyph(label: string): string {
  return (
    services.find(
      (service) => service.label.toLowerCase() === label.toLowerCase(),
    )?.glyph ?? '◇'
  );
}
