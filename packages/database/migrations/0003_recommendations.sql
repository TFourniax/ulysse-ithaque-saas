-- 0003 — Doctrine, company context, analyses, recommendations, evidence, revisions,
-- decisions, idempotency receipts, audit and outbox.

CREATE TABLE doctrines (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9.-]{1,63}$'),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'validated', 'retired')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  origin text NOT NULL CHECK (origin IN ('fixture', 'customer', 'licensed')),
  usage_rights text NOT NULL CHECK (usage_rights IN ('demo-only', 'tenant-internal', 'licensed-shared')),
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  validated_by uuid REFERENCES users (id),
  validated_at timestamptz,
  validation_note text,
  retired_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key, version),
  CHECK ((status = 'draft') OR (validated_by IS NOT NULL OR status = 'retired')),
  CHECK ((usage_rights = 'demo-only') = (origin = 'fixture'))
);
-- One active (validated) doctrine per tenant at a time.
CREATE UNIQUE INDEX doctrines_one_active ON doctrines (tenant_id) WHERE status = 'validated';
-- Versions are immutable: content cannot change after insertion.
CREATE FUNCTION app.doctrine_content_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.key IS DISTINCT FROM OLD.key OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'doctrine versions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER doctrines_immutable BEFORE UPDATE ON doctrines
  FOR EACH ROW EXECUTE FUNCTION app.doctrine_content_immutable();

CREATE TABLE company_contexts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'fixture')),
  note text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, version)
);

CREATE TABLE analyses (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
  doctrine_id uuid,
  doctrine_version integer,
  rule_versions jsonb NOT NULL,
  context_version integer,
  formulation jsonb NOT NULL,
  input_hash text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  evaluated integer NOT NULL,
  generated integer NOT NULL,
  unchanged integer NOT NULL,
  closed integer NOT NULL,
  abstentions jsonb NOT NULL,
  usage jsonb,
  error_code text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, doctrine_id) REFERENCES doctrines (tenant_id, id)
);
CREATE INDEX analyses_recent_idx ON analyses (tenant_id, started_at DESC);

CREATE TABLE recommendations (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('opportunity')),
  -- Snapshot of the subject: no FK so that a purge of source data keeps the decision history.
  subject_id uuid NOT NULL,
  subject_external_id text NOT NULL,
  subject_label text NOT NULL,
  connection_id uuid NOT NULL,
  kind text NOT NULL,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  doctrine_id uuid NOT NULL,
  doctrine_key text NOT NULL,
  doctrine_version integer NOT NULL,
  doctrine_origin text NOT NULL,
  doctrine_fictional boolean NOT NULL,
  context_version integer,
  analysis_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired', 'superseded')),
  revision integer NOT NULL CHECK (revision > 0),
  content_revision integer NOT NULL CHECK (content_revision > 0),
  fingerprint text NOT NULL,
  priority_score integer NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  priority jsonb NOT NULL,
  title text NOT NULL,
  why_now text NOT NULL,
  proposed_action text NOT NULL,
  assumptions jsonb NOT NULL,
  missing_information jsonb NOT NULL,
  formulation text NOT NULL CHECK (formulation IN ('template', 'model')),
  generated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  data_as_of timestamptz NOT NULL,
  max_source_age_hours numeric NOT NULL,
  closed_at timestamptz,
  closed_reason text CHECK (closed_reason IN ('ttl', 'evidence_changed', 'signal_resolved', 'source_deleted', 'connection_revoked', 'doctrine_changed', 'replaced')),
  supersedes_id uuid,
  superseded_by_id uuid,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id),
  FOREIGN KEY (tenant_id, doctrine_id) REFERENCES doctrines (tenant_id, id),
  -- The analysis row is written at the end of its transaction, with its final counters.
  FOREIGN KEY (tenant_id, analysis_id) REFERENCES analyses (tenant_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES recommendations (tenant_id, id),
  FOREIGN KEY (tenant_id, superseded_by_id) REFERENCES recommendations (tenant_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (expires_at > generated_at),
  CHECK ((status IN ('draft', 'pending')) = (closed_at IS NULL)),
  CHECK ((status = 'superseded') = (superseded_by_id IS NOT NULL))
);
-- At most one open proposal per subject and kind; duplicates are impossible even under concurrency.
CREATE UNIQUE INDEX recommendations_one_open ON recommendations (tenant_id, subject_id, kind) WHERE status IN ('draft', 'pending');
CREATE INDEX recommendations_fingerprint_idx ON recommendations (tenant_id, fingerprint);
CREATE INDEX recommendations_list_idx ON recommendations (tenant_id, priority_score DESC, generated_at DESC, id);
CREATE INDEX recommendations_rejected_idx ON recommendations (tenant_id, closed_at) WHERE status = 'rejected';

CREATE TABLE evidence_links (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  -- References are cleared when source data is purged; the value snapshot remains for history.
  fact_id uuid,
  source_record_id uuid,
  source_revision integer NOT NULL,
  connection_id uuid NOT NULL,
  fact_type text NOT NULL,
  label text NOT NULL,
  state text NOT NULL CHECK (state IN ('present', 'empty', 'unavailable')),
  value jsonb,
  locator text NOT NULL,
  material boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  source_modified_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendations (tenant_id, id),
  FOREIGN KEY (tenant_id, fact_id) REFERENCES facts (tenant_id, id) ON DELETE SET NULL (fact_id),
  FOREIGN KEY (tenant_id, source_record_id) REFERENCES source_records (tenant_id, id) ON DELETE SET NULL (source_record_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id)
);
CREATE INDEX evidence_links_recommendation_idx ON evidence_links (tenant_id, recommendation_id);
CREATE INDEX evidence_links_fact_idx ON evidence_links (tenant_id, fact_id);
CREATE INDEX evidence_links_source_idx ON evidence_links (tenant_id, source_record_id);

CREATE TABLE recommendation_revisions (
  tenant_id uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  content_revision integer NOT NULL,
  proposed_action text NOT NULL,
  note text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, recommendation_id, content_revision),
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendations (tenant_id, id)
);

CREATE TABLE decisions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  revision integer NOT NULL,
  content_revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  -- One decision per recommendation: concurrent reviewers cannot both succeed.
  UNIQUE (tenant_id, recommendation_id),
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendations (tenant_id, id)
);

CREATE TABLE idempotency_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  actor_id text NOT NULL,
  operation text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, actor_id, operation, key)
);
CREATE INDEX idempotency_receipts_expiry_idx ON idempotency_receipts (expires_at);

CREATE TABLE audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service')),
  actor_id text NOT NULL,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  revision integer,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_events_list_idx ON audit_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (tenant_id, resource_id);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER revisions_append_only BEFORE UPDATE OR DELETE ON recommendation_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TABLE outbox (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE published_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doctrines', 'company_contexts', 'analyses', 'recommendations', 'evidence_links',
                           'recommendation_revisions', 'decisions', 'idempotency_receipts', 'audit_events', 'outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO ulysse_runtime USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON doctrines, recommendations, connections TO ulysse_runtime;
GRANT SELECT, INSERT ON company_contexts, analyses, evidence_links, recommendation_revisions, decisions, audit_events TO ulysse_runtime;
GRANT SELECT, INSERT ON idempotency_receipts, outbox TO ulysse_runtime;
GRANT UPDATE (published_at, attempts, last_error) ON outbox TO ulysse_runtime;
