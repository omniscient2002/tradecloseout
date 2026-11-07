-- Ensure document_versions has updated_at column to track lifecycle transitions
ALTER TABLE document_versions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Ensure storage_objects status allows PROCESSING during scan verification (TC2-001)
ALTER TABLE storage_objects
  DROP CONSTRAINT IF EXISTS storage_objects_status_check;

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_status_check
    CHECK (status IN ('PENDING','PROCESSING','READY','QUARANTINED','FAILED','DELETED','ABORTED'));

-- Allow PACKAGE_GENERATIONS metric in usage_counters (TC2-024)
ALTER TABLE usage_counters
  DROP CONSTRAINT IF EXISTS usage_counters_metric_check;

ALTER TABLE usage_counters
  ADD CONSTRAINT usage_counters_metric_check
    CHECK (metric IN ('ACTIVE_PROJECTS','SEATS','STORAGE_BYTES','PACKAGES_MONTH','PACKAGE_GENERATIONS'));

-- Ensure submissions status allows SUBMITTED (0000 base schema parity)
ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_status_v021_chk;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_status_v021_chk
    CHECK (status IN ('DRAFT','SENT','ACKNOWLEDGED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','WITHDRAWN','SUBMITTED'));
