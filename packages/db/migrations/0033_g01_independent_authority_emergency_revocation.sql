-- G01-001: verified independent authority must be revocable independently
-- of the contractor issuer. A platform reviewer can immediately fail closed
-- on a compromised guest grant or fraudulent offline document attestation.
-- Revocations append immutable evidence; no reactivation is possible.
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS external_authority_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  grant_id UUID NOT NULL REFERENCES guest_grants(id),
  reviewer_session_user NAME NOT NULL,
  reason_ref TEXT NOT NULL CHECK (reason_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id,grant_id)
);

CREATE TABLE IF NOT EXISTS external_document_approval_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  document_version_id UUID NOT NULL REFERENCES document_versions(id),
  proof_version_id UUID NOT NULL REFERENCES document_versions(id),
  external_party_id UUID NOT NULL REFERENCES parties(id),
  reviewer_session_user NAME NOT NULL,
  reason_ref TEXT NOT NULL CHECK (reason_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id,document_version_id,proof_version_id,external_party_id)
);
REVOKE ALL ON external_authority_revocations,
  external_document_approval_revocations
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
ALTER TABLE external_authority_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_authority_revocations FORCE ROW LEVEL SECURITY;
ALTER TABLE external_document_approval_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_document_approval_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY external_authority_revocations_trusted_owner
  ON external_authority_revocations TO tc_migrator
  USING (true) WITH CHECK (true);
CREATE POLICY external_document_revocations_trusted_owner
  ON external_document_approval_revocations TO tc_migrator
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION forbid_external_revocation_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'INDEPENDENT_REVOCATION_IMMUTABLE' USING ERRCODE='42501';
END $$;
CREATE TRIGGER external_authority_revocation_immutable
  BEFORE UPDATE OR DELETE ON external_authority_revocations
  FOR EACH ROW EXECUTE FUNCTION forbid_external_revocation_mutation();
CREATE TRIGGER external_document_revocation_immutable
  BEFORE UPDATE OR DELETE ON external_document_approval_revocations
  FOR EACH ROW EXECUTE FUNCTION forbid_external_revocation_mutation();

CREATE OR REPLACE FUNCTION revoke_independent_external_guest_grant(
  p_org_id UUID,p_grant_id UUID,p_reason_ref TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
DECLARE
  v_reviewer NAME := session_user;
  v_grant RECORD;
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
  SELECT id,status INTO v_grant FROM guest_grants
   WHERE id=p_grant_id AND org_id=p_org_id
     AND grant_type IN ('CLIENT_VIEW','CONSULTANT_REVIEW') FOR UPDATE;
  IF NOT FOUND OR v_grant.status<>'ACTIVE' THEN
    RAISE EXCEPTION 'EXTERNAL_GRANT_NOT_REVOCABLE' USING ERRCODE='42501';
  END IF;
  INSERT INTO external_authority_revocations
    (org_id,grant_id,reviewer_session_user,reason_ref)
  VALUES (p_org_id,p_grant_id,v_reviewer,p_reason_ref);
  UPDATE guest_grants SET status='REVOKED'
   WHERE id=p_grant_id AND org_id=p_org_id AND status='ACTIVE';
  UPDATE sessions SET revoked_at=now(),mfa_verified=false,mfa_verified_at=NULL
   WHERE guest_grant_id=p_grant_id AND revoked_at IS NULL;
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION revoke_external_document_approval(
  p_org_id UUID,p_document_version_id UUID,p_proof_version_id UUID,
  p_external_party_id UUID,p_reason_ref TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
DECLARE
  v_reviewer NAME := session_user;
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
  INSERT INTO external_document_approval_revocations
    (org_id,document_version_id,proof_version_id,external_party_id,
     reviewer_session_user,reason_ref)
  VALUES (p_org_id,p_document_version_id,p_proof_version_id,
          p_external_party_id,v_reviewer,p_reason_ref);
  RETURN TRUE;
END $$;

-- Revocation must be authoritative at the API's boolean-only verification
-- boundary, including attempts to record an older, now-disputed proof.
CREATE OR REPLACE FUNCTION has_verified_external_document_approval(
  p_org_id UUID,p_document_version_id UUID,p_proof_version_id UUID,
  p_external_party_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
BEGIN
  IF NULLIF(current_setting('app.current_org',true),'')::uuid
       IS DISTINCT FROM p_org_id
     OR p_document_version_id=p_proof_version_id THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM external_document_approval_revocations
     WHERE org_id=p_org_id AND document_version_id=p_document_version_id
       AND proof_version_id=p_proof_version_id
       AND external_party_id=p_external_party_id
  ) THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1
      FROM external_document_approval_attestations a
      JOIN document_versions proof ON proof.org_id=a.org_id
       AND proof.project_id=a.project_id AND proof.id=a.proof_version_id
      JOIN storage_objects so ON so.org_id=proof.org_id
       AND so.id=proof.object_id
      JOIN document_versions target ON target.org_id=a.org_id
       AND target.project_id=a.project_id AND target.id=a.document_version_id
      JOIN projects project ON project.org_id=a.org_id AND project.id=a.project_id
      JOIN parties party ON party.org_id=a.org_id AND party.id=a.external_party_id
     WHERE a.org_id=p_org_id AND a.document_version_id=p_document_version_id
       AND a.proof_version_id=p_proof_version_id
       AND a.external_party_id=p_external_party_id
       AND proof.file_status='READY' AND proof.deleted_at IS NULL
       AND target.file_status='READY' AND target.deleted_at IS NULL
       AND target.superseded_at IS NULL
       AND so.status='READY' AND so.provider_version_id IS NOT NULL
       AND so.observed_size_bytes=so.size_bytes
       AND so.sha256 IS NOT NULL AND a.evidence_digest=lower(so.sha256)
       AND party.status='ACTIVE'
       AND party.id IN (project.client_party_id,project.consultant_party_id,project.mc_party_id)
     GROUP BY a.evidence_digest,a.evidence_ref
    HAVING COUNT(DISTINCT a.reviewer_session_user)>=2
  );
END $$;

REVOKE ALL ON FUNCTION revoke_independent_external_guest_grant(UUID,UUID,TEXT)
  FROM PUBLIC,tc_app;
REVOKE ALL ON FUNCTION revoke_external_document_approval(UUID,UUID,UUID,UUID,TEXT)
  FROM PUBLIC,tc_app;
GRANT EXECUTE ON FUNCTION revoke_independent_external_guest_grant(UUID,UUID,TEXT)
  TO tc_external_authority_reviewer;
GRANT EXECUTE ON FUNCTION revoke_external_document_approval(UUID,UUID,UUID,UUID,TEXT)
  TO tc_external_authority_reviewer;
REVOKE ALL ON FUNCTION forbid_external_revocation_mutation()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
REVOKE ALL ON FUNCTION has_verified_external_document_approval(UUID,UUID,UUID,UUID)
  FROM PUBLIC,tc_external_authority_reviewer;
GRANT EXECUTE ON FUNCTION has_verified_external_document_approval(UUID,UUID,UUID,UUID)
  TO tc_app;

RESET ROLE;
