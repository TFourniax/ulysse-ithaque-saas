import type { CrmColumnRoleDto, CrmImportSummaryDto, CrmPreviewDto } from '@ulysse/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, useConnections } from '../api.ts';
import { Banner, ErrorBanner, Loading, PageHeader, TableScroll } from '../components/ui.tsx';
import { formatDateTime } from '../format.ts';
import { can, useSession } from '../session.tsx';

const ROLES: Record<CrmColumnRoleDto, string> = {
  ignore: 'Ne pas utiliser',
  title: 'Nom de l’affaire',
  company: 'Entreprise cliente',
  externalId: 'Identifiant de la source',
  pipeline: 'Portefeuille',
  stage: 'Étape de l’affaire',
  amount: 'Montant potentiel',
  currency: 'Devise',
  lastInteractionAt: 'Dernière interaction',
  nextStep: 'Prochaine action',
  nextStepDueAt: 'Date de la prochaine action',
  ownerName: 'Responsable commercial',
  segment: 'Segment de clientèle',
  opposed: 'Opposition au contact',
  pauseUntil: 'Contact suspendu jusqu’au',
  visibility: 'Restriction d’accès',
  facts: 'Informations déclarées',
  hypotheses: 'Hypothèses à vérifier',
  objectives: 'Objectifs et valeur attendue',
  risks: 'Risques signalés',
  competitors: 'Concurrence mentionnée',
  history: 'Notes et historique',
};
const ACTIONS = {
  create: 'Nouvelle affaire',
  update: 'Mise à jour',
  unchanged: 'Déjà connue, inchangée',
  choose: 'Rapprochement à vérifier',
  invalid: 'Ligne écartée',
};
const STATUS: Record<string, string> = {
  preview: 'Aperçu à confirmer',
  queued: 'Import en cours',
  completed: 'Import terminé',
  failed: 'Import à reprendre',
  cancelled: 'Aperçu annulé',
};
function defaultTarget(r: CrmPreviewDto['rows'][number]): string {
  return r.action === 'invalid' ? 'skip' : r.action === 'choose' ? '' : (r.targetId ?? 'new');
}

