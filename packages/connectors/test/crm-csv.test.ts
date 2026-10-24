import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CrmCsvError, parseCrmCsv } from '../src/crm-csv.ts';
const at = '2026-10-24T12:00:00.000Z';

test('Excel display amounts in French and English retain their exact decimal value', () => {
  for (const input of [
    '1 234,56',
    '1\u00a0234,56 €',
    '1\u202f234,56',
    '1.234,56',
    '1,234.56',
    '1234.56 EUR',
    "1'234.56",
    '€ 1 234,56',
  ]) {
    const row = parseCrmCsv(`Titre;Potentiel en € du deal\nFictive;${input}`, undefined, at)
      .rows[0];
    assert.deepEqual(row?.errors, [], input);
    assert.deepEqual(
      row.fields?.amount,
      { state: 'present', value: { amount: '1234.56', currency: 'EUR' } },
      input,
    );
  }
  for (const input of ['1,234', '1.234']) {
    assert.equal(
      parseCrmCsv(`Titre;Montant;Devise\nFictive;${input};EUR`, undefined, at).rows[0]?.fields,
      null,
      'ambiguous separators require an explicit choice',
    );
  }
  for (const input of ['1 23,45', '1,23,456', '1.23.456,78', '1,2,3', '=10+20', '10€00']) {
    assert.equal(
      parseCrmCsv(`Titre;Montant;Devise\nFictive;${input};EUR`, undefined, at).rows[0]?.fields,
      null,
      input,
    );
  }
});

test('reviewed number format, default currency and row corrections produce a new validated proposal', () => {
  const csv =
    'Titre;Entreprise;Montant;Prochaine action\nA;Fictive;1,234;Appeler\nB;Autre;illisible;Écrire';
  const initial = parseCrmCsv(csv, undefined, at);
  assert.ok(initial.rows.every((r) => r.fields === null));
  assert.equal(initial.rows[0]?.editableCells?.find((c) => c.column === 2)?.original, '1,234');
  const fixed = parseCrmCsv(csv, undefined, at, {
    numberFormat: 'en',
    defaultCurrency: 'EUR',
    cells: [
      { row: 3, column: 2, value: '' },
      { row: 2, column: 3, value: 'Préparer une réunion' },
    ],
  });
  assert.ok(fixed.rows.every((r) => r.fields !== null));
  assert.deepEqual(fixed.rows[0]?.fields?.amount, {
    state: 'present',
    value: { amount: '1234', currency: 'EUR' },
  });
  assert.deepEqual(fixed.rows[1]?.fields?.amount, { state: 'empty' });
  assert.deepEqual(fixed.rows[0].fields.nextStep, {
    state: 'present',
    value: 'Préparer une réunion',
  });
  assert.ok(
    fixed.rows[0].fields.commercial?.materials.some(
      (m) =>
        m.title === 'Corrections à l’import' && m.text.includes('Appeler → Préparer une réunion'),
    ),
  );
  assert.ok(
    fixed.rows[1].fields.commercial?.materials.some((m) => m.text.includes('illisible → (vide)')),
  );
  assert.equal(fixed.rows[0].identity, initial.rows[0].identity);
  assert.ok(
    initial.rows.every((r) => r.fields === null),
    'the original proposal is not mutated',
  );
});

test('currency choices do not silently replace an explicit currency or convert amounts', () => {
  assert.equal(
    parseCrmCsv('Titre;Montant\nFictive;20', undefined, at, { defaultCurrency: 'EUO' }).rows[0]
      ?.fields,
    null,
  );
  const csv = 'Titre;Montant;Devise\nFictive;20;USD';
  assert.deepEqual(
    parseCrmCsv(csv, undefined, at, { defaultCurrency: 'EUR' }).rows[0]?.fields?.amount,
    { state: 'present', value: { amount: '20', currency: 'USD' } },
  );
  const corrected = parseCrmCsv(csv, undefined, at, {
    rowCurrencies: [{ row: 2, currency: 'EUR' }],
  }).rows[0];
  assert.deepEqual(corrected?.fields?.amount, {
    state: 'present',
    value: { amount: '20', currency: 'EUR' },
  });
  assert.ok(corrected.fields.commercial?.materials.some((m) => m.text.includes('sans conversion')));
  assert.equal(
    parseCrmCsv('Titre;Potentiel en € du deal;Devise\nFictive;20;USD', undefined, at).rows[0]
      ?.fields,
    null,
  );
});

test('edits cannot remove source visibility restrictions, change source IDs or reference missing rows', () => {
  const csv = 'ID;Titre;Limiter la vue à ..;Montant\n001;Fictive;Privé;20';
  for (const cells of [
    [{ row: 2, column: 2, value: 'Tout le monde' }],
    [{ row: 2, column: 0, value: '002' }],
    [{ row: 3, column: 1, value: 'Autre' }],
    [
      { row: 2, column: 3, value: '10' },
      { row: 2, column: 3, value: '20' },
    ],
  ])
    assert.throws(() => parseCrmCsv(csv, undefined, at, { cells }), CrmCsvError);
  const restricted = parseCrmCsv(csv, ['externalId', 'title', 'ignore', 'amount'], at, {
    defaultCurrency: 'EUR',
    cells: [{ row: 2, column: 3, value: '10' }],
  });
  assert.equal(restricted.rows[0]?.fields, null);
  assert.ok(!restricted.rows[0].editableCells?.some((c) => c.column === 2));
});

