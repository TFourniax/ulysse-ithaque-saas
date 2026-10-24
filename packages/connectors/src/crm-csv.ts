import type {
  CrmColumn,
  CrmColumnRole,
  CrmFile,
  CrmImportRow,
  CrmImportAdjustments,
  FieldValue,
  Money,
} from '@ulysse/domain';
import { crmMoney } from './crm-money.ts';
import {
  empty,
  ensure,
  fingerprintOf,
  isInstant,
  present,
  unavailable,
  validateFields,
} from '@ulysse/domain';

export const CRM_MAX_BYTES = 5 * 1024 * 1024;
export const CRM_MAX_ROWS = 2000;
const MAX_COLUMNS = 200;
export class CrmCsvError extends Error {}
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const aliases: [CrmColumnRole, string[]][] = [
  ['title', ['Titre', 'Affaire', 'Nom de l’affaire', 'Deal name', 'Opportunity name', 'title']],
  ['company', ['Société cible principale', 'Société', 'Entreprise', 'Company', 'Account']],
  ['externalId', ['Identifiant', 'ID', 'Deal ID', 'Opportunity ID', 'Identifiant Nereis']],
  ['pipeline', ['Quel Pipe ? (3 choix)', 'Pipe', 'Pipeline']],
  ['stage', ['Etape dans processus client', 'Étape', 'Statut', 'Stage', 'Status']],
  ['amount', ['Potentiel en € du deal', 'Montant', 'Amount', 'Valeur du deal']],
  ['currency', ['Devise', 'Currency']],
  [
    'lastInteractionAt',
    ['Dernière interaction', 'Date dernière interaction', 'Last activity', 'Last interaction'],
  ],
  ['nextStep', ['Objectif AU', 'Prochaine action', 'Prochaine étape', 'Next step']],
  [
    'nextStepDueAt',
    ['Échéance prochaine action', 'Date prochaine action', 'Next step due', 'Next step due at'],
  ],
  ['ownerName', ['Commercial', 'Responsable commercial', 'Owner', 'Owner name']],
  ['segment', ['Segment', 'Secteur', 'Industry']],
  ['opposed', ['Opposition contact', 'Ne pas contacter', 'Do not contact', 'Opt out']],
  ['pauseUntil', ['Contact suspendu jusqu’au', 'Pause contact jusqu’au', 'Pause until']],
  ['visibility', ['Limiter la vue à', 'Visibilité', 'Visibility', 'Access restriction']],
  [
    'objectives',
    [
      'Que voulez-vous gagner?',
      'Quel impact sur les revenus futurs?',
      'Quel ROI non financiers et leviers',
      'Type de vente (obligatoire)',
      'Offre(s) proposée(s)',
    ],
  ],
  ['risks', ['Raison(s) du risque', 'Risque']],
  ['competitors', ['Leurs mots : concurrence', 'DATA Short list concurrents']],
  [
    'facts',
    [
      'Contact cible principale',
      '(F)Acteurs Humains',
      'Date de 1ère ACCROCHE',
      'Date 1ère INTERACTION (Action Utile / AU)',
      'Nature la 1ère AU',
      "Origine de l'accroche",
      "Dernier changement d'étape",
      'Décision prévue le',
      'Commande prévue le',
      'Commande reçue le',
      'Date de réception de commande',
      'Valeur dernier devis émis',
      'Partenaires commerciaux',
      'Prix de vente du partenaire',
      'Responsable(s) des ventes',
      "Gagné / Perdu / Pas d'achat : motifs de la décision",
    ],
  ],
  [
    'history',
    [
      'Notes',
      'Historique',
      'Tâches à faire',
      "Tâches TOTALEMENT CRITIQUES à faire : l'avez-vous fait ?",
      'Date d’information des champs suivants',
      'Tous les éléments que vous voulez historiser : rapports de visites, enregistrement IA, notes, fichiers, mails etc',
    ],
  ],
];
export function crmRole(label: string): CrmColumnRole {
  const n = norm(label);
  for (const [role, names] of aliases) if (names.some((name) => norm(name) === n)) return role;
  if (/^0 conscience de la concurrence/.test(n)) return 'competitors';
  if (/^1 les opportunites et risques/.test(n)) return 'facts';
  if (/^2 inventaire|^3 compilation|^7 hypotheses/.test(n)) return 'hypotheses';
  if (/^[4568] /.test(n)) return 'objectives';
  if (/^revenu potentiel|^valeur a 3 ans/.test(n)) return 'objectives';
  return 'ignore';
}

