import { useId, useState } from 'react';
import { useQualityReport } from '../api.ts';
import { useSession } from '../session.tsx';
import { Banner, ErrorBanner, Loading } from '../components/ui.tsx';
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
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Catégorie</th>
            <th scope="col">Nombre</th>
            {total !== undefined && <th scope="col">Part</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, count]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{count}</td>
              {total !== undefined && <td>{share(count, total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <h1>Mesure</h1>
      <p className="muted">
        Chiffres calculés uniquement à partir de ce qui a été enregistré dans cette entreprise sur
        la période : propositions générées, décisions et évaluations des décideurs. Aucune
        estimation ni gain extrapolé. Avec le CRM de démonstration, ces données sont fictives.
      </p>
      <label htmlFor={periodId}>Période</label>
      <select id={periodId} value={days} onChange={(e) => setDays(Number(e.target.value))}>
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {p} derniers jours
          </option>
        ))}
      </select>
      {report.isPending && <Loading />}
      {report.error && <ErrorBanner error={report.error} title="Mesure indisponible" />}
      {data && (
        <>
          <p className="muted small">
            Du {formatDateTime(data.period.from)} au {formatDateTime(data.period.to)}.
          </p>
          {data.truncated && (
            <Banner kind="warning">
              La période contient plus de lignes que la limite de calcul : les chiffres sont
              partiels. Réduisez la période.
            </Banner>
          )}
          <section className="panel" aria-labelledby="measure-proposals">
            <h2 id="measure-proposals">Propositions générées : {data.proposals.generated}</h2>
            <CountTable
              caption="Par type"
              rows={Object.entries(data.proposals.byKind).map(([k, n]) => [KIND_LABELS[k] ?? k, n])}
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
            <h2 id="measure-decisions">Décisions : {data.decisions.total}</h2>
            <p>
              Approuvées : {data.decisions.approved} · Rejetées : {data.decisions.rejected} · Délai
              médian entre génération et décision :{' '}
              {data.decisions.medianHoursToDecision === null
                ? '—'
                : `${hours.format(data.decisions.medianHoursToDecision)} h`}
            </p>
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
            <h2 id="measure-analysis">Dernière analyse</h2>
            {data.latestAnalysis ? (
              <>
                <p>
                  {formatDate(data.latestAnalysis.completedAt)} · sujets évalués :{' '}
                  {data.latestAnalysis.evaluated}
                </p>
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
        </>
      )}
    </>
  );
}
