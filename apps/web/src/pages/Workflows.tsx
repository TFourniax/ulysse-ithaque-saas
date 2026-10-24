import { useResearchPolicy } from './Research.tsx';
import type { WorkflowBriefDto, WorkflowRunDto, WorkspaceSourceDto } from '@ulysse/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { Banner, ErrorBanner, Loading, PageHeader } from '../components/ui.tsx';
import { formatDateTime } from '../format.ts';
import { can, useSession } from '../session.tsx';
import { MODE_LABELS } from './Analyses.tsx';

export const SOURCE_LABELS: Record<WorkspaceSourceDto['kind'], string> = {
  website: 'Site et communication',
  offer: 'Offre et preuves',
  competitor: 'Alternative du marché',
  content: 'Contenu déjà produit',
  consumer_query: 'Demande consommateur observée',
  buyer_hypothesis: 'Question acheteur simulée',
};
const PHASES: Record<WorkflowBriefDto['phase'], string> = {
  unknown: 'À préciser',
  exploration: 'Exploration du besoin',
  comparison: 'Comparaison des solutions',
  decision: 'Décision',
  adoption: 'Adoption et usage',
};
const STATES: Record<WorkflowRunDto['status'], string> = {
  queued: 'En attente',
  running: 'Analyse en cours',
  draft: 'Brouillon à relire',
  needs_context: 'Précisions nécessaires',
  abstained: 'Analyse non produite',
  approved: 'Validé',
  rejected: 'Écarté',
  obsolete: 'À actualiser',
  failed: 'Analyse interrompue',
};
const WORKFLOW_ERRORS: Record<string, string> = {
  context_limit:
    'Le volume d’informations dépasse la capacité de cette analyse. Les sources collectées sont conservées. Reprenez le brief avec un périmètre plus ciblé.',
  provider_retry_wait:
    'Le fournisseur demande une pause. Ulysse attend puis reprend automatiquement l’appel en cours.',
  budget_reached:
    'L’enveloppe nécessaire à cette analyse n’a pas pu être réservée. Les dépenses et réservations de la session et du mois sont conservées. Les données de recherche restent disponibles.',
  engine_unavailable: 'Activez le moteur d’analyse pour produire ce résultat.',
  STALE_EVIDENCE: 'Actualisez les sources sélectionnées avant de relancer.',
  versions_changed: 'Le contexte ou les sources ont changé pendant l’analyse.',
  provider_region_plan_required:
    'Le compte du fournisseur ne permet pas l’accès européen. Vérifiez le forfait de l’organisation associée à la clé.',
  provider_http_401: 'Le fournisseur refuse la clé API. Vérifiez la clé configurée.',
  provider_http_402: 'Le fournisseur signale des crédits insuffisants.',
  provider_http_403:
    'Le fournisseur refuse cet appel. Vérifiez les autorisations et restrictions du compte.',
  provider_http_429: 'Le fournisseur limite actuellement les appels.',
  provider_http_503: 'Aucun fournisseur disponible ne satisfait les contraintes de cet appel.',
  provider_timeout: 'Le fournisseur n’a pas répondu dans le délai prévu.',
  provider_transport_error: 'La connexion au fournisseur a échoué.',
  provider_invalid_response: 'Le fournisseur a renvoyé une réponse illisible.',
  provider_response_too_large:
    'La réponse du fournisseur dépasse la taille acceptée. Les données collectées sont conservées.',
  provider_response_error: 'Le fournisseur a signalé une erreur pendant la génération.',
  hermes_http_504: 'Le délai maximal de l’analyse a été atteint.',
  hermes_timeout: 'Le moteur d’analyse n’a pas répondu dans le délai prévu.',
  hermes_http_422: 'Le moteur d’analyse n’a pas pu retourner une réponse exploitable.',
  result_invalid: 'La réponse produite ne respecte pas le format attendu.',
  result_schema_invalid: 'Les champs de la réponse ne respectent pas le format attendu.',
  result_evidence_invalid:
    'La relecture n’a pas pu produire un diagnostic avec des références valides. Les sources collectées sont conservées.',
  comparison_evidence_missing: 'Une comparaison ne cite pas les deux offres nécessaires.',
  benchmark_missing:
    'La comparaison demandée n’a pas été produite malgré les fiches disponibles. Vos sources sont conservées ; vous pouvez reprendre ce brief.',
  brief_incomplete:
    'Le brief ne contient pas encore les informations nécessaires. Reprenez-le pour le compléter.',
  publication_refused:
    'Le résultat n’a pas satisfait le contrôle final. Vos sources et votre brief sont conservés.',
  result_json_invalid: 'Le modèle n’a pas fourni un résultat JSON lisible.',
  result_truncated: 'La réponse du modèle est incomplète. Aucun diagnostic n’a été publié.',
  result_too_large: 'La réponse du modèle dépasse la taille autorisée.',
  result_kind_invalid: 'Le modèle a répondu pour un autre parcours.',
  result_semantics_invalid: 'Le résultat structuré est incohérent avec les règles du diagnostic.',
  result_refused: 'Le fournisseur n’a pas terminé normalement la réponse.',
  required_source_unread: 'L’analyse n’a pas consulté toutes les sources requises.',
  unretrieved_citation: 'L’analyse cite une référence qu’elle n’a pas consultée.',
  offer_evidence_missing: 'L’analyse ne cite pas de source décrivant l’offre.',
  competitor_evidence_missing: 'Le benchmark ne cite pas les preuves concurrentes requises.',
  uniqueness_without_benchmark: 'Le verdict d’unicité n’est pas étayé par un benchmark sourcé.',
};
const EMPTY: WorkflowBriefDto = {
  offer: '',
  target: '',
  phase: 'unknown',
  objective: '',
  channel: '',
  constraints: '',
  buyerRunId: null,
};
export function useWorkspace() {
  const session = useSession();
  return useQuery({
    queryKey: ['workspace', session.activeTenant.id],
    queryFn: () => api<WorkspaceSourceDto[]>('/v1/workspace/sources'),
  });
}
export function useWorkflows() {
  const session = useSession();
  return useQuery({
    queryKey: ['workflows', session.activeTenant.id],
    queryFn: () => api<WorkflowRunDto[]>('/v1/workflows'),
    refetchInterval: 2000,
  });
}
function References({
  refs,
  sources,
  researchId,
}: {
  refs: readonly string[];
  sources: WorkspaceSourceDto[];
  researchId?: string | null;
}) {
  return (
    <ul className="workflow-refs">
      {refs.map((ref) => {
        const source = sources.find((s) => ref === `source:${s.id}:r${s.revision}`);
        return (
          <li key={ref}>
            {source ? (
              <Link to={`/workspace#source-${source.id}`}>
                {source.title} · v{source.revision}
              </Link>
            ) : researchId && /^source:[a-f0-9-]+:r[0-9]+$/u.test(ref) ? (
              <Link to={`/research?campaign=${researchId}&candidate=${ref.split(':')[1] ?? ''}`}>
                Source de la comparaison
              </Link>
            ) : (
              <span>
                {/^context:v\d+$/u.test(ref)
                  ? `Contexte de votre entreprise · version ${ref.slice(9)}`
                  : /^workflow:[a-f0-9-]+$/u.test(ref)
                    ? 'Votre demande pour cette analyse'
                    : /^doctrine:[a-f0-9-]+:v\d+$/u.test(ref)
                      ? 'Méthode commerciale de référence'
                      : /^buyer:[a-f0-9-]+$/u.test(ref)
                        ? 'Diagnostic acheteur associé'
                        : 'Référence complémentaire'}
                <details>
                  <summary>Détail de la référence</summary>
                  <code>{ref}</code>
                </details>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
function ResultCard({
  run,
  sources,
  onResume,
}: {
  run: WorkflowRunDto;
  sources: WorkspaceSourceDto[];
  onResume: (r: WorkflowRunDto) => void;
}) {
  const session = useSession();
  const client = useQueryClient();
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api(`/v1/workflows/${run.id}/review`, {
        method: 'POST',
        body: { revision: run.revision, decision },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workflows', session.activeTenant.id] }),
  });
  const r = run.result;
  const coverage = r?.limits.find(
    (limit) =>
      limit.startsWith('Périmètre de la comparaison :') ||
      limit.startsWith('Couverture de cette synthèse :'),
  );
  return (
    <article className="section workflow-result" id={run.id}>
      <div className="workflow-result-head">
        <h2>
          {r?.content?.title ??
            (run.kind === 'buyer' ? 'Diagnostic acheteur' : 'Contenu contextualisé')}
        </h2>
        <span className="badge">{STATES[run.status]}</span>
      </div>
      <p className="small muted">
        {formatDateTime(run.createdAt)} · {MODE_LABELS[run.mode]}
      </p>
      <p>
        <strong>{run.brief.target || 'Cible à préciser'}</strong> · {PHASES[run.brief.phase]} ·{' '}
        {run.brief.objective || 'Objectif à préciser'}
      </p>
      {run.researchId && (
        <Banner kind="info">
          {run.status === 'queued'
            ? 'Ulysse prépare les informations du marché avant ce diagnostic.'
            : 'Le diagnostic utilise une recherche de marché. Vérifiez les sources citées avant d’approuver le brouillon ; une modification des informations comparées demandera une nouvelle analyse.'}{' '}
          <Link to={`/research?campaign=${run.researchId}`}>
            Voir les entreprises et les sources
          </Link>
        </Banner>
      )}
      {run.stale && (
        <Banner kind="warning">
          Des sources, le contexte ou la doctrine ont changé ou sont trop anciens. Relancez
          l’analyse avant de l’utiliser.
        </Banner>
      )}
      {run.errorCode && (
        <Banner kind={run.errorCode === 'provider_retry_wait' ? 'info' : 'warning'}>
          {WORKFLOW_ERRORS[run.errorCode] ?? 'Analyse non disponible.'}
          {run.errorCode !== 'provider_retry_wait' && (
            <details>
              <summary>Détail pour l’assistance</summary>
              <code>{run.errorCode}</code>
            </details>
          )}
        </Banner>
      )}
      {r && (
        <>
          <p className="lead">{r.summary}</p>
          {r.questions.length > 0 && (
            <div className="workflow-questions">
              <h3>{run.kind === 'buyer' ? 'À clarifier avant de décider' : 'Pour avancer'}</h3>
              <ul>
                {r.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {r.findings.map((f, i) => (
            <section key={`${f.topic}-${i}`}>
              <h3>{f.topic}</h3>
              <p>{f.analysis}</p>
              <References refs={f.references} sources={sources} researchId={run.researchId} />
            </section>
          ))}
          {r.benchmark.length > 0 && (
            <>
              <h3>Comparaison des offres</h3>
              {coverage && (
                <section aria-label="Périmètre de la comparaison">
                  <h4>Sur quelles informations repose cette comparaison ?</h4>
                  <p>{coverage}</p>
                </section>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Alternative</th>
                      <th>Comparaison et preuves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.benchmark.map((f, i) => (
                      <tr key={`${f.topic}-${i}`}>
                        <td>{f.topic}</td>
                        <td>
                          {f.analysis}
                          <References
                            refs={f.references}
                            sources={sources}
                            researchId={run.researchId}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {r.uniqueness && (
            <section className="workflow-verdict">
              <h3>Ce qui distingue votre offre</h3>
              <strong>
                {
                  {
                    plausible: 'Différence plausible dans les sources consultées',
                    not_differentiated: 'Différence non démontrée face aux alternatives',
                    insufficient_evidence: 'Preuves insuffisantes pour conclure',
                  }[r.uniqueness.verdict]
                }
              </strong>
              <p>{r.uniqueness.reason}</p>
              <References
                refs={r.uniqueness.references}
                sources={sources}
                researchId={run.researchId}
              />
            </section>
          )}
          {r.buyerQuestions.length > 0 && (
            <>
              <h3>Questions d’achat simulées</h3>
              <p className="small muted">
                Hypothèses à tester ; elles ne représentent pas une demande consommateur mesurée.
              </p>
              <ul>
                {r.buyerQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          )}
          {r.content && (
            <>
              <div className="workflow-copy">{r.content.body}</div>
              <p>
                <strong>Prochaine étape proposée au lecteur :</strong> {r.content.callToAction}
              </p>
              <h3>Pourquoi ce contenu</h3>
              <p>{r.content.rationale}</p>
              <References
                refs={r.content.references}
                sources={sources}
                researchId={run.researchId}
              />
            </>
          )}
          {r.limits.length > 0 && (
            <section className="workflow-limits">
              <h3>Limites et points à vérifier</h3>
              <ul>
                {r.limits
                  .filter((l) => !r.benchmark.length || l !== coverage)
                  .map((l) => (
                    <li key={l}>{l}</li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
      <div className="workflow-actions">
        {can(session, 'recommendation:revise') && (
          <button type="button" className="button button-secondary" onClick={() => onResume(run)}>
            {run.status === 'needs_context' ? 'Compléter le brief' : 'Reprendre ce brief'}
          </button>
        )}
        {run.kind === 'buyer' &&
          r?.outcome === 'draft' &&
          !run.stale &&
          (run.status === 'draft' || run.status === 'approved') && (
            <Link className="button button-secondary" to={`/content?buyer=${run.id}`}>
              Créer un contenu à partir du diagnostic
            </Link>
          )}
        {run.status === 'draft' && can(session, 'recommendation:decide') && (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={run.stale || run.mode !== 'hermes-live' || review.isPending}
              onClick={() => review.mutate('approve')}
            >
              Valider le brouillon
            </button>
            <button
              type="button"
              className="button button-ghost"
              disabled={review.isPending}
              onClick={() => review.mutate('reject')}
            >
              Écarter
            </button>
          </>
        )}
      </div>
      {review.error && <ErrorBanner error={review.error} />}
    </article>
  );
}
function WorkflowForm({
  kind,
  sources,
  buyer,
  runs,
  initialResearchId,
}: {
  kind: 'buyer' | 'content';
  sources: WorkspaceSourceDto[];
  buyer: WorkflowRunDto | undefined;
  runs: WorkflowRunDto[];
  initialResearchId: string | undefined;
}) {
  const session = useSession();
  const client = useQueryClient();
  const researchPolicy = useResearchPolicy();
  const [researchId, setResearchId] = useState(initialResearchId);
  const [brief, setBrief] = useState<WorkflowBriefDto>(
    buyer
      ? { ...buyer.brief, buyerRunId: buyer.id, objective: '', channel: '', phase: 'unknown' }
      : EMPTY,
  );
  const [selected, setSelected] = useState<string[]>(
    buyer?.sourceIds.filter((id) => sources.some((s) => s.id === id)) ?? [],
  );
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/v1/workflows', {
        method: 'POST',
        body: {
          kind,
          brief,
          sourceIds: selected,
          requestKey,
          ...(kind === 'buyer' && researchId ? { researchId } : {}),
        },
      }),
    onSuccess: async () => {
      setRequestKey(crypto.randomUUID());
      await client.invalidateQueries({ queryKey: ['workflows', session.activeTenant.id] });
    },
  });
  const change = (key: keyof Omit<WorkflowBriefDto, 'buyerRunId'>, value: string) => {
    setBrief((b) => ({ ...b, [key]: value }));
    setRequestKey(crypto.randomUUID());
  };
  const resume = (r: WorkflowRunDto) => {
    setResearchId(r.researchId ?? undefined);
    setBrief(r.brief);
    setSelected(r.sourceIds.filter((id) => sources.some((s) => s.id === id)));
    setRequestKey(crypto.randomUUID());
    document.getElementById('workflow-brief')?.scrollIntoView({ behavior: 'smooth' });
  };
  return (
    <>
      {can(session, 'recommendation:revise') && (
        <form
          className="section workflow-form"
          id="workflow-brief"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>{kind === 'buyer' ? 'Cadrer le regard de l’acheteur' : 'Cadrer le contenu'}</h2>
          {kind === 'buyer' && (
            <Banner kind="info">
              {researchId
                ? 'Ce diagnostic utilise les résultats conservés de la campagne sélectionnée. Si la collecte est en cours, interrompez-la pour analyser les résultats déjà disponibles.'
                : researchPolicy.data?.profile.enabled
                  ? 'La recherche publique est activée : Ulysse collecte les informations de marché nécessaires avant le diagnostic.'
                  : 'Activez la recherche publique pour qu’Ulysse trouve et documente les concurrents.'}{' '}
              <Link to={researchId ? `/research?campaign=${researchId}` : '/research'}>
                Recherche et benchmark
              </Link>
            </Banner>
          )}
          <p>
            Les champs inconnus peuvent rester vides : Ulis précisera ce dont il a besoin pour
            avancer.
          </p>
          {brief.buyerRunId && (
            <Banner kind="info">
              Ce brief réutilise un diagnostic synthétique. Ses hypothèses restent à vérifier auprès
              de clients réels.
            </Banner>
          )}
          <div className="workflow-fields">
            <label>
              Offre à examiner
              <textarea
                value={brief.offer}
                maxLength={2000}
                onChange={(e) => change('offer', e.target.value)}
                rows={3}
              />
            </label>
            <label>
              Cible et situation d’achat
              <textarea
                value={brief.target}
                maxLength={1500}
                onChange={(e) => change('target', e.target.value)}
                rows={3}
              />
            </label>
            <label>
              Phase de décision
              <select
                value={brief.phase}
                onChange={(e) => {
                  const p = Object.keys(PHASES).find((p) => p === e.target.value);
                  if (p) change('phase', p);
                }}
              >
                {Object.entries(PHASES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {kind === 'content' ? 'Canal et format' : 'Canal de communication à examiner'}
              <input
                value={brief.channel}
                maxLength={200}
                onChange={(e) => change('channel', e.target.value)}
              />
            </label>
          </div>
          <label>
            Progression attendue du client
            <textarea
              value={brief.objective}
              maxLength={1500}
              onChange={(e) => change('objective', e.target.value)}
              placeholder="Que doit comprendre, dire ou faire la personne ?"
              rows={2}
            />
          </label>
          <label>
            Contexte, ton et contraintes
            <textarea
              value={brief.constraints}
              maxLength={2000}
              onChange={(e) => change('constraints', e.target.value)}
              rows={2}
            />
          </label>
          <fieldset>
            <legend>Sources à confronter — {selected.length}/8</legend>
            {sources.length === 0 && (
              <p>
                Ajoutez d’abord les pages, offres et documents utiles dans{' '}
                <Link to="/workspace">Sources métier</Link>.
              </p>
            )}
            {sources.map((s) => (
              <label className="workflow-source-choice" key={s.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  disabled={!selected.includes(s.id) && selected.length >= 8}
                  onChange={(e) => {
                    setSelected((v) =>
                      e.target.checked ? [...v, s.id] : v.filter((id) => id !== s.id),
                    );
                    setRequestKey(crypto.randomUUID());
                  }}
                />
                <span>
                  {s.title}
                  <small>
                    {SOURCE_LABELS[s.kind]} · {formatDateTime(s.observedAt)}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="workflow-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={create.isPending || selected.length === 0}
            >
              {create.isPending
                ? 'Mise en file…'
                : kind === 'buyer'
                  ? 'Lancer le client synthétique'
                  : 'Préparer le contenu'}
            </button>
            <Link to="/workspace">Gérer les sources</Link>
            <Link to="/admin">Contexte et doctrine</Link>
          </div>
          {create.isSuccess && (
            <Banner kind="success">Demande enregistrée. Le résultat apparaîtra ci-dessous.</Banner>
          )}
          {create.error && <ErrorBanner error={create.error} />}
        </form>
      )}
      <div aria-live="polite">
        {runs
          .filter((r) => r.kind === kind)
          .map((r) => (
            <ResultCard key={r.id} run={r} sources={sources} onResume={resume} />
          ))}
      </div>
    </>
  );
}
export function WorkflowsPage({ kind }: { kind: 'buyer' | 'content' }) {
  const sources = useWorkspace();
  const runs = useWorkflows();
  const [params] = useSearchParams();
  const buyerId = params.get('buyer');
  if (sources.isPending || runs.isPending) return <Loading />;
  if (sources.error) return <ErrorBanner error={sources.error} />;
  if (runs.error) return <ErrorBanner error={runs.error} />;
  const buyer = runs.data.find(
    (r) =>
      r.id === buyerId &&
      r.kind === 'buyer' &&
      !r.stale &&
      (r.status === 'draft' || r.status === 'approved'),
  );
  return (
    <>
      <PageHeader title={kind === 'buyer' ? 'Client synthétique' : 'Contenus contextualisés'}>
        <p>
          {kind === 'buyer'
            ? 'Comprendre l’offre comme un acheteur, confronter ses promesses au marché et tester ce qui la distingue.'
            : 'Partir d’une cible, d’une phase et d’un objectif pour préparer un contenu utile.'}
        </p>
      </PageHeader>
      <Banner kind="info">
        {kind === 'buyer'
          ? 'Le diagnostic simule un acheteur sur les sources fournies. Il ne constitue pas une validation du marché.'
          : 'Les contenus restent des brouillons à relire et à valider. Les demandes observées et les questions simulées conservent leur origine.'}
      </Banner>
      {buyerId && !buyer && (
        <Banner kind="warning">
          Le diagnostic choisi est indisponible ou périmé. Actualisez-le avant de le réutiliser.
        </Banner>
      )}
      <WorkflowForm
        key={`${kind}-${buyer?.id ?? ''}-${params.get('research') ?? ''}`}
        kind={kind}
        sources={sources.data}
        runs={runs.data}
        buyer={buyer}
        initialResearchId={params.get('research') ?? undefined}
      />
    </>
  );
}
export function WorkspacePage() {
  const session = useSession();
  const sources = useWorkspace();
  const client = useQueryClient();
  const [kind, setKind] = useState<WorkspaceSourceDto['kind']>('website');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const save = useMutation({
    mutationFn: () =>
      api('/v1/workspace/sources', {
        method: 'POST',
        body: {
          kind,
          title,
          url: url || null,
          text,
          observedAt: new Date(`${date}:00Z`).toISOString(),
          origin:
            kind === 'consumer_query'
              ? 'observed'
              : kind === 'buyer_hypothesis'
                ? 'simulated'
                : 'company',
        },
      }),
    onSuccess: async () => {
      setTitle('');
      setUrl('');
      setText('');
      await client.invalidateQueries({ queryKey: ['workspace', session.activeTenant.id] });
    },
  });
  const withdraw = useMutation({
    mutationFn: (s: WorkspaceSourceDto) =>
      api(`/v1/workspace/sources/${s.id}`, { method: 'DELETE', body: { revision: s.revision } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['workspace', session.activeTenant.id] });
      await client.invalidateQueries({ queryKey: ['workflows', session.activeTenant.id] });
    },
  });
  return (
    <>
      <PageHeader title="Sources métier">
        <p>
          Le corpus commun au client synthétique et aux contenus : votre offre, vos communications,
          les alternatives et les questions de vos clients.
        </p>
      </PageHeader>
      <div className="workflow-paths">
        <Link to="/buyer">
          <strong>01 · Client synthétique</strong>
          <span>Compréhension, benchmark, unicité</span>
        </Link>
        <Link to="/content">
          <strong>02 · Contenus</strong>
          <span>Cible, phase et progression attendue</span>
        </Link>
        <Link to="/opportunities">
          <strong>03 · Prochaine interaction</strong>
          <span>La prochaine action utile par affaire</span>
        </Link>
      </div>
      <Banner kind="info">
        Ajoutez les extraits utiles et leur provenance. L’URL documente la source ; son contenu
        n’est pas récupéré automatiquement. Une demande consommateur observée doit venir d’une trace
        réelle, datée et attribuable.
      </Banner>
      {can(session, 'context:manage') && (
        <form
          className="section workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2>Ajouter une source</h2>
          <div className="workflow-fields">
            <label>
              Nature
              <select
                value={kind}
                onChange={(e) => {
                  const found = Object.keys(SOURCE_LABELS).find((k) => k === e.target.value) as
                    WorkspaceSourceDto['kind'] | undefined;
                  if (found) setKind(found);
                }}
              >
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Titre
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              URL d’origine (facultative)
              <input
                type="url"
                pattern="https://.*"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Date d’observation (UTC)
              <input
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label>
            Extrait, faits et provenance
            <textarea
              required
              maxLength={6000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
            />
          </label>
          <p className="small muted">
            Importez uniquement des contenus que votre entreprise peut utiliser. Ne transformez pas
            une hypothèse en observation.
          </p>
          <button className="button button-primary" type="submit" disabled={save.isPending}>
            Ajouter au corpus
          </button>
          {save.error && <ErrorBanner error={save.error} />}
        </form>
      )}
      {sources.isPending && <Loading />}
      {sources.error && <ErrorBanner error={sources.error} />}{' '}
      {withdraw.error && <ErrorBanner error={withdraw.error} />}
      {sources.data?.length === 0 && (
        <section className="section">
          <h2>Le corpus est prêt à être constitué</h2>
          <p>Aucune donnée d’entreprise n’a été préchargée dans cet espace.</p>
        </section>
      )}
      {sources.data?.map((s) => (
        <article className="section" id={`source-${s.id}`} key={s.id}>
          <h2>{s.title}</h2>
          <p className="small muted">
            {SOURCE_LABELS[s.kind]} · v{s.revision} · observé le {formatDateTime(s.observedAt)} ·{' '}
            {s.origin === 'simulated'
              ? 'simulé'
              : s.origin === 'observed'
                ? 'observation déclarée'
                : 'fourni par l’entreprise'}
          </p>
          {s.url && (
            <p>
              <a href={s.url} target="_blank" rel="noreferrer">
                Ouvrir la source
              </a>
            </p>
          )}
          <details>
            <summary>Lire l’extrait</summary>
            <p className="workflow-copy">{s.text}</p>
          </details>
          {can(session, 'context:manage') && (
            <details>
              <summary>Retirer cette source</summary>
              <p>
                Son extrait et les résultats des deux parcours seront retirés. Il faudra relancer
                les analyses avec le corpus actualisé.
              </p>
              <button
                type="button"
                className="button button-ghost"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate(s)}
              >
                Confirmer le retrait
              </button>
            </details>
          )}
        </article>
      ))}
    </>
  );
}
