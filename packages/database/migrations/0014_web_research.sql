-- UL-020: public research is separate from approved knowledge and private CRM material.
CREATE TABLE research_policies (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id), revision integer NOT NULL CHECK(revision>0),
  profile jsonb NOT NULL, authorized_by uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE research_campaigns (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1, profile jsonb NOT NULL, profile_revision integer NOT NULL,
  context_version integer NOT NULL, input_hash text NOT NULL, request_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','paused','completed','cancelled','failed')),
  stop_reason text, searches integer NOT NULL DEFAULT 0, pages integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_key)
);
CREATE TABLE research_candidates (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, id uuid NOT NULL,
  domain text NOT NULL, revision integer NOT NULL DEFAULT 1, body jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campaign_id,domain),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES research_campaigns(tenant_id,id)
);
CREATE TABLE research_pages (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, candidate_id uuid NOT NULL,
  id uuid NOT NULL, url text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campaign_id,url),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES research_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,candidate_id) REFERENCES research_candidates(tenant_id,id)
);
CREATE TABLE research_tasks (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, id uuid NOT NULL,
  task_key text NOT NULL, body jsonb NOT NULL, priority integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
  attempt integer NOT NULL DEFAULT 0, lease uuid, expires_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}', error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campaign_id,task_key),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES research_campaigns(tenant_id,id)
);
CREATE INDEX research_tasks_pending ON research_tasks(tenant_id,campaign_id,status,priority,created_at);
CREATE TABLE research_calls (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, task_id uuid NOT NULL, id uuid NOT NULL,
  session_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('search','model')),
  cost_usd numeric(12,6) NOT NULL CHECK(cost_usd>=0), reserved_usd numeric(12,6) NOT NULL CHECK(reserved_usd>=0),
  cost_state text NOT NULL DEFAULT 'unknown' CHECK(cost_state IN ('unknown','estimated','declared')),
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,task_id) REFERENCES research_tasks(tenant_id,id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES research_campaigns(tenant_id,id)
);
CREATE INDEX research_calls_budget ON research_calls(session_id,created_at);
CREATE TABLE research_reviews (
  tenant_id uuid NOT NULL, id uuid NOT NULL, candidate_id uuid NOT NULL, revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id), decision jsonb NOT NULL, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,candidate_id) REFERENCES research_candidates(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['research_policies','research_campaigns','research_candidates','research_pages','research_tasks','research_calls','research_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id())',t);
    EXECUTE format('GRANT SELECT ON %I TO ulysse_app,ulysse_worker',t);
  END LOOP;
END $$;
GRANT INSERT,UPDATE ON research_policies,research_campaigns,research_candidates,research_tasks TO ulysse_app;
GRANT INSERT ON research_reviews TO ulysse_app;
GRANT INSERT,UPDATE ON research_campaigns,research_candidates,research_pages,research_tasks,research_calls TO ulysse_worker;
GRANT SELECT ON research_policies,research_campaigns,research_tasks,research_calls TO ulysse_definer;
GRANT INSERT ON research_calls TO ulysse_definer;
ALTER TABLE workflow_requests ADD COLUMN research_id uuid;
ALTER TABLE workflow_requests ADD CONSTRAINT workflow_research_fk FOREIGN KEY(tenant_id,research_id) REFERENCES research_campaigns(tenant_id,id);

-- Same lock and financial ceilings as model gateway. Unknown charges retain their upper bound.
CREATE FUNCTION app.reserve_research_call(p_id uuid,p_campaign uuid,p_task uuid,p_lease uuid,p_kind text,p_cost numeric,p_session text,p_session_usd numeric,p_month_usd numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid := app.current_tenant_id(); c public.research_campaigns; total numeric;
BEGIN
  IF p_cost<=0 OR p_cost>.25 OR p_kind NOT IN ('search','model') OR p_session_usd<=0 OR p_session_usd>2 OR p_month_usd<=0 OR p_month_usd>10 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(160016);
  SELECT * INTO c FROM public.research_campaigns WHERE tenant_id=tenant AND id=p_campaign FOR UPDATE;
  IF NOT FOUND OR c.status<>'running' OR NOT EXISTS(SELECT 1 FROM public.research_policies WHERE tenant_id=tenant AND revision=c.profile_revision AND (profile->>'enabled')::boolean AND EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id JOIN public.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=tenant AND m.user_id=authorized_by AND m.status='active' AND m.role='owner' AND u.status='active' AND t.status='active')) OR NOT EXISTS(SELECT 1 FROM public.research_tasks WHERE tenant_id=tenant AND campaign_id=p_campaign AND id=p_task AND lease=p_lease AND status='running' AND expires_at>clock_timestamp()) THEN RETURN false; END IF;
  SELECT coalesce(sum(cost_usd),0) INTO total FROM public.research_calls WHERE tenant_id=tenant AND campaign_id=p_campaign;
  IF total+p_cost>(c.profile->>'budgetUsd')::numeric THEN RETURN false; END IF;
  SELECT coalesce(sum(cost_usd),0) INTO total FROM public.research_calls WHERE session_id=p_session;
  total := total+(SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) FROM public.agent_runs WHERE session_id=p_session AND mode='hermes-live');
  IF total+p_cost>p_session_usd THEN RETURN false; END IF;
  SELECT coalesce(sum(cost_usd),0) INTO total FROM public.research_calls WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp());
  total := total+(SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) FROM public.agent_runs WHERE tenant_id=tenant AND mode='hermes-live' AND started_at>=date_trunc('month',clock_timestamp()));
  total := total+(SELECT coalesce(sum(coalesce(cost_usd,p_month_usd)),0) FROM public.model_usage WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp()));
  IF total+p_cost>p_month_usd THEN RETURN false; END IF;
  INSERT INTO public.research_calls(tenant_id,campaign_id,task_id,id,session_id,kind,cost_usd,reserved_usd) VALUES(tenant,p_campaign,p_task,p_id,p_session,p_kind,p_cost,p_cost);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.reserve_research_call(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_research_call(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric) TO ulysse_worker;
ALTER FUNCTION app.reserve_research_call(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric) OWNER TO ulysse_definer;

-- Research reservations count towards existing workflow ceilings as well.
-- The existing function belongs to the NOLOGIN definer; the migrator has SET, not INHERIT.
SET LOCAL ROLE ulysse_definer;
CREATE OR REPLACE FUNCTION app.reserve_agent_run_budget(p_run uuid, p_run_usd numeric, p_session_usd numeric, p_month_usd numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_runs; tenant uuid := app.current_tenant_id(); total numeric;
BEGIN
  IF p_run_usd <= 0 OR p_run_usd > .25 OR p_session_usd <= 0 OR p_session_usd > 2 OR p_month_usd <= 0 OR p_month_usd > 10 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(160016);
  SELECT * INTO r FROM public.agent_runs WHERE tenant_id=tenant AND id=p_run FOR UPDATE;
  IF NOT FOUND OR r.status <> 'running' OR r.mode NOT IN ('hermes-live','hermes-stub') OR r.reserved_usd <> 0 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.agent_runs WHERE mode IN ('hermes-live','hermes-stub') AND status IN ('running','validating') AND expires_at > clock_timestamp() AND reserved_usd>0) >= 2
    OR EXISTS(SELECT 1 FROM public.agent_runs WHERE tenant_id=tenant AND status IN ('running','validating') AND expires_at>clock_timestamp() AND reserved_usd>0) THEN RETURN false; END IF;
  SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) INTO total FROM public.agent_runs WHERE session_id=r.session_id AND mode=r.mode;
  IF r.mode = 'hermes-live' THEN total := total + (SELECT coalesce(sum(cost_usd),0) FROM public.research_calls WHERE session_id=r.session_id); END IF;
  IF total + p_run_usd > p_session_usd THEN RETURN false; END IF;
  SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) INTO total FROM public.agent_runs WHERE tenant_id=tenant AND mode=r.mode AND started_at>=date_trunc('month',clock_timestamp());
  IF r.mode = 'hermes-live' THEN
    total := total + (SELECT coalesce(sum(cost_usd),0) FROM public.research_calls WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp()));
    total := total + (SELECT coalesce(sum(coalesce(cost_usd,p_month_usd)),0) FROM public.model_usage WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp()));
  END IF;
  IF total + p_run_usd > p_month_usd THEN RETURN false; END IF;
  UPDATE public.agent_runs SET reserved_usd=p_run_usd WHERE tenant_id=tenant AND id=p_run;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) TO ulysse_worker;
ALTER FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) OWNER TO ulysse_definer;

RESET ROLE;
