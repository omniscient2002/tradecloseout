-- G01: a grant is an immutable assertion about one external recipient.
-- Once issued, its party, target contact, project, capabilities and provenance
-- cannot be silently reassigned. To change them, revoke the old grant and
-- issue a fresh invitation with a new OTP and independent approval.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION guard_guest_grant_immutable_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.party_id IS DISTINCT FROM OLD.party_id
     OR NEW.target_email IS DISTINCT FROM OLD.target_email
     OR NEW.target_phone_e164 IS DISTINCT FROM OLD.target_phone_e164
     OR NEW.grant_type IS DISTINCT FROM OLD.grant_type
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.capabilities IS DISTINCT FROM OLD.capabilities
     OR NEW.scope_json IS DISTINCT FROM OLD.scope_json
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.principal_user_id IS NOT NULL
          AND NEW.principal_user_id IS DISTINCT FROM OLD.principal_user_id)
  THEN
    RAISE EXCEPTION 'GUEST_GRANT_IDENTITY_IMMUTABLE_REVOKE_AND_REISSUE'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guest_grants_immutable_identity ON guest_grants;
CREATE TRIGGER guest_grants_immutable_identity
  BEFORE UPDATE ON guest_grants
  FOR EACH ROW EXECUTE FUNCTION guard_guest_grant_immutable_identity();

RESET ROLE;
