-- G01-001: an internal "record external approval" operation cannot infer a
-- counterparty decision from a contractor-selected PDF or party name.
-- Two different platform-managed reviewers must independently validate the
-- actual decision evidence (verified stored proof bytes, named party and exact
-- target document revision) before it can promote a document to APPROVED.
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS external_document_approval_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  project_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  proof_version_id UUID NOT NULL,
  external_party_id UUID NOT NULL,
  reviewer_session_user NAME NOT NULL,
  evidence_digest CHAR(64) NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  evidence_ref TEXT NOT NULL CHECK (evidence_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,project_id,document_version_id)
    REFERENCES document_versions(org_id,project_id,id),
  FOREIGN KEY (org_id,project_id,proof_version_id)
    REFERENCES document_versions(org_id,project_id,id),
  FOREIGN KEY (org_id,external_party_id)
    REFERENCES parties(org_id,id),
  UNIQUE (document_version_id,external_party_id,reviewer_session_user)
);
CREATE INDEX IF NOT EXISTS external_document_attestations_lookup
  ON external_document_approval_attestations
  (org_id,project_id,document_version_id,external_party_id,proof_version_id);
REVOKE ALL ON TABLE external_document_approval_attestations
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
ALTER TABLE external_document_approval_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_document_approval_attestations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_document_attestation_trusted_owner
  ON external_document_approval_attestations;
CREATE POLICY external_document_attestation_trusted_owner
  ON external_document_approval_attestations TO tc_migrator
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION forbid_external_document_attestation_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'EXTERNAL_DOCUMENT_ATTESTATION_IMMUTABLE'
    USING ERRCODE='42501';
END $$;
DROP TRIGGER IF EXISTS external_document_attestation_immutable
  ON external_document_approval_attestations;
CREATE TRIGGER external_document_attestation_immutable
  BEFORE UPDATE OR DELETE ON external_document_approval_attestations
  FOR EACH ROW EXECUTE FUNCTION forbid_external_document_attestation_mutation();

CREATE OR REPLACE FUNCTION attest_external_document_approval(
  p_org_id UUID, p_document_version_id UUID, p_proof_version_id UUID,
  p_external_party_id UUID, p_evidence_digest TEXT, p_evidence_ref TEXT
)
RETURNS TABLE (review_count INTEGER, independently_verified BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public
AS $$
DECLARE
  v_reviewer NAME := session_user;
  v_scope RECORD;
  v_count INTEGER;
BEGIN
  IF v_reviewer IN ('tc_app','tc_migrator','postgres') OR
     NOT pg_has_role(v_reviewer,'tc_external_authority_reviewer','MEMBER') THEN
    RAISE EXCEPTION 'PLATFORM_REVIEWER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_evidence_digest IS NULL OR p_evidence_digest !~ '^[0-9a-f]{64}$'
     OR p_evidence_ref IS NULL OR
        p_evidence_ref !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_document_version_id=p_proof_version_id THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_EVIDENCE_INVALID'
      USING ERRCODE='22023';
  END IF;
  PERFORM set_config('app.current_org',p_org_id::text,true);
  PERFORM set_config('app.current_org_id',p_org_id::text,true);

  -- Lock the live party, project, original revision, proof revision and
  -- authoritative storage object so they cannot change during attestation.
  SELECT target.project_id, proof.file_status AS proof_status,
         so.sha256 AS proof_sha
    INTO v_scope
    FROM document_versions target
    JOIN document_versions proof
      ON proof.org_id=target.org_id AND proof.project_id=target.project_id
     AND proof.id=p_proof_version_id AND proof.deleted_at IS NULL
    JOIN storage_objects so ON so.id=proof.object_id AND so.org_id=proof.org_id
    JOIN projects project ON project.id=target.project_id
      AND project.org_id=target.org_id
    JOIN parties party ON party.id=p_external_party_id
      AND party.org_id=target.org_id
   WHERE target.org_id=p_org_id AND target.id=p_document_version_id
     AND target.deleted_at IS NULL AND target.file_status='READY'
     AND target.superseded_at IS NULL
     AND project.status NOT IN ('CANCELLED','ARCHIVED')
     AND party.status='ACTIVE'
     AND party.id IN (project.client_party_id,project.consultant_party_id,project.mc_party_id)
     AND proof.file_status='READY' AND so.status='READY'
     AND so.sha256 IS NOT NULL AND lower(so.sha256)=p_evidence_digest
     AND so.provider_version_id IS NOT NULL
     AND so.observed_size_bytes IS NOT NULL
     AND so.observed_size_bytes=so.size_bytes
   FOR SHARE OF target,proof,so,project,party;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_PROOF_OR_AUTHORITY_INVALID'
      USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM external_document_approval_attestations a
     WHERE a.org_id=p_org_id
       AND a.document_version_id=p_document_version_id
       AND a.external_party_id=p_external_party_id
       AND (a.proof_version_id<>p_proof_version_id
         OR a.evidence_digest<>p_evidence_digest
         OR a.evidence_ref<>p_evidence_ref)
  ) THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_EVIDENCE_CONFLICT'
      USING ERRCODE='22023';
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_count
    FROM external_document_approval_attestations a
   WHERE a.org_id=p_org_id AND a.document_version_id=p_document_version_id
     AND a.external_party_id=p_external_party_id;
  IF v_count>=2 THEN
    RAISE EXCEPTION 'EXTERNAL_DOCUMENT_ALREADY_ATTESTED'
      USING ERRCODE='23505';
  END IF;

  INSERT INTO external_document_approval_attestations
    (org_id,project_id,document_version_id,proof_version_id,
     external_party_id,reviewer_session_user,evidence_digest,evidence_ref)
  VALUES (p_org_id,v_scope.project_id,p_document_version_id,p_proof_version_id,
          p_external_party_id,v_reviewer,p_evidence_digest,p_evidence_ref);

  RETURN QUERY SELECT v_count+1,(v_count+1>=2);
END $$;

REVOKE ALL ON FUNCTION attest_external_document_approval(
  UUID,UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC,tc_app;
GRANT EXECUTE ON FUNCTION attest_external_document_approval(
  UUID,UUID,UUID,UUID,TEXT,TEXT) TO tc_external_authority_reviewer;

-- A narrowly scoped TRUE/FALSE read for the ordinary application.
-- It cannot insert, edit or read reviewer records or fabricate attestations.
CREATE OR REPLACE FUNCTION has_verified_external_document_approval(
  p_org_id UUID, p_document_version_id UUID, p_proof_version_id UUID,
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
       AND so.sha256 IS NOT NULL
       AND a.evidence_digest=lower(so.sha256)
       AND party.status='ACTIVE'
       AND party.id IN (project.client_party_id,project.consultant_party_id,project.mc_party_id)
     GROUP BY a.evidence_digest,a.evidence_ref
    HAVING COUNT(DISTINCT a.reviewer_session_user)>=2
  );
END $$;
REVOKE ALL ON FUNCTION has_verified_external_document_approval(
  UUID,UUID,UUID,UUID) FROM PUBLIC,tc_external_authority_reviewer;
GRANT EXECUTE ON FUNCTION has_verified_external_document_approval(
  UUID,UUID,UUID,UUID) TO tc_app;
REVOKE ALL ON FUNCTION forbid_external_document_attestation_mutation()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;

RESET ROLE;
