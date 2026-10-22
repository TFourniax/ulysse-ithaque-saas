/** Ephemeral CI only: the real Hermes loop reads the November corpus and explicitly abstains. */
import assert from 'node:assert/strict';
import { request } from '@playwright/test';
const origin = process.env.ULYSSE_SMOKE_ORIGIN ?? 'http://localhost:3000';
assert.equal(process.env.ULYSSE_EXPECT_MODE, 'hermes-stub');
const output = process.env.ULYSSE_EVIDENCE_DIR ?? 'test-results/ul016';
const context = await request.newContext({ storageState: `${output}/session.json` });
async function json(path, body) {
  const response =
    body === undefined
      ? await context.get(`${origin}${path}`)
      : await context.post(`${origin}${path}`, {
          data: body,
          headers: {
            origin,
            'x-csrf-token': me.csrfToken,
            'idempotency-key': crypto.randomUUID(),
          },
        });
  assert.equal(response.ok(), true, `${path}: ${response.status()}`);
  return response.json();
}
const me = await json('/v1/me');
try {
  const source = await json('/v1/workspace/sources', {
    kind: 'offer',
    title: 'Recette novembre — offre fictive',
    origin: 'company',
    url: null,
    observedAt: new Date().toISOString(),
    text: 'Diagnostic fictif de flux et maintenance pour un atelier industriel.',
  });
  for (const kind of ['buyer', 'content']) {
    const { id } = await json('/v1/workflows', {
      kind,
      sourceIds: [source.id],
      requestKey: crypto.randomUUID(),
      brief: {
        offer: 'Diagnostic de flux et maintenance',
        target: 'Responsable atelier — scénario fictif',
        phase: 'comparison',
        objective: 'Préparer un cadrage',
        channel: 'Article',
        constraints: 'Tout est fictif.',
        buyerRunId: null,
      },
    });
    const deadline = Date.now() + 150000;
    let result;
    while (Date.now() < deadline) {
      result = (await json('/v1/workflows')).find((r) => r.id === id);
      if (result && !['queued', 'running'].includes(result.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(result?.status, 'abstained', `${kind}: ${result?.status}/${result?.errorCode}`);
    assert.equal(result.mode, 'hermes-stub');
    assert.ok(result.agentRunId, 'went through the Hermes runtime');
    assert.match(result.result.summary, /Modèle simulé/);
    assert.ok(result.result.limits.includes('Sources obligatoires fournies automatiquement.'));
    assert.ok(result.result.limits.includes('Schéma natif reçu par le fournisseur simulé.'));
    assert.ok(result.result.limits.includes('Reprise après HTTP 429 du fournisseur simulé.'));
    if (kind === 'buyer')
      assert.ok(
        result.result.limits.includes('Relecture séparée exécutée avec les preuves consultées.'),
      );
    assert.equal(result.result.content, null);
    assert.equal(result.result.uniqueness, null);
    console.log(`UL017_${kind.toUpperCase()}_HERMES_STUB=passed`);
  }
  // Historical stub runs remain readable after the upgrade; new workflow runs have their own route.
  await json('/v1/agent-runs');
} finally {
  await context.dispose();
}
