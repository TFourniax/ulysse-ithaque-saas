-- 0008 — Optional reviewer assessment recorded with each decision (UL-012b), used to
-- measure the value of proposals during a pilot. Additive: existing decisions stay
-- unlabelled. `useful` goes with an approval; the other labels explain a rejection.
ALTER TABLE decisions ADD COLUMN quality text
  CHECK (quality IS NULL OR quality IN ('useful', 'not_actionable', 'duplicate', 'outdated', 'unfounded', 'out_of_scope'));
ALTER TABLE decisions ADD CONSTRAINT decisions_quality_matches_decision
  CHECK (quality IS NULL OR (decision = 'approve') = (quality = 'useful'));

-- Period reports read decisions and recommendations by date within a tenant.
CREATE INDEX decisions_created_idx ON decisions (tenant_id, created_at, id);
CREATE INDEX recommendations_generated_idx ON recommendations (tenant_id, generated_at, id);
