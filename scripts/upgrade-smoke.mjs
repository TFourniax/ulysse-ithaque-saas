/** Upgrade evidence through the authenticated API; fictional account only. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'http://localhost:3000';
const sessionFile = process.env.ULYSSE_UPGRADE_SESSION;
const proofFile = process.env.ULYSSE_UPGRADE_PROOF;
assert.ok(sessionFile && proofFile);
const cookie = JSON.parse(await readFile(sessionFile, 'utf8')).map(([k,v]) => `${k}=${v}`).join('; ');
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { cookie, ...init.headers } });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}
const me = await request('/v1/me');
if (process.argv.includes('--before')) {
  const opportunities = (await request('/v1/opportunities?limit=100')).items;
  const recs = (await request('/v1/recommendations?limit=100')).items;
  const rec = recs.find(r => r.subject.externalId !== 'OPP-001');
  assert.ok(rec, 'a separate historical subject can record an upgrade decision');
  await request(`/v1/recommendations/${rec.id}/decisions`, {
    method: 'POST', headers: { 'content-type':'application/json', 'x-csrf-token':me.csrfToken, 'idempotency-key':crypto.randomUUID(), origin:base },
    body: JSON.stringify({ expectedRevision:rec.revision, decision:'approve', reason:'Décision fictive avant mise à niveau UL-016' }),
  });
  await writeFile(proofFile, JSON.stringify({ tenantId:me.activeTenant.id, opportunityIds:opportunities.map(o=>o.id), recommendationId:rec.id }, null, 2));
  console.log('UL016_UPGRADE_BEFORE=passed');
} else {
  const proof = JSON.parse(await readFile(proofFile, 'utf8'));
  assert.equal(me.activeTenant.id, proof.tenantId);
  const opportunities = (await request('/v1/opportunities?limit=100')).items;
  assert.ok(proof.opportunityIds.every(id=>opportunities.some(o=>o.id===id)));
  const detail = await request(`/v1/recommendations/${proof.recommendationId}`);
  assert.equal(detail.recommendation.status, 'approved');
  assert.ok(detail.decisions.some(d=>d.decision==='approve'));
  const deadline = Date.now() + 60000;
  let enriched = false;
  while (Date.now() < deadline) {
    const list = (await request('/v1/opportunities?limit=100')).items;
    enriched = list.some(o=>o.externalId==='OPP-001' && o.commercial?.materials.length > 0);
    if (enriched) break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(enriched, true, 'upgraded fixture data passed through ingestion');
  console.log('UL016_UPGRADE_PRESERVED_STATE=passed');
}
