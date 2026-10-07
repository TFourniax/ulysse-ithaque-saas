import { useId, useState } from 'react';
import { useQualityReport } from '../api.ts';
import { useSession } from '../session.tsx';
import { Banner, ErrorBanner, Loading, Meter, PageHeader, TableScroll } from '../components/ui.tsx';
import {
  ABSTENTION_LABELS,
  formatDate,
  formatDateTime,
  KIND_LABELS,
  QUALITY_LABELS,
  STATUS_LABELS,
} from '../format.ts';

const PERIODS = [7, 30, 90] as const;
const hours = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function share(count: number, total: number): string {
  return total === 0 ? '—' : `${String(Math.round((count / total) * 100))} %`;
}

function CountTable({
  caption,
  rows,
  total,
}: {
  caption: string;
  rows: Array<[string, number]>;
  total?: number;
}) {
  // Bars compare categories: against the total when shares are shown, else against the largest.
  const scale = total ?? Math.max(0, ...rows.map(([, count]) => count));
  return (
    <TableScroll label={caption}>
      <table className="count-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Catégorie</th>
            <th scope="col" className="num">
              Nombre
            </th>
            {total !== undefined && (
              <th scope="col" className="num">
                Part
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, count]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="num">
                <span className="count-cell">
                  <Meter ratio={scale === 0 ? 0 : count / scale} />
                  <span>{count}</span>
                </span>
              </td>
              {total !== undefined && <td className="num">{share(count, total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <span className="kpi-label">
        {label}
        <span className="visually-hidden"> :</span>
      </span>{' '}
      <span className="kpi-value">{value}</span>
    </>
  );
}

/**
 * Observed figures for the active company. Everything shown is counted from
 * recorded proposals, decisions and evaluations: no estimate or extrapolated gain.
 */
export function MeasurePage() {
  const session = useSession();
  const [days, setDays] = useState<number>(30);
  const periodId = useId();
  const report = useQualityReport(session.activeTenant.id, days);
  const data = report.data;
  return (
    <>
      <PageHeader title="Mesure">
        <p>
          Chiffres calculés uniquement à partir de ce qui a été enregistré dans cette entreprise sur
          la période : propositions générées, décisions et évaluations des décideurs. Aucune
          estimation ni gain extrapolé. Avec le CRM de démonstration, ces données sont fictives.
        </p>
      </PageHeader>
      <div className="toolbar">
        <label htmlFor={periodId}>Période</label>
        <select id={periodId} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p} derniers jours
            </option>
          ))}
        </select>
      </div>
      {report.isPending && <Loading />}
      {report.error && <ErrorBanner error={report.error} title="Mesure indisponible" />}
      {data && (
        <>
          <p className="muted small period">
            Du {formatDateTime(data.period.from)} au {formatDateTime(data.period.to)}.
          </p>
          {data.truncated && (
            <Banner kind="warning">
              La période contient plus de lignes que la limite de calcul : les chiffres sont
              partiels. Réduisez la période.
            </Banner>
          )}
          <div className="measure-grid">
            <section className="panel" aria-labelledby="measure-proposals">
              <h2 id="measure-proposals" className="kpi">
                <Figure label="Propositions générées" value={data.proposals.generated} />
              </h2>
              <CountTable
                caption="Par type"
                rows={Object.entries(data.proposals.byKind).map(([k, n]) => [
                  KIND_LABELS[k] ?? k,
                  n,
                ])}
              />
              <CountTable
                caption="Par état actuel"
                rows={Object.entries(data.proposals.byStatus).map(([k, n]) => [
                  STATUS_LABELS[k] ?? k,
                  n,
                ])}
              />
            </section>
            <section className="panel" aria-labelledby="measure-decisions">
              <h2 id="measure-decisions" className="kpi">
                <Figure label="Décisions" value={data.decisions.total} />
              </h2>
              <dl className="stats">
                <div>
                  <dt>Approuvées</dt>
                  <dd>{data.decisions.approved}</dd>
                </div>
                <div>
                  <dt>Rejetées</dt>
                  <dd>{data.decisions.rejected}</dd>
                </div>
                <div>
                  <dt>Délai médian entre génération et décision</dt>
                  <dd>
                    {data.decisions.medianHoursToDecision === null
                      ? '—'
                      : `${hours.format(data.decisions.medianHoursToDecision)} h`}
                  </dd>
                </div>
              </dl>
              <CountTable
                caption="Évaluations des décideurs"
                total={data.decisions.total}
                rows={[
                  ...Object.entries(QUALITY_LABELS).map(([k, label]): [string, number] => [
                    label,
                    data.decisions.byQuality[k] ?? 0,
                  ]),
                  ['Non évaluées', data.decisions.byQuality.unlabeled ?? 0],
                ]}
              />
            </section>
            <section className="panel" aria-labelledby="measure-analysis">
              <h2 id="measure-analysis" className="kpi">
                <Figure
                  label="Dernière analyse"
                  value={data.latestAnalysis ? formatDate(data.latestAnalysis.completedAt) : '—'}
                />
              </h2>
              {data.latestAnalysis ? (
                <>
                  <dl className="stats">
                    <div>
                      <dt>Sujets évalués</dt>
                      <dd>{data.latestAnalysis.evaluated}</dd>
                    </div>
                  </dl>
                  <CountTable
                    caption="Abstentions par motif (état à la dernière analyse)"
                    rows={Object.entries(data.latestAnalysis.abstentions).map(([k, n]) => [
                      capitalized(ABSTENTION_LABELS[k] ?? k),
                      n,
                    ])}
                  />
                </>
              ) : (
                <p className="muted">Aucune analyse terminée.</p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
