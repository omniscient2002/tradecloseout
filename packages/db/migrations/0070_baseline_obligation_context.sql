-- Observed facts, not an inferred HVAC mapping or an engineering approval.
CREATE FUNCTION project_obligation_context(organisation_id uuid,target_project_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('schemaVersion',1,'project',jsonb_build_object('projectType',p.project_type,'clientPartyId',p.client_party_id,
  'mainContractorPartyId',p.mc_party_id,'consultantPartyId',p.consultant_party_id,'contractValuePaise',p.contract_value_paise::text,
  'startDate',p.start_date,'targetHandoverDate',p.target_handover_date,'settings',p.settings_json),
  'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(c)-ARRAY['row_version','created_at','updated_at','created_by'] ORDER BY c.id)
    FROM contracts c WHERE c.org_id=p.org_id AND c.project_id=p.id AND c.status='ACTIVE'),'[]'::jsonb),
  'variations',COALESCE((SELECT jsonb_agg(to_jsonb(v)-ARRAY['row_version','created_at','updated_at','created_by','approved_at','approved_by'] ORDER BY v.id)
    FROM variations v WHERE v.org_id=p.org_id AND v.project_id=p.id AND v.status='APPROVED'),'[]'::jsonb),
  'specifications',COALESCE((SELECT jsonb_agg(to_jsonb(s)-ARRAY['row_version','created_at','updated_at','created_by'] ORDER BY s.id)
    FROM specification_refs s WHERE s.org_id=p.org_id AND s.project_id=p.id),'[]'::jsonb),
  'assets',COALESCE((SELECT jsonb_agg(to_jsonb(a)-ARRAY['row_version','created_at','updated_at','created_by','deleted_at','warranty_start','warranty_end'] ORDER BY a.id)
    FROM assets a WHERE a.org_id=p.org_id AND a.project_id=p.id AND a.status='ACTIVE' AND a.deleted_at IS NULL),'[]'::jsonb))
 FROM projects p WHERE p.org_id=organisation_id AND p.id=target_project_id
$$;
CREATE FUNCTION project_obligation_context_checksum(organisation_id uuid,target_project_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(digest(project_obligation_context(organisation_id,target_project_id)::text,'sha256'),'hex')
$$;
REVOKE ALL ON FUNCTION project_obligation_context(uuid,uuid),project_obligation_context_checksum(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_obligation_context(uuid,uuid),project_obligation_context_checksum(uuid,uuid) TO tc_app;
ALTER TABLE checklist_snapshots ADD COLUMN obligation_context_json jsonb;
ALTER TABLE checklist_snapshots ADD COLUMN obligation_context_checksum text;
ALTER TABLE checklist_snapshots ADD COLUMN context_capture_kind text;
-- Preserve prior approvals without inventing retrospective review evidence.
-- This is an explicitly labelled observation from which subsequent drift is detectable.
UPDATE checklist_snapshots s SET obligation_context_json=project_obligation_context(s.org_id,s.project_id),
 obligation_context_checksum=project_obligation_context_checksum(s.org_id,s.project_id),context_capture_kind='MIGRATION_OBSERVATION'
 WHERE s.status='ACTIVE';
ALTER TABLE requirement_change_requests ADD COLUMN proposed_context_checksum text;
CREATE FUNCTION capture_baseline_obligation_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.obligation_context_json=project_obligation_context(NEW.org_id,NEW.project_id);
  NEW.obligation_context_checksum=project_obligation_context_checksum(NEW.org_id,NEW.project_id);
  NEW.context_capture_kind='BASELINE_APPLICATION';
 ELSE
  IF ROW(NEW.obligation_context_json,NEW.obligation_context_checksum,NEW.context_capture_kind)
    IS DISTINCT FROM ROW(OLD.obligation_context_json,OLD.obligation_context_checksum,OLD.context_capture_kind) THEN
   RAISE EXCEPTION 'BASELINE_CONTEXT_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER baseline_context_capture BEFORE INSERT OR UPDATE ON checklist_snapshots FOR EACH ROW EXECUTE FUNCTION capture_baseline_obligation_context();
CREATE FUNCTION capture_baseline_proposal_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.proposed_context_checksum=project_obligation_context_checksum(NEW.org_id,NEW.project_id);
 ELSIF NEW.proposed_context_checksum IS DISTINCT FROM OLD.proposed_context_checksum THEN RAISE EXCEPTION 'BASELINE_PROPOSAL_CONTEXT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER baseline_proposal_context_capture BEFORE INSERT OR UPDATE ON requirement_change_requests FOR EACH ROW EXECUTE FUNCTION capture_baseline_proposal_context();
CREATE FUNCTION package_baseline_is_current(organisation_id uuid,target_project_id uuid,target_package_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM handover_packages hp JOIN checklist_snapshots s ON s.org_id=hp.org_id AND s.project_id=hp.project_id
  AND s.id=hp.snapshot_id AND s.status='ACTIVE' AND s.checksum=hp.snapshot_checksum
  WHERE hp.org_id=organisation_id AND hp.project_id=target_project_id AND hp.id=target_package_id AND hp.baseline_obsoleted_at IS NULL
    AND s.obligation_context_checksum=project_obligation_context_checksum(s.org_id,s.project_id))
$$;
REVOKE ALL ON FUNCTION package_baseline_is_current(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION package_baseline_is_current(uuid,uuid,uuid) TO tc_app;
