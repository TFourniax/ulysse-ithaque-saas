/** Ephemeral CI: real Hermes recovery, cited buyer draft, review repair and linked content. */
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
  const rivals = [];
  for (const name of ['A', 'B'])
    rivals.push(
      await json('/v1/workspace/sources', {
        kind: 'competitor',
        title: `Alternative fictive ${name}`,
        origin: 'company',
        url: null,
        observedAt: new Date().toISOString(),
        text: `Prestataire fictif ${name} : audit de flux et maintenance, tarif non précisé.`,
      }),
    );
  let buyerId = null;
  for (const kind of ['buyer', 'content']) {
    const { id } = await json('/v1/workflows', {
      kind,
      sourceIds: [source.id, ...rivals.map((r) => r.id)],
      requestKey: crypto.randomUUID(),
      brief: {
        offer: 'Diagnostic de flux et maintenance',
        target: 'Responsable atelier — scénario fictif',
        phase: 'comparison',
        objective: 'Préparer un cadrage',
        channel: 'Article',
        constraints: 'Tout est fictif. CI_NATIVE_FALLBACK CI_MISSING_BENCHMARK',
        buyerRunId: buyerId,
      },
    });
    const deadline = Date.now() + 420000;
    let result;
    while (Date.now() < deadline) {
      result = (await json('/v1/workflows')).find((r) => r.id === id);
      if (result && !['queued', 'running'].includes(result.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(result?.status, 'draft', `${kind}: ${result?.status}/${result?.errorCode}`);
    assert.equal(result.mode, 'hermes-stub');
    assert.ok(result.agentRunId, 'went through the Hermes runtime');
    assert.match(result.result.summary, /Modèle simulé/);
    assert.ok(result.result.limits.includes('Sources obligatoires fournies automatiquement.'));
    assert.ok(result.result.limits.includes('Schéma natif reçu par le fournisseur simulé.'));
    assert.ok(result.result.limits.includes('Reprise après HTTP 429 du fournisseur simulé.'));
    if (kind === 'buyer') {
      buyerId = id;
      assert.ok(
        result.result.limits.includes('Relecture séparée exécutée avec les preuves consultées.'),
      );
      assert.equal(result.result.benchmark.length, 2);
      assert.ok(
        result.result.limits.includes('Benchmark omis puis corrigé avec les preuves fournies.'),
      );
      for (const row of result.result.benchmark) {
        assert.ok(row.references.includes(`source:${source.id}:r1`));
        assert.ok(rivals.some((r) => row.references.includes(`source:${r.id}:r1`)));
      }
      assert.equal(result.result.content, null);
    } else {
      assert.ok(result.result.content);
      assert.ok(result.result.content.references.includes(`buyer:${buyerId}`));
      assert.equal(result.result.uniqueness, null);
    }
    assert.equal(
      result.result.limits.includes('Modèle de secours simulé utilisé.'),
      Boolean(process.env.AGENT_FALLBACK_MODEL_ID),
      'Hermes uses a backup only when configured',
    );
    console.log(`UL017_${kind.toUpperCase()}_HERMES_STUB=passed`);
  }
  // Historical stub runs remain readable after the upgrade; new workflow runs have their own route.
  await json('/v1/agent-runs');
} finally {
  await context.dispose();
}
