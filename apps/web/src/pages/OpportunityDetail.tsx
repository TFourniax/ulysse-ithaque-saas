import type { DemoScenarioName, OpportunityDetailDto } from '@ulysse/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api.ts';
import { Banner, ErrorBanner, Loading, PageHeader } from '../components/ui.tsx';
import { formatDateTime, formatFactValue } from '../format.ts';
import { can, useSession } from '../session.tsx';
import { MODE_LABELS, RunCard, useAgentRuns } from './Analyses.tsx';

const SCENARIOS: Array<[DemoScenarioName, string]> = [
  ['baseline', 'Opportunité inactive'],
  ['positive_reply', 'Nouvelle réponse positive'],
  ['pause', 'Pause explicite'],
  ['contradiction', 'Sources contradictoires'],
  ['insufficient', 'Informations insuffisantes'],
  ['complementary', 'Besoin complémentaire'],
  ['opposition', 'Opposition à la prospection'],
  ['injection', 'Injection dans un document'],
];
export function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const session = useSession();
  const client = useQueryClient();
  const [scenario, setScenario] = useState<DemoScenarioName>('baseline');
  const detail = useQuery({
    queryKey: ['opportunity', session.activeTenant.id, id],
    queryFn: () => api<OpportunityDetailDto>(`/v1/opportunities/${id}`),
    refetchInterval: 2000,
  });
  const runs = useAgentRuns(session.activeTenant.id);
  const inject = useMutation({
    mutationFn: () =>
      api(`/v1/demo/opportunities/${id}/source-event`, { method: 'POST', body: { scenario } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['opportunity', session.activeTenant.id, id] });
    },
  });
  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const o = detail.data.opportunity;
  return (
    <>
      <PageHeader title={o.name}>
        <p>
          <Link to="/opportunities">← Opportunités</Link> · {o.externalId} · révision {o.revision}
        </p>
      </PageHeader>
      <Banner kind="info">
        Entreprise, sources et doctrine fictives. Mode :{' '}
        {runs.data ? MODE_LABELS[runs.data.configuredMode] : 'chargement'}.
      </Banner>
      <section className="section">
        <h2>Données CRM normalisées</h2>
        <dl>
          {Object.entries(o.fields).map(([key, field]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {typeof field === 'string' ? field : formatFactValue(field.state, field.value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="section">
        <h2>Activités, échanges et documents fictifs</h2>
        {!o.commercial && (
          <p>Informations indisponibles : enrichir les fixtures avec le seed de ce lot.</p>
        )}
        {o.commercial?.materials.length === 0 && (
          <p>Source accessible, sans activité ni document.</p>
        )}
        {o.commercial?.contactPolicy.opposed && (
          <Banner kind="warning">Opposition explicite : aucune sollicitation autorisée.</Banner>
        )}
        {o.commercial?.contactPolicy.pauseUntil && (
          <p>Pause demandée jusqu’au {formatDateTime(o.commercial.contactPolicy.pauseUntil)}.</p>
        )}
        {o.commercial?.materials.map((m) => (
          <details key={m.id} id={m.id}>
            <summary>
              {m.title} · {m.type} · v{m.version}
            </summary>
            <p className="small muted">
              {m.author} · {formatDateTime(m.occurredAt)}
            </p>
            <p>{m.text}</p>
            <code>
              material:{o.id}:{m.id}:v{m.version}:r{o.revision}
            </code>
          </details>
        ))}
      </section>
      {runs.data?.demoEnabled && can(session, 'connection:manage') && (
        <section className="section">
          <h2>Scénarios de démonstration</h2>
          <p>
            Cette commande change la source fictive, puis demande son ingestion. Le worker analysera
            les nouvelles versions.
          </p>
          <label htmlFor="scenario">Événement source</label>
          <select
            id="scenario"
            value={scenario}
            onChange={(e) => {
              const value = SCENARIOS.find(([key]) => key === e.target.value)?.[0];
              if (value) setScenario(value);
            }}
          >
            {SCENARIOS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="button button-primary"
            type="button"
            disabled={inject.isPending}
            onClick={() => inject.mutate()}
          >
            Injecter et synchroniser
          </button>
          {inject.isSuccess && (
            <Banner kind="success">
              Événement injecté ; synchronisation en attente du worker.
            </Banner>
          )}
          {inject.error && <ErrorBanner error={inject.error} />}
        </section>
      )}
      <section className="section">
        <h2>Propositions liées</h2>
        <ul>
          {detail.data.recommendations.map((r) => (
            <li key={r.id}>
              <Link to={`/recommendations/${r.id}`}>{r.title}</Link> · {r.status} ·{' '}
              <Link to={`/analyses#${r.analysisId}`}>Analyse</Link>
            </li>
          ))}
        </ul>
      </section>
      {runs.error && <ErrorBanner error={runs.error} />}
      {runs.data?.runs
        .filter((r) => r.subject_id === id)
        .map((r) => (
          <RunCard key={r.id} run={r} />
        ))}
    </>
  );
}
