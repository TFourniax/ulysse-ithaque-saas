-- 0001 — Tenancy, identity, memberships and sessions.
-- Applied by ulysse_migrator (schema owner). Runtime roles never own objects:
--   ulysse_runtime  NOLOGIN group holding table privileges
--   ulysse_app      LOGIN, member of ulysse_runtime (API)
--   ulysse_worker   LOGIN, member of ulysse_runtime (worker, pg-boss)
--   ulysse_definer  NOLOGIN BYPASSRLS, owns a few narrow SECURITY DEFINER functions
-- None of the LOGIN roles has BYPASSRLS. Roles are created by `npm run db:bootstrap`.

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO ulysse_runtime, ulysse_definer;
-- Required to transfer ownership of definer functions (ALTER FUNCTION ... OWNER).
GRANT CREATE ON SCHEMA app TO ulysse_definer;
GRANT USAGE ON SCHEMA public TO ulysse_runtime, ulysse_definer;

-- Transaction-local tenant/user context. Missing or empty settings yield NULL,
-- which matches no row: absence of context fails closed.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION app.current_tenant_id(), app.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_user_id() TO ulysse_runtime, ulysse_definer;

CREATE FUNCTION app.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'append-only table %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  oidc_issuer text NOT NULL CHECK (length(oidc_issuer) BETWEEN 1 AND 500),
  oidc_subject text NOT NULL CHECK (length(oidc_subject) BETWEEN 1 AND 255),
  email text CHECK (email IS NULL OR length(email) <= 320),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  -- Identity is (issuer, subject); e-mail alone never authorizes anything.
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'reviewer', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  PRIMARY KEY (tenant_id, user_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Authentication infrastructure, looked up by a hash of a 256-bit random token
-- before any tenant is selected. Not tenant data: no RLS, runtime DML only.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  active_tenant_id uuid REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE oidc_login_attempts (
  state_hash text PRIMARY KEY CHECK (length(state_hash) = 64),
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  return_to text NOT NULL CHECK (return_to ~ '^/[^/\\]' OR return_to = '/'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

-- A user sees the tenants they actively belong to; a tenant context sees itself.
CREATE POLICY tenants_visible ON tenants FOR SELECT TO ulysse_runtime
  USING (
    id = app.current_tenant_id()
    OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app.current_user_id() AND m.status = 'active')
  );

-- A user sees themself and the members of the current tenant (names in audit/history).
CREATE POLICY users_visible ON users FOR SELECT TO ulysse_runtime
  USING (
    id = app.current_user_id()
    OR id IN (SELECT m.user_id FROM memberships m WHERE m.tenant_id = app.current_tenant_id())
  );
CREATE POLICY users_self_update ON users FOR UPDATE TO ulysse_runtime
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

-- Own memberships across tenants (tenant switcher) or all memberships of the current tenant.
CREATE POLICY memberships_visible ON memberships FOR SELECT TO ulysse_runtime
  USING (user_id = app.current_user_id() OR tenant_id = app.current_tenant_id());
CREATE POLICY memberships_tenant_update ON memberships FOR UPDATE TO ulysse_runtime
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT ON tenants TO ulysse_runtime;
GRANT SELECT ON users TO ulysse_runtime;
GRANT UPDATE (email, display_name, last_login_at) ON users TO ulysse_runtime;
GRANT SELECT ON memberships TO ulysse_runtime;
GRANT UPDATE (role, status, updated_at, revoked_at, revoked_by) ON memberships TO ulysse_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, oidc_login_attempts TO ulysse_app;

-- Login lookup happens before any user context exists: narrow definer function.
CREATE FUNCTION app.find_user_by_subject(p_issuer text, p_subject text)
  RETURNS TABLE (id uuid, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT u.id, u.status FROM public.users u WHERE u.oidc_issuer = p_issuer AND u.oidc_subject = p_subject $$;
-- Privileges are set while the migrator still owns the function: only the owner (grantor)
-- can revoke the implicit PUBLIC grant. ALTER OWNER then transfers these ACL entries.
REVOKE ALL ON FUNCTION app.find_user_by_subject(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_user_by_subject(text, text) TO ulysse_app;
ALTER FUNCTION app.find_user_by_subject(text, text) OWNER TO ulysse_definer;
GRANT SELECT ON users TO ulysse_definer;
