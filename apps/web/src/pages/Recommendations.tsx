import type { RecommendationSummary } from '@ulysse/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import type { View } from '../api.ts';
import { useAnalyses, useConnections, useRecommendations } from '../api.ts';
import { can, useSession } from '../session.tsx';
import { dealAnalysisIssue, hasCalculatedPriority } from '../deal-analysis.ts';
import { useAgentRuns } from './Analyses.tsx';
import {
  Banner,
  EmptyState,
  ErrorBanner,
  FictionalBadge,
  Loading,
  PageHeader,
  PriorityGauge,
  Segmented,
  StatusBadge,
} from '../components/ui.tsx';
import {
  ABSTENTION_LABELS,
  CLOSED_REASON_LABELS,
  formatDateTime,
  formatRelative,
  frenchSpacing,
  KIND_LABELS,
} from '../format.ts';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'open', label: 'À décider' },
  { id: 'decided', label: 'Décidées' },
  { id: 'closed', label: 'Closes' },
  { id: 'all', label: 'Toutes' },
];

function SourceStatus({ tenantId }: { tenantId: string }) {
  const session = useSession();
  const connections = useConnections(tenantId);
  const analyses = useAnalyses(tenantId);
  const agent = useAgentRuns(tenantId);
  if (connections.isPending) return null;
  if (connections.error)
    return <ErrorBanner error={connections.error} title="État des sources indisponible" />;
  const active = connections.data.filter((c) => c.status === 'active');
  if (active.length === 0) {
    const broken = connections.data.find((c) => c.status === 'error');
    return (
      <Banner kind="warning">
        {broken ? (
          <>
            La source « {broken.displayName} » est en erreur ({broken.lastErrorCode ?? 'inconnue'}).
            Aucune nouvelle donnée n&apos;est lue.
          </>
        ) : (
          <>
            Aucune source n&apos;est connectée : Ulysse ne peut pas encore préparer de proposition.
          </>
        )}{' '}
        {can(session, 'connection:manage') ? (
          <Link to="/connections">Gérer les connexions</Link>
        ) : (
          'Contactez le responsable de votre entreprise.'
        )}
      </Banner>
    );
  }
  const neverSynced = active.filter((c) => c.dataAsOf === null);
  const latest = analyses.data?.[0];
  const agentic = agent.data?.configuredMode !== undefined && agent.data.configuredMode !== 'rules';
  const currentRuns = (agent.data?.runs ?? []).filter(
    (r, i, all) =>
      r.subject_label !== null && all.findIndex((v) => v.subject_id === r.subject_id) === i,
  );
  const activeRuns = currentRuns.filter((r) => r.status === 'running' || r.status === 'validating');
  const issues = currentRuns.filter((r) => dealAnalysisIssue(r));
  const latestRun = agent.data?.runs[0];
  const lastAnalysed = agentic
    ? agent.data?.runs.find(
        (r) => !r.snapshot.preflight && (r.status === 'completed' || r.status === 'abstained'),
      )?.completed_at
    : latest?.completedAt;
  const awaiting =
    agentic &&
    active.some(
      (c) => c.dataAsOf && (!lastAnalysed || Date.parse(c.dataAsOf) > Date.parse(lastAnalysed)),
    );
  const abstentions = latest ? Object.entries(latest.abstentions).filter(([, n]) => n > 0) : [];
  return (
    <div className="source-status">
      {agent.error && <ErrorBanner error={agent.error} title="État des analyses indisponible" />}
      {agentic && activeRuns.length > 0 && (
        <Banner kind="info">
          {activeRuns.length} analyse(s) en cours. <Link to="/analyses">Voir la progression</Link>
        </Banner>
      )}
      {agentic && issues.length > 0 && (
        <Banner kind="warning">
          {issues.slice(0, 3).map((r) => (
            <p key={r.id}>
              <Link to={`/opportunities/${r.subject_id}`}>{r.subject_label}</Link> :{' '}
              {dealAnalysisIssue(r)}
            </p>
          ))}
          <Link to="/analyses">Voir l’état des analyses</Link>
        </Banner>
      )}
      {awaiting && activeRuns.length === 0 && issues.length === 0 && (
        <Banner kind="info">
          Les données ont été importées, mais aucune analyse terminée depuis cet import n’est encore
          affichée. <Link to="/analyses">Vérifier l’état des analyses</Link>
        </Banner>
      )}
      {neverSynced.length > 0 && (
        <Banner kind="info">
          Synchronisation initiale en cours pour {neverSynced.map((c) => c.displayName).join(', ')}.
        </Banner>
      )}
      {active.map((c) =>
        c.lastErrorCode ? (
          <Banner key={c.id} kind="warning">
            Dernière synchronisation de « {c.displayName} » en échec ({c.lastErrorCode}) ; données
            au {formatDateTime(c.dataAsOf)}.
          </Banner>
        ) : null,
      )}
      <p className="sync-line">
        <span
          className={
            active.some((c) => c.lastErrorCode) || (agentic && (issues.length > 0 || awaiting))
              ? 'live-dot is-degraded'
              : 'live-dot'
          }
          aria-hidden="true"
        />
        <span>
          Données reçues :{' '}
          {active
            .map(
              (c) => `${c.displayName} ${c.dataAsOf ? formatRelative(c.dataAsOf) : '(en attente)'}`,
            )
            .join(' · ')}
          {agentic && latestRun && (
            <>
              {' '}
              · dernier traitement {formatRelative(latestRun.completed_at ?? latestRun.started_at)}
            </>
          )}
          {!agentic && latest && (
            <>
              {' '}
              · dernière analyse {formatRelative(latest.completedAt)}
              {abstentions.length > 0 && (
                <>
                  {' '}
                  (
                  {abstentions
                    .map(
                      ([reason, n]) =>
                        `${String(n)} non évaluée(s) : ${ABSTENTION_LABELS[reason] ?? reason}`,
                    )
                    .join(' ; ')}
                  )
                </>
              )}
            </>
          )}
        </span>
      </p>
    </div>
  );
}

