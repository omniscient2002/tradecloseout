-- A partial running-account bill annexure is NOT a final contractual handover dossier.
-- Historical RA packs were identifiable by the generator's persisted prefix;
-- backfill them before any full-handover selection/closure check.
ALTER TABLE handover_packages
  ADD COLUMN IF NOT EXISTS package_purpose TEXT NOT NULL DEFAULT 'FULL_HANDOVER';

UPDATE handover_packages
   SET package_purpose = 'RA_BILL'
 WHERE override_reason LIKE 'RA Bill Annexure:%'
   AND package_purpose = 'FULL_HANDOVER';

ALTER TABLE handover_packages
  ADD CONSTRAINT handover_packages_purpose_valid
  CHECK (package_purpose IN ('FULL_HANDOVER', 'RA_BILL'));

CREATE INDEX IF NOT EXISTS handover_packages_latest_by_purpose_idx
    ON handover_packages (org_id, project_id, package_purpose, version_no DESC);

COMMENT ON COLUMN handover_packages.package_purpose IS
  'FULL_HANDOVER includes the complete contractual manifest; RA_BILL is only a milestone-filtered payment evidence annexure.';
