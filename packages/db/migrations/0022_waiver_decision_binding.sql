-- PH3-G07-001/002/003: bind each waiver decision to one immutable
-- obligation revision and one retry identity. Historical waivers are
-- deliberately left NULL: they cannot be countersigned without requalification.
SET ROLE tc_migrator;
ALTER TABLE waivers
  ADD COLUMN IF NOT EXISTS obligation_row_version integer,
  ADD COLUMN IF NOT EXISTS command_id uuid;
ALTER TABLE waivers
  ADD CONSTRAINT waivers_obligation_row_version_positive
    CHECK (obligation_row_version IS NULL OR obligation_row_version >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS waivers_org_command_id_uq
  ON waivers(org_id, command_id) WHERE command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS waivers_current_intent_idx
  ON waivers(org_id, project_id, requirement_id, created_at DESC)
  WHERE status IN ('PENDING_SECOND_APPROVAL', 'ACTIVE');
RESET ROLE;
