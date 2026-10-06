-- 0006 — Bind each OIDC login attempt to the browser that started it.
-- The callback must present a short-lived cookie whose hash matches; this blocks
-- login CSRF (forcing a victim's browser to complete an attacker's login).
ALTER TABLE oidc_login_attempts ADD COLUMN binding_hash text NOT NULL CHECK (length(binding_hash) = 64);
