-- G01-001: privileged external decisions are append-only. The first and
-- second attestations must remain reconstructible after grant revocation.
-- Party deactivation cannot leave a live independently approved grant whose
-- dormant authority silently returns when that party becomes active again.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION forbid_external_authority_review_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'EXTERNAL_AUTHORITY_REVIEW_IMMUTABLE'
    USING ERRCODE='42501';
END $$;

DROP TRIGGER IF EXISTS external_authority_review_append_only ON external_authority_reviews;
CREATE TRIGGER external_authority_review_append_only
  BEFORE UPDATE OR DELETE ON external_authority_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_external_authority_review_mutation();

CREATE OR REPLACE FUNCTION guard_approved_guest_party_deactivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_org TEXT := current_setting('app.current_org', true);
  previous_org_id TEXT := current_setting('app.current_org_id', true);
  has_approved BOOLEAN;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR OLD.status <> 'ACTIVE'
     OR NEW.status = 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.current_org', OLD.org_id::text, true);
  PERFORM set_config('app.current_org_id', OLD.org_id::text, true);
  SELECT EXISTS (
    SELECT 1 FROM guest_grants g
     WHERE g.org_id=OLD.org_id AND g.party_id=OLD.id
       AND g.status='ACTIVE' AND g.expires_at>now()
       AND g.grant_type IN ('CLIENT_VIEW','CONSULTANT_REVIEW')
       AND g.independent_authority_verified_at IS NOT NULL
  ) INTO has_approved;
  PERFORM set_config('app.current_org', COALESCE(previous_org,''), true);
  PERFORM set_config('app.current_org_id', COALESCE(previous_org_id,''), true);
  IF has_approved THEN
    RAISE EXCEPTION 'APPROVED_GUEST_REVOKE_BEFORE_PARTY_DEACTIVATION'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS parties_approved_guest_status_guard ON parties;
CREATE TRIGGER parties_approved_guest_status_guard
  BEFORE UPDATE OF status ON parties
  FOR EACH ROW EXECUTE FUNCTION guard_approved_guest_party_deactivation();

REVOKE ALL ON FUNCTION forbid_external_authority_review_mutation()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
REVOKE ALL ON FUNCTION guard_approved_guest_party_deactivation()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;

RESET ROLE;
