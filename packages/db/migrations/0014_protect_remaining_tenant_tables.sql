-- The complete tenant-table test inventory exposed tables omitted by the base RLS list.
SET ROLE tc_migrator;
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['config_versions','asset_categories','notification_templates','retention_policies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    -- Global catalogue rows can be read, but runtime callers cannot modify them.
    EXECUTE format('CREATE POLICY shared_catalogue_read ON %I FOR SELECT USING
      (org_id IS NULL OR org_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)', tbl);
    EXECUTE format('CREATE POLICY tenant_write ON %I FOR ALL USING
      (org_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)
      WITH CHECK (org_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)', tbl);
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['admin_audit_events','job_executions','payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING
      (org_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)
      WITH CHECK (org_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;
RESET ROLE;
