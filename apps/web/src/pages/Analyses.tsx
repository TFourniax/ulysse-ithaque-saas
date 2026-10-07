import type { AgentEventDto, AgentRunDto, AgentStatusDto } from '@ulysse/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useSession } from '../session.tsx';
import { Banner, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui.tsx';
import { formatDateTime } from '../format.ts';

export const MODE_LABELS = {
  rules: 'Historique / règles',
  simulated: 'Agentique simulé — aucun appel modèle',
  'hermes-live': 'Hermes live — modèle réel',
};
const TOOL_LABELS: Record<string, string> = {
  get_opportunity: 'Consultation des données CRM',
  list_activities: 'Consultation des activités et échanges',
  search_documents: 'Recherche des documents autorisés',
  read_document_excerpt: "Lecture d'un extrait autorisé",
  get_company_context: "Consultation du contexte de l'entreprise",
  get_active_doctrine: 'Consultation de la doctrine fictive',
  list_related_recommendations: 'Consultation des propositions et décisions précédentes',
};
const STATUSES: Record<string, string> = {
  running: 'Analyse en cours',
  validating: 'Validation du résultat',
  completed: 'Analyse terminée',
  abstained: 'Aucune proposition publiée',
  obsolete: 'Résultat obsolète',
  budget_reached: 'Budget ou concurrence atteint',
  failed: 'Erreur — résultat non publié',
  interrupted: 'Analyse interrompue',
};
export function useAgentRuns(tenantId: string) {
  return useQuery({
    queryKey: ['agent-runs', tenantId],
    queryFn: () => api<AgentStatusDto>('/v1/agent-runs'),
    refetchInterval: 2000,
  });
}
export function RunCard({ run }: { run: AgentRunDto }) {
  const session = useSession();
  const events = useQuery({
    queryKey: ['agent-events', session.activeTenant.id, run.id],
    queryFn: () => api<AgentEventDto[]>(`/v1/agent-runs/${run.id}/events`),
    refetchInterval: run.status === 'running' ? 2000 : false,
  });
  return (
    <section className="section" id={run.id} aria-label={`Analyse ${run.id}`}>
      <h2>{STATUSES[run.status] ?? run.status}</h2>
      <p>
        <strong>{MODE_LABELS[run.mode]}</strong> · {formatDateTime(run.started_at)} ·{' '}
        <Link to={`/opportunities/${run.subject_id}`}>Ouvrir l’opportunité</Link>
      </p>
      <p className="muted small">
        {run.model} · Hermes {run.hermes_version.slice(0, 12)} · instructions{' '}
        {run.instructions_version} · {run.tool_calls} outils · {run.model_calls} appels modèle
      </p>
      <p>
        Coût{' '}
        {run.cost_state === 'unknown'
          ? 'inconnu ; réservation conservée'
          : run.cost_state === 'estimated'
            ? 'estimé'
            : 'déclaré'}{' '}
        : {run.committed_usd.toFixed(6)} USD · réservation {run.reserved_usd.toFixed(2)} USD ·{' '}
        {run.input_tokens} / {run.output_tokens} tokens
      </p>
      {run.error_code && (
        <Banner kind="warning">
          Code : {run.error_code} · corrélation : {run.correlation_id}
        </Banner>
      )}
      {events.isPending && <Loading label="Chargement des étapes" />}
      {events.error && <ErrorBanner error={events.error} />}
      <ol>
        {events.data?.map((e) => (
          <li key={e.sequence}>
            <span>{TOOL_LABELS[e.label] ?? e.label}</span>
            {e.references.length > 0 && (
              <details>
                <summary>Références consultées</summary>
                <ul>
                  {e.references.map((r) => (
                    <li key={r}>
                      <code>{r}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ol>
      <details>
        <summary>Versions et résultat structuré validé</summary>
        <pre className="agent-json">
          {JSON.stringify({ versions: run.snapshot, result: run.result }, null, 2)}
        </pre>
      </details>
    </section>
  );
}
export function AnalysesPage() {
  const session = useSession();
  const runs = useAgentRuns(session.activeTenant.id);
  return (
    <>
      <PageHeader title="Analyses">
        <p>
          Analyses proactives et preuves d’exécution. Les étapes affichent les outils consultés ; la
          justification publiée est factuelle et sourcée.
        </p>
      </PageHeader>
      <Banner kind="info">
        Sources et doctrine entièrement fictives. Mode configuré :{' '}
        {runs.data ? MODE_LABELS[runs.data.configuredMode] : 'chargement'}.
      </Banner>
      {runs.isPending && <Loading />}
      {runs.error && <ErrorBanner error={runs.error} />}
      {runs.data?.runs.length === 0 && (
        <EmptyState title="Aucune exécution agentique">
          <p>
            Une ingestion déclenche l’analyse en arrière-plan lorsque le mode agentique est activé.
          </p>
        </EmptyState>
      )}
      {runs.data?.runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </>
  );
}
