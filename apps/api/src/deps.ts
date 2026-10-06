import type { ConnectorRegistry } from '@ulysse/connectors';
import type { IdentityRepository, Pool } from '@ulysse/database';
import type { Clock, RuleRegistry, UnitOfWork } from '@ulysse/domain';
import type { Logger, Metrics } from '@ulysse/observability';
import type { OidcProvider } from './auth/oidc.ts';
import type { SessionStore } from './auth/sessions.ts';
import type { ApiConfig } from './config.ts';

export type ApiDeps = Readonly<{
  config: ApiConfig;
  pool: Pool;
  uow: UnitOfWork;
  identity: IdentityRepository;
  sessions: SessionStore;
  oidc: OidcProvider;
  registry: ConnectorRegistry;
  rules: RuleRegistry;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
}>;
