-- PH5-G28-001 defense in depth: the incident login may not read or mutate
-- ordinary tenant/session tables at all. Only a parameterized, independently
-- approved security-definer operation may inspect and quarantine target rows.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION public.execute_approved_incident_runbook(
  p_approval uuid,
  p_org uuid,
  p_code text,
  p_entity uuid,
  p_operator_user uuid,
  p_reason text,
  p_execute boolean
)
RETURNS TABLE (
  matched_targets integer,
  changed_targets integer,
  project_id uuid,
  audit_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $runbook$
DECLARE
  v_approval uuid;
  v_matched integer := 0;
  v_changed integer := 0;
  v_project uuid := NULL;
  v_event uuid := NULL;
  v_object uuid;
  v_pkg record;
  v_updated integer;
  v_storage_changed integer;
  v_request text;
  v_after jsonb;
BEGIN
  IF session_user = 'tc_incident_operator' OR session_user = 'tc_migrator' THEN
    RAISE EXCEPTION 'INCIDENT_INDIVIDUAL_LOGIN_REQUIRED';
  END IF;
  IF p_code NOT IN ('RB-08', 'RB-09', 'RB-12') OR
     p_operator_user IS NULL OR p_org IS NULL OR
     p_reason IS NULL OR length(p_reason) < 12 OR length(p_reason) > 500 OR
     (p_code = 'RB-08' AND p_entity IS NOT NULL) OR
     (p_code IN ('RB-09','RB-12') AND p_entity IS NULL) THEN
    RAISE EXCEPTION 'INCIDENT_ARGUMENTS_INVALID';
  END IF;
  -- SECURITY DEFINER uses the restricted schema owner, not caller GUC
  -- authority. Every target is still pinned to the approved org parameter.
  PERFORM set_config('app.current_org', p_org::text, true);
  PERFORM set_config('app.current_org_id', p_org::text, true);
  SELECT a.id INTO v_approval
    FROM public.incident_runbook_approvals a
   WHERE a.id = p_approval AND a.org_id = p_org
     AND a.code = p_code AND a.entity_id IS NOT DISTINCT FROM p_entity
     AND a.operator_db_login = session_user
     AND a.operator_user_id = p_operator_user AND a.reason = p_reason
     AND a.consumed_at IS NULL AND a.expires_at > statement_timestamp()
   FOR UPDATE;
  IF v_approval IS NULL THEN
    RAISE EXCEPTION 'INCIDENT_APPROVAL_MISSING_EXPIRED_OR_USED';
  END IF;

  IF p_code = 'RB-08' THEN
    SELECT count(*)::integer INTO v_matched FROM public.sessions
     WHERE active_org_id = p_org AND revoked_at IS NULL;
    IF p_execute THEN
      UPDATE public.sessions SET revoked_at = now()
       WHERE active_org_id = p_org AND revoked_at IS NULL;
      GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;
  ELSIF p_code = 'RB-09' THEN
    SELECT dv.project_id, so.id INTO v_project, v_object
      FROM public.document_versions dv
      JOIN public.storage_objects so
        ON so.org_id = dv.org_id AND so.id = dv.object_id
     WHERE dv.org_id = p_org AND dv.id = p_entity
     FOR UPDATE OF dv, so;
    IF v_object IS NULL THEN RAISE EXCEPTION 'INCIDENT_VERSION_NOT_FOUND'; END IF;
    v_matched := 1;
    IF p_execute THEN
      UPDATE public.storage_objects SET status = 'QUARANTINED'
       WHERE org_id = p_org AND id = v_object
         AND status <> 'QUARANTINED';
      GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;
  ELSIF p_code = 'RB-12' THEN
    SELECT hp.project_id, hp.status, hp.pdf_object_id,
           hp.zip_object_id, hp.manifest_object_id
      INTO v_pkg
      FROM public.handover_packages hp
     WHERE hp.org_id = p_org AND hp.id = p_entity
     FOR UPDATE OF hp;
    IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_PACKAGE_NOT_FOUND'; END IF;
    v_project := v_pkg.project_id;
    v_matched := 1;
    IF p_execute THEN
      UPDATE public.handover_packages
         SET status = 'REJECTED', row_version = row_version + 1,
             updated_at = now()
       WHERE org_id = p_org AND id = p_entity AND status <> 'REJECTED';
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      UPDATE public.storage_objects SET status = 'QUARANTINED'
       WHERE org_id = p_org AND
         id = ANY(array_remove(
           ARRAY[v_pkg.pdf_object_id, v_pkg.zip_object_id, v_pkg.manifest_object_id]::uuid[],
           NULL::uuid
         )) AND status <> 'QUARANTINED';
      GET DIAGNOSTICS v_storage_changed = ROW_COUNT;
      IF v_updated > 0 OR v_storage_changed > 0 THEN v_changed := 1; END IF;
    END IF;
  END IF;

  IF p_execute THEN
    UPDATE public.incident_runbook_approvals
       SET consumed_at = statement_timestamp()
     WHERE id = v_approval AND consumed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_APPROVAL_ALREADY_CONSUMED'; END IF;
    v_event := gen_random_uuid();
    v_request := 'rb_' || v_event::text;
    v_after := jsonb_build_object(
      'code', p_code, 'approvalRef', p_approval, 'reason', p_reason,
      'matchedTargets', v_matched, 'changedTargets', v_changed,
      'containment', 'DATABASE_AND_FUTURE_APP_DOWNLOADS_ONLY'
    );
    INSERT INTO public.admin_audit_events
      (id, org_id, admin_user_id, action, reason, entity_type,
       entity_id, after_json, request_id)
    VALUES (gen_random_uuid(), p_org, p_operator_user,
      'INCIDENT_' || p_code, p_reason, 'INCIDENT_RUNBOOK',
      p_entity, v_after, v_request);
    INSERT INTO public.audit_events
      (id, org_id, project_id, actor_type, actor_user_id, action,
       entity_type, entity_id, after_json, request_id)
    VALUES (v_event, p_org, v_project, 'ADMIN', p_operator_user,
      'RUNBOOK_' || p_code, 'RUNBOOK_EXECUTION',
      COALESCE(p_entity, p_org), v_after, v_request);
  END IF;
  RETURN QUERY SELECT v_matched, v_changed, v_project, v_event;
END
$runbook$;

REVOKE ALL ON FUNCTION public.execute_approved_incident_runbook(uuid,uuid,text,uuid,uuid,text,boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_approved_incident_runbook(uuid,uuid,text,uuid,uuid,text,boolean)
  TO tc_incident_operator;
REVOKE EXECUTE ON FUNCTION public.claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)
  FROM tc_incident_operator;

-- No direct SQL bypass, including cross-tenant read of the globally scoped
-- sessions table. Tenant GUCs alone are NOT independent authorization.
REVOKE ALL ON TABLE public.organisations, public.sessions, public.document_versions,
  public.storage_objects, public.handover_packages, public.audit_events,
  public.admin_audit_events FROM tc_incident_operator;
REVOKE ALL ON SEQUENCE public.audit_events_chain_seq FROM tc_incident_operator;
RESET ROLE;
