-- UL-016: bounded agent execution. Canonical state remains in PostgreSQL.
CREATE TABLE agent_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  subject_id uuid NOT NULL,
  input_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('simulated', 'hermes-live')),
  status text NOT NULL CHECK (status IN ('running','validating','completed','abstained','obsolete','budget_reached','failed','interrupted')),
  trigger text NOT NULL,
  snapshot jsonb NOT NULL,
  capability_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  session_id text NOT NULL,
  model text NOT NULL,
  hermes_version text NOT NULL,
  instructions_version text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  result jsonb,
  error_code text,
  retrieved text[] NOT NULL DEFAULT '{}',
  tool_calls integer NOT NULL DEFAULT 0 CHECK (tool_calls BETWEEN 0 AND 12),
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 8),
  uncertain_calls integer NOT NULL DEFAULT 0 CHECK (uncertain_calls BETWEEN 0 AND 8),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  committed_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (committed_usd >= 0),
  cost_state text NOT NULL DEFAULT 'unknown' CHECK (cost_state IN ('declared','estimated','unknown')),
  correlation_id text NOT NULL,
  PRIMARY KEY (tenant_id,id)
);
CREATE INDEX agent_runs_recent ON agent_runs(tenant_id,started_at DESC);
CREATE UNIQUE INDEX agent_runs_no_double_publication ON agent_runs(tenant_id,subject_id,input_hash,mode)
  WHERE status IN ('running','validating','completed','abstained');
CREATE TABLE agent_events (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 40),
  kind text NOT NULL,
  label text NOT NULL CHECK (length(label) <= 200),
  reference_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,run_id,sequence),
  FOREIGN KEY (tenant_id,run_id) REFERENCES agent_runs(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_runs USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON agent_events USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT ON agent_runs,agent_events TO ulysse_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON agent_runs,agent_events TO ulysse_worker;
GRANT SELECT,UPDATE ON agent_runs TO ulysse_definer;
GRANT SELECT ON model_usage TO ulysse_definer;

-- The global lock prevents two tenants both spending the same remaining budget.
-- Unknown historical cost blocks live instead of being counted as zero (DEBT-014).
CREATE FUNCTION app.reserve_agent_budget(p_run uuid, p_run_usd numeric, p_session_usd numeric, p_month_usd numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_runs; tenant uuid := app.current_tenant_id(); total numeric;
BEGIN
  IF p_run_usd <= 0 OR p_run_usd > .25 OR p_session_usd <= 0 OR p_session_usd > 2 OR p_month_usd <= 0 OR p_month_usd > 10 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(160016);
  SELECT * INTO r FROM public.agent_runs WHERE tenant_id=tenant AND id=p_run FOR UPDATE;
  IF NOT FOUND OR r.status <> 'running' OR r.mode <> 'hermes-live' OR r.reserved_usd <> 0 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.agent_runs WHERE mode='hermes-live' AND status IN ('running','validating') AND expires_at > clock_timestamp() AND reserved_usd>0) >= 2
    OR EXISTS(SELECT 1 FROM public.agent_runs WHERE tenant_id=tenant AND status IN ('running','validating') AND expires_at>clock_timestamp() AND reserved_usd>0) THEN RETURN false; END IF;
  SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) INTO total FROM public.agent_runs WHERE session_id=r.session_id AND mode='hermes-live';
  IF total + p_run_usd > p_session_usd THEN RETURN false; END IF;
  SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) INTO total FROM public.agent_runs WHERE tenant_id=tenant AND mode='hermes-live' AND started_at>=date_trunc('month',clock_timestamp());
  total := total + (SELECT coalesce(sum(coalesce(cost_usd,p_month_usd)),0) FROM public.model_usage WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp()));
  IF total + p_run_usd > p_month_usd THEN RETURN false; END IF;
  UPDATE public.agent_runs SET reserved_usd=p_run_usd WHERE tenant_id=tenant AND id=p_run;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.reserve_agent_budget(uuid,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_agent_budget(uuid,numeric,numeric,numeric) TO ulysse_worker;
ALTER FUNCTION app.reserve_agent_budget(uuid,numeric,numeric,numeric) OWNER TO ulysse_definer;

-- Only opaque execution capability hashes cross the private service boundary.
CREATE FUNCTION app.resolve_agent_capability(p_hash text)
RETURNS TABLE(tenant_id uuid,id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT r.tenant_id,r.id FROM public.agent_runs r WHERE r.capability_hash=p_hash
    AND r.status='running' AND r.expires_at>clock_timestamp() LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.resolve_agent_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_agent_capability(text) TO ulysse_worker;
ALTER FUNCTION app.resolve_agent_capability(text) OWNER TO ulysse_definer;

CREATE FUNCTION app.agent_slot_available()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(160016);
  RETURN NOT EXISTS(SELECT 1 FROM public.agent_runs WHERE tenant_id=app.current_tenant_id() AND status IN ('running','validating') AND expires_at>clock_timestamp())
    AND (SELECT count(*) FROM public.agent_runs WHERE status IN ('running','validating') AND expires_at>clock_timestamp()) < 2;
END $$;
REVOKE ALL ON FUNCTION app.agent_slot_available() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.agent_slot_available() TO ulysse_worker;
ALTER FUNCTION app.agent_slot_available() OWNER TO ulysse_definer;
