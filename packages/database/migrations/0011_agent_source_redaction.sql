-- Agent input copies are withdrawable; business decisions and usage accounting remain.
-- This additive migration also covers a worker restarted in historical/rules mode.
GRANT SELECT ON recommendations, evidence_links TO ulysse_definer;
GRANT UPDATE (state, value, label) ON evidence_links TO ulysse_definer;
GRANT SELECT, DELETE ON agent_events TO ulysse_definer;

CREATE FUNCTION app.purge_agent_artifacts(p_connection uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid := app.current_tenant_id();
BEGIN
  IF tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.connections WHERE tenant_id=tenant AND id=p_connection AND status='revoked'
  ) THEN
    RAISE EXCEPTION 'agent copies require a revoked connection in the current tenant'
      USING ERRCODE='insufficient_privilege';
  END IF;
  DELETE FROM public.agent_events e USING public.agent_runs r, public.opportunities o
    WHERE e.tenant_id=tenant AND r.tenant_id=tenant AND o.tenant_id=tenant
      AND e.run_id=r.id AND r.subject_id=o.id AND o.connection_id=p_connection;
  UPDATE public.agent_runs SET result=NULL,retrieved='{}',snapshot='{}',
    status=CASE WHEN status IN ('running','validating') THEN 'interrupted' ELSE status END,
    error_code='source_purged'
    WHERE tenant_id=tenant AND subject_id IN (
      SELECT id FROM public.opportunities WHERE tenant_id=tenant AND connection_id=p_connection
    );
  UPDATE public.evidence_links e SET state='unavailable',value=NULL,label='Preuve retirée avec la source'
    FROM public.recommendations r
    WHERE e.tenant_id=tenant AND r.tenant_id=tenant AND e.recommendation_id=r.id
      AND e.connection_id=p_connection AND r.rule_id='ulysse.agent.v1';
END $$;
REVOKE ALL ON FUNCTION app.purge_agent_artifacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_agent_artifacts(uuid) TO ulysse_worker;
ALTER FUNCTION app.purge_agent_artifacts(uuid) OWNER TO ulysse_definer;
