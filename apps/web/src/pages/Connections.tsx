import type { Connection } from '@ulysse/contracts';
import { useId, useState } from 'react';
import { useConnectionActions, useConnections, useConnectors, useSyncRuns } from '../api.ts';
import { can, useSession } from '../App.tsx';
import { Banner, EmptyState, ErrorBanner, FictionalBadge, Loading } from '../components/ui.tsx';
import { formatDateTime, formatRelative } from '../format.ts';

const STATUS: Record<string, string> = {
  active: 'Active',
  paused: 'En pause',
  error: 'En erreur',
  revoked: 'Révoquée',
};

function SyncRuns({ tenantId, connection }: { tenantId: string; connection: Connection }) {
  const [open, setOpen] = useState(false);
  const runs = useSyncRuns(tenantId, connection.id, open);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Historique des synchronisations</summary>
      {runs.isPending && open && <Loading />}
      {runs.error && <ErrorBanner error={runs.error} />}
      {runs.data && (
        <ul className="small">
          {runs.data.map((r) => (
            <li key={r.id}>
              {formatDateTime(r.startedAt)} — {r.trigger} — {r.status} — {r.pages} page(s),{' '}
              {r.created} créé(s), {r.revised} modifié(s), {r.deleted} supprimé(s), {r.rejected}{' '}
              rejeté(s)
              {r.errorCode && <> — erreur {r.errorCode}</>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function AddConnection({ tenantId }: { tenantId: string }) {
  const connectors = useConnectors(tenantId);
  const actions = useConnectionActions(tenantId);
  const [provider, setProvider] = useState('');
  const [name, setName] = useState('');
  const [dataset, setDataset] = useState('');
  const ids = { provider: useId(), name: useId(), dataset: useId() };
  if (connectors.isPending) return null;
  if (connectors.error) return <ErrorBanner error={connectors.error} />;
  const selected = connectors.data.find((c) => c.provider === provider);
  return (
    <section className="panel" aria-labelledby="add-title">
      <h2 id="add-title">Autoriser une source</h2>
      {connectors.data.length === 0 ? (
        <p className="muted">
          Aucun connecteur n&apos;est installé sur cet environnement. La première intégration réelle
          dépend du pilote (UL-008).
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            actions.create.mutate({ provider, displayName: name, config: { dataset } });
          }}
        >
          <label htmlFor={ids.provider}>Connecteur</label>
          <select
            id={ids.provider}
            required
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">Choisir…</option>
            {connectors.data.map((c) => (
              <option key={c.provider} value={c.provider}>
                {c.displayName}
              </option>
            ))}
          </select>
          {selected && (
            <p className="muted small">
              Accès demandés : {selected.scopes.join(', ')}. Lecture seule ; aucune écriture vers la
              source.
              {selected.kind === 'fixture' && ' Connecteur fictif de démonstration.'}
            </p>
          )}
          <label htmlFor={ids.name}>Nom affiché</label>
          <input
            id={ids.name}
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor={ids.dataset}>Jeu de données (connecteur fictif)</label>
          <input
            id={ids.dataset}
            required
            pattern="[a-z0-9-]{1,40}"
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
          />
          <div className="actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={actions.create.isPending}
            >
              Autoriser et synchroniser
            </button>
          </div>
          {actions.create.isSuccess && (
            <Banner kind="success">
              Source autorisée : la synchronisation initiale démarre en arrière-plan.
            </Banner>
          )}
          {actions.create.error && <ErrorBanner error={actions.create.error} />}
        </form>
      )}
    </section>
  );
}

export function ConnectionsPage() {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const connections = useConnections(tenantId);
  const actions = useConnectionActions(tenantId);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <>
      <h1>Connexions</h1>
      <p className="muted">
        Sources autorisées, état de synchronisation et fraîcheur des données. Les synchronisations
        continuent sans navigateur ouvert.
      </p>
      {connections.isPending && <Loading />}
      {connections.error && <ErrorBanner error={connections.error} />}
      {connections.isSuccess && connections.data.length === 0 && (
        <EmptyState title="Aucune source autorisée" />
      )}
      <ul className="cards">
        {connections.data?.map((c) => (
          <li key={c.id} className="card">
            <div className="card-head">
              <span className={`badge badge-conn-${c.status}`}>{STATUS[c.status] ?? c.status}</span>
              {c.kind === 'fixture' && <FictionalBadge />}
            </div>
            <h2 className="card-title">{c.displayName}</h2>
            <dl className="facts">
              <dt>Connecteur</dt>
              <dd>{c.provider}</dd>
              <dt>Accès</dt>
              <dd>{c.grantedScopes.join(', ')}</dd>
              <dt>Données confirmées</dt>
              <dd>
                {c.dataAsOf
                  ? `${formatDateTime(c.dataAsOf)} (${formatRelative(c.dataAsOf)})`
                  : 'Synchronisation initiale en attente'}
              </dd>
              <dt>Dernière réussite</dt>
              <dd>{formatDateTime(c.lastSuccessAt)}</dd>
              <dt>Cadence</dt>
              <dd>
                toutes les {c.syncIntervalMinutes} min · prochaine{' '}
                {c.nextSyncAt ? formatRelative(c.nextSyncAt) : '—'}
              </dd>
              {c.lastErrorCode && (
                <>
                  <dt>Dernière erreur</dt>
                  <dd>
                    {c.lastErrorCode} ({formatDateTime(c.lastErrorAt)}, {c.consecutiveFailures}{' '}
                    échec(s) consécutif(s))
                  </dd>
                </>
              )}
            </dl>
            {c.status === 'active' && (
              <div className="actions">
                {can(session, 'connection:sync') && (
                  <button
                    type="button"
                    className="button"
                    disabled={actions.sync.isPending}
                    onClick={() => actions.sync.mutate(c.id)}
                  >
                    Synchroniser maintenant
                  </button>
                )}
                {can(session, 'connection:manage') &&
                  (confirming === c.id ? (
                    <>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() =>
                          actions.revoke.mutate(c.id, { onSettled: () => setConfirming(null) })
                        }
                      >
                        Confirmer la révocation
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => setConfirming(c.id)}
                    >
                      Révoquer
                    </button>
                  ))}
              </div>
            )}
            {confirming === c.id && (
              <p className="muted small" role="status">
                La révocation arrête les synchronisations, ferme les propositions ouvertes issues de
                cette source et supprime ses données synchronisées.
              </p>
            )}
            <SyncRuns tenantId={tenantId} connection={c} />
          </li>
        ))}
      </ul>
      <div aria-live="polite">
        {actions.sync.isSuccess && (
          <Banner kind="success">
            Synchronisation demandée : elle est mise en file (traitement en arrière-plan).
          </Banner>
        )}
        {actions.sync.error && <ErrorBanner error={actions.sync.error} />}
        {actions.revoke.error && <ErrorBanner error={actions.revoke.error} />}
      </div>
      {can(session, 'connection:manage') && <AddConnection tenantId={tenantId} />}
    </>
  );
}
