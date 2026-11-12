-- Expiry is a local admission decision, never proof of provider deletion.
-- Retain version/object identities and explicitly track unconfirmed cleanup.
ALTER TABLE storage_objects
  ADD COLUMN upload_cleanup_requested_at timestamptz,
  ADD COLUMN upload_cleanup_completed_at timestamptz,
  ADD COLUMN upload_failure_code text,
  ADD CONSTRAINT storage_upload_cleanup_order CHECK (
    upload_cleanup_completed_at IS NULL OR
    (upload_cleanup_requested_at IS NOT NULL AND upload_cleanup_completed_at>=upload_cleanup_requested_at)
  );
CREATE INDEX storage_upload_cleanup_pending_idx ON storage_objects(org_id,upload_cleanup_requested_at,id)
  WHERE upload_cleanup_requested_at IS NOT NULL AND upload_cleanup_completed_at IS NULL;
