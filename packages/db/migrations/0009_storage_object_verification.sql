-- Keep client declarations separate from provider-observed immutable object facts.
ALTER TABLE storage_objects
  ADD COLUMN IF NOT EXISTS expected_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS original_filename TEXT NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS observed_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS provider_version_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_expected_sha256_format
    CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT storage_objects_observed_size_nonnegative
    CHECK (observed_size_bytes IS NULL OR observed_size_bytes >= 0);