test('Nereis columns preserve fact/hypothesis meaning, first interaction is not the last', () => {
  const csv =
    '\uFEFFTitre;Société cible principale;Potentiel en € du deal;Devise;Date 1ère INTERACTION (Action Utile / AU);Etape dans processus client;Objectif AU;2/ Inventaire LUCIDE des hypothèses et interprétations;Limiter la vue à ..\r\n"Projet; pilote";Atelier fictif;"2 280,50";€;09/09/2026;[Curiosité] À préciser;Définir les critères;"Budget supposé\nà confirmer";Tout le monde';
  const parsed = parseCrmCsv(csv, undefined, at),
    row = parsed.rows[0];
  assert.deepEqual(row?.errors, []);
  assert.equal(row.fields?.name, 'Projet; pilote');
  assert.deepEqual(row.fields.lastInteractionAt, { state: 'unavailable' });
  assert.deepEqual(row.fields.amount, {
    state: 'present',
    value: { amount: '2280.50', currency: 'EUR' },
  });
  assert.ok(
    row.fields.commercial?.materials.some(
      (m) => m.title.includes('Hypothèses') && m.text.includes('Budget supposé\nà confirmer'),
    ),
  );
  assert.equal(row.fields.stage, 'open');
  assert.equal(parsed.columns.at(-1)?.role, 'visibility');
});
test('UTF8 BOM, Excel separator, escaped quotes and embedded line breaks are read literally', () => {
  const row = parseCrmCsv(
    'sep=;\r\nTitre;Entreprise;Notes\r\n"Projet ""A""";Fictive;"=HYPERLINK(""https://example.test"")\nNe pas exécuter"',
    undefined,
    at,
  ).rows[0];
  assert.equal(row?.title, 'Projet "A"');
  assert.deepEqual(row.errors, []);
  assert.ok(row.fields?.commercial?.materials.some((m) => m.text.includes('=HYPERLINK')));
});
test('blank values, absent columns and unknown fields remain different', () => {
  const result = parseCrmCsv(
    'Titre,Entreprise,Prochaine action,Champ inconnu\nA,Fictive,,secret inutile',
    undefined,
    at,
  );
  assert.deepEqual(result.rows[0]?.fields?.nextStep, { state: 'empty' });
  assert.deepEqual(result.rows[0].fields.nextStepDueAt, { state: 'unavailable' });
  assert.equal(result.columns[3]?.role, 'ignore');
  assert.ok(!JSON.stringify(result.rows).includes('secret inutile'));
});
test('invalid dates/money and restricted rows cannot be imported, even after remapping visibility', () => {
  const text =
    'Titre;Entreprise;Dernière interaction;Montant;Devise;Limiter la vue à ..\nA;Fictive;31/02/2026;1,2,3;EUR;Équipe privée';
  const r = parseCrmCsv(text, undefined, at).rows[0];
  assert.equal(r?.fields, null);
  assert.equal(r.errors.length, 3);
  const remapped = parseCrmCsv('Titre;Limiter la vue à ..\nA;Privé', ['title', 'ignore'], at);
  assert.equal(remapped.rows[0]?.fields, null);
});
test('stable identities survive row order, amounts and notes changing; duplicates are explicit', () => {
  const a = parseCrmCsv(
    'Titre;Entreprise;Notes\nA;Fictive;Ancienne note\nB;Autre;Texte',
    undefined,
    at,
  );
  const b = parseCrmCsv(
    'Titre;Entreprise;Notes\nB;Autre;Texte\nA;Fictive;Nouvelle note',
    undefined,
    at,
  );
  assert.equal(a.rows[0]?.identity, b.rows[1]?.identity);
  const d = parseCrmCsv('Titre;Entreprise\nA;Fictive\nA;Fictive', undefined, at);
  assert.ok(d.rows.every((r) => r.warnings.some((w) => w.includes('Plusieurs lignes'))));
});
test('explicit source identifiers remain separate from display titles; opposition is preserved', () => {
  const r = parseCrmCsv(
    'ID;Titre;Entreprise;Ne pas contacter;Pause until\n001;A;Fictive;oui;2026-11-01',
    undefined,
    at,
  ).rows[0];
  assert.equal(r?.sourceId, '001');
  assert.deepEqual(r.fields?.commercial?.contactPolicy, {
    opposed: true,
    pauseUntil: '2026-11-01T12:00:00.000Z',
  });
  const b = parseCrmCsv('ID;Titre;Entreprise\n001;Renommée;Fictive', undefined, at).rows[0];
  assert.equal(r.identity, b?.identity);
});
test('malformed quoting, excessive rows and binary files fail without partial output', () => {
  for (const text of [
    'Titre;Entreprise\n"unfinished;Fictive',
    'Titre\nA\u0000B',
    'Titre\n' + Array.from({ length: 2001 }, (_, i) => `A${i}`).join('\n'),
  ])
    assert.throws(() => parseCrmCsv(text, undefined, at), CrmCsvError);
});