/** Quoted delimiters/newlines, escaped quotes and CRLF. Never evaluates spreadsheet formulas. */
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell.trim());
    cell = '';
    closed = false;
    if (row.length > MAX_COLUMNS) throw new CrmCsvError('Le fichier dépasse 200 colonnes.');
  };
  const line = () => {
    field();
    if (row.some((s) => s !== '')) rows.push(row);
    row = [];
    if (rows.length > CRM_MAX_ROWS + 1)
      throw new CrmCsvError('Importez au plus 2 000 affaires par fichier.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === delimiter) field();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else if (closed && c !== ' ' && c !== '\t')
      throw new CrmCsvError('Le CSV contient des guillemets mal fermés.');
    else if (!closed) cell += c;
    if (cell.length > 48000)
      throw new CrmCsvError(
        'Une cellule dépasse 48 000 caractères. Scindez ce texte en plusieurs affaires ou sources.',
      );
  }
  if (quoted) throw new CrmCsvError('Le CSV contient un champ entre guillemets non terminé.');
  if (cell || row.length || closed) line();
  return rows;
}

export function parseCrmCsv(
  text: string,
  mapping?: CrmColumnRole[],
  observedAt = new Date().toISOString(),
  adjustments: CrmImportAdjustments = {},
): CrmFile {
  if (!text || Buffer.byteLength(text, 'utf8') > CRM_MAX_BYTES)
    throw new CrmCsvError('Choisissez un CSV de moins de 5 Mo.');
  if (text.includes('\u0000') || text.includes('\ufffd'))
    throw new CrmCsvError('Encodage illisible. Exportez le fichier en CSV UTF-8.');
  ensure(isInstant(observedAt), 'INVALID_TIMESTAMP');
  text = text.replace(/^\uFEFF/, '');
  let delimiter = '';
  const sep = /^sep=([;,\t])\r?\n/i.exec(text);
  if (sep) {
    delimiter = sep[1] ?? '';
    text = text.slice(sep[0].length);
  }
  let table: string[][] = [];
  if (delimiter) table = readCsv(text, delimiter);
  else {
    // Inspect a complete logical header, not the first physical line of a quoted field.
    const candidates = [',', ';', '\t'].map((d) => ({ d, count: 0 }));
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (c === '\n' || c === '\r') break;
        const candidate = candidates.find((v) => v.d === c);
        if (candidate) candidate.count++;
      }
    }
    delimiter = candidates.sort((a, b) => b.count - a.count)[0]?.d ?? ',';
    table = readCsv(text, delimiter);
  }
  const headers = table.shift();
  if (!headers?.length || !table.length)
    throw new CrmCsvError('Le CSV doit contenir une ligne de titres puis au moins une affaire.');
  if (mapping && mapping.length !== headers.length)
    throw new CrmCsvError('Les colonnes ont changé. Recommencez l’aperçu.');
  const columns: CrmColumn[] = headers.map((label, index) => ({
    index,
    label: label || `Colonne ${index + 1}`,
    role: mapping?.[index] ?? crmRole(label),
  }));
  const edits = new Map<string, string>();
  let editedBytes = 0;
  for (const edit of adjustments.cells ?? []) {
    const column = columns[edit.column];
    if (
      !column ||
      !table[edit.row - 2] ||
      ['ignore', 'visibility', 'externalId'].includes(column.role) ||
      ['visibility', 'externalId'].includes(crmRole(column.label))
    )
      throw new CrmCsvError(
        'Cette cellule ne peut pas être corrigée ici. Vérifiez les colonnes et les restrictions du fichier.',
      );
    const key = `${edit.row}:${edit.column}`;
    if (edits.has(key)) throw new CrmCsvError('La même cellule a reçu plusieurs corrections.');
    if (edit.value.includes('\u0000') || edit.value.includes('\ufffd') || edit.value.length > 48000)
      throw new CrmCsvError('Une correction contient une valeur illisible ou trop longue.');
    editedBytes += Buffer.byteLength(edit.value, 'utf8');
    if (editedBytes > CRM_MAX_BYTES)
      throw new CrmCsvError('Les corrections dépassent 5 Mo. Réduisez leur contenu.');
    edits.set(key, edit.value.trim());
  }
  const currencies = new Map<number, string>();
  for (const correction of adjustments.rowCurrencies ?? []) {
    if (
      !table[correction.row - 2] ||
      currencies.has(correction.row) ||
      !/^[A-Za-z]{3}$/.test(correction.currency)
    )
      throw new CrmCsvError('Correction de devise invalide.');
    currencies.set(correction.row, correction.currency.toUpperCase());
  }
  const single: CrmColumnRole[] = [
    'title',
    'company',
    'externalId',
    'pipeline',
    'stage',
    'amount',
    'currency',
    'lastInteractionAt',
    'nextStep',
    'nextStepDueAt',
    'ownerName',
    'segment',
    'opposed',
    'pauseUntil',
  ];
  const rows = table.map((original, index) => {
    const row = index + 2;
    const values = original.map((value, column) => edits.get(`${row}:${column}`) ?? value);
    const changes = columns
      .filter((c) => values[c.index] !== original[c.index])
      .map((c) => `${c.label} : ${original[c.index] || '(vide)'} → ${values[c.index] || '(vide)'}`);
    const normalized = normalizeRow(
      columns,
      values,
      row,
      observedAt,
      adjustments,
      currencies.get(row),
      changes,
    );
    normalized.editableCells = columns
      .filter(
        (c) =>
          !['ignore', 'visibility', 'externalId'].includes(c.role) &&
          !['visibility', 'externalId'].includes(crmRole(c.label)),
      )
      .map((c) => ({
        column: c.index,
        original: original[c.index] ?? '',
        value: values[c.index] ?? '',
      }));
    normalized.currencyOverride = currencies.get(row) ?? '';
    return normalized;
  });
  if (single.some((role) => columns.filter((c) => c.role === role).length > 1)) {
    for (const row of rows) {
      row.errors.push(
        'Deux colonnes correspondent au même champ. Ajustez la reconnaissance des colonnes.',
      );
      row.fields = null;
    }
  }
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.identity, (counts.get(r.identity) ?? 0) + 1);
  for (const r of rows)
    if ((counts.get(r.identity) ?? 0) > 1)
      r.warnings.push(
        'Plusieurs lignes désignent la même affaire : choisissez celles à conserver.',
      );
  return { columns, rows, delimiter };
}

