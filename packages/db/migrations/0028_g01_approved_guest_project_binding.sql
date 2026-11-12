-- G01-001: independent external sign-off is valid for the reviewed project
-- counterparty, not merely for a contractor-created guest_grants row.
-- An approved grant must not become reusable by changing the project's
-- client/consultant party away and subsequently back without fresh review.
-- Database enforcement covers direct SQL, not only application controllers.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION approve_external_guest_authority(
  p_org_id UUID, p_grant_id UUID, p_evidence_digest TEXT, p_evidence_ref TEXT
)
RETURNS TABLE (review_count INTEGER, independently_verified BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_grant RECORD;
  v_count INTEGER;
  v_linked INTEGER;
  v_reviewer NAME := session_user;
BEGIN
  IF v_reviewer IN ('tc_app', 'tc_migrator', 'postgres') OR
     NOT pg_has_role(v_reviewer, 'tc_external_authority_reviewer', 'MEMBER') THEN
    RAISE EXCEPTION 'PLATFORM_REVIEWER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_evidence_digest IS NULL OR p_evidence_digest !~ '^[0-9a-f]{64}$'
     OR p_evidence_ref IS NULL
     OR p_evidence_ref !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'INVALID_INDEPENDENT_EVIDENCE_REFERENCE' USING ERRCODE='22023';
  END IF;

  PERFORM set_config('app.current_org', p_org_id::text, true);
  PERFORM set_config('app.current_org_id', p_org_id::text, true);

  SELECT g.id,g.org_id,g.project_id,g.party_id,g.status,g.expires_at,
         g.grant_type,g.independent_authority_verified_at
    INTO v_grant
    FROM guest_grants g
   WHERE g.id=p_grant_id AND g.org_id=p_org_id
   FOR UPDATE;

  IF NOT FOUND OR v_grant.status <> 'ACTIVE' OR v_grant.expires_at <= now()
     OR v_grant.grant_type NOT IN ('CLIENT_VIEW', 'CONSULTANT_REVIEW') THEN
    RAISE EXCEPTION 'SENSITIVE_GRANT_NOT_APPROVABLE' USING ERRCODE='42501';
  END IF;
  IF v_grant.independent_authority_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'GRANT_ALREADY_APPROVED_REVOKE_TO_CHANGE' USING ERRCODE='23505';
  END IF;

  -- Lock the actual project and external party until the review commits.
  -- Review of an unrelated or inactive party must fail independently of the
  -- request guard; no subsequent project edit may retroactively legitimize it.
  SELECT 1 INTO v_linked
    FROM projects p
    JOIN parties pt ON pt.org_id=p.org_id AND pt.id=v_grant.party_id
   WHERE p.id=v_grant.project_id AND p.org_id=p_org_id
     AND pt.status='ACTIVE'
     AND p.status NOT IN ('CANCELLED','ARCHIVED')
     AND ((v_grant.grant_type='CLIENT_VIEW' AND p.client_party_id=v_grant.party_id)
       OR (v_grant.grant_type='CONSULTANT_REVIEW' AND p.consultant_party_id=v_grant.party_id))
   FOR SHARE OF p, pt;
  IF v_linked IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_REVIEW_PROJECT_PARTY_MISMATCH' USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM external_authority_reviews er
     WHERE er.grant_id=p_grant_id
       AND (er.evidence_digest <> p_evidence_digest
            OR er.evidence_ref <> p_evidence_ref)
  ) THEN
    RAISE EXCEPTION 'INDEPENDENT_REVIEW_EVIDENCE_MISMATCH' USING ERRCODE='22023';
  END IF;

  INSERT INTO external_authority_reviews
    (org_id,grant_id,reviewer_session_user,evidence_digest,evidence_ref)
  VALUES (p_org_id,p_grant_id,v_reviewer,p_evidence_digest,p_evidence_ref);

  SELECT COUNT(*)::INTEGER INTO v_count FROM external_authority_reviews
    WHERE grant_id=p_grant_id AND org_id=p_org_id;

  IF v_count >= 2 THEN
    UPDATE guest_grants
       SET independent_authority_verified_at=now(),
           independent_authority_evidence_ref=p_evidence_ref
     WHERE id=p_grant_id AND org_id=p_org_id;
  END IF;

  RETURN QUERY SELECT v_count, (v_count >= 2);
END $$;

REVOKE ALL ON FUNCTION approve_external_guest_authority(UUID,UUID,TEXT,TEXT)
  FROM PUBLIC, tc_app;
GRANT EXECUTE ON FUNCTION approve_external_guest_authority(UUID,UUID,TEXT,TEXT)
  TO tc_external_authority_reviewer;

CREATE OR REPLACE FUNCTION guard_approved_guest_project_counterparty()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Block reassignment while a live, independently approved signatory for
  -- the old designated party still exists. An operator must revoke that grant
  -- (which also invalidates guest session authority) before changing parties.
  IF (NEW.client_party_id IS DISTINCT FROM OLD.client_party_id AND EXISTS (
        SELECT 1 FROM guest_grants g
         WHERE g.org_id=OLD.org_id AND g.project_id=OLD.id
           AND g.party_id=OLD.client_party_id
           AND g.grant_type='CLIENT_VIEW'
           AND g.status='ACTIVE' AND g.expires_at > now()
           AND g.independent_authority_verified_at IS NOT NULL
     )) OR
     (NEW.consultant_party_id IS DISTINCT FROM OLD.consultant_party_id AND EXISTS (
        SELECT 1 FROM guest_grants g
         WHERE g.org_id=OLD.org_id AND g.project_id=OLD.id
           AND g.party_id=OLD.consultant_party_id
           AND g.grant_type='CONSULTANT_REVIEW'
           AND g.status='ACTIVE' AND g.expires_at > now()
           AND g.independent_authority_verified_at IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'APPROVED_GUEST_REVOKE_BEFORE_PROJECT_PARTY_CHANGE'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_approved_guest_party_guard ON projects;
CREATE TRIGGER projects_approved_guest_party_guard
  BEFORE UPDATE OF client_party_id, consultant_party_id ON projects
  FOR EACH ROW EXECUTE FUNCTION guard_approved_guest_project_counterparty();

RESET ROLE;
