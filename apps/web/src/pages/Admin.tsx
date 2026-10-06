import type { CompanyContextContentDto, DoctrineDto, MemberDto } from '@ulysse/contracts';
import { useId, useState } from 'react';
import {
  useCompanyContext,
  useDoctrineActions,
  useDoctrines,
  useMemberActions,
  useMembers,
  useRules,
  useUpdateContext,
} from '../api.ts';
import { can, useSession } from '../session.tsx';
import { Banner, ErrorBanner, FictionalBadge, Loading } from '../components/ui.tsx';
import { formatDateTime, ROLE_LABELS } from '../format.ts';

function Members() {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const allowed = can(session, 'member:read');
  const members = useMembers(tenantId, allowed);
  const actions = useMemberActions(tenantId);
  if (!allowed) return null;
  const manage = can(session, 'member:manage');
  return (
    <section className="panel" aria-labelledby="members-title">
      <h2 id="members-title">Membres</h2>
      <p className="muted small">
        Les accès sont vérifiés à chaque requête : un retrait prend effet immédiatement.
        L&apos;ajout d&apos;un compte se fait par provisionnement administrateur (voir
        docs/OPERATIONS.md).
      </p>
      {members.isPending && <Loading />}
      {members.error && <ErrorBanner error={members.error} />}
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Membres de l&apos;entreprise</caption>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Rôle</th>
              <th scope="col">Statut</th>
              {manage && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m: MemberDto) => (
              <tr key={m.userId}>
                <th scope="row">
                  {m.displayName}
                  {m.email && <span className="muted small"> {m.email}</span>}
                </th>
                <td>
                  {manage && m.status === 'active' ? (
                    <label>
                      <span className="visually-hidden">Rôle de {m.displayName}</span>
                      <select
                        value={m.role}
                        disabled={actions.changeRole.isPending}
                        onChange={(e) =>
                          actions.changeRole.mutate({
                            userId: m.userId,
                            role: e.target.value as MemberDto['role'],
                          })
                        }
                      >
                        {(['owner', 'reviewer', 'viewer'] as const).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    ROLE_LABELS[m.role]
                  )}
                </td>
                <td>
                  {m.status === 'active' ? 'Actif' : `Révoqué le ${formatDateTime(m.revokedAt)}`}
                </td>
                {manage && (
                  <td>
                    {m.status === 'active' && m.userId !== session.user.id && (
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => actions.revoke.mutate(m.userId)}
                      >
                        Retirer l&apos;accès
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions.changeRole.error && <ErrorBanner error={actions.changeRole.error} />}
      {actions.revoke.error && <ErrorBanner error={actions.revoke.error} />}
    </section>
  );
}

function DoctrineEditor({ base }: { base: DoctrineDto }) {
  const session = useSession();
  const actions = useDoctrineActions(session.activeTenant.id);
  const rules = useRules(session.activeTenant.id);
  const [content, setContent] = useState(base.content);
  const [open, setOpen] = useState(false);
  const policyIds = { age: useId(), ttl: useId(), cap: useId(), cool: useId() };
  if (!open) {
    return (
      <button type="button" className="button" onClick={() => setOpen(true)}>
        Préparer une nouvelle version
      </button>
    );
  }
  const setPolicy = (key: keyof DoctrineDto['content']['policy'], value: number) =>
    setContent({ ...content, policy: { ...content.policy, [key]: value } });
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        actions.draft.mutate(
          {
            key: base.key,
            title: base.title,
            origin: base.origin,
            usageRights: base.usageRights,
            content,
          },
          { onSuccess: () => setOpen(false) },
        );
      }}
    >
      <h3>Nouvelle version (brouillon)</h3>
      <p className="muted small">
        Une version est immuable : la modification crée un brouillon qui doit être validé par un
        responsable avant d&apos;être utilisé.
      </p>
      {content.rules.map((rule, index) => {
        const spec = rules.data?.find((r) => r.id === rule.ruleId);
        return (
          <fieldset key={rule.ruleId}>
            <legend>
              {spec?.label ?? rule.ruleId} {spec?.fictional && <FictionalBadge />}
            </legend>
            <label>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) =>
                  setContent({
                    ...content,
                    rules: content.rules.map((r, i) =>
                      i === index ? { ...r, enabled: e.target.checked } : r,
                    ),
                  })
                }
              />{' '}
              Règle active
            </label>
            {Object.entries(rule.parameters).map(([name, value]) => {
              const p = spec?.parameters.find((x) => x.name === name);
              return (
                <label key={name}>
                  {name}{' '}
                  {p && (
                    <span className="muted small">
                      ({p.min}–{p.max})
                    </span>
                  )}
                  <input
                    type="number"
                    min={p?.min}
                    max={p?.max}
                    step={p?.integer ? 1 : 'any'}
                    value={value}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        rules: content.rules.map((r, i) =>
                          i === index
                            ? {
                                ...r,
                                parameters: { ...r.parameters, [name]: Number(e.target.value) },
                              }
                            : r,
                        ),
                      })
                    }
                  />
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <fieldset>
        <legend>Politique</legend>
        <label htmlFor={policyIds.age}>Âge maximal des données (heures)</label>
        <input
          id={policyIds.age}
          type="number"
          min={1}
          value={content.policy.maxSourceAgeHours}
          onChange={(e) => setPolicy('maxSourceAgeHours', Number(e.target.value))}
        />
        <label htmlFor={policyIds.ttl}>Durée de validité d&apos;une proposition (heures)</label>
        <input
          id={policyIds.ttl}
          type="number"
          min={1}
          value={content.policy.recommendationLifetimeHours}
          onChange={(e) => setPolicy('recommendationLifetimeHours', Number(e.target.value))}
        />
        <label htmlFor={policyIds.cap}>Propositions ouvertes maximum</label>
        <input
          id={policyIds.cap}
          type="number"
          min={1}
          value={content.policy.maxOpenRecommendations}
          onChange={(e) => setPolicy('maxOpenRecommendations', Number(e.target.value))}
        />
        <label htmlFor={policyIds.cool}>Délai après rejet avant nouvelle proposition (jours)</label>
        <input
          id={policyIds.cool}
          type="number"
          min={0}
          value={content.policy.rejectionCooldownDays}
          onChange={(e) => setPolicy('rejectionCooldownDays', Number(e.target.value))}
        />
      </fieldset>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={actions.draft.isPending}>
          Créer le brouillon
        </button>
        <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
      {actions.draft.error && <ErrorBanner error={actions.draft.error} />}
    </form>
  );
}

function Doctrines() {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const doctrines = useDoctrines(tenantId);
  const actions = useDoctrineActions(tenantId);
  const validator = can(session, 'doctrine:validate');
  const active = doctrines.data?.find((d) => d.status === 'validated');
  return (
    <section className="panel" aria-labelledby="doctrine-title">
      <h2 id="doctrine-title">Doctrine</h2>
      <p className="muted small">
        La doctrine définit les règles et seuils utilisés pour proposer. Elle est fournie et validée
        par les responsables métier ; la doctrine de démonstration est fictive.
      </p>
      {doctrines.isPending && <Loading />}
      {doctrines.error && <ErrorBanner error={doctrines.error} />}
      {doctrines.data?.length === 0 && (
        <Banner kind="warning">Aucune doctrine : aucune proposition ne peut être produite.</Banner>
      )}
      <ul className="cards">
        {doctrines.data?.map((d) => (
          <li key={d.id} className="card">
            <div className="card-head">
              <span className={`badge badge-doctrine-${d.status}`}>
                {d.status === 'validated'
                  ? 'En vigueur'
                  : d.status === 'draft'
                    ? 'Brouillon'
                    : 'Retirée'}
              </span>
              {d.origin === 'fixture' && <FictionalBadge />}
            </div>
            <h3 className="card-title">
              {d.title} — v{d.version}
            </h3>
            <p className="muted small">
              Origine : {d.origin} · droits : {d.usageRights} · créée {formatDateTime(d.createdAt)}
              {d.validatedAt && <> · validée {formatDateTime(d.validatedAt)}</>}
              {d.validationNote && <> · « {d.validationNote} »</>}
            </p>
            <ul className="small">
              {d.content.rules.map((r) => (
                <li key={r.ruleId}>
                  {r.ruleId} {r.enabled ? '' : '(désactivée)'} —{' '}
                  {Object.entries(r.parameters)
                    .map(([k, v]) => `${k} = ${String(v)}`)
                    .join(', ')}
                </li>
              ))}
              <li>
                Données ≤ {d.content.policy.maxSourceAgeHours} h · validité{' '}
                {d.content.policy.recommendationLifetimeHours} h · max{' '}
                {d.content.policy.maxOpenRecommendations} ouvertes · délai après rejet{' '}
                {d.content.policy.rejectionCooldownDays} j
              </li>
            </ul>
            {validator && d.status === 'draft' && (
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => actions.validate.mutate({ id: d.id, note: null })}
                >
                  Valider cette version
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {active && can(session, 'doctrine:manage') && <DoctrineEditor base={active} />}
      {actions.validate.error && <ErrorBanner error={actions.validate.error} />}
    </section>
  );
}

function ContextSection() {
  const session = useSession();
  const tenantId = session.activeTenant.id;
  const query = useCompanyContext(tenantId);
  const update = useUpdateContext(tenantId);
  const [draft, setDraft] = useState<CompanyContextContentDto | null>(null);
  const ids = {
    activity: useId(),
    segments: useId(),
    offers: useId(),
    objectives: useId(),
    constraints: useId(),
    process: useId(),
  };
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const current = query.data.context;
  const editable = can(session, 'context:manage');
  const lines = (v: string) =>
    v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <section className="panel" aria-labelledby="context-title">
      <h2 id="context-title">Contexte de l&apos;entreprise</h2>
      <p className="muted small">
        Propre à cette entreprise, versionné, jamais partagé avec une autre entreprise. Les segments
        cibles influencent la priorité.
      </p>
      {current ? (
        <dl className="facts">
          <dt>Version</dt>
          <dd>
            v{current.version} ({current.source === 'fixture' ? 'fictif' : 'saisi'},{' '}
            {formatDateTime(current.createdAt)})
          </dd>
          <dt>Activité</dt>
          <dd>{current.content.activity || '—'}</dd>
          <dt>Segments cibles</dt>
          <dd>{current.content.targetSegments.join(', ') || '—'}</dd>
          <dt>Offres</dt>
          <dd>{current.content.offers.join(', ') || '—'}</dd>
          <dt>Objectifs</dt>
          <dd>{current.content.objectives.join(' ; ') || '—'}</dd>
          <dt>Contraintes</dt>
          <dd>{current.content.constraints.join(' ; ') || '—'}</dd>
          <dt>Processus commercial</dt>
          <dd>{current.content.salesProcess || '—'}</dd>
        </dl>
      ) : (
        <p className="muted">Aucun contexte renseigné.</p>
      )}
      {editable && !draft && (
        <button
          type="button"
          className="button"
          onClick={() =>
            setDraft(
              current?.content ?? {
                activity: '',
                offers: [],
                objectives: [],
                targetSegments: [],
                constraints: [],
                salesProcess: '',
              },
            )
          }
        >
          Mettre à jour le contexte
        </button>
      )}
      {editable && draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ content: draft, note: null }, { onSuccess: () => setDraft(null) });
          }}
        >
          <label htmlFor={ids.activity}>Activité</label>
          <textarea
            id={ids.activity}
            rows={2}
            value={draft.activity}
            onChange={(e) => setDraft({ ...draft, activity: e.target.value })}
          />
          <label htmlFor={ids.segments}>Segments cibles (un par ligne)</label>
          <textarea
            id={ids.segments}
            rows={2}
            value={draft.targetSegments.join('\n')}
            onChange={(e) => setDraft({ ...draft, targetSegments: lines(e.target.value) })}
          />
          <label htmlFor={ids.offers}>Offres (une par ligne)</label>
          <textarea
            id={ids.offers}
            rows={2}
            value={draft.offers.join('\n')}
            onChange={(e) => setDraft({ ...draft, offers: lines(e.target.value) })}
          />
          <label htmlFor={ids.objectives}>Objectifs (un par ligne)</label>
          <textarea
            id={ids.objectives}
            rows={2}
            value={draft.objectives.join('\n')}
            onChange={(e) => setDraft({ ...draft, objectives: lines(e.target.value) })}
          />
          <label htmlFor={ids.constraints}>Contraintes (une par ligne)</label>
          <textarea
            id={ids.constraints}
            rows={2}
            value={draft.constraints.join('\n')}
            onChange={(e) => setDraft({ ...draft, constraints: lines(e.target.value) })}
          />
          <label htmlFor={ids.process}>Processus commercial</label>
          <textarea
            id={ids.process}
            rows={2}
            value={draft.salesProcess}
            onChange={(e) => setDraft({ ...draft, salesProcess: e.target.value })}
          />
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={update.isPending}>
              Enregistrer une nouvelle version
            </button>
            <button type="button" className="button button-ghost" onClick={() => setDraft(null)}>
              Annuler
            </button>
          </div>
          {update.error && <ErrorBanner error={update.error} />}
        </form>
      )}
    </section>
  );
}

export function AdminPage() {
  return (
    <>
      <h1>Administration</h1>
      <Members />
      <Doctrines />
      <ContextSection />
    </>
  );
}