export function CrmImportsPage() {
  const session = useSession(),
    tenantId = session.activeTenant.id,
    client = useQueryClient();
  const connections = useConnections(tenantId);
  const imports = useQuery({
    queryKey: ['crm-imports', tenantId],
    queryFn: () => api<CrmImportSummaryDto[]>('/v1/crm/imports'),
    refetchInterval: 3000,
  });
  const [file, setFile] = useState<{ filename: string; text: string } | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [preview, setPreview] = useState<CrmPreviewDto | null>(null);
  const [mapping, setMapping] = useState<CrmColumnRoleDto[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [limit, setLimit] = useState(50);
  const input = useRef<HTMLInputElement>(null);
  const requestSerial = useRef(0);
  const fileSerial = useRef(0);
  const permitted = can(session, 'connection:manage');
  const fileConnections = (connections.data ?? []).filter(
    (c) => c.provider === 'crm-file' && c.status === 'active',
  );
  const selectedConnection =
    connectionId || (fileConnections.length === 1 ? (fileConnections[0]?.id ?? '') : '');
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['crm-imports', tenantId] }),
      client.invalidateQueries({ queryKey: ['connections', tenantId] }),
      client.invalidateQueries({ queryKey: ['opportunities', tenantId] }),
    ]);
  const prepare = useMutation({
    mutationFn: (body: {
      filename: string;
      text: string;
      connectionId: string | null;
      mapping?: CrmColumnRoleDto[];
    }) => api<CrmPreviewDto>('/v1/crm/imports/preview', { method: 'POST', body }),
  });
  const confirm = useMutation({
    mutationFn: (p: CrmPreviewDto) =>
      api<{ id: string; connectionId: string; status: string }>(`/v1/crm/imports/${p.id}/confirm`, {
        method: 'POST',
        body: {
          resolutions: p.rows.map((r) => ({
            row: r.row,
            target: resolutions[r.row] ?? defaultTarget(r),
          })),
        },
      }),
    onSuccess: async (result) => {
      setConnectionId(result.connectionId);
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = '';
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/v1/crm/imports/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = '';
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/v1/crm/imports/${id}/retry`, { method: 'POST', body: {} }),
    onSettled: refresh,
  });
  async function inspect(
    selected: { filename: string; text: string },
    columns?: CrmColumnRoleDto[],
  ) {
    const serial = ++requestSerial.current;
    setError(null);
    setPreview(null);
    confirm.reset();
    try {
      const p = await prepare.mutateAsync({
        ...selected,
        connectionId: selectedConnection || null,
        ...(columns ? { mapping: columns } : {}),
      });
      if (serial !== requestSerial.current) return;
      setPreview(p);
      setMapping(p.columns.map((c) => c.role));
      setResolutions({});
      setLimit(50);
    } catch (e) {
      if (serial === requestSerial.current)
        setError(e instanceof Error ? e : new Error('Lecture du fichier impossible.'));
    }
  }
  async function load(selected: File | undefined) {
    if (!selected) return;
    const serial = ++fileSerial.current;
    ++requestSerial.current;
    setError(null);
    setPreview(null);
    setFile(null);
    confirm.reset();
    if (!selected.name.toLowerCase().endsWith('.csv')) {
      setError(
        new Error(
          'Depuis Excel, enregistrez votre feuille au format CSV UTF-8, puis déposez ce CSV ici.',
        ),
      );
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError(new Error('Le fichier dépasse 5 Mo. Répartissez les affaires entre plusieurs CSV.'));
      return;
    }
    try {
      const bytes = await selected.arrayBuffer();
      if (serial !== fileSerial.current) return;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder('windows-1252', { fatal: true }).decode(bytes);
      }
      const next = { filename: selected.name, text };
      setFile(next);
      await inspect(next);
    } catch (e) {
      if (serial === fileSerial.current)
        setError(e instanceof Error ? e : new Error('Lecture du fichier impossible.'));
    }
  }
  const unresolved =
    preview?.rows.filter((r) => (resolutions[r.row] ?? defaultTarget(r)) === '').length ?? 0;
  const included =
    preview?.rows.filter((r) => !['skip', ''].includes(resolutions[r.row] ?? defaultTarget(r)))
      .length ?? 0;
  const skipped = (preview?.rows.length ?? 0) - included - unresolved;
  const mappingChanged = preview?.columns.some((c) => mapping[c.index] !== c.role) ?? false;
  const busy = prepare.isPending || confirm.isPending || cancel.isPending;
  const uploadDisabled =
    busy || !connections.isSuccess || (fileConnections.length > 1 && !selectedConnection);
  return (
    <>
      <PageHeader title="Importer mes affaires">
        <p>
          Déposez l’export CSV de votre CRM. Ulysse reconnaît les informations utiles et prépare
          leur intégration. Vous vérifiez avant de confirmer.
        </p>
      </PageHeader>
      {!permitted && (
        <Banner kind="info">
          Le responsable de votre espace peut importer les données commerciales.
        </Banner>
      )}
      {permitted && (
        <section className="card" aria-label="Déposer un fichier CRM">
          {connections.isPending && <Loading label="Chargement de vos sources…" />}
          {connections.error && <ErrorBanner error={connections.error} />}
          {fileConnections.length > 1 && (
            <label>
              Portefeuille à actualiser
              <select
                value={selectedConnection}
                disabled={busy}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setPreview(null);
                  setFile(null);
                }}
              >
                <option value="">Choisir un portefeuille</option>
                {fileConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="crm-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!uploadDisabled) void load(e.dataTransfer.files[0]);
            }}
          >
            <label htmlFor="crm-file">
              <strong>Déposer un fichier CSV</strong>
            </label>
            <p>
              Glissez votre fichier ici ou sélectionnez-le. Jusqu’à 2 000 affaires et 5 Mo par
              fichier.
            </p>
            <input
              ref={input}
              id="crm-file"
              type="file"
              accept=".csv,text/csv"
              disabled={uploadDisabled}
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </div>
          <p className="small muted">
            Depuis Excel : Enregistrer sous → CSV UTF-8. Déposez uniquement les données autorisées
            pour les collaborateurs de cet espace. Une ligne absente d’un nouvel export reste
            conservée.
          </p>
          {busy && (
            <Loading
              label={
                confirm.isPending
                  ? 'Confirmation de l’import…'
                  : 'Lecture du fichier et recherche des affaires déjà connues…'
              }
            />
          )}
          {error && <ErrorBanner error={error} />}
        </section>
      )}
      {preview && (
        <section className="card" aria-label="Vérifier l’import">
          <h2>Vérifier avant d’importer</h2>
          <p>
            <strong>{preview.filename}</strong> · {preview.rows.length} lignes · {included} à
            importer · {skipped} écartées{unresolved ? ` · ${unresolved} à rapprocher` : ''}.
          </p>
          <p>
            {preview.missing} affaire(s) déjà connue(s) ne sont pas rapprochées automatiquement dans
            cet export. Elles seront conservées.
          </p>
          <details className="crm-columns">
            <summary>
              Informations reconnues : {preview.columns.filter((c) => c.role !== 'ignore').length}{' '}
              colonnes sur {preview.columns.length}
            </summary>
            <p>
              Les colonnes non utilisées ne seront pas enregistrées. Les hypothèses restent
              identifiées comme telles. Les dates de première interaction ne sont pas prises pour la
              dernière interaction.
            </p>
            <div className="crm-column-grid">
              {preview.columns.map((c) => (
                <label key={c.index}>
                  {c.label}
                  <select
                    value={mapping[c.index]}
                    disabled={busy}
                    onChange={(e) =>
                      setMapping((old) =>
                        old.map((v, i) =>
                          i === c.index ? (e.target.value as CrmColumnRoleDto) : v,
                        ),
                      )
                    }
                  >
                    {Object.entries(ROLES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {mappingChanged && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  if (file) void inspect(file, mapping);
                }}
              >
                Actualiser l’aperçu
              </button>
            )}
          </details>
          <TableScroll label="Affaires du fichier">
            <table className="crm-preview">
              <thead>
                <tr>
                  <th>Ligne et affaire</th>
                  <th>Vérifications</th>
                  <th>À importer</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, limit).map((r) => (
                  <tr key={r.row}>
                    <td>
                      <strong>{r.title || 'Nom manquant'}</strong>
                      <br />
                      {r.company}
                      <br />
                      <span className="small muted">Ligne {r.row}</span>
                    </td>
                    <td>
                      <strong>{ACTIONS[r.action]}</strong>
                      {r.errors.map((s, i) => (
                        <p key={`e${i}`}>{s}</p>
                      ))}
                      {r.warnings.map((s, i) => (
                        <p className="small" key={`w${i}`}>
                          {s}
                        </p>
                      ))}
                      {r.details.length > 0 && (
                        <details>
                          <summary>Voir les informations retenues</summary>
                          <dl>
                            {r.details.map((d) => (
                              <div key={d.label}>
                                <dt>{d.label}</dt>
                                <dd>{d.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                    <td>
                      <label>
                        <span className="visually-hidden">Choix pour la ligne {r.row}</span>
                        <select
                          disabled={busy || r.action === 'invalid'}
                          value={resolutions[r.row] ?? defaultTarget(r)}
                          onChange={(e) =>
                            setResolutions((old) => ({ ...old, [r.row]: e.target.value }))
                          }
                        >
                          <option value="">Choisir…</option>
                          <option value="skip">Écarter cette ligne</option>
                          <option value="new">Créer une affaire distincte</option>
                          {r.choices.map((c) => (
                            <option key={c.id} value={c.id}>
                              Actualiser : {c.title}
                              {c.company ? ` — ${c.company}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {preview.rows.length > limit && (
            <button type="button" className="button" onClick={() => setLimit((v) => v + 100)}>
              Afficher les lignes suivantes
            </button>
          )}
          {unresolved > 0 && (
            <Banner kind="warning">
              Choisissez une affaire existante, créez une affaire distincte ou écartez les lignes
              dont le rapprochement est incertain.
            </Banner>
          )}
          <p>
            Après confirmation, les affaires alimentent la préparation des prochaines actions avec
            le moteur configuré. Aucun message n’est envoyé à vos contacts.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy || mappingChanged || unresolved > 0 || included === 0}
              onClick={() => confirm.mutate(preview)}
            >
              Importer {included} affaire(s){skipped ? ` — ${skipped} ligne(s) écartée(s)` : ''}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                cancel.mutate(preview.id);
              }}
            >
              Annuler
            </button>
          </div>
          {confirm.error && <ErrorBanner error={confirm.error} />}
          {cancel.error && <ErrorBanner error={cancel.error} />}
        </section>
      )}
      {confirm.isSuccess && (
        <Banner kind="success">
          Import confirmé. Les données sont intégrées en arrière-plan ; vous pouvez quitter cette
          page.
        </Banner>
      )}
      <section className="card">
        <h2>Derniers imports</h2>
        {imports.isPending && <Loading />}
        {imports.error && <ErrorBanner error={imports.error} />}
        {retry.error && <ErrorBanner error={retry.error} />}
        {imports.data?.length === 0 && <p>Aucun fichier importé pour le moment.</p>}
        <ul className="crm-history">
          {imports.data
            ?.filter((b) => b.status !== 'preview')
            .map((b) => (
              <li key={b.id}>
                <strong>{b.filename}</strong> · {STATUS[b.status] ?? b.status}
                {b.status === 'failed' && permitted && (
                  <button
                    type="button"
                    className="button"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(b.id)}
                  >
                    Réessayer cet import
                  </button>
                )}
                <br />
                <span className="small muted">{formatDateTime(b.createdAt)}</span>
                {b.result && (
                  <p>
                    {b.result.created} créée(s), {b.result.updated} mise(s) à jour,{' '}
                    {b.result.unchanged} inchangée(s), {b.result.skipped} écartée(s).
                  </p>
                )}
              </li>
            ))}
        </ul>
        <div className="actions">
          <Link className="button" to="/opportunities">
            Voir mes affaires
          </Link>
          <Link className="button" to="/recommendations">
            Faire avancer mes affaires
          </Link>
        </div>
      </section>
    </>
  );
}
