-- ==============================================================================
-- 0018_revalidation_concurrency_and_commissioning_composite_fks.sql
-- F01 & F02:
-- 1. Add row_version and scope_key to evidence_revalidations for concurrency and scoped matching
-- 2. Add composite foreign keys (org_id, project_id, asset_id) to commissioning tables
-- 3. Set quality_inspections default outcome to 'PENDING' (F03)
-- ==============================================================================

SET ROLE tc_migrator;

-- 1. EVIDENCE REVALIDATIONS CONCURRENCY & SCOPING (F01)
ALTER TABLE evidence_revalidations
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scope_key text;

-- 2. COMMISSIONING TABLES COMPOSITE ASSET CONSTRAINTS (F02)
ALTER TABLE tab_worksheets
  DROP CONSTRAINT IF EXISTS tab_worksheets_asset_fk,
  ADD CONSTRAINT tab_worksheets_asset_fk
    FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES assets (org_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE quality_inspections
  DROP CONSTRAINT IF EXISTS quality_inspections_asset_fk,
  ADD CONSTRAINT quality_inspections_asset_fk
    FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES assets (org_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE seasonal_commissioning_schedules
  DROP CONSTRAINT IF EXISTS seasonal_comm_asset_fk,
  ADD CONSTRAINT seasonal_comm_asset_fk
    FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES assets (org_id, project_id, id) ON DELETE CASCADE;

-- 3. DEFAULT OUTCOME PENDING (F03)
ALTER TABLE quality_inspections
  ALTER COLUMN outcome SET DEFAULT 'PENDING';

RESET ROLE;
