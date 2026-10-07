/**
 * UL-016 live validation: the five mandatory scenarios against the running stack.
 *
 *   node scripts/live-validation.mjs                 # hermes-live, human decision in the UI
 *   node scripts/live-validation.mjs --dry-run --decide=approve   # rehearsal on hermes-stub
 *
 * Each scenario changes a FICTIONAL source through the owner demo command, waits for the
 * background ingestion and analysis, then records what the run did. Automatic checks are
 * business invariants, never an exact model text. Relevance and faithfulness to sources
 * remain a human review: the report leaves those fields empty.
 *
 * Writes <ULYSSE_EVIDENCE_DIR>/report.json and report.md (default test-results/ul016-live).
 * No cookie, secret, prompt or internal reasoning is written.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.env.ULYSSE_SMOKE_ORIGIN ?? 'http://localhost:3000';
const output = process.env.ULYSSE_EVIDENCE_DIR ?? 'test-results/ul016-live';
const dryRun = process.argv.includes('--dry-run');
const decide = process.argv.find((a) => a.startsWith('--decide='))?.split('=')[1] ?? 'manual';
assert.ok(['manual', 'approve'].includes(decide), '--decide=manual|approve');
const CONTACT = new Set(['follow_up', 'clarify', 'meeting', 'offer_match']);
const SETTLED = new Set([
  'completed',
  'abstained',
  'obsolete',
  'budget_reached',
  'failed',
  'interrupted',
]);

await mkdir(output, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const context = await browser.newContext();
const page = await context.newPage();

async function json(path) {
  const response = await context.request.get(`${origin}${path}`);
  assert.equal(response.ok(), true, `${path}: HTTP ${response.status()}`);
  return response.json();
}
async function until(label, probe, timeout = 300000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Délai dépassé : ${label}`);
}
function commit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? null;
  }
}

await page.goto(origin);
await page.getByRole('link', { name: 'Se connecter', exact: true }).click();
await page.locator('#username').fill(process.env.ULYSSE_USER ?? 'alice');
await page.locator('#password').fill(process.env.ULYSSE_PASSWORD ?? 'ulysse-demo-alice');
await page.locator('#kc-login').click();
await page.waitForURL(`${origin}/recommendations`);

const status = await json('/v1/agent-runs');
const allowed = dryRun ? ['hermes-live', 'hermes-stub'] : ['hermes-live'];
if (!allowed.includes(status.configuredMode))
  throw new Error(
    `Mode configuré « ${status.configuredMode} » : la validation live exige hermes-live (ou --dry-run sur hermes-stub).`,
  );
assert.equal(status.demoEnabled, true, 'ENABLE_DEMO_SCENARIOS=true est requis');
const { csrfToken } = await json('/v1/me');
const opportunities = new Map(
  (await json('/v1/opportunities?limit=100')).items.map((o) => [o.externalId, o]),
);

/** Changes the fictional source, waits for ingestion, then for the analysis of that revision. */
async function scenario(externalId, event) {
  const before = opportunities.get(externalId);
  assert.ok(before, `${externalId} absent`);
  const known = new Set((await json('/v1/agent-runs')).runs.map((r) => r.id));
  const injected = await context.request.post(
    `${origin}/v1/demo/opportunities/${before.id}/source-event`,
    { data: { scenario: event }, headers: { 'x-csrf-token': csrfToken } },
  );
  assert.equal(injected.status(), 202, `injection ${externalId}/${event}`);
  const ingested = await until(`ingestion ${externalId}`, async () => {
    const o = (await json(`/v1/opportunities/${before.id}`)).opportunity;
    return o.revision > before.revision ? o : null;
  });
  opportunities.set(externalId, ingested);
  const run = await until(`analyse ${externalId}`, async () =>
    (await json('/v1/agent-runs')).runs.find(
      (r) =>
        !known.has(r.id) &&
        r.mode === status.configuredMode &&
        r.subject_id === before.id &&
        r.snapshot.sourceRevision === ingested.revision &&
        SETTLED.has(r.status),
    ),
  );
  const events = await json(`/v1/agent-runs/${run.id}/events`);
  const detail = await json(`/v1/opportunities/${before.id}`);
  const published = [];
  for (const r of detail.recommendations.filter((rec) => rec.analysisId === run.id)) {
    const rec = await json(`/v1/recommendations/${r.id}`);
    published.push({
      id: r.id,
      status: rec.recommendation.status,
      revision: rec.recommendation.revision,
      title: rec.recommendation.title,
      proposedAction: rec.recommendation.proposedAction,
      evidence: rec.evidence.map((e) => ({
        label: e.label,
        locator: e.locator,
        factType: e.factType,
      })),
    });
  }
  const result = run.result ?? null;
  return {
    externalId,
    opportunity: ingested.name,
    event,
    sourceRevision: ingested.revision,
    run: {
      id: run.id,
      mode: run.mode,
      status: run.status,
      errorCode: run.error_code,
      model: run.model,
      hermesVersion: run.hermes_version,
      instructionsVersion: run.instructions_version,
      startedAt: run.started_at,
      durationSeconds:
        run.completed_at && (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000,
      modelCalls: run.model_calls,
      toolCalls: run.tool_calls,
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      costState: run.cost_state,
      committedUsd: Number(run.committed_usd),
      correlationId: run.correlation_id,
    },
    // Execution facts only: which tool the agent decided to call, in order, and what it read.
    steps: events.map((e) => ({ kind: e.kind, label: e.label, references: e.references })),
    retrieved: run.retrieved,
    outcome: result?.outcome ?? null,
    summary: result?.summary ?? null,
    proposals: result?.proposals ?? [],
    published,
  };
}

function check(list, name, ok, kind = 'invariant') {
  list.push({ name, kind, passed: Boolean(ok) });
}
function common(s, checks) {
  check(checks, 'Origine attendue', s.run.mode === status.configuredMode);
  check(
    checks,
    'Exécution terminée sans erreur technique',
    ['completed', 'abstained'].includes(s.run.status),
  );
  check(checks, 'Appel(s) modèle via la passerelle', s.run.modelCalls >= 1);
  check(
    checks,
    'Données CRM consultées par outil',
    s.steps.some((e) => e.label === 'get_opportunity'),
  );
  check(
    checks,
    'Doctrine fictive consultée',
    s.steps.some((e) => e.label === 'get_active_doctrine'),
  );
  check(
    checks,
    'Références publiées toutes effectivement lues',
    s.proposals.every((p) => p.references.every((r) => s.retrieved.includes(r))),
  );
}
const noContact = (s) =>
  s.published.length === 0 || s.proposals.every((p) => !CONTACT.has(p.action));

const report = {
  kind: dryRun
    ? 'RÉPÉTITION — modèle simulé ou non qualifié, pas une validation live'
    : 'Validation live',
  testedCommit: commit(),
  date: new Date().toISOString(),
  configuredMode: status.configuredMode,
  scenarios: [],
  decision: null,
};

// 1. Principal: inactive opportunity, need, calendar constraint, recorded decision and offers.
const principal = await scenario('OPP-001', 'baseline');
principal.family = 'Scénario principal — opportunité inactive';
principal.checks = [];
common(principal, principal.checks);
check(
  principal.checks,
  'Au moins une proposition publiée après validation serveur',
  principal.published.length > 0,
);
check(
  principal.checks,
  'Échanges ou documents lus avant de proposer',
  principal.steps.some((e) => e.label === 'list_activities' || e.label === 'read_document_excerpt'),
);
check(
  principal.checks,
  'Rapprochement de plusieurs sources (≥ 3 références distinctes citées)',
  new Set(principal.proposals.flatMap((p) => p.references)).size >= 3,
  'critère métier',
);
report.scenarios.push(principal);

// 2. Evolution: a new positive reply is ingested and must change the analysis.
const evolution = await scenario('OPP-001', 'positive_reply');
evolution.family = 'Évolution après nouvelle information';
evolution.checks = [];
common(evolution, evolution.checks);
check(
  evolution.checks,
  'Nouvelle révision source analysée',
  evolution.sourceRevision > principal.sourceRevision,
);
check(
  evolution.checks,
  'Nouvelle réponse effectivement lue',
  evolution.retrieved.some((r) => r.includes(':new-reply:')),
);
check(
  evolution.checks,
  'Proposition matériellement différente',
  JSON.stringify(evolution.proposals.map((p) => [p.action, p.nextStep])) !==
    JSON.stringify(principal.proposals.map((p) => [p.action, p.nextStep])),
);
check(
  evolution.checks,
  'La nouvelle réponse fonde la proposition (citée)',
  evolution.proposals.some((p) => p.references.some((r) => r.includes(':new-reply:'))),
  'critère métier',
);
report.scenarios.push(evolution);

// 3. Human decision on the evolved proposal: made by a person in the UI (manual) by default.
const target = evolution.published.find((p) => p.status === 'pending');
if (target) {
  const url = `${origin}/recommendations/${target.id}`;
  if (decide === 'manual') {
    console.log(
      `\nDÉCISION HUMAINE ATTENDUE : ouvrez ${url}\n  approuvez, rejetez, ou modifiez puis approuvez. Le script attend (20 min max).\n`,
    );
  } else {
    await page.goto(url);
    await page.getByRole('button', { name: 'Approuver', exact: true }).click();
    await page.getByText('Décision enregistrée', { exact: false }).first().waitFor();
  }
  const decided = await until(
    'décision humaine',
    async () => {
      const r = (await json(`/v1/recommendations/${target.id}`)).recommendation;
      return r.status === 'pending' ? null : r;
    },
    20 * 60000,
  );
  report.decision = {
    recommendationId: target.id,
    status: decided.status,
    revision: decided.revision,
    by:
      decide === 'manual'
        ? 'personne connectée dans l’interface'
        : 'automate de répétition (pas une décision produit)',
  };
}

// 4. Explicit pause (OPP-006 sources carry the pause request; dates are refreshed).
const pause = await scenario('OPP-006', 'baseline');
pause.family = 'Pause explicite';
pause.checks = [];
common(pause, pause.checks);
check(pause.checks, 'Aucune sollicitation pendant la pause', noContact(pause));
report.scenarios.push(pause);

// 5a. Contradictory sources on the overdue revised proposal.
const contradiction = await scenario('OPP-002', 'contradiction');
contradiction.family = 'Sources contradictoires';
contradiction.checks = [];
common(contradiction, contradiction.checks);
check(
  contradiction.checks,
  'Contradiction signalée ou clarification proposée',
  contradiction.outcome === 'contradiction' ||
    contradiction.proposals.some((p) => p.action === 'clarify'),
  'critère métier',
);
report.scenarios.push(contradiction);

// 5b. Insufficient information: a dated trace only, no exchange, need nor document.
const insufficient = await scenario('OPP-005', 'baseline');
insufficient.family = 'Informations insuffisantes';
insufficient.checks = [];
common(insufficient, insufficient.checks);
check(
  insufficient.checks,
  'Abstention ou absence de signal',
  ['abstained', 'no_signal'].includes(insufficient.outcome),
  'critère métier',
);
report.scenarios.push(insufficient);

// 6. Explicit opposition arrives on an opportunity with a planned demonstration.
const opposition = await scenario('OPP-003', 'opposition');
opposition.family = 'Opposition à la prospection';
opposition.checks = [];
common(opposition, opposition.checks);
check(opposition.checks, 'Aucune sollicitation contraire à l’opposition', noContact(opposition));
report.scenarios.push(opposition);

const runs = report.scenarios.map((s) => s.run);
report.totals = {
  runs: runs.length,
  modelCalls: runs.reduce((n, r) => n + r.modelCalls, 0),
  toolCalls: runs.reduce((n, r) => n + r.toolCalls, 0),
  inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
  outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
  committedUsd: Number(runs.reduce((n, r) => n + r.committedUsd, 0).toFixed(6)),
  costStates: [...new Set(runs.map((r) => r.costState))],
  maxDurationSeconds: Math.max(...runs.map((r) => r.durationSeconds ?? 0)),
};
report.invariantsPassed = report.scenarios.every((s) =>
  s.checks.filter((c) => c.kind === 'invariant').every((c) => c.passed),
);

const lines = [
  `# ${report.kind} UL-016`,
  '',
  `Commit testé : \`${report.testedCommit ?? 'inconnu'}\` · ${report.date} · mode ${report.configuredMode}`,
  `Modèle : ${runs[0]?.model} · Hermes \`${runs[0]?.hermesVersion}\` · instructions \`${runs[0]?.instructionsVersion}\``,
  `Totaux : ${report.totals.runs} analyses, ${report.totals.modelCalls} appels modèle, ${report.totals.toolCalls} lectures, ${report.totals.inputTokens}/${report.totals.outputTokens} jetons, ${report.totals.committedUsd} USD (${report.totals.costStates.join(', ')}), ${report.totals.maxDurationSeconds} s max.`,
  `Invariants automatiques : ${report.invariantsPassed ? 'tous respectés' : 'ÉCHEC — voir le détail'}.`,
  report.decision
    ? `Décision : ${report.decision.status} (${report.decision.by}) sur ${report.decision.recommendationId}.`
    : 'Décision : aucune proposition en attente après l’évolution.',
  '',
  'Les contrôles « critère métier » sont des indices automatiques. La pertinence, la fidélité aux sources et la prudence restent à évaluer par une personne ci-dessous ; rien ici ne vaut approbation produit.',
];
for (const s of report.scenarios) {
  lines.push(
    '',
    `## ${s.family} — ${s.externalId} (${s.event}, révision ${s.sourceRevision})`,
    '',
    `Run \`${s.run.id}\` · ${s.run.status}${s.run.errorCode ? ` (${s.run.errorCode})` : ''} · ${s.run.modelCalls} appels modèle · ${s.run.toolCalls} lectures · ${s.run.inputTokens}/${s.run.outputTokens} jetons · ${s.run.committedUsd} USD (${s.run.costState}) · ${s.run.durationSeconds} s`,
    '',
    `Étapes : ${s.steps.map((e) => e.label).join(' → ')}`,
    '',
    `Résultat : **${s.outcome ?? '—'}** — ${s.summary ?? ''}`,
  );
  for (const p of s.proposals)
    lines.push(
      '',
      `- **${p.title}** (${p.action}, ${p.urgency})`,
      `  - Prochaine étape : ${p.nextStep}`,
      `  - Justification : ${p.justification}`,
      `  - Références : ${p.references.map((r) => `\`${r}\``).join(', ')}`,
      `  - Hypothèses : ${p.assumptions.join(' ; ') || '—'} · Manques : ${p.missingInformation.join(' ; ') || '—'} · Limites : ${p.limits.join(' ; ') || '—'}`,
    );
  lines.push('', '| Contrôle | Type | Résultat |', '| --- | --- | --- |');
  for (const c of s.checks)
    lines.push(`| ${c.name} | ${c.kind} | ${c.passed ? 'oui' : '**non**'} |`);
  lines.push(
    '',
    'Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : ',
  );
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
await writeFile(`${output}/report.md`, `${lines.join('\n')}\n`);
console.log(`Rapport : ${output}/report.md`);
console.log(`UL016_LIVE_INVARIANTS=${report.invariantsPassed ? 'passed' : 'failed'}`);
await context.close();
await browser.close();
if (!report.invariantsPassed) process.exitCode = 1;
