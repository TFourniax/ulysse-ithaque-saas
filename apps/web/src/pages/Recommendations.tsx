import type { RecommendationSummary } from '@ulysse/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import type { View } from '../api.ts';
import { useAnalyses, useConnections, useRecommendations } from '../api.ts';
import { can, useSession } from '../session.tsx';
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
  const abstentions = latest ? Object.entries(latest.abstentions).filter(([, n]) => n > 0) : [];
  return (
    <div className="source-status">
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
          className={active.some((c) => c.lastErrorCode) ? 'live-dot is-degraded' : 'live-dot'}
          aria-hidden="true"
        />
        <span>
          Données confirmées :{' '}
          {active
            .map(
              (c) => `${c.displayName} ${c.dataAsOf ? formatRelative(c.dataAsOf) : '(en attente)'}`,
            )
            .join(' · ')}
          {latest && (
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
        <span className="priority" title="Score de priorité (formule affichée dans le détail)">
          <span className="priority-label">Priorité</span>{' '}
          <span className="priority-value">{rec.priority.score}</span>
        </span>
        <PriorityGauge score={rec.priority.score} />
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
            Ulysse analyse vos données en arrière-plan ; les nouvelles propositions apparaîtront ici
            sans action de votre part.
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
