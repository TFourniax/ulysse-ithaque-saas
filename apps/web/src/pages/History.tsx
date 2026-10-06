import { useAudit } from '../api.ts';
import { can, useSession } from '../App.tsx';
import { Banner, ErrorBanner, Loading } from '../components/ui.tsx';
import { EVENT_LABELS, formatDateTime } from '../format.ts';

export function HistoryPage() {
  const session = useSession();
  const allowed = can(session, 'audit:read');
  const query = useAudit(session.activeTenant.id, allowed);
  if (!allowed)
    return (
      <Banner kind="warning">
        Votre rôle ne donne pas accès au journal d&apos;audit de l&apos;entreprise.
      </Banner>
    );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <h1>Historique</h1>
      <p className="muted">
        Journal d&apos;audit métier de l&apos;entreprise : qui a fait quoi, quand, sur quelle
        révision. Il ne contient aucun contenu des sources.
      </p>
      {query.isPending && <Loading />}
      {query.error && <ErrorBanner error={query.error} />}
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Journal d&apos;audit</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Événement</th>
              <th scope="col">Acteur</th>
              <th scope="col">Objet</th>
              <th scope="col">Détails</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td className="small">{formatDateTime(e.createdAt)}</td>
                <td>{EVENT_LABELS[e.eventType] ?? e.eventType}</td>
                <td>{e.actorName ?? e.actorId}</td>
                <td className="small">
                  {e.resourceType} {e.resourceId.slice(0, 8)}
                  {e.revision !== null && <> · rév. {e.revision}</>}
                </td>
                <td className="small muted">
                  {Object.entries(e.metadata)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage && (
        <button type="button" className="button" onClick={() => void query.fetchNextPage()}>
          Afficher plus
        </button>
      )}
    </>
  );
}
