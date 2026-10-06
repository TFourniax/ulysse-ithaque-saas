-- 0005 — Administrative provisioning (tenants, users, memberships).
-- FORCE ROW LEVEL SECURITY applies to the schema owner too, so provisioning goes
-- through explicit definer functions executable only by the administrative role.
-- Runtime roles (API, worker) cannot create tenants or users.

GRANT INSERT, UPDATE ON tenants TO ulysse_definer;
GRANT INSERT, UPDATE ON users TO ulysse_definer;
GRANT SELECT, INSERT, UPDATE ON memberships TO ulysse_definer;

CREATE FUNCTION app.provision_tenant(p_slug text, p_name text)
  RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    INSERT INTO public.tenants (slug, name) VALUES (p_slug, p_name)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  $$;

CREATE FUNCTION app.provision_user(p_issuer text, p_subject text, p_email text, p_display_name text)
  RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    INSERT INTO public.users (oidc_issuer, oidc_subject, email, display_name)
    VALUES (p_issuer, p_subject, p_email, p_display_name)
    ON CONFLICT (oidc_issuer, oidc_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
    RETURNING id
  $$;

CREATE FUNCTION app.set_membership(p_tenant_id uuid, p_user_id uuid, p_role text, p_status text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    INSERT INTO public.memberships (tenant_id, user_id, role, status, revoked_at)
    VALUES (p_tenant_id, p_user_id, p_role, p_status, CASE WHEN p_status = 'revoked' THEN now() END)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = EXCLUDED.status, revoked_at = EXCLUDED.revoked_at, updated_at = now()
  $$;

CREATE FUNCTION app.set_user_status(p_user_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ UPDATE public.users SET status = p_status WHERE id = p_user_id $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.provision_tenant(text, text)',
    'app.provision_user(text, text, text, text)',
    'app.set_membership(uuid, uuid, text, text)',
    'app.set_user_status(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO ulysse_definer', f);
  END LOOP;
END $$;

-- ALTER OWNER rewrites ACL entries of the previous owner (the migrator), so the grant to
-- the administrative role is issued by the new owner afterwards.
SET LOCAL ROLE ulysse_definer;
GRANT EXECUTE ON FUNCTION app.provision_tenant(text, text) TO ulysse_migrator;
GRANT EXECUTE ON FUNCTION app.provision_user(text, text, text, text) TO ulysse_migrator;
GRANT EXECUTE ON FUNCTION app.set_membership(uuid, uuid, text, text) TO ulysse_migrator;
GRANT EXECUTE ON FUNCTION app.set_user_status(uuid, text) TO ulysse_migrator;
RESET ROLE;
