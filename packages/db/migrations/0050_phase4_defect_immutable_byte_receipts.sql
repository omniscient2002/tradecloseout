-- PH4-G17-001/002: Pin scanned immutable bytes and the complete approved
-- target set at remedy submission, independently compare at closure.
-- Do not fabricate receipts for historical RECTIFIED rows: requalification
-- is required before historical closure can resume.
SET ROLE tc_migrator;

ALTER TABLE defects
  ADD COLUMN remedy_sha256 TEXT,
  ADD COLUMN remedy_provider_version_id TEXT,
  ADD COLUMN remedy_size_bytes BIGINT,
  ADD COLUMN remedy_scanned_at TIMESTAMPTZ,
  ADD COLUMN remedy_asset_scope_ids UUID[];

ALTER TABLE defects ADD CONSTRAINT defects_remedy_pinned_receipt_valid CHECK (
  remedy_document_version_id IS NULL OR (
    remedy_sha256 ~ '^[0-9a-f]{64}$'
    AND remedy_provider_version_id IS NOT NULL
    AND length(btrim(remedy_provider_version_id)) > 0
    AND lower(btrim(remedy_provider_version_id)) NOT IN
      ('null','undefined','none','unversioned')
    AND remedy_size_bytes > 0
    AND remedy_scanned_at IS NOT NULL
    AND remedy_asset_scope_ids IS NOT NULL
    AND array_position(remedy_asset_scope_ids, NULL) IS NULL
  )
);

ALTER TABLE defect_transition_events
  ADD COLUMN evidence_sha256 TEXT,
  ADD COLUMN evidence_provider_version_id TEXT,
  ADD COLUMN evidence_size_bytes BIGINT,
  ADD COLUMN evidence_scanned_at TIMESTAMPTZ,
  ADD COLUMN evidence_asset_scope_ids UUID[];

ALTER TABLE defect_transition_events ADD CONSTRAINT defect_event_receipt_valid CHECK (
  evidence_sha256 IS NULL OR (
    evidence_sha256 ~ '^[0-9a-f]{64}$' AND
    evidence_provider_version_id IS NOT NULL AND
    length(btrim(evidence_provider_version_id)) > 0 AND
    evidence_size_bytes > 0 AND
    evidence_scanned_at IS NOT NULL AND
    evidence_asset_scope_ids IS NOT NULL
  )
);

COMMENT ON COLUMN defects.remedy_sha256 IS
  'Lowercase SHA-256 over full scanned provider-version bytes at remedy submission; compared at independent closure.';
COMMENT ON COLUMN defects.remedy_asset_scope_ids IS
  'Ordered complete asset association set at approved remedy submission, not the first linked asset or storage key.';
COMMENT ON COLUMN defects.remedy_scanned_at IS
  'Trusted worker scan receipt. Historical READY objects without scanner provenance must be requalified, not assumed valid.';

RESET ROLE;
