-- Phase 1 G26-001 / G27-001: protect the audit partition entry points.
-- Forward-only migration; historical migration checksums are never rewritten.
SET ROLE tc_migrator;

-- A parent statement trigger does not protect a direct child UPDATE/DELETE.
-- Row triggers created on the parent are cloned to current and future partitions.
CREATE OR REPLACE FUNCTION public.phase1_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: audit_events is append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_phase1_audit_mutation ON public.audit_events;
CREATE TRIGGER trg_phase1_audit_mutation
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.phase1_reject_audit_mutation();

-- TRUNCATE fires neither row nor ordinary UPDATE/DELETE triggers.
DROP TRIGGER IF EXISTS trg_phase1_audit_truncate ON public.audit_events;
CREATE TRIGGER trg_phase1_audit_truncate
  BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.phase1_reject_audit_mutation();

DO $$
DECLARE
  child regclass;
BEGIN
  FOR child IN
    SELECT inhrelid::regclass
      FROM pg_inherits
     WHERE inhparent = 'public.audit_events'::regclass
  LOOP
    -- The runtime must use the parent: direct child references are not an API.
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM tc_app', child);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', child);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', child);
    EXECUTE format('DROP POLICY IF EXISTS phase1_audit_child_select ON %s', child);
    EXECUTE format(
      'CREATE POLICY phase1_audit_child_select ON %s FOR SELECT TO tc_app ' ||
      'USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      child
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_phase1_audit_truncate ON %s', child);
    EXECUTE format(
      'CREATE TRIGGER trg_phase1_audit_truncate BEFORE TRUNCATE ON %s ' ||
      'FOR EACH STATEMENT EXECUTE FUNCTION public.phase1_reject_audit_mutation()',
      child
    );
  END LOOP;
END
$$;

-- 0000 granted blanket default DML rights for all future tables. Remove those
-- automatic grants so future partitions cannot silently become directly
-- accessible. Future non-audit migrations MUST explicitly review/grant rights.
ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM tc_app;

RESET ROLE;
