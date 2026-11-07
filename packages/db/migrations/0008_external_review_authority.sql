-- Preserve the external approver's declared role/title with the recorded response.
-- Historical records remain nullable; new API writes require a non-empty role.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS external_approver_role TEXT;

COMMENT ON COLUMN reviews.external_approver_role IS
  'Role or designation declared for the external authority whose response was recorded; this is provenance, not independent identity verification.';
