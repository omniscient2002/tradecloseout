-- G01-001 independent counterparty authority: the contractor runtime account
-- has no EXECUTE privilege on this approval path and cannot grant itself the
-- platform reviewer role. Two DISTINCT authenticated platform database
-- identities must attest to the same independently checked evidence digest.
-- Provision individual reviewer LOGIN roles out-of-band through infrastructure
-- identity management; NEVER share a reviewer credential with the web/API.
-- Evidence must be checked against an independently established party
-- representative; this migration does not make contractor-supplied contacts
-- authoritative by itself.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_external_authority_reviewer') THEN
    CREATE ROLE tc_external_authority_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS external_authority_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  grant_id UUID NOT NULL REFERENCES guest_grants(id),
  reviewer_session_user NAME NOT NULL,
  evidence_digest CHAR(64) NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  evidence_ref TEXT NOT NULL CHECK (evidence_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  review_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grant_id, reviewer_session_user)
);

-- The migration role's default grants otherwise expose every new table to
-- the normal tc_app account. Explicitly revoke all data-plane access.
REVOKE ALL ON TABLE external_authority_reviews FROM PUBLIC, tc_app;
REVOKE ALL ON TABLE external_authority_reviews FROM tc_external_authority_reviewer;

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

  -- The grants table enforces FORCE RLS. Scope the privileged function to the
  -- exact caller-specified tenant and verify tenant and grant together.
  PERFORM set_config('app.current_org', p_org_id::text, true);
  PERFORM set_config('app.current_org_id', p_org_id::text, true);

  SELECT g.id, g.org_id, g.status, g.expires_at, g.grant_type,
         g.independent_authority_verified_at
    INTO v_grant
    FROM guest_grants AS g
   WHERE g.id=p_grant_id AND g.org_id=p_org_id
   FOR UPDATE;

  IF NOT FOUND OR v_grant.status <> 'ACTIVE' OR v_grant.expires_at <= now()
     OR v_grant.grant_type NOT IN ('CLIENT_VIEW', 'CONSULTANT_REVIEW') THEN
    RAISE EXCEPTION 'SENSITIVE_GRANT_NOT_APPROVABLE' USING ERRCODE='42501';
  END IF;
  IF v_grant.independent_authority_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'GRANT_ALREADY_APPROVED_REVOKE_TO_CHANGE' USING ERRCODE='23505';
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
    -- Runs inside this SECURITY DEFINER function as tc_migrator. Existing
    -- trigger 0024 prevents ordinary app accounts asserting these fields.
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

RESET ROLE;
