-- G01-001: Revoking an independently attested external decision must also
-- invalidate any already-committed current document approval derived from it.
-- Otherwise closeout readiness could continue trusting a disputed signature.
-- Immutable archive copies already delivered are handled by incident response.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION revoke_external_document_approval(
  p_org_id UUID,p_document_version_id UUID,p_proof_version_id UUID,
  p_external_party_id UUID,p_reason_ref TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
DECLARE
  v_reviewer NAME := session_user;
  v_doc RECORD;
BEGIN
  IF v_reviewer IN ('tc_app','tc_migrator','postgres') OR
     NOT pg_has_role(v_reviewer,'tc_external_authority_reviewer','MEMBER') THEN
    RAISE EXCEPTION 'PLATFORM_REVIEWER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_reason_ref IS NULL OR p_reason_ref !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'EXTERNAL_REVOCATION_REASON_REQUIRED' USING ERRCODE='22023';
  END IF;
  PERFORM set_config('app.current_org',p_org_id::text,true);
  PERFORM set_config('app.current_org_id',p_org_id::text,true);
  IF NOT EXISTS (
    SELECT 1 FROM external_document_approval_attestations
     WHERE org_id=p_org_id AND document_version_id=p_document_version_id
       AND proof_version_id=p_proof_version_id
       AND external_party_id=p_external_party_id
  ) THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_ATTESTATION_NOT_FOUND'
      USING ERRCODE='42501';
  END IF;

  -- Lock the original document/revision before recording the irreversible
  -- revocation. Subsequent approval transactions must serialize on these rows.
  SELECT d.id,d.current_approved_version_id,dv.review_status
    INTO v_doc FROM documents d
    JOIN document_versions dv ON dv.org_id=d.org_id
      AND dv.project_id=d.project_id AND dv.document_id=d.id
   WHERE d.org_id=p_org_id AND dv.id=p_document_version_id
   FOR UPDATE OF d,dv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_TARGET_NOT_FOUND'
      USING ERRCODE='42501';
  END IF;

  INSERT INTO external_document_approval_revocations
    (org_id,document_version_id,proof_version_id,external_party_id,
     reviewer_session_user,reason_ref)
  VALUES (p_org_id,p_document_version_id,p_proof_version_id,
          p_external_party_id,v_reviewer,p_reason_ref);

  -- A now-disputed externally approved revision cannot remain current.
  -- Retain immutable historical review rows; future readiness must fail
  -- until a fresh independent approval on new unrevoked evidence occurs.
  IF v_doc.current_approved_version_id=p_document_version_id THEN
    UPDATE document_versions
       SET review_status='CHANGES_REQUESTED',row_version=row_version+1
     WHERE id=p_document_version_id AND org_id=p_org_id
       AND review_status='APPROVED';
    UPDATE documents
       SET current_approved_version_id=NULL,row_version=row_version+1,
           updated_at=now()
     WHERE id=v_doc.id AND org_id=p_org_id
       AND current_approved_version_id=p_document_version_id;
  END IF;
  RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION revoke_external_document_approval(
  UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC,tc_app;
GRANT EXECUTE ON FUNCTION revoke_external_document_approval(
  UUID,UUID,UUID,UUID,TEXT) TO tc_external_authority_reviewer;
RESET ROLE;
