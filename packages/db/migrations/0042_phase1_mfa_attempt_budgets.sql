-- PH1-G01: durable, cross-replica MFA verification budget.
-- Counters are committed in a SEPARATE transaction before verifying a factor;
-- invalid-code rollbacks must not refund brute-force attempts.
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS mfa_attempt_budgets (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'GLOBAL','ENROLL_START','ENROLL_CONFIRM','VERIFY','RECOVERY','CANCEL'
  )),
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  reset_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, action)
);

REVOKE ALL ON mfa_attempt_budgets FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mfa_attempt_budgets TO tc_app;

ALTER TABLE mfa_attempt_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_attempt_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_attempt_actor ON mfa_attempt_budgets;
CREATE POLICY mfa_attempt_actor ON mfa_attempt_budgets TO tc_app
  USING (user_id = NULLIF(current_setting('app.current_user', true),'')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user', true),'')::uuid);

RESET ROLE;
