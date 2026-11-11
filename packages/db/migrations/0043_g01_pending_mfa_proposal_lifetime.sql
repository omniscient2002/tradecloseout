-- PH1-G01-003: pending authenticator setup is not an indefinitely valid
-- encrypted factor. Bind an unconfirmed proposal to the current session and
-- its authentication generation with a database-enforced expiry check.
-- Existing unbound proposals remain unconfirmable and must be restarted by
-- their owner. Never decrypt or copy their plaintext during migration.
SET ROLE tc_migrator;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_pending_session_id UUID,
  ADD COLUMN IF NOT EXISTS mfa_pending_auth_generation UUID,
  ADD COLUMN IF NOT EXISTS mfa_pending_expires_at TIMESTAMPTZ;
RESET ROLE;
