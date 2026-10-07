-- UL-016 (suite) : mode « Hermes réel, modèle simulé » (hermes-stub) pour recetter la stack
-- complète sans fournisseur payant. Sa comptabilité est séparée du live : un run simulé ne
-- consomme jamais le budget d'une session ou d'un mois live, et inversement.
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_mode_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_mode_check
  CHECK (mode IN ('simulated', 'hermes-live', 'hermes-stub'));

-- Replaces app.reserve_agent_budget (0009, now unused). Same locks and plafonds; totals are
-- computed per execution mode, and unknown legacy wording costs still block live (DEBT-014).
CREATE FUNCTION app.reserve_agent_run_budget(p_run uuid, p_run_usd numeric, p_session_usd numeric, p_month_usd numeric)
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
  IF total + p_run_usd > p_session_usd THEN RETURN false; END IF;
  SELECT coalesce(sum(greatest(reserved_usd,committed_usd)),0) INTO total FROM public.agent_runs WHERE tenant_id=tenant AND mode=r.mode AND started_at>=date_trunc('month',clock_timestamp());
  IF r.mode = 'hermes-live' THEN
    total := total + (SELECT coalesce(sum(coalesce(cost_usd,p_month_usd)),0) FROM public.model_usage WHERE tenant_id=tenant AND created_at>=date_trunc('month',clock_timestamp()));
  END IF;
  IF total + p_run_usd > p_month_usd THEN RETURN false; END IF;
  UPDATE public.agent_runs SET reserved_usd=p_run_usd WHERE tenant_id=tenant AND id=p_run;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) TO ulysse_worker;
ALTER FUNCTION app.reserve_agent_run_budget(uuid,numeric,numeric,numeric) OWNER TO ulysse_definer;
