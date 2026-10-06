import type { RecommendationDetail } from '@ulysse/contracts';
import { useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  newIdempotencyKey,
  useDecision,
  useRecommendation,
  useRevision,
} from '../api.ts';
import { useSession } from '../session.tsx';
import { Banner, ErrorBanner, FictionalBadge, Loading, StatusBadge } from '../components/ui.tsx';
import {
  CLOSED_REASON_LABELS,
  EVENT_LABELS,
  formatDateTime,
  formatFactValue,
  formatRelative,
  KIND_LABELS,
} from '../format.ts';

const EVIDENCE_STATE_MESSAGES: Record<string, string> = {
  changed:
    "Les faits ont changé à la source depuis la génération : l'approbation est bloquée. Une nouvelle analyse remplacera ou fermera cette proposition.",
  stale:
    'Les données de la source sont trop anciennes pour approuver (dernière synchronisation réussie trop ancienne). Le rejet reste possible.',
  connection_inactive:
    "La source n'est plus active (révoquée ou en erreur) : l'approbation est bloquée.",
  doctrine_changed:
    "La doctrine utilisée n'est plus la doctrine validée en vigueur : l'approbation est bloquée.",
};

const STAGE_LABELS: Record<string, string> = { open: 'Ouverte', won: 'Gagnée', lost: 'Perdue' };

const CONFLICT_CODES = new Set([
  'REVISION_CONFLICT',
  'ALREADY_DECIDED',
  'STALE_EVIDENCE',
  'EXPIRED',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_CONFLICT',
]);

/** Reuses the same Idempotency-Key only when the exact same request is retried. */
function useAttemptKey() {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    keyFor(fingerprint: string): string {
      if (ref.current?.fingerprint !== fingerprint)
        ref.current = { fingerprint, key: newIdempotencyKey() };
      return ref.current.key;
    },
    reset() {
      ref.current = null;
    },
  };
}

