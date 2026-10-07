-- Optional fixture schema is installed by the development seed, never created in production.
-- Dynamic statements defer that optional table's existence check to invocation.
GRANT SELECT ON opportunities TO ulysse_definer;
CREATE FUNCTION app.demo_update_source(p_subject uuid,p_commercial jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE dataset text; external text; changed integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE tenant_id=app.current_tenant_id() AND user_id=app.current_user_id() AND role='owner' AND status='active') THEN
    RAISE EXCEPTION 'owner required' USING ERRCODE='42501';
  END IF;
  SELECT c.config->>'dataset',o.external_id INTO dataset,external FROM public.opportunities o
    JOIN public.connections c ON c.tenant_id=o.tenant_id AND c.id=o.connection_id
    WHERE o.tenant_id=app.current_tenant_id() AND o.id=p_subject AND o.deleted_at IS NULL AND c.provider='fixture-crm' AND c.status='active';
  IF dataset NOT IN ('acme-demo','globex-demo') OR external IS NULL OR octet_length(p_commercial::text)>60000 THEN
    RAISE EXCEPTION 'demo scope invalid' USING ERRCODE='42501';
  END IF;
  EXECUTE 'UPDATE fixture_crm.items SET payload=jsonb_set(payload,''{commercial}'',$3),seq=nextval(''fixture_crm.change_seq''),version=version+1,modified_at=clock_timestamp() WHERE dataset=$1 AND external_id=$2 AND NOT deleted'
    USING dataset,external,p_commercial;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'fixture unavailable'; END IF;
END $$;
REVOKE ALL ON FUNCTION app.demo_update_source(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.demo_update_source(uuid,jsonb) TO ulysse_app;
ALTER FUNCTION app.demo_update_source(uuid,jsonb) OWNER TO ulysse_definer;
