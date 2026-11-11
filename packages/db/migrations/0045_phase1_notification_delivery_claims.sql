-- PH1-G24-005: forward-only, tenant-scoped durable notification claims.
-- SENT historically means provider ACCEPTED, not recipient DELIVERED.
-- Keep that legacy status contract but expose a distinct gateway_state.
SET ROLE tc_migrator;
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claim_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS gateway_state TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE notifications
  ADD CONSTRAINT notifications_delivery_attempts_valid
    CHECK (delivery_attempts BETWEEN 0 AND 5),
  ADD CONSTRAINT notifications_gateway_state_valid
    CHECK (gateway_state IN ('PENDING','ACCEPTED','DELIVERED','BOUNCED','FAILED'));
CREATE INDEX notifications_due_delivery_idx
  ON notifications(org_id, next_attempt_at, created_at, id)
  WHERE status='QUEUED' AND dead_lettered_at IS NULL;
RESET ROLE;
