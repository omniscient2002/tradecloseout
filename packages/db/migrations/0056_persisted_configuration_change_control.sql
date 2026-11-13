ALTER TABLE config_versions ADD COLUMN published_by uuid REFERENCES users(id);
ALTER TABLE config_versions ADD COLUMN parent_version_id uuid REFERENCES config_versions(id);
CREATE OR REPLACE FUNCTION protect_configuration_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.org_id,NEW.level,NEW.scope_type,NEW.scope_id,NEW.version_no,NEW.schema_version,
   NEW.payload_json,NEW.checksum,NEW.source_pack_id,NEW.parent_version_id,NEW.created_by)
   IS DISTINCT FROM ROW(OLD.org_id,OLD.level,OLD.scope_type,OLD.scope_id,OLD.version_no,OLD.schema_version,
   OLD.payload_json,OLD.checksum,OLD.source_pack_id,OLD.parent_version_id,OLD.created_by)
 THEN RAISE EXCEPTION 'CONFIGURATION_VERSION_IMMUTABLE'; END IF;
 IF current_user='tc_app' THEN
  IF NEW.org_id IS NULL OR NEW.level NOT IN('ORG','CLIENT_CONTRACT','PROJECT') THEN
   RAISE EXCEPTION 'GLOBAL_CONFIGURATION_REQUIRES_SEPARATE_AUTHORITY'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'DRAFT' OR NEW.created_by IS DISTINCT FROM current_setting('app.current_user',true)::uuid)
   THEN RAISE EXCEPTION 'CONFIGURATION_DRAFT_AUTHOR_REQUIRED'; END IF;
  IF TG_OP='UPDATE' AND NEW.status='ACTIVE' THEN
   IF OLD.status<>'DRAFT' OR NEW.published_by IS NOT DISTINCT FROM NEW.created_by
     OR NEW.published_by IS DISTINCT FROM current_setting('app.current_user',true)::uuid
     OR NEW.published_at IS NULL OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.org_id=NEW.org_id AND m.user_id=NEW.published_by AND m.status='ACTIVE'
       AND m.role IN('R-OWNER','R-ADMIN') AND u.status='ACTIVE')
   THEN RAISE EXCEPTION 'INDEPENDENT_CONFIGURATION_PUBLICATION_REQUIRED'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND NOT(OLD.status='DRAFT' AND NEW.status='ACTIVE' OR OLD.status='ACTIVE' AND NEW.status='ARCHIVED')
   THEN RAISE EXCEPTION 'CONFIGURATION_STATE_TRANSITION_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER configuration_version_immutable BEFORE INSERT OR UPDATE ON config_versions
 FOR EACH ROW EXECUTE FUNCTION protect_configuration_version();
REVOKE UPDATE,DELETE,TRUNCATE ON config_versions FROM tc_app;
GRANT UPDATE(status,published_by,published_at) ON config_versions TO tc_app;

ALTER TABLE requirement_change_requests ADD COLUMN baseline_snapshot_id uuid;
ALTER TABLE requirement_change_requests ADD COLUMN proposed_checksum text;
ALTER TABLE requirement_change_requests ADD COLUMN proposed_layers_json jsonb;
ALTER TABLE requirement_change_requests ADD CONSTRAINT change_baseline_same_scope_fk
 FOREIGN KEY(org_id,project_id,baseline_snapshot_id) REFERENCES checklist_snapshots(org_id,project_id,id);
CREATE OR REPLACE FUNCTION protect_requirement_change_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.org_id,NEW.project_id,NEW.requirement_id,NEW.change_type,NEW.delta_json,NEW.reason,
 NEW.requested_by,NEW.baseline_snapshot_id,NEW.proposed_checksum,NEW.proposed_layers_json,NEW.impact_json)
 IS DISTINCT FROM ROW(OLD.org_id,OLD.project_id,OLD.requirement_id,OLD.change_type,OLD.delta_json,OLD.reason,
 OLD.requested_by,OLD.baseline_snapshot_id,OLD.proposed_checksum,OLD.proposed_layers_json,OLD.impact_json)
 THEN RAISE EXCEPTION 'CHANGE_REQUEST_INPUT_IMMUTABLE'; END IF;
 IF current_user='tc_app' AND NEW.status IN('APPROVED','REJECTED') AND (
   NEW.approved_by IS DISTINCT FROM current_setting('app.current_user',true)::uuid OR
   NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
     WHERE m.org_id=NEW.org_id AND m.user_id=NEW.approved_by AND m.status='ACTIVE' AND m.role IN('R-OWNER','R-ADMIN')))
 THEN RAISE EXCEPTION 'CURRENT_CHANGE_REVIEW_AUTHORITY_REQUIRED'; END IF;
 IF OLD.status IN('APPROVED','REJECTED','APPLIED') AND ROW(NEW.approved_by,NEW.decided_at) IS DISTINCT FROM ROW(OLD.approved_by,OLD.decided_at)
 THEN RAISE EXCEPTION 'CHANGE_DECISION_IMMUTABLE'; END IF;
 IF NEW.status='APPROVED' AND (OLD.status NOT IN('PENDING','SUBMITTED') OR NEW.approved_by IS NOT DISTINCT FROM NEW.requested_by)
 THEN RAISE EXCEPTION 'INDEPENDENT_CHANGE_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER requirement_change_input_immutable BEFORE UPDATE ON requirement_change_requests
 FOR EACH ROW EXECUTE FUNCTION protect_requirement_change_request();

CREATE TABLE project_baseline_approvals (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,project_id uuid NOT NULL,snapshot_id uuid NOT NULL,
 checksum text NOT NULL,reviewer_user_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,project_id,snapshot_id),
 FOREIGN KEY(org_id,project_id,snapshot_id) REFERENCES checklist_snapshots(org_id,project_id,id)
);
ALTER TABLE project_baseline_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_baseline_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY project_baseline_approvals_read ON project_baseline_approvals FOR SELECT
 USING(org_id=current_setting('app.current_org',true)::uuid);
CREATE POLICY project_baseline_approvals_insert ON project_baseline_approvals FOR INSERT
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid
 AND reviewer_user_id=current_setting('app.current_user',true)::uuid
 AND EXISTS(SELECT 1 FROM checklist_snapshots s JOIN memberships m ON m.org_id=s.org_id
  JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
  WHERE s.org_id=project_baseline_approvals.org_id AND s.project_id=project_baseline_approvals.project_id
   AND s.id=project_baseline_approvals.snapshot_id AND s.checksum=project_baseline_approvals.checksum
   AND s.status='ACTIVE' AND s.created_by<>m.user_id AND m.user_id=project_baseline_approvals.reviewer_user_id
   AND m.status='ACTIVE' AND m.role IN('R-OWNER','R-ADMIN')));
GRANT SELECT,INSERT ON project_baseline_approvals TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON project_baseline_approvals FROM tc_app;

CREATE OR REPLACE FUNCTION freeze_checklist_snapshot_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.org_id,NEW.project_id,NEW.version_no,NEW.resolved_payload_json,NEW.provenance_json,NEW.source_json,NEW.checksum,NEW.created_by)
 IS DISTINCT FROM ROW(OLD.org_id,OLD.project_id,OLD.version_no,OLD.resolved_payload_json,OLD.provenance_json,OLD.source_json,OLD.checksum,OLD.created_by)
 THEN RAISE EXCEPTION 'CHECKLIST_SNAPSHOT_CONTENT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checklist_snapshot_content_immutable BEFORE UPDATE ON checklist_snapshots
 FOR EACH ROW EXECUTE FUNCTION freeze_checklist_snapshot_content();
