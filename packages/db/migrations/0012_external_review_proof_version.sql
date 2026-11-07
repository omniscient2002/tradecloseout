-- Preserve the exact submitted proof version. Historical responses remain unverified
-- until a human can identify their source version; do not infer a backfill.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS external_proof_version_id UUID;
ALTER TABLE reviews ADD CONSTRAINT reviews_external_proof_version_scope_fk
  FOREIGN KEY (org_id, project_id, external_proof_version_id)
  REFERENCES document_versions (org_id, project_id, id);
