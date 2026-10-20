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
function References({ refs, sources }: { refs: readonly string[]; sources: WorkspaceSourceDto[] }) {
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
            ) : (
              <code>{ref}</code>
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
      {run.stale && (
        <Banner kind="warning">
          Des sources, le contexte ou la doctrine ont changé ou sont trop anciens. Relancez
          l’analyse avant de l’utiliser.
        </Banner>
      )}
      {run.errorCode && (
        <Banner kind="warning">
          {run.errorCode === 'engine_unavailable'
            ? 'Activez le moteur d’analyse pour produire ce résultat.'
            : run.errorCode === 'STALE_EVIDENCE'
              ? 'Actualisez les sources sélectionnées avant de relancer.'
              : `Analyse non disponible (${run.errorCode}).`}
        </Banner>
      )}
      {r && (
        <>
          <p className="lead">{r.summary}</p>
          {r.questions.length > 0 && (
            <div className="workflow-questions">
              <h3>Pour avancer</h3>
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
              <References refs={f.references} sources={sources} />
            </section>
          ))}
          {r.benchmark.length > 0 && (
            <>
              <h3>Benchmark du corpus</h3>
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
                          <References refs={f.references} sources={sources} />
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
              <h3>Crash test de l’unicité</h3>
              <strong>
                {
                  {
                    plausible: 'Différence plausible dans ce corpus',
                    not_differentiated: 'Différence non démontrée face aux alternatives',
                    insufficient_evidence: 'Preuves insuffisantes pour conclure',
                  }[r.uniqueness.verdict]
                }
              </strong>
              <p>{r.uniqueness.reason}</p>
              <References refs={r.uniqueness.references} sources={sources} />
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
              <References refs={r.content.references} sources={sources} />
            </>
          )}
          {r.limits.length > 0 && (
            <details>
              <summary>Limites et points à vérifier</summary>
              <ul>
                {r.limits.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
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
}: {
  kind: 'buyer' | 'content';
  sources: WorkspaceSourceDto[];
  buyer: WorkflowRunDto | undefined;
  runs: WorkflowRunDto[];
}) {
  const session = useSession();
  const client = useQueryClient();
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
        body: { kind, brief, sourceIds: selected, requestKey },
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
        key={`${kind}-${buyer?.id ?? ''}`}
        kind={kind}
        sources={sources.data}
        runs={runs.data}
        buyer={buyer}
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
