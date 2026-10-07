import { useOpportunities } from '../api.ts';
import { useSession } from '../session.tsx';
import { EmptyState, ErrorBanner, Loading, PageHeader, TableScroll } from '../components/ui.tsx';
import { formatDateTime, formatFactValue } from '../format.ts';

const STAGES: Record<string, string> = { open: 'Ouverte', won: 'Gagnée', lost: 'Perdue' };

type Field = { state: 'present' | 'empty' | 'unavailable'; value?: unknown } | string | undefined;

function cell(field: Field): { text: string; muted: boolean } {
  if (field === undefined || typeof field === 'string') return { text: '—', muted: true };
  return { text: formatFactValue(field.state, field.value), muted: field.state !== 'present' };
}

export function OpportunitiesPage() {
  const session = useSession();
  const query = useOpportunities(session.activeTenant.id);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: Array<[string, string]> = [
    ['lastInteractionAt', 'Dernière interaction'],
    ['nextStep', 'Prochaine étape'],
    ['nextStepDueAt', 'Échéance'],
    ['amount', 'Montant'],
    ['ownerName', 'Responsable'],
    ['segment', 'Segment'],
  ];
  return (
    <>
      <PageHeader title="Opportunités">
        <p>
          Projection normalisée des sources autorisées (lecture seule). « Non fourni par la source »
          signale une information que la source n&apos;expose pas ; Ulysse ne la devine pas.
        </p>
      </PageHeader>
      {query.isPending && <Loading />}
      {query.error && <ErrorBanner error={query.error} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState title="Aucune opportunité synchronisée" />
      )}
      {items.length > 0 && (
        <TableScroll label="Opportunités synchronisées" framed>
          <table>
            <caption className="visually-hidden">Opportunités synchronisées</caption>
            <thead>
              <tr>
                <th scope="col">Opportunité</th>
                <th scope="col">Étape</th>
                {columns.map(([, label]) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
                <th scope="col">Observée</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <th scope="row">
                    {o.name}
                    <span className="muted small cell-sub">
                      {' '}
                      ({o.externalId}, rév. {o.revision})
                    </span>
                  </th>
                  <td>
                    <span className={`stage stage-${o.stage}`}>{STAGES[o.stage] ?? o.stage}</span>
                  </td>
                  {columns.map(([key]) => {
                    const c = cell(o.fields[key]);
                    return (
                      <td key={key} className={c.muted ? 'muted' : ''}>
                        {c.text}
                      </td>
                    );
                  })}
                  <td className="small">{formatDateTime(o.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {query.hasNextPage && (
        <div className="list-more">
          <button type="button" className="button" onClick={() => void query.fetchNextPage()}>
            Afficher plus
          </button>
        </div>
      )}
    </>
  );
}
