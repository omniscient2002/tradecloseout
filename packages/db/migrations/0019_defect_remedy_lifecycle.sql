-- ==============================================================================
-- 0019_defect_remedy_lifecycle.sql
-- F07: Add remedied_by and remedied_at tracking to defects table
-- ==============================================================================

SET ROLE tc_migrator;

ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS remedied_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS remedied_at timestamp with time zone;

RESET ROLE;
