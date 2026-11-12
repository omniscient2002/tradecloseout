-- PH4-G14-002 / PH4-G25-005: freeze the selected evidence and decision facts.
-- Historical package rows remain distinguishable (all NULL pin fields) and
-- MUST NOT be silently reconstructed from mutable document metadata.
SET ROLE tc_migrator;

ALTER TABLE handover_packages
  ADD COLUMN manifest_format_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE handover_packages
  ADD CONSTRAINT handover_manifest_format_positive
  CHECK (manifest_format_version BETWEEN 1 AND 2);

ALTER TABLE package_items
  ADD COLUMN source_document_id UUID,
  ADD COLUMN source_object_id UUID,
  ADD COLUMN source_title TEXT,
  ADD COLUMN source_revision_code TEXT,
  ADD COLUMN source_bucket TEXT,
  ADD COLUMN source_object_key TEXT,
  ADD COLUMN source_mime TEXT,
  ADD COLUMN source_size_bytes BIGINT,
  ADD COLUMN source_sha256 TEXT,
  ADD COLUMN source_provider_version_id TEXT;

ALTER TABLE package_items
  ADD CONSTRAINT package_items_frozen_source_complete CHECK (
    source_object_id IS NULL OR (
      source_document_id IS NOT NULL AND source_title IS NOT NULL AND
      source_bucket IS NOT NULL AND length(source_bucket) > 0 AND
      source_object_key IS NOT NULL AND length(source_object_key) > 0 AND
      source_mime = 'application/pdf' AND
      source_size_bytes > 0 AND
      source_sha256 ~ '^[a-fA-F0-9]{64}$' AND
      source_provider_version_id IS NOT NULL AND
      btrim(lower(source_provider_version_id)) NOT IN ('', 'null', 'undefined', 'none', 'unversioned')
    )
  );

ALTER TABLE package_requirements
  ADD COLUMN revision_code_at_generation TEXT,
  ADD COLUMN waiver_id_at_generation UUID,
  ADD COLUMN waiver_reason_at_generation TEXT,
  ADD COLUMN second_approved_by_at_generation UUID;

COMMENT ON COLUMN package_items.source_object_id IS
  'Immutable storage object selected when this handover manifest was created. Never reconstruct from later live document_version state.';
COMMENT ON COLUMN package_requirements.waiver_id_at_generation IS
  'Frozen waiver identity and approval provenance for this package revision; not proof that a later revoked waiver remains valid.';

RESET ROLE;
