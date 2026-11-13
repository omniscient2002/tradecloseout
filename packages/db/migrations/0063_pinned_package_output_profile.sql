ALTER TABLE handover_packages ADD COLUMN output_profile_json jsonb;
CREATE FUNCTION pin_package_output_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE logo jsonb;logo_id uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.output_profile_json IS DISTINCT FROM OLD.output_profile_json THEN RAISE EXCEPTION 'PACKAGE_OUTPUT_PROFILE_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
 SELECT op.logo_object_id INTO logo_id FROM org_profiles op WHERE op.org_id=NEW.org_id;
 IF logo_id IS NOT NULL THEN
  SELECT jsonb_build_object('id',s.id,'bucket',s.bucket,'objectKey',s.object_key,'providerVersionId',s.provider_version_id,
   'sha256',lower(s.sha256),'sizeBytes',s.size_bytes,'mimeType',s.mime) INTO logo FROM storage_objects s
   WHERE s.org_id=NEW.org_id AND s.id=logo_id AND s.status='READY' AND s.sha256 ~* '^[a-f0-9]{64}$' AND s.av_scanned_at IS NOT NULL
    AND s.provider_version_id IS NOT NULL AND s.observed_size_bytes=s.size_bytes AND s.size_bytes BETWEEN 1 AND 2097152
    AND s.mime IN('image/png','image/jpeg') FOR SHARE;
  IF logo IS NULL THEN RAISE EXCEPTION 'VERIFIED_PACKAGE_BRANDING_OBJECT_REQUIRED'; END IF;
 END IF;
 SELECT jsonb_build_object('legalName',o.legal_name,'profileRowVersion',op.row_version,
   'brandColor',COALESCE(cs.resolved_payload_json->>'branding.primary_color',op.brand_color,'#0F2942'),
   'footerText',op.footer_text,'signatoryName',op.signatory_name,'signatoryDesignation',op.signatory_designation,
   'namingPattern',cs.resolved_payload_json->>'naming.pattern','logo',logo)
  INTO NEW.output_profile_json FROM organisations o LEFT JOIN org_profiles op ON op.org_id=o.id
  LEFT JOIN checklist_snapshots cs ON cs.org_id=o.id AND cs.project_id=NEW.project_id AND cs.id=NEW.snapshot_id WHERE o.id=NEW.org_id;
 RETURN NEW;
END $$;
CREATE TRIGGER package_output_profile_guard BEFORE INSERT OR UPDATE ON handover_packages FOR EACH ROW EXECUTE FUNCTION pin_package_output_profile();
