/**
 * Background job queues (pg-boss). Created by the migration step so that the
 * runtime worker role needs no DDL privilege. Every payload carries the tenant
 * and, when relevant, the connection: the worker re-validates both at execution.
 */
export const QUEUES = {
  dispatchSyncs: 'ulysse.dispatch-syncs',
  dispatchMaintenance: 'ulysse.dispatch-maintenance',
  relayOutbox: 'ulysse.relay-outbox',
  connectionSync: 'ulysse.connection-sync',
  connectionPurge: 'ulysse.connection-purge',
  tenantAnalyze: 'ulysse.tenant-analyze',
  tenantMaintain: 'ulysse.tenant-maintain',
  recommendationFormulate: 'ulysse.recommendation-formulate',
  deadLetter: 'ulysse.dead-letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type QueueDefinition = Readonly<{
  name: QueueName;
  /** stately: at most one queued and one active job per key (coalescing per tenant/connection). */
  policy: 'standard' | 'stately';
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
  expireInSeconds: number;
  deadLetter?: QueueName;
}>;

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: QUEUES.deadLetter,
    policy: 'standard',
    retryLimit: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 60,
  },
  {
    name: QUEUES.dispatchSyncs,
    policy: 'stately',
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: false,
    expireInSeconds: 120,
  },
  {
    name: QUEUES.dispatchMaintenance,
    policy: 'stately',
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: false,
    expireInSeconds: 120,
  },
  {
    name: QUEUES.relayOutbox,
    policy: 'stately',
    retryLimit: 1,
    retryDelay: 1,
    retryBackoff: false,
    expireInSeconds: 120,
  },
  {
    name: QUEUES.connectionSync,
    policy: 'stately',
    retryLimit: 4,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 900,
    deadLetter: QUEUES.deadLetter,
  },
  {
    name: QUEUES.connectionPurge,
    policy: 'stately',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 600,
    deadLetter: QUEUES.deadLetter,
  },
  {
    name: QUEUES.tenantAnalyze,
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 600,
    deadLetter: QUEUES.deadLetter,
  },
  {
    name: QUEUES.tenantMaintain,
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 600,
    deadLetter: QUEUES.deadLetter,
  },
  {
    name: QUEUES.recommendationFormulate,
    policy: 'stately',
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
    deadLetter: QUEUES.deadLetter,
  },
];

export const PGBOSS_SCHEMA = 'pgboss';
