-- G01-001: prevent the normal application role from unilaterally asserting
-- independent client / consultant signatory authority.
--
-- This is a fail-closed safety boundary, not a completed external delegation
-- workflow. An independently governed review process and trusted approval
-- service/role must be separately designed and accepted before production.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION guard_external_guest_authority_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Normal runtime DB credentials (tc_app or any alternate non-migrator app
  -- role) can issue/revoke grants, but CANNOT mint independent approval.
  IF current_user NOT IN ('tc_migrator', 'postgres') THEN
    IF (TG_OP = 'INSERT' AND
        (NEW.independent_authority_verified_at IS NOT NULL OR
         NEW.independent_authority_evidence_ref IS NOT NULL))
       OR (TG_OP = 'UPDATE' AND
        (NEW.independent_authority_verified_at IS DISTINCT FROM OLD.independent_authority_verified_at
         OR NEW.independent_authority_evidence_ref IS DISTINCT FROM OLD.independent_authority_evidence_ref)) THEN
      RAISE EXCEPTION 'INDEPENDENT_AUTHORITY_APPROVAL_REQUIRES_SEPARATE_TRUSTED_WORKFLOW'
        USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guest_grants_independent_authority_approval_guard ON guest_grants;
CREATE TRIGGER guest_grants_independent_authority_approval_guard
  BEFORE INSERT OR UPDATE ON guest_grants
  FOR EACH ROW EXECUTE FUNCTION guard_external_guest_authority_approval();

RESET ROLE;
