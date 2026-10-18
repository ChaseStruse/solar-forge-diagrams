import type { TrafficScenario } from './document';
/** Examples become document-owned on the first save or delete. */
export const defaultScenarios: TrafficScenario[] = [
  {
    id: 'public-https',
    name: 'Public HTTPS',
    traffic: {
      protocol: 'tcp',
      port: 443,
      sourceIp: '203.0.113.10',
      direction: 'ingress',
    },
  },
  {
    id: 'office-ssh',
    name: 'SSH from office',
    traffic: {
      protocol: 'tcp',
      port: 22,
      sourceIp: '198.51.100.10',
      direction: 'ingress',
    },
  },
  {
    id: 'worker-egress',
    name: 'Worker egress',
    traffic: {
      protocol: 'tcp',
      port: 443,
      sourceIp: '10.0.10.10',
      direction: 'egress',
    },
  },
];
