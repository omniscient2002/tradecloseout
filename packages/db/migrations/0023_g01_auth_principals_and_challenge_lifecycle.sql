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
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE otp_challenges
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'SENT'
    CHECK (delivery_status IN ('PENDING','SENT','FAILED','AMBIGUOUS')),
  ADD COLUMN IF NOT EXISTS otp_generation UUID;

CREATE INDEX IF NOT EXISTS otp_challenges_guest_current_idx
  ON otp_challenges (guest_grant_id, created_at DESC)
  WHERE purpose = 'GUEST_ACCESS' AND consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_request_budgets (
  budget_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No privileged client/witness authorization may be automatically inherited
-- from existing contractor-issued contact data. Independent authority must
-- be separately verified; approval workflow is a future release gate.
UPDATE sessions
   SET revoked_at = now()
 WHERE guest_grant_id IS NOT NULL AND revoked_at IS NULL;

GRANT SELECT,INSERT,UPDATE,DELETE ON auth_request_budgets TO tc_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON guest_grants, sessions, otp_challenges TO tc_app;

RESET ROLE;
