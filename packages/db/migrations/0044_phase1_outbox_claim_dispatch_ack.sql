-- PH1-G24-003/004: short, fenced outbox claim/ack protocol.
-- Do not rewrite historical migrations. Existing undispatched rows become
-- immediately eligible for a claim after this forward-only migration.
SET ROLE tc_migrator;
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claim_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS outbox_events_due_claim_idx
  ON outbox_events(org_id, next_attempt_at, created_at, id)
  WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL;
RESET ROLE;
