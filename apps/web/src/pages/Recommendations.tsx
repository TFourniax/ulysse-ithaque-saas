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
  StatusBadge,
} from '../components/ui.tsx';
import {
  ABSTENTION_LABELS,
  CLOSED_REASON_LABELS,
  formatDateTime,
  formatRelative,
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
      <p className="muted small">
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
      </p>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationSummary }) {
  return (
    <li className="card">
      <div className="card-head">
        <StatusBadge status={rec.effectiveStatus} />
        <span className="priority" title="Score de priorité (formule affichée dans le détail)">
          Priorité {rec.priority.score}
        </span>
        {rec.doctrine.fictional && <FictionalBadge />}
      </div>
      <h2 className="card-title">
        <Link to={`/recommendations/${rec.id}`}>{rec.title}</Link>
      </h2>
      <p className="muted small">
        {KIND_LABELS[rec.kind] ?? rec.kind} · {rec.subject.label} ({rec.subject.externalId})
      </p>
      <p>{rec.whyNow}</p>
      <p className="muted small">
        Générée {formatRelative(rec.generatedAt)} · données au {formatDateTime(rec.dataAsOf)}
        {rec.closedReason && (
          <> · close : {CLOSED_REASON_LABELS[rec.closedReason] ?? rec.closedReason}</>
        )}
        {rec.effectiveStatus === 'pending' && <> · expire {formatRelative(rec.expiresAt)}</>}
      </p>
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
      <h1>Propositions</h1>
      <SourceStatus tenantId={tenantId} />
      <div className="segmented" role="group" aria-label="Filtrer les propositions">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
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
        <ul className="cards" aria-label="Liste des propositions">
          {items.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <button
          type="button"
          className="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Chargement…' : 'Afficher plus'}
        </button>
      )}
    </>
  );
}
