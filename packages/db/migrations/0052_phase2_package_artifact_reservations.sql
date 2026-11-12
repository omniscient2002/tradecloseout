-- Separate unpublished build reservation from the immutable published pointer.
ALTER TABLE handover_packages ADD COLUMN build_object_id uuid;
ALTER TABLE handover_packages ADD CONSTRAINT handover_build_object_same_org_fk
  FOREIGN KEY(org_id,build_object_id) REFERENCES storage_objects(org_id,id);
