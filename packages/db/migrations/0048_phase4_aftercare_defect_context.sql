-- PH4-G17-003: make post-close warranty/aftercare defects distinct from
-- historical closeout baseline defects, retaining the accepted dossier link.
SET ROLE tc_migrator;

ALTER TABLE defects
  ADD COLUMN defect_context TEXT NOT NULL DEFAULT 'CLOSEOUT',
  ADD COLUMN accepted_package_id UUID,
  ADD COLUMN aftercare_reason TEXT,
  ADD COLUMN aftercare_reference TEXT;

ALTER TABLE defects
  ADD CONSTRAINT defects_context_valid
  CHECK (defect_context IN ('CLOSEOUT', 'AFTERCARE'));

ALTER TABLE defects
  ADD CONSTRAINT defects_aftercare_qualified
  CHECK (defect_context <> 'AFTERCARE' OR (
    mandatory = false
    AND asset_id IS NOT NULL
    AND accepted_package_id IS NOT NULL
    AND aftercare_reason IS NOT NULL
    AND length(btrim(aftercare_reason)) BETWEEN 10 AND 1200
    AND aftercare_reference IS NOT NULL
    AND length(btrim(aftercare_reference)) BETWEEN 1 AND 180
  ));

ALTER TABLE defects
  ADD CONSTRAINT defects_aftercare_accepted_package_fk
  FOREIGN KEY (org_id, project_id, accepted_package_id)
  REFERENCES handover_packages (org_id, project_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS defects_aftercare_package_lookup
  ON defects (org_id, project_id, accepted_package_id)
  WHERE defect_context = 'AFTERCARE';

COMMENT ON COLUMN defects.accepted_package_id IS
  'Frozen full-handover package context for a later AFTERCARE report; never evidence of an OEM warranty confirmation.';
COMMENT ON COLUMN defects.defect_context IS
  'CLOSEOUT affects current baseline; AFTERCARE is post-closure issue tracking and cannot amend an accepted dossier.';

RESET ROLE;
