import type { ConnectorCatalog, ConnectorDescription } from '@ulysse/domain';
import { DomainError } from '@ulysse/domain';
import type { Connector } from './contract.ts';
import { ConnectorError } from './contract.ts';

export type ConnectorRegistry = ReadonlyMap<string, Connector>;

export function createRegistry(connectors: readonly Connector[]): ConnectorRegistry {
  return new Map(connectors.map((c) => [c.definition.provider, c]));
}

/** Exposes installed connectors to the domain without coupling it to provider code. */
export function catalogOf(registry: ConnectorRegistry): ConnectorCatalog {
  return {
    describe(provider: string): ConnectorDescription | null {
      const connector = registry.get(provider);
      if (!connector) return null;
      const d = connector.definition;
      return {
        provider: d.provider,
        kind: d.kind,
        scopes: d.authorization.scopes,
        defaultSyncIntervalMinutes: d.defaultSyncIntervalMinutes,
        validateConfig(config: unknown) {
          try {
            return d.validateConfig(config);
          } catch (error) {
            if (error instanceof ConnectorError)
              throw new DomainError('INVALID_INPUT', `config: ${error.message}`);
            throw error;
          }
        },
      };
    },
  };
}
