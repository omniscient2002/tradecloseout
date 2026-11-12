-- PH1-G01-003: session-bound, expiring, superseding MFA enrollment proposals.
--
-- 0041 is reserved beyond the unmerged G01 candidate's 0023..0040 range.
-- Do not rename or overwrite the already-applied Phase 1 0021/0022 audit SQL
-- (those numbers collide with distinct files in the unmerged candidate).
-- This table is intentionally additive, with no exposure to guests or workers.
SET ROLE tc_migrator;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_totp_last_step BIGINT NOT NULL DEFAULT -1;

CREATE TABLE IF NOT EXISTS mfa_enrollment_proposals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- A SHA-256 token hash (not the raw bearer token) binds the enrollment
  -- to this exact session generation, including deployments without the
  -- later auth_generation migration from unmerged PR #5.
  session_token_hash TEXT NOT NULL CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
  encrypted_secret TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','REPLACED','CANCELLED','CONFIRMED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (status <> 'PENDING' OR encrypted_secret IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_enrollment_one_pending_per_user
  ON mfa_enrollment_proposals(user_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS mfa_enrollment_user_expiry
  ON mfa_enrollment_proposals(user_id, expires_at);

-- Recovery codes are one-use HMAC digests, not recoverable factors. Create
-- only if absent; the later G01 migration integration must inspect schema,
-- policies and their checksum ledger before any safe merge.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_active_idx
  ON mfa_recovery_codes(user_id) WHERE consumed_at IS NULL;

REVOKE ALL ON mfa_enrollment_proposals, mfa_recovery_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mfa_enrollment_proposals TO tc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO tc_app;

ALTER TABLE mfa_enrollment_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_enrollment_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_enrollment_actor_policy ON mfa_enrollment_proposals;
CREATE POLICY mfa_enrollment_actor_policy ON mfa_enrollment_proposals TO tc_app
  USING (user_id = NULLIF(current_setting('app.current_user',true),'')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user',true),'')::uuid);

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_recovery_codes_owner ON mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_owner ON mfa_recovery_codes TO tc_app
  USING (user_id = NULLIF(current_setting('app.current_user',true),'')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user',true),'')::uuid);

RESET ROLE;
