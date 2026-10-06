-- 0002 — Authorized connections, sync runs, versioned source records, projections and facts.
-- Every client object carries tenant_id; relations use (tenant_id, id) composite keys so
-- a row can never reference an object of another tenant, even by mistake.

CREATE TABLE connections (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'error', 'revoked')),
  config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  -- Opaque reference to a secret held outside this table (never the secret itself).
  credential_ref text,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  sync_interval_minutes integer NOT NULL CHECK (sync_interval_minutes BETWEEN 5 AND 10080),
  cursor text,
  pass_started_at timestamptz,
  last_sync_started_at timestamptz,
  last_success_at timestamptz,
  data_as_of timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_sync_at timestamptz,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  PRIMARY KEY (tenant_id, id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX connections_due_idx ON connections (next_sync_at) WHERE status = 'active';

CREATE TABLE sync_runs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  connection_id uuid NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('initial', 'scheduled', 'manual', 'replay')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  pages integer NOT NULL DEFAULT 0,
  seen integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  revised integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  deleted integer NOT NULL DEFAULT 0,
  stale integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  cursor_start text,
  cursor_end text,
  error_code text,
  error_detail text CHECK (error_detail IS NULL OR length(error_detail) <= 300),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id)
);
CREATE INDEX sync_runs_connection_idx ON sync_runs (tenant_id, connection_id, started_at DESC);

-- Append-only history of normalized source revisions (raw payloads are never stored).
CREATE TABLE source_records (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('opportunity')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  revision integer NOT NULL CHECK (revision > 0),
  provider_version text,
  etag text,
  content_hash text,
  normalized jsonb,
  source_modified_at timestamptz,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, entity_type, external_id, revision),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id),
  CHECK ((deleted_at IS NULL) = (normalized IS NOT NULL AND content_hash IS NOT NULL))
);

CREATE TABLE opportunities (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_id text NOT NULL,
  source_record_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('open', 'won', 'lost')),
  fields jsonb NOT NULL,
  source_modified_at timestamptz,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, external_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id),
  FOREIGN KEY (tenant_id, source_record_id) REFERENCES source_records (tenant_id, id)
);
CREATE INDEX opportunities_name_idx ON opportunities (tenant_id, name COLLATE "C", id);

CREATE TABLE facts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('opportunity')),
  subject_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  source_revision integer NOT NULL,
  fact_type text NOT NULL,
  state text NOT NULL CHECK (state IN ('present', 'empty', 'unavailable')),
  value jsonb,
  locator text NOT NULL,
  observed_at timestamptz NOT NULL,
  source_modified_at timestamptz,
  superseded_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES opportunities (tenant_id, id),
  FOREIGN KEY (tenant_id, source_record_id) REFERENCES source_records (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id),
  CHECK ((state = 'present') = (value IS NOT NULL AND value <> 'null'::jsonb))
);
CREATE INDEX facts_current_idx ON facts (tenant_id, subject_id) WHERE superseded_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections', 'sync_runs', 'source_records', 'opportunities', 'facts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO ulysse_runtime USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON connections, sync_runs TO ulysse_runtime;
GRANT SELECT, INSERT, UPDATE (observed_at), DELETE ON source_records TO ulysse_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunities, facts TO ulysse_runtime;
