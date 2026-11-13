ALTER TABLE requirements ADD COLUMN qualification_required_since timestamptz;
ALTER TABLE requirements ADD COLUMN obligation_definition_json jsonb;
CREATE FUNCTION requirement_obligation_fingerprint(r requirements) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(digest(jsonb_build_object('definition',r.obligation_definition_json,'title',r.title,'description',r.description,
  'documentType',r.doc_type_key,'scope',r.scope_key,'group',r.group_key,'mandatory',r.mandatory,
  'reviewerRole',r.reviewer_role,'validity',r.validity_rule_json,
  'dueAt',to_char(r.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex')
$$;
REVOKE ALL ON FUNCTION requirement_obligation_fingerprint(requirements) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION requirement_obligation_fingerprint(requirements) TO tc_app;
ALTER TABLE reviews ADD COLUMN requirement_id uuid;
ALTER TABLE reviews ADD CONSTRAINT review_requirement_scope_fk FOREIGN KEY(org_id,project_id,requirement_id) REFERENCES requirements(org_id,project_id,id);
CREATE FUNCTION freeze_review_requirement_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.requirement_id IS DISTINCT FROM OLD.requirement_id THEN RAISE EXCEPTION 'REVIEW_REQUIREMENT_BINDING_IMMUTABLE'; END IF;RETURN NEW;END $$;
CREATE TRIGGER review_requirement_binding_guard BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION freeze_review_requirement_binding();
CREATE TABLE requirement_evidence_qualifications(
 id uuid PRIMARY KEY,org_id uuid NOT NULL,project_id uuid NOT NULL,requirement_id uuid NOT NULL,document_version_id uuid NOT NULL,review_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,obligation_fingerprint text NOT NULL,reviewer_role text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,requirement_id,document_version_id,review_id),
 FOREIGN KEY(org_id,project_id,requirement_id) REFERENCES requirements(org_id,project_id,id),
 FOREIGN KEY(org_id,project_id,document_version_id) REFERENCES document_versions(org_id,project_id,id),
 FOREIGN KEY(org_id,project_id,review_id) REFERENCES reviews(org_id,project_id,id),
 FOREIGN KEY(org_id,project_id,snapshot_id) REFERENCES checklist_snapshots(org_id,project_id,id)
);
ALTER TABLE requirement_evidence_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_evidence_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY requirement_qualification_read ON requirement_evidence_qualifications FOR SELECT USING(org_id=current_setting('app.current_org',true)::uuid);
CREATE POLICY requirement_qualification_insert ON requirement_evidence_qualifications FOR INSERT WITH CHECK(org_id=current_setting('app.current_org',true)::uuid
 AND created_by=current_setting('app.current_user',true)::uuid AND EXISTS(
  SELECT 1 FROM requirements r JOIN document_requirements dr ON dr.org_id=r.org_id AND dr.project_id=r.project_id AND dr.requirement_id=r.id
  JOIN document_versions dv ON dv.org_id=dr.org_id AND dv.project_id=dr.project_id AND dv.document_id=dr.document_id
  JOIN storage_objects so ON so.org_id=dv.org_id AND so.id=dv.object_id AND so.status='READY' AND so.sha256 IS NOT NULL
   AND so.provider_version_id IS NOT NULL AND so.observed_size_bytes=so.size_bytes
  JOIN reviews rv ON rv.org_id=dv.org_id AND rv.project_id=dv.project_id AND rv.document_version_id=dv.id AND rv.status='APPROVED' AND rv.decision='APPROVE'
  JOIN memberships m ON m.org_id=r.org_id AND m.user_id=current_setting('app.current_user',true)::uuid AND m.status='ACTIVE'
  JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
  WHERE r.org_id=requirement_evidence_qualifications.org_id AND r.project_id=requirement_evidence_qualifications.project_id
   AND r.id=requirement_evidence_qualifications.requirement_id AND dv.id=requirement_evidence_qualifications.document_version_id
   AND rv.decided_at IS NOT NULL AND (r.qualification_required_since IS NULL OR COALESCE(rv.recorded_at,rv.decided_at)>=r.qualification_required_since)
   AND rv.id=requirement_evidence_qualifications.review_id AND (rv.requirement_id IS NULL OR rv.requirement_id=r.id) AND r.current_snapshot_id=requirement_evidence_qualifications.snapshot_id
   AND r.reviewer_role=requirement_evidence_qualifications.reviewer_role
   AND requirement_obligation_fingerprint(r)=requirement_evidence_qualifications.obligation_fingerprint
   AND dv.file_status='READY' AND dv.review_status='APPROVED' AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
   AND (rv.method='IN_APP' AND rv.reviewer_subject_type='USER' AND rv.reviewer_subject_id=m.user_id AND dv.uploaded_by<>m.user_id
     AND (m.role=r.reviewer_role OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.org_id=r.org_id AND pm.project_id=r.project_id
       AND pm.user_id=m.user_id AND pm.role=r.reviewer_role AND pm.status='ACTIVE'))
    OR rv.method='EXTERNAL' AND rv.reviewer_subject_type='PARTY' AND rv.evidence_object_id IS NOT NULL
     AND r.reviewer_role IN('R-CONSULTANT','R-REVIEWER') AND m.role IN('R-OWNER','R-ADMIN','R-PM','R-DOC')
     AND EXISTS(SELECT 1 FROM storage_objects proof WHERE proof.org_id=rv.org_id AND proof.id=rv.evidence_object_id AND proof.status='READY'
       AND proof.sha256 IS NOT NULL AND proof.provider_version_id IS NOT NULL AND proof.observed_size_bytes=proof.size_bytes))));
GRANT SELECT,INSERT ON requirement_evidence_qualifications TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON requirement_evidence_qualifications FROM tc_app;
CREATE FUNCTION freeze_requirement_qualification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REQUIREMENT_QUALIFICATION_IMMUTABLE'; END $$;
CREATE TRIGGER requirement_qualification_immutable BEFORE UPDATE OR DELETE ON requirement_evidence_qualifications FOR EACH ROW EXECUTE FUNCTION freeze_requirement_qualification();
ALTER TABLE handover_packages ADD COLUMN baseline_obsoleted_at timestamptz;
ALTER TABLE submissions ADD COLUMN baseline_obsoleted_at timestamptz;
CREATE FUNCTION protect_review_decision_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.org_id,NEW.project_id,NEW.document_version_id,NEW.stage_key,NEW.reviewer_subject_type,NEW.method,NEW.requirement_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.project_id,OLD.document_version_id,OLD.stage_key,OLD.reviewer_subject_type,OLD.method,OLD.requirement_id,OLD.created_at)
 THEN RAISE EXCEPTION 'REVIEW_SCOPE_IMMUTABLE'; END IF;
 IF OLD.status IN('APPROVED','CHANGES_REQUESTED','REJECTED','CANCELLED') THEN
  IF NEW.status NOT IN(OLD.status,'CANCELLED') OR
   ROW(NEW.reviewer_subject_id,NEW.reviewer_user_id,NEW.reviewer_party_id,NEW.decision,NEW.decided_at,NEW.comment,
    NEW.external_method,NEW.external_approver_name,NEW.external_approver_role,NEW.external_reference,NEW.evidence_object_id,NEW.external_proof_version_id,NEW.on_behalf_of_user_id,NEW.recorded_at,NEW.occurred_at,NEW.occurred_at_precision,NEW.backdating_reason)
   IS DISTINCT FROM ROW(OLD.reviewer_subject_id,OLD.reviewer_user_id,OLD.reviewer_party_id,OLD.decision,OLD.decided_at,OLD.comment,
    OLD.external_method,OLD.external_approver_name,OLD.external_approver_role,OLD.external_reference,OLD.evidence_object_id,OLD.external_proof_version_id,OLD.on_behalf_of_user_id,OLD.recorded_at,OLD.occurred_at,OLD.occurred_at_precision,OLD.backdating_reason)
  THEN RAISE EXCEPTION 'REVIEW_DECISION_FACTS_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_decision_fact_guard BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION protect_review_decision_facts();