function RecommendationCard({ rec, index }: { rec: RecommendationSummary; index: number }) {
  return (
    <li className="proposal" style={{ '--i': Math.min(index, 8) }}>
      <div className="proposal-priority">
        {hasCalculatedPriority(rec) ? (
          <>
            <span className="priority" title="Score de priorité (formule affichée dans le détail)">
              <span className="priority-label">Priorité</span>{' '}
              <span className="priority-value">{rec.priority.score}</span>
            </span>
            <PriorityGauge score={rec.priority.score} />
          </>
        ) : (
          <p className="priority-label">
            À examiner
            <br />
            <span className="muted small">Sans classement chiffré</span>
          </p>
        )}
      </div>
      <div className="proposal-body">
        <div className="tag-row">
          <StatusBadge status={rec.effectiveStatus} />
          {rec.doctrine.fictional && <FictionalBadge />}
          <span className="kind">{KIND_LABELS[rec.kind] ?? rec.kind}</span>
        </div>
        <h2 className="proposal-title">
          <Link to={`/recommendations/${rec.id}`} viewTransition>
            {frenchSpacing(rec.title)}
          </Link>
        </h2>
        <p className="proposal-why">{rec.whyNow}</p>
        <p className="meta">
          <span>
            {rec.subject.label} ({rec.subject.externalId})
          </span>{' '}
          <span>Générée {formatRelative(rec.generatedAt)}</span>{' '}
          <span>données au {formatDateTime(rec.dataAsOf)}</span>
          {rec.closedReason && (
            <>
              {' '}
              <span>close : {CLOSED_REASON_LABELS[rec.closedReason] ?? rec.closedReason}</span>
            </>
          )}
          {rec.effectiveStatus === 'pending' && (
            <>
              {' '}
              <span>expire {formatRelative(rec.expiresAt)}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export function RecommendationsPage() {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const [view, setView] = useState<View>('open');
  const list = useRecommendations(tenantId, view);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Propositions">
        <SourceStatus tenantId={tenantId} />
      </PageHeader>
      <Segmented label="Filtrer les propositions" options={VIEWS} value={view} onChange={setView} />
      {list.isPending && <Loading />}
      {list.error && <ErrorBanner error={list.error} />}
      {list.isSuccess && items.length === 0 && (
        <EmptyState
          title={
            view === 'open' ? 'Aucune proposition à décider' : 'Aucune proposition dans cette vue'
          }
        >
          <p>
            Les propositions préparées pour vos affaires apparaissent ici.{' '}
            <Link to="/analyses">Consulter l’état des analyses</Link> pour voir leur progression,
            les éventuels blocages ou les raisons de ne pas proposer d’action.
          </p>
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="proposals" aria-label="Liste des propositions">
          {items.map((rec, index) => (
            <RecommendationCard key={rec.id} rec={rec} index={index} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="list-more">
          <button
            type="button"
            className="button"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Chargement…' : 'Afficher plus'}
          </button>
        </div>
      )}
    </>
  );
}