function DecisionPanel({ detail }: { detail: RecommendationDetail }) {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const rec = detail.recommendation;
  const decide = useDecision(tenantId, rec.id);
  const attempt = useAttemptKey();
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const reasonId = useId();
  const approveHelpId = useId();

  const approveBlocked =
    rec.effectiveStatus !== 'pending'
      ? rec.effectiveStatus === 'draft'
        ? 'Soumettez le brouillon avant de pouvoir l’approuver.'
        : 'La proposition a expiré : seule une décision de rejet reste possible.'
      : detail.evidenceState !== 'current'
        ? (EVIDENCE_STATE_MESSAGES[detail.evidenceState] ?? 'Preuves non vérifiables.')
        : null;

  const submit = (decision: 'approve' | 'reject') => {
    setFeedback(null);
    const trimmed = reason.trim() || null;
    const key = attempt.keyFor(JSON.stringify([decision, rec.revision, trimmed]));
    decide.mutate(
      { decision, expectedRevision: rec.revision, reason: trimmed, key },
      {
        onSuccess: (result) => {
          attempt.reset();
          setFeedback(
            decision === 'approve'
              ? 'Décision enregistrée : proposition approuvée. Aucune action externe n’a été exécutée.'
              : 'Décision enregistrée : proposition rejetée.',
          );
          if (result.replayed)
            setFeedback((f) => `${f ?? ''} (requête déjà traitée, résultat identique)`);
        },
        onError: (error) => {
          if (error instanceof ApiError && CONFLICT_CODES.has(error.code)) attempt.reset();
        },
      },
    );
  };

  const conflictError =
    decide.error instanceof ApiError && CONFLICT_CODES.has(decide.error.code) ? decide.error : null;
  const conflict = conflictError !== null;
  const feedbackRegion = (
    <div aria-live="polite">
      {feedback && <Banner kind="success">{feedback}</Banner>}
      {conflictError && (
        <Banner kind="warning">
          {conflictError.message} La proposition a été rechargée : vérifiez son état avant toute
          nouvelle décision.
        </Banner>
      )}
      {decide.error && !conflict && (
        <ErrorBanner error={decide.error} title="Décision non enregistrée" />
      )}
    </div>
  );
  if (!detail.permissions.canDecide) {
    return (
      <section className="panel" aria-labelledby="decision-title">
        <h2 id="decision-title">Décision</h2>
        <p className="muted">
          {rec.status === 'pending' || rec.status === 'draft'
            ? 'Votre rôle permet la consultation uniquement : la décision revient à un décideur ou au responsable.'
            : 'Cette proposition est close.'}
        </p>
        {feedbackRegion}
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="decision-title">
      <h2 id="decision-title">Décision</h2>
      <p className="muted small">
        Approuver enregistre votre décision ; Ulysse n&apos;envoie rien et ne modifie aucun outil
        externe.
      </p>
      <label htmlFor={reasonId}>Motif (facultatif)</label>
      <textarea
        id={reasonId}
        value={reason}
        maxLength={1000}
        rows={2}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={decide.isPending || approveBlocked !== null}
          aria-describedby={approveBlocked ? approveHelpId : undefined}
          onClick={() => submit('approve')}
        >
          Approuver
        </button>
        <button
          type="button"
          className="button"
          disabled={decide.isPending}
          onClick={() => submit('reject')}
        >
          Rejeter
        </button>
      </div>
      {approveBlocked && (
        <p id={approveHelpId} className="muted small">
          {approveBlocked}
        </p>
      )}
      {feedbackRegion}
    </section>
  );
}

function RevisionEditor({ detail }: { detail: RecommendationDetail }) {
  const session = useSession();
  const rec = detail.recommendation;
  const revise = useRevision(session.activeTenant.id, rec.id);
  const attempt = useAttemptKey();
  const [text, setText] = useState(rec.proposedAction);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const textId = useId();
  const noteId = useId();
  if (!detail.permissions.canRevise) return null;
  const save = (submit: boolean) => {
    const key = attempt.keyFor(JSON.stringify([text, note, submit, rec.revision]));
    revise.mutate(
      {
        expectedRevision: rec.revision,
        proposedAction: text.trim(),
        note: note.trim() || null,
        submit,
        key,
      },
      {
        onSuccess: () => {
          attempt.reset();
          setOpen(false);
        },
      },
    );
  };
  return (
    <section className="panel" aria-labelledby="revision-title">
      <h2 id="revision-title">Modifier la prochaine étape</h2>
      {!open ? (
        <button type="button" className="button" onClick={() => setOpen(true)}>
          Modifier
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <p className="muted small">
            Une modification crée une nouvelle révision : toute décision devra porter sur cette
            nouvelle version.
          </p>
          <label htmlFor={textId}>Prochaine étape proposée</label>
          <textarea
            id={textId}
            required
            maxLength={4000}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <label htmlFor={noteId}>Note de révision (facultatif)</label>
          <input
            id={noteId}
            type="text"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={revise.isPending || text.trim().length === 0}
            >
              Soumettre la révision
            </button>
            <button
              type="button"
              className="button"
              disabled={revise.isPending || text.trim().length === 0}
              onClick={() => save(false)}
            >
              Enregistrer en brouillon
            </button>
            <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {revise.error && <ErrorBanner error={revise.error} title="Révision non enregistrée" />}
    </section>
  );
}

export function RecommendationDetailPage() {
  const { id = '' } = useParams();
  const session = useSession();
  const query = useRecommendation(session.activeTenant.id, id);
  if (query.isPending) return <Loading />;
  if (query.error) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <p>
          <Link to="/recommendations">← Propositions</Link>
        </p>
        <ErrorBanner
          error={query.error}
          title={notFound ? 'Proposition introuvable ou non accessible' : 'Chargement impossible'}
        />
      </>
    );
  }
  const detail = query.data;
  const rec = detail.recommendation;
  return (
    <article className="detail">
      <p>
        <Link to="/recommendations">← Propositions</Link>
      </p>
      <header className="detail-head">
        <div className="card-head">
          <StatusBadge status={rec.effectiveStatus} />
          <span className="priority">Priorité {rec.priority.score}</span>
          {rec.doctrine.fictional && <FictionalBadge />}
          <span className="muted small">Révision {rec.revision}</span>
        </div>
        <h1>{rec.title}</h1>
        <p className="muted">
          {KIND_LABELS[rec.kind] ?? rec.kind} · {rec.subject.label} ({rec.subject.externalId})
        </p>
      </header>
      {detail.evidenceState !== 'current' &&
        (rec.status === 'pending' || rec.status === 'draft') && (
          <Banner kind="warning">{EVIDENCE_STATE_MESSAGES[detail.evidenceState]}</Banner>
        )}
      {rec.closedReason && (
        <Banner kind="info">
          Proposition close : {CLOSED_REASON_LABELS[rec.closedReason] ?? rec.closedReason}
          {rec.supersededById && (
            <>
              {' '}
              —{' '}
              <Link to={`/recommendations/${rec.supersededById}`}>
                voir la proposition qui la remplace
              </Link>
            </>
          )}
        </Banner>
      )}
      <div className="detail-grid">
        <div>
          <section className="panel" aria-labelledby="why-title">
            <h2 id="why-title">Pourquoi maintenant</h2>
            <p>{rec.whyNow}</p>
            <h3>Prochaine étape proposée</h3>
            <p className="proposed">{rec.proposedAction}</p>
            {rec.supersedesId && (
              <p className="muted small">
                Remplace{' '}
                <Link to={`/recommendations/${rec.supersedesId}`}>une proposition précédente</Link>.
              </p>
            )}
          </section>
          <section className="panel" aria-labelledby="facts-title">
            <h2 id="facts-title">Faits et sources</h2>
            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">Faits utilisés par la proposition</caption>
                <thead>
                  <tr>
                    <th scope="col">Fait</th>
                    <th scope="col">Valeur</th>
                    <th scope="col">Rôle</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.evidence.map((e) => (
                    <tr key={e.id}>
                      <th scope="row">{e.label}</th>
                      <td className={e.state === 'present' ? '' : 'muted'}>
                        {e.factType === 'stage' && typeof e.value === 'string'
                          ? (STAGE_LABELS[e.value] ?? e.value)
                          : formatFactValue(e.state, e.value)}
                      </td>
                      <td>{e.material ? 'Déterminant' : 'Contexte'}</td>
                      <td className="small">
                        Révision {e.sourceRevision}, observée {formatDateTime(e.observedAt)}
                        {e.sourceModifiedAt && (
                          <>, modifiée à la source {formatDateTime(e.sourceModifiedAt)}</>
                        )}
                        {!e.sourceAvailable && (
                          <> — donnée source supprimée (valeur conservée pour l&apos;historique)</>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Données confirmées au {formatDateTime(rec.dataAsOf)} ({formatRelative(rec.dataAsOf)})
              · âge maximal accepté : {rec.maxSourceAgeHours} h.
            </p>
          </section>
          <section className="panel" aria-labelledby="limits-title">
            <h2 id="limits-title">Hypothèses et limites</h2>
            <ul>
              {rec.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {rec.missingInformation.length > 0 && (
              <>
                <h3>Informations manquantes</h3>
                <ul>
                  {rec.missingInformation.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Raison de la priorité</h3>
            <ul>
              {rec.priority.reasons.map((r) => (
                <li key={r.label}>
                  {r.label} : +{r.points}
                </li>
              ))}
            </ul>
            <p className="muted small">
              Règle {rec.ruleId} v{rec.ruleVersion} · doctrine « {rec.doctrine.key} » v
              {rec.doctrine.version}
              {rec.doctrine.fictional && ' (fictive, non validée métier)'} · contexte v
              {rec.contextVersion ?? '—'} · formulation :{' '}
              {rec.formulation === 'model' ? 'assistée par modèle' : 'modèle déterministe'}. Le
              score est une priorité calculée, pas une probabilité.
            </p>
          </section>
        </div>
        <div>
          <DecisionPanel key={rec.id} detail={detail} />
          <RevisionEditor key={`rev:${rec.id}:${String(rec.revision)}`} detail={detail} />
          <section className="panel" aria-labelledby="history-title">
            <h2 id="history-title">Historique</h2>
            <ol className="timeline">
              {detail.history.map((event) => (
                <li key={event.id}>
                  <strong>{EVENT_LABELS[event.eventType] ?? event.eventType}</strong>
                  <span className="muted small">
                    {' '}
                    — {event.actorName ?? event.actorId}, {formatDateTime(event.createdAt)}
                    {event.revision !== null && <>, révision {event.revision}</>}
                  </span>
                </li>
              ))}
            </ol>
            {detail.revisions.length > 1 && (
              <>
                <h3>Versions du contenu</h3>
                <ol>
                  {detail.revisions.map((r) => (
                    <li key={r.contentRevision}>
                      v{r.contentRevision} ({r.createdBy ? 'modification humaine' : 'générée'},{' '}
                      {formatDateTime(r.createdAt)}) : {r.proposedAction}
                      {r.note && <span className="muted"> — {r.note}</span>}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
