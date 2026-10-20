-- UL-017: no tenant or fictional company is inserted by this migration.
CREATE TABLE workspace_sources (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0), body jsonb NOT NULL,
  retired_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE workflow_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('buyer','content')), brief jsonb NOT NULL,
  source_ids uuid[] NOT NULL, request_key uuid NOT NULL, request_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','draft','needs_context','abstained','approved','rejected','obsolete','failed')),
  mode text NOT NULL CHECK(mode IN ('rules','simulated','hermes-live')),
  input_hash text, agent_run_id uuid, result jsonb, error_code text,
  created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,created_by,request_key),
  FOREIGN KEY(tenant_id,agent_run_id) REFERENCES agent_runs(tenant_id,id)
);
ALTER TABLE agent_runs ADD COLUMN workflow_kind text NOT NULL DEFAULT 'deal'
  CHECK(workflow_kind IN ('deal','buyer','content'));
ALTER TABLE workspace_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_sources USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
CREATE POLICY tenant_isolation ON workflow_requests USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON workspace_sources,workflow_requests TO ulysse_app;
GRANT SELECT ON workspace_sources TO ulysse_worker;
GRANT SELECT,UPDATE ON workflow_requests TO ulysse_worker;
CREATE INDEX workflow_requests_recent ON workflow_requests(tenant_id,created_at DESC);
-- A withdrawn source erases derived copies, including linked content workflows.
CREATE FUNCTION app.withdraw_workspace_source(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid := app.current_tenant_id();
BEGIN
  IF tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_sources WHERE tenant_id=tenant AND id=p_id AND retired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'source must be withdrawn first' USING ERRCODE='insufficient_privilege';
  END IF;
  -- Conservative tenant-wide invalidation avoids keeping downstream buyer copies.
  DELETE FROM public.agent_events WHERE tenant_id=tenant AND run_id IN
    (SELECT agent_run_id FROM public.workflow_requests WHERE tenant_id=tenant);
  UPDATE public.agent_runs SET result=NULL,retrieved='{}',snapshot='{}',status='obsolete',error_code='source_withdrawn'
    WHERE tenant_id=tenant AND workflow_kind<>'deal';
  UPDATE public.workflow_requests SET result=NULL,status='obsolete',revision=revision+1,error_code='source_withdrawn'
    WHERE tenant_id=tenant;
END $$;
GRANT SELECT ON workspace_sources TO ulysse_definer;
GRANT SELECT,UPDATE ON workflow_requests TO ulysse_definer;
REVOKE ALL ON FUNCTION app.withdraw_workspace_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.withdraw_workspace_source(uuid) TO ulysse_app;
ALTER FUNCTION app.withdraw_workspace_source(uuid) OWNER TO ulysse_definer;
