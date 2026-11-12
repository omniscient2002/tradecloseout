-- PH4-G17-002: bind independently verified defect remedies to an exact
-- current document version, not just to a reusable storage object or its key.
SET ROLE tc_migrator;

ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS remedy_document_version_id UUID;

ALTER TABLE defects
  ADD CONSTRAINT defects_remedy_version_same_project_fk
  FOREIGN KEY (org_id, project_id, remedy_document_version_id)
  REFERENCES document_versions (org_id, project_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS defects_remedy_version_lookup_idx
  ON defects (org_id, project_id, remedy_document_version_id)
  WHERE remedy_document_version_id IS NOT NULL;

-- Historical RECTIFIED evidence is unpinned. It must be requalified in an
-- explicit migration/review flow, never silently promoted to verified closure.
RESET ROLE;
