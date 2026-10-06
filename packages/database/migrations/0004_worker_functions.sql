-- 0004 — Narrow cross-tenant entry points for the worker identity.
-- The worker never reads tenant data without a tenant context: these functions only
-- return identifiers needed to schedule tenant-scoped jobs, and are executable by
-- ulysse_worker only (not by the API role).

GRANT SELECT ON tenants, connections TO ulysse_definer;
GRANT SELECT, UPDATE (published_at, attempts, last_error) ON outbox TO ulysse_definer;
GRANT SELECT, DELETE ON idempotency_receipts TO ulysse_definer;
GRANT SELECT, DELETE ON sessions, oidc_login_attempts TO ulysse_definer;

CREATE FUNCTION app.due_connections(p_now timestamptz, p_limit integer)
  RETURNS TABLE (tenant_id uuid, connection_id uuid, provider text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT c.tenant_id, c.id, c.provider
    FROM public.connections c
    JOIN public.tenants t ON t.id = c.tenant_id
    WHERE c.status = 'active' AND t.status = 'active' AND c.next_sync_at <= p_now
    ORDER BY c.next_sync_at
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  $$;

CREATE FUNCTION app.active_tenants()
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT t.id FROM public.tenants t WHERE t.status = 'active' ORDER BY t.id $$;

-- Locks unpublished events until the caller's transaction ends (SKIP LOCKED lets
-- several relays run without double handoff).
CREATE FUNCTION app.claim_outbox(p_limit integer)
  RETURNS TABLE (tenant_id uuid, id uuid, event_type text, subject_type text, subject_id text, payload jsonb, created_at timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    UPDATE public.outbox o
    SET attempts = o.attempts + 1
    FROM (
      SELECT x.tenant_id, x.id FROM public.outbox x
      WHERE x.published_at IS NULL
      ORDER BY x.created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 500)
      FOR UPDATE SKIP LOCKED
    ) picked
    WHERE o.tenant_id = picked.tenant_id AND o.id = picked.id
    RETURNING o.tenant_id, o.id, o.event_type, o.subject_type, o.subject_id, o.payload, o.created_at
  $$;

CREATE FUNCTION app.mark_outbox_published(p_tenant_ids uuid[], p_ids uuid[], p_at timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    WITH done AS (
      UPDATE public.outbox o SET published_at = p_at, last_error = NULL
      FROM unnest(p_tenant_ids, p_ids) AS k(tenant_id, id)
      WHERE o.tenant_id = k.tenant_id AND o.id = k.id AND o.published_at IS NULL
      RETURNING 1
    )
    SELECT count(*)::integer FROM done
  $$;

CREATE FUNCTION app.outbox_backlog()
  RETURNS TABLE (pending bigint, oldest timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT count(*), min(created_at) FROM public.outbox WHERE published_at IS NULL $$;

-- Retention of authentication and idempotency artifacts. Deleting a receipt never
-- reverses a decision: decided recommendations are terminal.
CREATE FUNCTION app.purge_expired(p_now timestamptz)
  RETURNS TABLE (receipts integer, sessions integer, login_attempts integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE r integer; s integer; l integer;
BEGIN
  DELETE FROM public.idempotency_receipts WHERE expires_at < p_now; GET DIAGNOSTICS r = ROW_COUNT;
  DELETE FROM public.sessions WHERE expires_at < p_now OR revoked_at < p_now - interval '1 day'; GET DIAGNOSTICS s = ROW_COUNT;
  DELETE FROM public.oidc_login_attempts WHERE expires_at < p_now; GET DIAGNOSTICS l = ROW_COUNT;
  RETURN QUERY SELECT r, s, l;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.due_connections(timestamptz, integer)',
    'app.active_tenants()',
    'app.claim_outbox(integer)',
    'app.mark_outbox_published(uuid[], uuid[], timestamptz)',
    'app.outbox_backlog()',
    'app.purge_expired(timestamptz)'
  ] LOOP
    -- Revoke/grant while still owner, then transfer ownership (see 0001).
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ulysse_worker', f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO ulysse_definer', f);
  END LOOP;
END $$;
