-- PH1-G26-001 / PH1-G27-001: enforce the same tenant and immutable
-- audit boundary when clients name a physical child partition directly.
-- Applied migrations remain immutable; this is a forward-only change.
SET ROLE tc_migrator;

-- Parent UPDATE/DELETE is already revoked from tc_app. A row trigger on the
-- partitioned parent is cloned to attached partitions (including new ones).
CREATE OR REPLACE FUNCTION public.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_EVENTS_IMMUTABLE' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_phase1_audit_immutable ON public.audit_events;
CREATE TRIGGER trg_phase1_audit_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();

-- Parent policies/grants do not protect direct child table references.
-- Repair the existing children; the same assertions must run after every
-- future CREATE/ATTACH PARTITION, before accepting traffic.
DO $$
DECLARE
  v_partition regclass;
BEGIN
  FOR v_partition IN
    SELECT inhrelid::regclass
    FROM pg_inherits
    WHERE inhparent = 'public.audit_events'::regclass
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM tc_app', v_partition);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_partition);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_partition);
    EXECUTE format('DROP POLICY IF EXISTS audit_phase1_direct_tenant ON %s', v_partition);
    EXECUTE format(
      'CREATE POLICY audit_phase1_direct_tenant ON %s FOR SELECT TO tc_app ' ||
      'USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      v_partition
    );
    -- No direct TRUNCATE, even if an operator later adds an accidental grant.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_phase1_audit_no_truncate ON %s', v_partition);
    EXECUTE format(
      'CREATE TRIGGER trg_phase1_audit_no_truncate BEFORE TRUNCATE ON %s ' ||
      'FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_event_mutation()',
      v_partition
    );
  END LOOP;
END
$$;

-- Block TRUNCATE of the parent as well. Parent row triggers do not cover it.
DROP TRIGGER IF EXISTS trg_phase1_audit_no_truncate ON public.audit_events;
CREATE TRIGGER trg_phase1_audit_no_truncate
  BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_event_mutation();

RESET ROLE;
