-- 0007 — Observed model usage per tenant (tokens, reported cost, latency, outcome).
-- No prompt, output or source content is stored here: only counters and identifiers.
CREATE TABLE model_usage (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  recommendation_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('formulated', 'abstained', 'rejected', 'failed', 'skipped_budget')),
  error_code text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX model_usage_month_idx ON model_usage (tenant_id, created_at);
ALTER TABLE model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_usage TO ulysse_runtime
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON model_usage TO ulysse_runtime;
