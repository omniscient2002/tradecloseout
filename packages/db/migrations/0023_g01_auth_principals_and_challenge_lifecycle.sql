-- G01: additive auth principal and challenge lifecycle protection.
-- Old guest sessions are not reliably attributable to the external user and
-- must reauthenticate under a newly generated distinct guest principal.
SET ROLE tc_migrator;

ALTER TABLE guest_grants
  ADD COLUMN IF NOT EXISTS principal_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS independent_authority_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS independent_authority_evidence_ref TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS auth_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS sessions_active_expiry_idx
  ON sessions (expires_at, absolute_expires_at) WHERE revoked_at IS NULL;

ALTER TABLE otp_challenges
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'SENT'
    CHECK (delivery_status IN ('PENDING','SENT','FAILED','AMBIGUOUS')),
  ADD COLUMN IF NOT EXISTS otp_generation UUID,
  ADD COLUMN IF NOT EXISTS auth_intent_hash TEXT;

CREATE INDEX IF NOT EXISTS otp_challenges_guest_current_idx
  ON otp_challenges (guest_grant_id, created_at DESC)
  WHERE purpose = 'GUEST_ACCESS' AND consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_request_budgets (
  budget_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Privileged MFA enrollment and one-use emergency recovery codes.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_totp_pending_secret TEXT,
  ADD COLUMN IF NOT EXISTS mfa_totp_last_step BIGINT NOT NULL DEFAULT -1;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_active_idx
  ON mfa_recovery_codes (user_id) WHERE consumed_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO tc_app;

-- Authentication security events must not contain OTPs, plaintext session
-- tokens, delivery credentials or raw contact/guest invitation values.
CREATE TABLE IF NOT EXISTS auth_security_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','THROTTLED','ERROR')),
  subject_digest TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_security_events_actor_date_idx
  ON auth_security_events (actor_user_id, occurred_at DESC);
GRANT SELECT, INSERT ON auth_security_events TO tc_app;

-- The authentication event ledger is append-only. Runtime access is limited
-- to the current actor/tenant; pre-authentication events have neither and are
-- accessible only to the migrator/security operations role.
ALTER TABLE auth_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_security_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_security_events_insert ON auth_security_events;
CREATE POLICY auth_security_events_insert ON auth_security_events
  FOR INSERT TO tc_app WITH CHECK (true);
DROP POLICY IF EXISTS auth_security_events_read ON auth_security_events;
CREATE POLICY auth_security_events_read ON auth_security_events
  FOR SELECT TO tc_app USING (
    actor_user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
    OR org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  );

-- MFA backup hashes are bound to the authenticated user only.
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_recovery_codes_owner ON mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_owner ON mfa_recovery_codes TO tc_app
  USING (user_id = NULLIF(current_setting('app.current_user', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user', true), '')::uuid);

-- Pre-authentication shared limits intentionally have no tenant identity.
-- Their keys are HMAC-pseudonymized and reveal no contacts; global
-- increments need a policy before a browser user can be authenticated.
ALTER TABLE auth_request_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_request_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_request_budgets_runtime ON auth_request_budgets;
CREATE POLICY auth_request_budgets_runtime ON auth_request_budgets TO tc_app
  USING (true) WITH CHECK (true);

-- No privileged client/witness authorization may be automatically inherited
-- from existing contractor-issued contact data. Independent authority must
-- be separately verified; approval workflow is a future release gate.
UPDATE sessions
   SET revoked_at = now()
 WHERE guest_grant_id IS NOT NULL AND revoked_at IS NULL;

GRANT SELECT,INSERT,UPDATE,DELETE ON auth_request_budgets TO tc_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON guest_grants, sessions, otp_challenges TO tc_app;

RESET ROLE;
