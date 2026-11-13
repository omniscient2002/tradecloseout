-- Consent and installed provenance cannot be rewritten through a runtime query.
CREATE OR REPLACE FUNCTION protect_onboarding_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.org_id<>OLD.org_id OR OLD.terms_accepted_at IS NOT NULL AND
  ROW(NEW.terms_version,NEW.terms_accepted_by,NEW.terms_accepted_at) IS DISTINCT FROM
  ROW(OLD.terms_version,OLD.terms_accepted_by,OLD.terms_accepted_at))
 THEN RAISE EXCEPTION 'ONBOARDING_CONSENT_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'ONBOARDING_COMPLETION_IMMUTABLE'; END IF;
 IF current_user='tc_app' AND NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
  WHERE m.org_id=NEW.org_id AND m.user_id=current_setting('app.current_user',true)::uuid
   AND m.status='ACTIVE' AND m.role IN('R-OWNER','R-ADMIN')) THEN RAISE EXCEPTION 'ONBOARDING_AUTHORITY_REQUIRED'; END IF;
 IF NEW.terms_accepted_at IS NOT NULL AND (NEW.terms_version IS NULL OR NEW.terms_accepted_by IS NULL)
 THEN RAISE EXCEPTION 'ONBOARDING_CONSENT_INCOMPLETE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER onboarding_consent_guard BEFORE INSERT OR UPDATE ON organisation_onboarding FOR EACH ROW EXECUTE FUNCTION protect_onboarding_consent();
CREATE OR REPLACE FUNCTION protect_installed_configuration_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_pack_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM template_packs p WHERE p.id=NEW.source_pack_id
  AND p.status='ACTIVE' AND p.governance_version=1 AND p.schema_version=1 AND p.trade='HVAC'
  AND p.reviewed_at IS NOT NULL AND p.reviewer_identity<>p.author_identity AND p.review_record_json IS NOT NULL
  AND p.reviewed_candidate_sha ~ '^[a-f0-9]{40}$' AND p.payload_checksum=encode(digest(p.payload_json::text,'sha256'),'hex')
  AND p.payload_json=NEW.payload_json) THEN RAISE EXCEPTION 'REVIEWED_INSTALLED_CONFIGURATION_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER installed_configuration_source_guard BEFORE INSERT ON config_versions FOR EACH ROW EXECUTE FUNCTION protect_installed_configuration_source();
CREATE OR REPLACE FUNCTION protect_change_request_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
  OLD.status IN('PENDING','SUBMITTED') AND NEW.status IN('APPROVED','REJECTED') OR OLD.status='APPROVED' AND NEW.status='APPLIED')
 THEN RAISE EXCEPTION 'CHANGE_REQUEST_STATE_TRANSITION_INVALID'; END IF;
 IF NEW.status='APPLIED' AND (NEW.applied_snapshot_id IS NULL OR NOT EXISTS(SELECT 1 FROM checklist_snapshots s
  WHERE s.org_id=NEW.org_id AND s.project_id=NEW.project_id AND s.id=NEW.applied_snapshot_id AND s.checksum=NEW.proposed_checksum))
 THEN RAISE EXCEPTION 'CHANGE_REQUEST_APPLIED_SNAPSHOT_MISMATCH'; END IF;
 IF OLD.applied_snapshot_id IS NOT NULL AND NEW.applied_snapshot_id IS DISTINCT FROM OLD.applied_snapshot_id
 THEN RAISE EXCEPTION 'CHANGE_REQUEST_APPLICATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER change_request_state_guard BEFORE UPDATE ON requirement_change_requests FOR EACH ROW EXECUTE FUNCTION protect_change_request_state();
