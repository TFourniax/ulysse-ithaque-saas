-- Reviewed CRM files. The application stages a proposal; the existing worker queue applies it.
CREATE TABLE crm_import_batches (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  connection_id uuid, created_by uuid NOT NULL REFERENCES users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
  status text NOT NULL CHECK(status IN ('preview','queued','completed','failed','cancelled')),
  preview jsonb, selections jsonb, snapshot text NOT NULL,
  result jsonb, error_code text, confirmation_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL, completed_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id)
);
CREATE TABLE crm_import_items (
  tenant_id uuid NOT NULL, connection_id uuid NOT NULL, id uuid NOT NULL,
  identity_hash text NOT NULL, source_id text,
  title text NOT NULL, company text NOT NULL,
  revision integer NOT NULL CHECK(revision > 0), content_hash text NOT NULL,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id)
);
CREATE INDEX crm_items_connection ON crm_import_items(tenant_id,connection_id,identity_hash);
CREATE INDEX crm_batches_recent ON crm_import_batches(tenant_id,created_at DESC);
CREATE INDEX crm_batches_pending ON crm_import_batches(tenant_id,connection_id,created_at) WHERE status='queued';
CREATE UNIQUE INDEX crm_one_queued ON crm_import_batches(tenant_id,connection_id) WHERE status='queued';
ALTER TABLE crm_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_import_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_import_batches TO ulysse_runtime USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
CREATE POLICY tenant_isolation ON crm_import_items TO ulysse_runtime USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON crm_import_batches TO ulysse_app;
GRANT SELECT,UPDATE ON crm_import_batches TO ulysse_worker;
GRANT SELECT ON crm_import_items TO ulysse_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON crm_import_items TO ulysse_worker;

-- Source revocation erases staging copies immediately, even before worker cleanup.
GRANT SELECT,UPDATE ON crm_import_batches TO ulysse_definer;
GRANT SELECT,DELETE ON crm_import_items TO ulysse_definer;
CREATE FUNCTION app.withdraw_crm_imports() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status='revoked' AND OLD.status<>'revoked' THEN
    UPDATE public.crm_import_batches SET preview=NULL,selections=NULL,filename='Source retirée',
      status=CASE WHEN status IN ('preview','queued') THEN 'cancelled' ELSE status END
      WHERE tenant_id=NEW.tenant_id AND connection_id=NEW.id;
    DELETE FROM public.crm_import_items WHERE tenant_id=NEW.tenant_id AND connection_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.withdraw_crm_imports() FROM PUBLIC;
CREATE TRIGGER withdraw_crm_imports AFTER UPDATE OF status ON connections FOR EACH ROW EXECUTE FUNCTION app.withdraw_crm_imports();
ALTER FUNCTION app.withdraw_crm_imports() OWNER TO ulysse_definer;

CREATE FUNCTION app.purge_crm_previews() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  UPDATE public.crm_import_batches SET preview=NULL,selections=NULL,status='cancelled',filename='Aperçu expiré'
    WHERE (status='preview' AND expires_at<clock_timestamp()) OR (status='failed' AND created_at<clock_timestamp()-interval '7 days');
$$;
REVOKE ALL ON FUNCTION app.purge_crm_previews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_crm_previews() TO ulysse_worker;
ALTER FUNCTION app.purge_crm_previews() OWNER TO ulysse_definer;
