-- G01-001: the project UPDATE trigger in migration 0028 runs as
-- tc_migrator, subject to FORCE RLS on guest_grants. Unlike the reviewer
-- approval function, it had not established the row's tenant context, so an
-- independent approval could be invisible and reassignment was permitted.
-- An actual restricted-role negative integration test guards this invariant.
-- Migrations are append-only; do not edit already applied 0028.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION guard_approved_guest_project_counterparty()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_org TEXT := current_setting('app.current_org', true);
  previous_org_id TEXT := current_setting('app.current_org_id', true);
  must_revoke BOOLEAN;
BEGIN
  -- The trigger operates on a project already authorised for UPDATE by the
  -- caller. Scope trusted read checks to that row's immutable tenant, rather
  -- than inheriting an absent or stale GUC from an administrative connection.
  PERFORM set_config('app.current_org', OLD.org_id::text, true);
  PERFORM set_config('app.current_org_id', OLD.org_id::text, true);

  SELECT (
    (NEW.client_party_id IS DISTINCT FROM OLD.client_party_id AND EXISTS (
      SELECT 1 FROM guest_grants g
       WHERE g.org_id=OLD.org_id AND g.project_id=OLD.id
         AND g.party_id=OLD.client_party_id AND g.grant_type='CLIENT_VIEW'
         AND g.status='ACTIVE' AND g.expires_at>now()
         AND g.independent_authority_verified_at IS NOT NULL
    )) OR
    (NEW.consultant_party_id IS DISTINCT FROM OLD.consultant_party_id AND EXISTS (
      SELECT 1 FROM guest_grants g
       WHERE g.org_id=OLD.org_id AND g.project_id=OLD.id
         AND g.party_id=OLD.consultant_party_id AND g.grant_type='CONSULTANT_REVIEW'
         AND g.status='ACTIVE' AND g.expires_at>now()
         AND g.independent_authority_verified_at IS NOT NULL
    ))
  ) INTO must_revoke;

  -- Restore the caller's transaction-local RLS GUCs after trusted reads.
  PERFORM set_config('app.current_org', COALESCE(previous_org,''), true);
  PERFORM set_config('app.current_org_id', COALESCE(previous_org_id,''), true);

  IF must_revoke THEN
    RAISE EXCEPTION 'APPROVED_GUEST_REVOKE_BEFORE_PROJECT_PARTY_CHANGE'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION guard_approved_guest_project_counterparty()
  FROM PUBLIC, tc_app, tc_external_authority_reviewer;

RESET ROLE;
