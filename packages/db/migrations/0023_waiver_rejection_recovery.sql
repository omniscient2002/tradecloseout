-- PH3-G07-001/003: persist the pre-exception state so rejection and
-- requester withdrawal restore the actual prior obligation safely.
-- Legacy rows remain NULL and require requalification; do not fabricate it.
SET ROLE tc_migrator;
ALTER TABLE waivers
  ADD COLUMN IF NOT EXISTS previous_requirement_status text,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE waivers
  ADD CONSTRAINT waivers_recovery_status_valid_chk CHECK (
    previous_requirement_status IS NULL OR
    previous_requirement_status IN (
      'NOT_STARTED','REQUESTED','UPLOADED','IN_REVIEW','UNDER_REVIEW',
      'CHANGES_REQUESTED','REJECTED','EXPIRED'
    )
  );
ALTER TABLE waivers
  ADD CONSTRAINT waivers_rejection_attributed_chk CHECK (
    status NOT IN ('REJECTED','REVOKED') OR
    (decision_reason IS NOT NULL AND length(btrim(decision_reason)) >= 10
     AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ) NOT VALID;
-- Legacy rejected/revoked rows are intentionally preserved for reconciliation;
-- new transitions are checked immediately by PostgreSQL.
RESET ROLE;