function normalizeRow(
  columns: CrmColumn[],
  values: string[],
  row: number,
  at: string,
  adjustments: CrmImportAdjustments,
  currencyOverride: string | undefined,
  changes: string[],
): CrmImportRow {
  const errors: string[] = [],
    warnings: string[] = [];
  const get = (role: CrmColumnRole) => {
    const c = columns.find((c) => c.role === role);
    return c ? (values[c.index] ?? '') : undefined;
  };
  const title = get('title') ?? '',
    company = get('company') ?? '',
    pipeline = get('pipeline') ?? '',
    sourceId = get('externalId') || null;
  const identity = fingerprintOf(
    sourceId ? ['external', sourceId] : ['natural', norm(company), norm(title), norm(pipeline)],
  );
  const result: CrmImportRow = {
    row,
    title,
    company,
    sourceId,
    identity,
    fields: null,
    errors,
    warnings,
  };
  if (values.length !== columns.length)
    errors.push('Nombre de cellules différent de celui des colonnes.');
  if (!title) errors.push('Nom de l’affaire absent.');
  if (!company && !sourceId)
    warnings.push('Entreprise absente : vérifiez le nom avant un réimport.');
  // Restrictions from known headers cannot be hidden by remapping the column to Ignore.
  for (const c of columns.filter(
    (c) => c.role === 'visibility' || crmRole(c.label) === 'visibility',
  )) {
    const v = norm(values[c.index] ?? '');
    if (v && !['tout le monde', 'everyone', 'tous', 'public'].includes(v))
      errors.push(
        'Accès restreint dans le fichier : cette ligne ne peut pas être partagée avec tout l’espace.',
      );
  }
  function textField(role: CrmColumnRole, max: number): FieldValue<string> {
    const s = get(role);
    if (s === undefined) return unavailable;
    if (s.length > max) {
      errors.push(
        `Texte trop long dans « ${columns.find((c) => c.role === role)?.label ?? role} ». `,
      );
      return unavailable;
    }
    return s ? present(s) : empty;
  }
  function dateField(role: CrmColumnRole): FieldValue<string> {
    const s = get(role);
    if (s === undefined) return unavailable;
    if (!s) return empty;
    let iso = s;
    const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (french) iso = `${french[3]}-${french[2]}-${french[1]}T12:00:00.000Z`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = `${s}T12:00:00.000Z`;
    if (!isInstant(iso)) {
      errors.push('Date illisible : utilisez JJ/MM/AAAA ou AAAA-MM-JJ.');
      return unavailable;
    }
    if (role === 'lastInteractionAt' && Date.parse(iso) > Date.parse(at) + 86400000) {
      errors.push('La dernière interaction est dans le futur.');
      return unavailable;
    }
    return present(iso);
  }
  let amount: FieldValue<Money> = unavailable;
  const a = get('amount');
  if (a === '') amount = empty;
  else if (a !== undefined) {
    const money = crmMoney(a, {
      heading: columns.find((c) => c.role === 'amount')?.label ?? '',
      format: adjustments.numberFormat ?? 'auto',
      ...(get('currency') ? { fieldCurrency: get('currency') } : {}),
      ...(adjustments.defaultCurrency ? { defaultCurrency: adjustments.defaultCurrency } : {}),
      ...(currencyOverride ? { override: currencyOverride } : {}),
    });
    if (money.error) errors.push(money.error);
    else if (money.money) {
      amount = present(money.money);
      if (
        currencyOverride ||
        money.usedDefault ||
        (adjustments.numberFormat && adjustments.numberFormat !== 'auto')
      )
        changes.push(
          `Montant relu : ${a} → ${money.money.amount} ${money.money.currency}. Devise dans le fichier : ${get('currency') || columns.find((c) => c.role === 'amount')?.label || 'non indiquée'}. Format choisi : ${adjustments.numberFormat ?? 'auto'}${currencyOverride ? '. Devise corrigée sans conversion' : ''}.`,
        );
    }
  }
  const stageText = norm(get('stage') ?? '');
  const stage = ['gagne', 'won', 'gagnee'].includes(stageText)
    ? 'won'
    : ['perdu', 'lost', 'perdue', 'pas d achat'].includes(stageText)
      ? 'lost'
      : 'open';
  if (stage === 'open' && !['open', 'ouvert', 'ouverte'].includes(stageText))
    warnings.push(
      'Affaire considérée ouverte ; son étape d’origine est conservée dans les informations commerciales.',
    );
  const groups: [CrmColumnRole[], string][] = [
    [['company', 'pipeline', 'stage', 'facts', 'segment'], 'Informations déclarées dans le CRM'],
    [['objectives'], 'Objectifs et valeur attendue — non mesurés'],
    [['hypotheses'], 'Hypothèses et interprétations du CRM — à vérifier'],
    [['risks'], 'Risques signalés dans le CRM'],
    [['competitors'], 'Concurrence mentionnée dans le CRM — à confronter'],
    [['history', 'nextStep'], 'Notes et prochaines actions déclarées'],
  ];
  const materials: NonNullable<
    ReturnType<typeof validateFields>['commercial']
  >['materials'][number][] = [];
  for (const [roles, label] of groups) {
    const text = columns
      .filter((c) => roles.includes(c.role) && values[c.index] && values[c.index] !== c.label)
      .map((c) => `${c.label}: ${values[c.index] ?? ''}`)
      .join('\n\n');
    for (let start = 0; start < text.length; start += 3900)
      materials.push({
        id: `crm_${materials.length + 1}`,
        version: 1,
        type: 'document',
        title: label,
        text: `Source : export CRM. Date du document : dépôt du fichier.\n${text.slice(start, start + 3900)}`,
        author: 'Export CRM',
        occurredAt: at,
      });
  }
  if (changes.length) {
    result.correctionCount = changes.length;
    const text = `Corrections décidées par l’utilisateur avant import, à distinguer des valeurs du fichier.\n${changes.join('\n')}`;
    for (let start = 0; start < text.length; start += 3900)
      materials.push({
        id: `crm_${materials.length + 1}`,
        version: 1,
        type: 'document',
        title: 'Corrections à l’import',
        text: text.slice(start, start + 3900),
        author: 'Responsable de l’import',
        occurredAt: at,
      });
  }
  if (materials.length > 12)
    errors.push(
      'Cette affaire dépasse 46 800 caractères utiles. Réduisez les colonnes retenues pour cette ligne.',
    );
  const opposed = norm(get('opposed') ?? '');
  if (opposed && !['oui', 'yes', 'true', '1', 'non', 'no', 'false', '0'].includes(opposed))
    errors.push('Opposition au contact ambiguë : indiquez oui ou non.');
  const pause = dateField('pauseUntil');
  try {
    const fields = validateFields({
      name: title,
      stage,
      amount,
      lastInteractionAt: dateField('lastInteractionAt'),
      nextStep: textField('nextStep', 2000),
      nextStepDueAt: dateField('nextStepDueAt'),
      ownerName: textField('ownerName', 200),
      segment: textField('segment', 100),
      commercial: {
        materials,
        contactPolicy: {
          opposed: ['oui', 'yes', 'true', '1'].includes(opposed),
          pauseUntil: pause.state === 'present' ? pause.value : null,
        },
      },
    });
    if (!errors.length) result.fields = fields;
  } catch {
    if (!errors.length) errors.push('Une valeur est trop longue ou invalide pour cette affaire.');
  }
  return result;
}
