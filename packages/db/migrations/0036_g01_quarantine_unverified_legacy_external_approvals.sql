-- G01-001: the newer two-reviewer external-document gate prevents NEW
-- contractor claims but does not automatically authenticate older EXTERNAL
-- approvals recorded before the gate existed. Preserve the original review
-- evidence and audit, but fail closed on currently approved legacy revisions
-- until genuine independent authority is re-established.
--
-- This is a deliberately availability-affecting upgrade: perform a staging
-- inventory and restore rehearsal before shipping. Only externally APPROVED
-- current pointers without two live matching independent attestations change.
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS g01_legacy_external_approval_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  project_id UUID NOT NULL,
  document_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  review_id UUID NOT NULL,
  reason_code TEXT NOT NULL DEFAULT 'LEGACY_EXTERNAL_AUTHORITY_UNVERIFIED'
    CHECK (reason_code='LEGACY_EXTERNAL_AUTHORITY_UNVERIFIED'),
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id,document_version_id),
  FOREIGN KEY (org_id,project_id,document_id)
    REFERENCES documents(org_id,project_id,id),
  FOREIGN KEY (org_id,project_id,document_version_id)
    REFERENCES document_versions(org_id,project_id,id),
  FOREIGN KEY (org_id,project_id,review_id)
    REFERENCES reviews(org_id,project_id,id)
);
REVOKE ALL ON g01_legacy_external_approval_quarantine
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
ALTER TABLE g01_legacy_external_approval_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE g01_legacy_external_approval_quarantine FORCE ROW LEVEL SECURITY;
CREATE POLICY g01_legacy_external_approval_quarantine_migrator
  ON g01_legacy_external_approval_quarantine TO tc_migrator
  USING (true) WITH CHECK (true);

-- Legacy record preservation must be immutable. Only tc_migrator may SELECT
-- quarantine details using an isolated audited migration/operations account.
CREATE OR REPLACE FUNCTION g01_forbid_legacy_quarantine_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  RAISE EXCEPTION 'G01_LEGACY_QUARANTINE_IMMUTABLE' USING ERRCODE='42501';
END $$;
CREATE TRIGGER g01_legacy_external_quarantine_immutable
  BEFORE UPDATE OR DELETE ON g01_legacy_external_approval_quarantine
  FOR EACH ROW EXECUTE FUNCTION g01_forbid_legacy_quarantine_mutation();

CREATE OR REPLACE FUNCTION g01_quarantine_unverified_current_external_approvals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_row RECORD;
  v_approved BOOLEAN;
  v_review_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Only the trusted migrator role, never a reviewer or API session, can
  -- invoke the upgrade/reconciliation procedure.
  IF current_user <> 'tc_migrator' THEN
    RAISE EXCEPTION 'G01_MIGRATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  FOR v_row IN
    SELECT d.org_id,d.project_id,d.id AS document_id,
           dv.id AS version_id
      FROM documents d JOIN document_versions dv
        ON dv.id=d.current_approved_version_id
       AND dv.org_id=d.org_id AND dv.project_id=d.project_id
     WHERE dv.review_status='APPROVED' AND dv.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM reviews r
          WHERE r.org_id=d.org_id AND r.project_id=d.project_id
            AND r.document_version_id=dv.id
            AND r.method='EXTERNAL' AND r.status='APPROVED'
            AND r.decision='APPROVE'
       )
     ORDER BY d.org_id,d.id
     FOR UPDATE OF d,dv
  LOOP
    PERFORM set_config('app.current_org',v_row.org_id::text,true);
    PERFORM set_config('app.current_org_id',v_row.org_id::text,true);
    SELECT EXISTS (
      SELECT 1 FROM reviews r
       WHERE r.org_id=v_row.org_id AND r.project_id=v_row.project_id
         AND r.document_version_id=v_row.version_id
         AND r.method='EXTERNAL' AND r.status='APPROVED'
         AND r.decision='APPROVE'
         AND r.external_proof_version_id IS NOT NULL
         AND r.reviewer_party_id IS NOT NULL
         AND has_verified_external_document_approval(
           v_row.org_id,v_row.version_id,
           r.external_proof_version_id,r.reviewer_party_id
         )
    ) INTO v_approved;
    IF v_approved THEN CONTINUE; END IF;

    SELECT r.id INTO v_review_id FROM reviews r
     WHERE r.org_id=v_row.org_id AND r.project_id=v_row.project_id
       AND r.document_version_id=v_row.version_id
       AND r.method='EXTERNAL' AND r.status='APPROVED'
       AND r.decision='APPROVE'
     ORDER BY r.created_at DESC,r.id LIMIT 1;

    INSERT INTO g01_legacy_external_approval_quarantine
      (org_id,project_id,document_id,document_version_id,review_id)
    VALUES (v_row.org_id,v_row.project_id,v_row.document_id,
            v_row.version_id,v_review_id)
    ON CONFLICT (org_id,document_version_id) DO NOTHING;

    -- Preserve original reviews, attestation history and proof objects;
    -- remove only the live readiness authority. A fresh independently
    -- verified decision is required to restore it.
    UPDATE document_versions
       SET review_status='CHANGES_REQUESTED',row_version=row_version+1
     WHERE org_id=v_row.org_id AND project_id=v_row.project_id
       AND id=v_row.version_id AND review_status='APPROVED';
    UPDATE documents
       SET current_approved_version_id=NULL,row_version=row_version+1,
           updated_at=now()
     WHERE org_id=v_row.org_id AND project_id=v_row.project_id
       AND id=v_row.document_id
       AND current_approved_version_id=v_row.version_id;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION g01_quarantine_unverified_current_external_approvals()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
GRANT EXECUTE ON FUNCTION g01_quarantine_unverified_current_external_approvals()
  TO tc_migrator;
REVOKE ALL ON FUNCTION g01_forbid_legacy_quarantine_mutation()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;

-- Execute in the migration transaction so failures abort the entire upgrade.
-- This is deterministic for the database snapshot under the deployment lock.
SELECT g01_quarantine_unverified_current_external_approvals();
RESET ROLE;
