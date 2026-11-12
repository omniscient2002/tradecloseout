-- G01-001: the base legacy quarantine procedure (0036) is intentionally
-- tenant-RLS-scoped. Migration code cannot scan documents across all tenants
-- with an empty app.current_org: FORCE RLS hides those rows even from the
-- tc_migrator table owner. Iterate real organisation IDs and establish a
-- separate transaction-local tenant scope before each scoped reconciliation.
-- This additive migration corrects the 0036 empty-scope upgrade blind spot
-- without changing an already published migration checksum.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION g01_quarantine_all_unverified_external_approvals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_org RECORD;
  v_count INTEGER := 0;
BEGIN
  IF current_user <> 'tc_migrator' THEN
    RAISE EXCEPTION 'G01_MIGRATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  FOR v_org IN SELECT id FROM organisations ORDER BY id
  LOOP
    PERFORM set_config('app.current_org',v_org.id::text,true);
    PERFORM set_config('app.current_org_id',v_org.id::text,true);
    v_count := v_count + g01_quarantine_unverified_current_external_approvals();
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION g01_quarantine_all_unverified_external_approvals()
  FROM PUBLIC,tc_app,tc_external_authority_reviewer;
GRANT EXECUTE ON FUNCTION g01_quarantine_all_unverified_external_approvals()
  TO tc_migrator;

-- The migration runner holds its advisory lock and an open transaction.
-- Unverified current approvals are made non-current atomically on upgrade.
SELECT g01_quarantine_all_unverified_external_approvals();
RESET ROLE;
