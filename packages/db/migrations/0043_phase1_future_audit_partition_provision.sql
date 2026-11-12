-- PH1-G26-001: provision each future audit partition with the same hardening
-- contract used for existing audit children in migration 0021.
-- Existing applied migrations are immutable; this is forward-only.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION public.phase1_create_audit_month_partition(
  p_year integer,
  p_month integer
)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  partition_name text;
  partition_table regclass;
  from_boundary timestamptz;
  to_boundary timestamptz;
BEGIN
  IF p_year < 2026 OR p_year > 9998 OR p_month < 1 OR p_month > 12
  THEN
    RAISE EXCEPTION 'AUDIT_PARTITION_INVALID_MONTH' USING ERRCODE = '22023';
  END IF;

  partition_name := format('audit_events_%s_%s', p_year, lpad(p_month::text, 2, '0'));
  from_boundary := make_date(p_year, p_month, 1)::timestamp AT TIME ZONE 'UTC';
  to_boundary := (make_date(p_year, p_month, 1) + interval '1 month')::timestamp AT TIME ZONE 'UTC';

  partition_table := to_regclass(format('public.%I', partition_name));
  IF partition_table IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.audit_events FOR VALUES FROM (%L) TO (%L)',
      partition_name, from_boundary, to_boundary
    );
    partition_table := to_regclass(format('public.%I', partition_name));
  END IF;

  -- Never harden an unrelated table simply because its name resembles the
  -- planned partition. A malicious/conflicting name must fail closed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits
     WHERE inhrelid = partition_table
       AND inhparent = 'public.audit_events'::regclass
  ) THEN
    RAISE EXCEPTION 'AUDIT_PARTITION_NOT_ATTACHED' USING ERRCODE = '42501';
  END IF;

  -- A child is never an executable runtime API. PostgreSQL's table defaults
  -- are already revoked by 0021; enforce the explicit ACL again here.
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM tc_app, PUBLIC', partition_table);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', partition_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', partition_table);
  EXECUTE format('DROP POLICY IF EXISTS phase1_audit_child_select ON %s', partition_table);
  EXECUTE format(
    'CREATE POLICY phase1_audit_child_select ON %s FOR SELECT TO tc_app ' ||
    'USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
    partition_table
  );
  -- Parent row-trigger clones cover UPDATE/DELETE on each new child, but
  -- TRUNCATE is a separate privilege and a statement-level trigger.
  EXECUTE format('DROP TRIGGER IF EXISTS trg_phase1_audit_truncate ON %s', partition_table);
  EXECUTE format(
    'CREATE TRIGGER trg_phase1_audit_truncate BEFORE TRUNCATE ON %s ' ||
    'FOR EACH STATEMENT EXECUTE FUNCTION public.phase1_reject_audit_mutation()',
    partition_table
  );
  RETURN partition_name;
END;
$$;

-- SECURITY INVOKER is deliberate: only the migrator/table owner may create
-- audit children; neither tc_app nor PUBLIC may invoke partition maintenance.
REVOKE ALL ON FUNCTION public.phase1_create_audit_month_partition(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase1_create_audit_month_partition(integer, integer) TO tc_migrator;
COMMENT ON FUNCTION public.phase1_create_audit_month_partition(integer, integer)
  IS 'Audited migrator-only procedure for provisioning monthly audit children; never create/attach children from the application runtime role';

RESET ROLE;
