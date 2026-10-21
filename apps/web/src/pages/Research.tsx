import type {
  ResearchCampaignDto,
  ResearchCandidateDto,
  ResearchPolicyDto,
  ResearchProfileDto,
} from '@ulysse/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, useCompanyContext } from '../api.ts';
import { Banner, ErrorBanner, Loading, PageHeader } from '../components/ui.tsx';
import { formatDateTime } from '../format.ts';
import { can, useSession } from '../session.tsx';

const STATUS: Record<string, string> = {
  queued: 'Planifiée',
  running: 'Recherche en cours',
  paused: 'Collecte partielle',
  completed: 'Collecte terminée',
  cancelled: 'Interrompue',
  failed: 'Échec',
};
const RELEVANCE: Record<string, string> = {
  unqualified: 'À qualifier',
  direct: 'Concurrent direct',
  indirect: 'Concurrent indirect',
  substitute: 'Substitution',
  irrelevant: 'Hors périmètre',
  directory: 'Piste de découverte',
};
const REVIEW: Record<string, string> = {
  pending: 'À relire',
  approved: 'Validé',
  excluded: 'Écarté',
};
const REASONS: Record<string, string> = {
  provider_retry_scheduled:
    'Le fournisseur du modèle limite temporairement les appels. La collecte attend avant de réessayer automatiquement, au maximum deux fois pour cette étape.',
  provider_http_429:
    'Le fournisseur du modèle limite les appels. La collecte est en pause; les résultats et le budget restant sont conservés.',
  provider_http_503:
    'Le fournisseur du modèle est temporairement indisponible. Les résultats déjà collectés sont conservés.',
  research_response_truncated:
    'La réponse du modèle est incomplète. Aucun fait de cette réponse n’a été ajouté.',
  research_json_invalid: 'La réponse du modèle n’a pas pu être décodée.',
  research_schema_invalid: 'La réponse du modèle ne respecte pas le format attendu.',
  research_tool_response_invalid: 'Le modèle n’a pas fourni le résultat structuré attendu.',
  research_evidence_unusable:
    'Les références proposées par le modèle ne correspondent à aucun passage fourni.',
  research_quote_unmatched: 'Une citation ne correspond pas au texte collecté.',
  research_link_unobserved: 'Un lien proposé ne figure pas dans la page collectée.',
  research_publication_failed: 'Les informations extraites n’ont pas pu être enregistrées.',
  research_provider_unavailable:
    'Le fournisseur de recherche ou le modèle n’est pas encore configuré sur le serveur.',
  budget_reached:
    'Le plafond de la campagne, de la session ou du mois est atteint. Les dépenses déjà engagées sont conservées à la reprise.',
  collection_limit:
    'La limite de requêtes ou de pages de cette collecte est atteinte. Vous pouvez poursuivre avec une enveloppe plus grande.',
  steps_failed:
    'Certaines pages ou extractions n’ont pas pu être exploitées. Les résultats disponibles restent consultables; vous pouvez reprendre les étapes en échec.',
  coverage_reached:
    'Les pistes planifiées ont été parcourues. Cette couverture ne garantit pas l’exhaustivité du marché.',
  context_changed: 'Le contexte a changé. Lancez une nouvelle recherche pour ce contexte.',
  policy_changed: 'Le profil public ou son autorisation a changé.',
  user_cancelled: 'Recherche interrompue à votre demande.',
};
const DIMENSIONS = [
  ['offer', 'Offre'],
  ['target', 'Cible'],
  ['price', 'Prix et conditions'],
  ['delivery', 'Mise en œuvre'],
  ['integrations', 'Intégrations'],
  ['proof', 'Preuves annoncées'],
  ['support', 'Suivi'],
  ['limits', 'Limites'],
] as const;
type Detail = {
  campaign: ResearchCampaignDto;
  candidates: ResearchCandidateDto[];
  total: number;
  tasks: {
    id: string;
    body: Record<string, unknown>;
    status: string;
    attempt: number;
    summary: Record<string, unknown>;
    error_code: string | null;
  }[];
};
export function useResearchPolicy() {
  const session = useSession();
  return useQuery({
    queryKey: ['research-policy', session.activeTenant.id],
    queryFn: () => api<ResearchPolicyDto>('/v1/research/policy'),
  });
}
function ProfileForm({
  policy,
  initial,
}: {
  policy: ResearchPolicyDto;
  initial: ResearchProfileDto;
}) {
  const session = useSession();
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const [profile, setProfile] = useState(policy?.profile ?? initial);
  const [offers, setOffers] = useState(profile.offers.join('\n'));
  const [keywords, setKeywords] = useState(profile.keywords.join('\n'));
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      await api('/v1/research/policy', {
        method: 'PUT',
        body: {
          revision: policy?.revision ?? null,
          profile: {
            ...profile,
            enabled,
            offers: offers
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            keywords: keywords
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          },
        },
      });
      if (enabled) {
        const r = await api<{ id: string | null }>('/v1/research', {
          method: 'POST',
          body: { requestKey: crypto.randomUUID() },
        });
        if (r.id) setParams({ campaign: r.id });
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['research-policy', session.activeTenant.id] });
      await client.invalidateQueries({ queryKey: ['research', session.activeTenant.id] });
    },
  });
  const field = (
    key: 'companyName' | 'website' | 'target' | 'market' | 'geography',
    value: string,
  ) => setProfile((p) => ({ ...p, [key]: value }));
  if (!can(session, 'context:manage'))
    return <p>Le responsable de l’entreprise peut autoriser la recherche publique.</p>;
  return (
    <details className="section" open={!policy}>
      <summary>
        Profil public et autorisation de recherche {policy?.profile.enabled ? '· activée' : ''}
      </summary>
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(true);
        }}
      >
        <p>
          Ces informations seront utilisées dans les recherches web. Vérifiez qu’elles sont
          publiques. Ulysse prépare les concurrents et leurs offres pour votre revue; les notes CRM
          et le brief privé ne sont pas envoyés au moteur de recherche.
        </p>
        <div className="workflow-fields">
          <label>
            Nom public
            <input
              required
              maxLength={150}
              value={profile.companyName}
              onChange={(e) => field('companyName', e.target.value)}
            />
          </label>
          <label>
            Site officiel
            <input
              required
              type="url"
              placeholder="https://votre-entreprise.fr"
              value={profile.website}
              onChange={(e) => field('website', e.target.value)}
            />
          </label>
          <label>
            Offres publiques · une par ligne
            <textarea
              required
              rows={3}
              value={offers}
              onChange={(e) => setOffers(e.target.value)}
            />
          </label>
          <label>
            Mots-clés et synonymes · facultatifs
            <textarea rows={3} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </label>
          <label>
            Acheteurs visés
            <input
              required
              maxLength={200}
              value={profile.target}
              onChange={(e) => field('target', e.target.value)}
            />
          </label>
          <label>
            Marché ou secteur
            <input
              required
              maxLength={200}
              value={profile.market}
              onChange={(e) => field('market', e.target.value)}
            />
          </label>
          <label>
            Zone géographique
            <input
              maxLength={150}
              value={profile.geography}
              onChange={(e) => field('geography', e.target.value)}
            />
          </label>
        </div>
        <details>
          <summary>Enveloppe de collecte</summary>
          <div className="workflow-fields">
            <label>
              Plafond par campagne · USD
              <input
                type="number"
                min="0.05"
                max="2"
                step="0.05"
                value={profile.budgetUsd}
                onChange={(e) => setProfile({ ...profile, budgetUsd: Number(e.target.value) })}
              />
            </label>
            <label>
              Requêtes maximum
              <input
                type="number"
                min="6"
                max="100"
                value={profile.maxSearches}
                onChange={(e) => setProfile({ ...profile, maxSearches: Number(e.target.value) })}
              />
            </label>
            <label>
              Pages maximum
              <input
                type="number"
                min="12"
                max="500"
                value={profile.maxPages}
                onChange={(e) => setProfile({ ...profile, maxPages: Number(e.target.value) })}
              />
            </label>
            <label>
              Actualité des sources · jours
              <input
                type="number"
                min="1"
                max="90"
                value={profile.maxAgeDays}
                onChange={(e) => setProfile({ ...profile, maxAgeDays: Number(e.target.value) })}
              />
            </label>
          </div>
        </details>
        <p className="small muted">
          L’autorisation permet aussi la recherche automatique avant un diagnostic acheteur si les
          informations disponibles sont absentes, anciennes ou liées à un contexte différent. Vous
          pouvez l’arrêter ici.
        </p>
        <div className="workflow-actions">
          <button className="button button-primary" disabled={save.isPending} type="submit">
            Autoriser et lancer la recherche
          </button>
          {policy?.profile.enabled && (
            <button
              className="button button-secondary"
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate(false)}
            >
              Arrêter les recherches automatiques
            </button>
          )}
        </div>
        {save.error && <ErrorBanner error={save.error} />}
      </form>
    </details>
  );
}
function PageEvidence({ id }: { id: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const page = useQuery({
    queryKey: ['research-page', session.activeTenant.id, id],
    enabled: open,
    queryFn: () =>
      api<{ text: string; hash: string; truncated: boolean }>(`/v1/research/pages/${id}`),
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Texte collecté</summary>
      {page.isFetching && <Loading />}
      {page.error && <ErrorBanner error={page.error} />}
      <p className="research-page-text">{page.data?.text}</p>
      {page.data?.truncated && <p>Extrait limité à 24 000 caractères.</p>}
    </details>
  );
}
function CandidateReview({
  candidate,
  onChanged,
}: {
  candidate: ResearchCandidateDto;
  onChanged: () => Promise<void>;
}) {
  const session = useSession();
  const [note, setNote] = useState(candidate.note);
  const [fact, setFact] = useState('');
  const [value, setValue] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'excluded' | 'pending') =>
      api(`/v1/research/candidates/${candidate.id}/review`, {
        method: 'POST',
        body: {
          revision: candidate.revision,
          decision,
          note,
          corrections:
            fact && value
              ? [...candidate.corrections.filter((c) => c.factId !== fact), { factId: fact, value }]
              : candidate.corrections,
        },
      }),
    onSuccess: onChanged,
  });
  if (!can(session, 'recommendation:decide')) return null;
  return (
    <details>
      <summary>Décider ou corriger</summary>
      <label>
        Note de revue
        <textarea
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </label>
      <label>
        Fait à corriger
        <select value={fact} onChange={(e) => setFact(e.target.value)}>
          <option value="">Aucune correction</option>
          {candidate.facts.map((f) => (
            <option value={f.id} key={f.id}>
              {f.offer} · {f.value.slice(0, 70)}
            </option>
          ))}
        </select>
      </label>
      {fact && (
        <label>
          Correction humaine
          <input value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      <div className="workflow-actions">
        <button
          type="button"
          className="button button-primary button-sm"
          disabled={
            review.isPending ||
            !candidate.facts.length ||
            ['irrelevant', 'directory', 'unqualified'].includes(candidate.relevance)
          }
          onClick={() => review.mutate('approved')}
        >
          Valider
        </button>
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={review.isPending}
          onClick={() => review.mutate('excluded')}
        >
          Écarter
        </button>
        <button
          type="button"
          className="button button-ghost button-sm"
          disabled={review.isPending}
          onClick={() => review.mutate('pending')}
        >
          Garder à relire
        </button>
      </div>
      {review.error && <ErrorBanner error={review.error} />}
    </details>
  );
}
function ReviewHistory({ candidate }: { candidate: ResearchCandidateDto }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ['research-reviews', session.activeTenant.id, candidate.id, candidate.revision],
    enabled: open,
    queryFn: () =>
      api<
        {
          id: string;
          revision: number;
          created_at: string;
          decision: {
            decision: string;
            note: string;
            corrections: { factId: string; value: string }[];
          };
        }[]
      >(`/v1/research/candidates/${candidate.id}/reviews`),
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Historique des décisions</summary>
      {history.isFetching && <Loading />}
      {history.error && <ErrorBanner error={history.error} />}
      {history.data?.length === 0 && <p>Aucune décision enregistrée.</p>}
      {history.data?.map((entry) => (
        <div key={entry.id} className="research-fact">
          <p>
            {formatDateTime(entry.created_at)} · {REVIEW[entry.decision.decision]} · version{' '}
            {entry.revision}
          </p>
          {entry.decision.note && <p>{entry.decision.note}</p>}
          {entry.decision.corrections.map((c) => (
            <p key={c.factId}>Correction : {c.value}</p>
          ))}
        </div>
      ))}
      {(history.data?.length ?? 0) >= 100 && <p>100 décisions les plus récentes.</p>}
    </details>
  );
}
function CampaignView({ id, focused }: { id: string; focused?: string }) {
  const session = useSession();
  const [, setParams] = useSearchParams();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const detail = useQuery({
    queryKey: ['research', session.activeTenant.id, id, offset, query, focused],
    queryFn: () =>
      api<Detail>(
        `/v1/research/${id}?offset=${offset}&q=${encodeURIComponent(query)}${focused ? `&candidate=${encodeURIComponent(focused)}` : ''}`,
      ),
    refetchInterval: 5000,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['research', session.activeTenant.id] });
    await client.invalidateQueries({ queryKey: ['workflows', session.activeTenant.id] });
  };
  const action = useMutation({
    mutationFn: async (action: 'cancel' | 'resume') => {
      if (!detail.data) return;
      const c = detail.data.campaign;
      await api(`/v1/research/${id}/action`, {
        method: 'POST',
        body: {
          action,
          revision: c.revision,
          ...(action === 'resume' &&
          ['budget_reached', 'collection_limit'].includes(c.stopReason ?? '')
            ? {
                limits: {
                  budgetUsd: Math.min(2, c.profile.budgetUsd + 0.25),
                  maxSearches: Math.min(100, c.profile.maxSearches + 12),
                  maxPages: Math.min(500, c.profile.maxPages + 40),
                },
              }
            : {}),
        },
      });
    },
    onSuccess: refresh,
  });
  const bulk = useMutation({
    mutationFn: async (decision: 'approved' | 'excluded') => {
      for (const c of detail.data?.candidates.filter((c) => selected.includes(c.id)) ?? [])
        await api(`/v1/research/candidates/${c.id}/review`, {
          method: 'POST',
          body: { revision: c.revision, decision, note: c.note, corrections: c.corrections },
        });
    },
    onSettled: async () => {
      setSelected([]);
      await refresh();
    },
  });
  if (detail.isPending) return <Loading label="Chargement de la recherche…" />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const { campaign: c, candidates, total, tasks } = detail.data;
  return (
    <>
      <section className="section">
        <div className="workflow-result-head">
          <h2>{c.profile.companyName} · benchmark</h2>
          <span className="badge">{STATUS[c.status]}</span>
        </div>
        <p>
          {c.candidateCount} acteurs repérés · {c.qualifiedCount} concurrents qualifiés ·{' '}
          {c.searches} requêtes tentées · {c.pages} lectures tentées
        </p>
        <p className="small muted">
          {formatDateTime(c.createdAt)} · {c.committedUsd.toFixed(4)} USD consommés ou réservés /{' '}
          {c.profile.budgetUsd.toFixed(2)} USD · {c.uncertainCalls} appels au coût encore incertain
        </p>
        {c.stopReason && (
          <Banner kind="info">
            {REASONS[c.stopReason] ?? `La collecte s’est arrêtée : ${c.stopReason}.`}
          </Banner>
        )}
        <p>
          Les propositions sont provisoires jusqu’à votre revue. Une preuve annoncée par une
          entreprise reste une déclaration. Les prix affichés conservent leurs conditions et ne sont
          pas classés automatiquement.
        </p>
        <div className="workflow-actions">
          {can(session, 'context:manage') && (
            <>
              {['queued', 'running'].includes(c.status) && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={action.isPending}
                  onClick={() => action.mutate('cancel')}
                >
                  Interrompre
                </button>
              )}
              {(c.status === 'paused' ||
                c.status === 'failed' ||
                (c.status === 'completed' && c.stopReason === 'steps_failed')) && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={action.isPending}
                  onClick={() => action.mutate('resume')}
                >
                  {['budget_reached', 'collection_limit'].includes(c.stopReason ?? '')
                    ? `Poursuivre · plafond ${Math.min(2, c.profile.budgetUsd + 0.25).toFixed(2)} USD`
                    : 'Reprendre la collecte'}
                </button>
              )}
            </>
          )}
          <Link to="/buyer" className="button button-primary">
            Préparer le diagnostic acheteur
          </Link>
        </div>
        {action.error && <ErrorBanner error={action.error} />}
      </section>
      <section className="section">
        <h2>Offres et preuves comparables</h2>
        {focused && (
          <p>
            Preuve citée dans le diagnostic.{' '}
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => setParams({ campaign: id })}
            >
              Voir tout le benchmark
            </button>
          </p>
        )}
        <label>
          Rechercher dans le corpus
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
              setSelected([]);
            }}
            placeholder="Entreprise, offre, fonctionnalité…"
          />
        </label>
        {selected.length > 0 && (
          <div className="workflow-actions">
            <span>{selected.length} acteurs sélectionnés</span>
            <button
              type="button"
              className="button button-secondary"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate('approved')}
            >
              Valider la sélection
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate('excluded')}
            >
              Écarter la sélection
            </button>
          </div>
        )}
        {bulk.error && <ErrorBanner error={bulk.error} />}
        {candidates.length === 0 ? (
          <p>
            {query || focused
              ? 'Aucune fiche ne correspond à ce filtre.'
              : 'La collecte prépare les premières fiches. Aucun concurrent n’est à importer manuellement.'}
          </p>
        ) : (
          <div className="research-table-scroll">
            <table className="research-table">
              <caption>
                Matrice provisoire · {total} fiches dans ce filtre. Une cellule vide signifie « non
                trouvé dans les pages lues ».
              </caption>
              <thead>
                <tr>
                  <th>Entreprise et pertinence</th>
                  {DIMENSIONS.map(([key, label]) => (
                    <th key={key}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id} id={`candidate-${candidate.id}`}>
                    <th scope="row">
                      {can(session, 'recommendation:decide') && (
                        <label className="small">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${candidate.name}`}
                            checked={selected.includes(candidate.id)}
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...ids, candidate.id]
                                  : ids.filter((id) => id !== candidate.id),
                              )
                            }
                          />{' '}
                          Sélectionner
                        </label>
                      )}
                      <a href={`https://${candidate.domain}/`} target="_blank" rel="noreferrer">
                        {candidate.name}
                      </a>
                      <p className="small">
                        {candidate.own ? 'Votre entreprise' : RELEVANCE[candidate.relevance]} ·{' '}
                        {REVIEW[candidate.review]}
                      </p>
                      <p className="small">{candidate.reason}</p>
                      {candidate.pages.some(
                        (p) =>
                          Date.now() - Date.parse(p.retrievedAt) > c.profile.maxAgeDays * 86400000,
                      ) && <p>Sources à actualiser</p>}
                      {candidate.note && <p>Note : {candidate.note}</p>}
                      {candidate.errors.length > 0 && (
                        <details>
                          <summary>{candidate.errors.length} pages non exploitées</summary>
                          <ul>
                            {candidate.errors.map((e, i) => (
                              <li key={`${e.url}-${i}`}>
                                <a href={e.url} target="_blank" rel="noreferrer">
                                  {new URL(e.url).pathname}
                                </a>{' '}
                                · {e.code}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <CandidateReview
                        key={candidate.revision}
                        candidate={candidate}
                        onChanged={refresh}
                      />
                      <ReviewHistory candidate={candidate} />
                    </th>
                    {DIMENSIONS.map(([dimension]) => {
                      const facts = candidate.facts.filter((f) => f.dimension === dimension);
                      return (
                        <td key={dimension}>
                          {dimension === 'price' &&
                            facts.some(
                              (f) =>
                                new Set(
                                  facts
                                    .filter((other) => other.offer === f.offer)
                                    .map((other) => other.value),
                                ).size > 1,
                            ) && (
                              <p className="small">
                                Plusieurs valeurs relevées pour une même offre : vérifier les
                                conditions et les dates.
                              </p>
                            )}
                          {facts.length ? (
                            facts.map((fact) => {
                              const page = candidate.pages.find((p) => p.id === fact.pageId);
                              const correction = candidate.corrections.find(
                                (f) => f.factId === fact.id,
                              );
                              return (
                                <div key={fact.id} className="research-fact">
                                  <strong>{fact.offer}</strong>
                                  <p>{fact.value}</p>
                                  {correction && <p>Correction humaine : {correction.value}</p>}
                                  <details>
                                    <summary>Source · déclaration</summary>
                                    <blockquote>{fact.quote}</blockquote>
                                    {page && (
                                      <>
                                        <a href={page.url} target="_blank" rel="noreferrer">
                                          {page.title || page.url}
                                        </a>
                                        <p className="small">
                                          Lu le {formatDateTime(page.retrievedAt)}
                                          {page.publishedAt
                                            ? ` · publié le ${formatDateTime(page.publishedAt)}`
                                            : ''}
                                        </p>
                                        <PageEvidence id={page.id} />
                                      </>
                                    )}
                                  </details>
                                </div>
                              );
                            })
                          ) : (
                            <span className="muted">
                              {candidate.pages.length
                                ? 'Non trouvé'
                                : 'Non accessible ou en attente'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workflow-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 25));
              setSelected([]);
            }}
          >
            Précédent
          </button>
          <span>
            {total ? offset + 1 : 0}–{Math.min(offset + 25, total)} / {total}
          </span>
          <button
            className="button button-secondary"
            type="button"
            disabled={offset + 25 >= total}
            onClick={() => {
              setOffset(offset + 25);
              setSelected([]);
            }}
          >
            Suivant
          </button>
        </div>
      </section>
      <details className="section">
        <summary>Requêtes et couverture · dernières 200 étapes</summary>
        <ul>
          {tasks
            .filter((t) => t.body.kind === 'search')
            .map((t) => (
              <li key={t.id}>
                <strong>
                  {String(
                    t.summary.query ??
                      (typeof t.body.search === 'object' &&
                      t.body.search !== null &&
                      'query' in t.body.search
                        ? t.body.search.query
                        : ''),
                  )}
                </strong>{' '}
                · {t.status}
                {typeof t.summary.newDomains === 'number'
                  ? ` · ${t.summary.newDomains} nouveaux domaines`
                  : ''}
                {t.error_code ? ` · ${REASONS[t.error_code] ?? t.error_code}` : ''}
              </li>
            ))}
        </ul>
        <p>
          {c.pendingTasks} étapes encore en attente. Le nombre d’acteurs repérés ne préjuge pas de
          leur pertinence. Les fiches hors périmètre sont conservées avec leur motif.
        </p>
      </details>
    </>
  );
}
export function ResearchPage() {
  const session = useSession();
  const policy = useResearchPolicy();
  const context = useCompanyContext(session.activeTenant.id);
  const [params, setParams] = useSearchParams();
  const campaigns = useQuery({
    queryKey: ['research', session.activeTenant.id],
    queryFn: () => api<ResearchCampaignDto[]>('/v1/research'),
    refetchInterval: 5000,
  });
  if (policy.isPending || context.isPending || campaigns.isPending) return <Loading />;
  if (policy.error || context.error || campaigns.error)
    return <ErrorBanner error={policy.error ?? context.error ?? campaigns.error} />;
  const initial: ResearchProfileDto = {
    enabled: true,
    companyName: session.activeTenant.name,
    website: '',
    offers: [...(context.data.context?.content.offers ?? [])].slice(0, 10),
    target: (context.data.context?.content.targetSegments.join(', ') ?? '').slice(0, 200),
    market: (context.data.context?.content.activity ?? '').slice(0, 200),
    geography: '',
    keywords: [],
    budgetUsd: 0.75,
    maxSearches: 24,
    maxPages: 120,
    maxAgeDays: 30,
  };
  const selected = params.get('campaign') ?? campaigns.data[0]?.id;
  return (
    <>
      <PageHeader title="Recherche et benchmark">
        <p>Ulysse explore le marché, documente les offres et prépare les informations à valider.</p>
      </PageHeader>
      <ProfileForm key={policy.data?.revision ?? 0} policy={policy.data} initial={initial} />
      {campaigns.data.length > 0 && (
        <label>
          Campagne
          <select value={selected} onChange={(e) => setParams({ campaign: e.target.value })}>
            {campaigns.data.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDateTime(c.createdAt)} · {STATUS[c.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <CampaignView
          key={`${selected}:${params.get('candidate') ?? ''}`}
          id={selected}
          focused={params.get('candidate') ?? undefined}
        />
      )}
    </>
  );
}
