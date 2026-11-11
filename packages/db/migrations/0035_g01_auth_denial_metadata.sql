-- G01-R3: durable, redacted denial metadata, without raw codes, tokens,
-- remote addresses or HTTP header values. Appends to the G01 auth ledger;
-- production/staging roles remain FORCE RLS and insert-only for runtime.
SET ROLE tc_migrator;
ALTER TABLE auth_security_events
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS source_digest CHAR(64);
ALTER TABLE auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_reason_code_check;
ALTER TABLE auth_security_events
  ADD CONSTRAINT auth_security_events_reason_code_check
  CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$');
ALTER TABLE auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_source_digest_check;
ALTER TABLE auth_security_events
  ADD CONSTRAINT auth_security_events_source_digest_check
  CHECK (source_digest IS NULL OR source_digest ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS auth_security_events_denied_recent_idx
  ON auth_security_events (event_type, occurred_at DESC)
  WHERE outcome IN ('DENIED','THROTTLED');
RESET ROLE;
