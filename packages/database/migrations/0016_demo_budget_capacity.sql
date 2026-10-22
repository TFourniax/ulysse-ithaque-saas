-- UL-020: product decision, prioritize useful completion before fine cost optimization.
-- Raise configurable demo ceilings to $2/run, $20/session, $100/tenant/month.
-- No costs, reservations, identities, policies or previous migrations are rewritten.
-- Same tenant authorization, leases, concurrency and shared financial lock.
SET LOCAL ROLE ulysse_definer;
CREATE OR REPLACE FUNCTION app.reserve_research_call(p_id uuid,p_campaign uuid,p_task uuid,p_lease uuid,p_kind text,p_cost numeric,p_session text,p_session_usd numeric,p_month_usd numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid := app.current_tenant_id(); c public.research_campaigns; total numeric;
BEGIN
  IF p_cost<=0 OR p_cost>2 OR p_kind NOT IN ('search','model') OR p_session_usd<=0 OR p_session_usd>20 OR p_month_usd<=0 OR p_month_usd>100 THEN RETURN false; END IF;
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


CREATE OR REPLACE FUNCTION app.reserve_agent_run_budget(p_run uuid, p_run_usd numeric, p_session_usd numeric, p_month_usd numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_runs; tenant uuid := app.current_tenant_id(); total numeric;
BEGIN
  IF p_run_usd <= 0 OR p_run_usd > 2 OR p_session_usd <= 0 OR p_session_usd > 20 OR p_month_usd <= 0 OR p_month_usd > 100 THEN RETURN false; END IF;
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
