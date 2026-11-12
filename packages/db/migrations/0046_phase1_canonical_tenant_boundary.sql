-- PH1-G26-007: one fail-closed tenant boundary, including discovery policies
-- and directly addressed audit children. Applied SQL remains immutable.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION public.current_app_org_id()
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tenant uuid;
  tenant_alias uuid;
BEGIN
  BEGIN
    tenant := nullif(current_setting('app.current_org', true), '')::uuid;
    tenant_alias := nullif(current_setting('app.current_org_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_INVALID_UUID' USING ERRCODE = '22023';
  END;
  IF tenant IS NOT NULL AND tenant_alias IS NOT NULL AND tenant <> tenant_alias THEN
    RAISE EXCEPTION 'TENANT_ALIAS_MISMATCH' USING ERRCODE = '22000';
  END IF;
  RETURN coalesce(tenant, tenant_alias);
END;
$$;

-- An OR exception (self discovery, public catalogue, guest token) must not
-- short-circuit validation of conflicting tenant settings. This restrictive
-- policy grants no access itself; the existing permissive policies still decide
-- which rows/commands are allowed. Missing tenant context permits ONLY those
-- explicit exceptions, never ordinary tenant rows.
CREATE FUNCTION public.app_tenant_context_is_valid()
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.current_app_org_id();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.current_app_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_tenant_context_is_valid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_org_id(), public.app_tenant_context_is_valid()
  TO tc_app, tc_migrator;

-- Historical migrations created some tables as the authenticated migration
-- administrator, others as tc_migrator. DDL must use that administrator's
-- existing ownership authority; never transfer ownership/grant runtime rights.
RESET ROLE;

DO $$
DECLARE
  policy record;
  relation record;
  expression text;
  check_expression text;
BEGIN
  -- Transform only the two historical tenant-setting expressions. Preserve
  -- policy names, commands, role lists, permissiveness and existing exceptions.
  -- An unrecognised raw setting fails the upgrade rather than being ignored.
  FOR policy IN
    SELECT p.*, pg_get_expr(p.polqual, p.polrelid) AS using_sql,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_sql
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND EXISTS (
       SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
         AND a.attname='org_id' AND NOT a.attisdropped)
  LOOP
    expression := policy.using_sql;
    check_expression := policy.check_sql;
    FOR relation IN SELECT unnest(ARRAY['app.current_org','app.current_org_id']) AS setting LOOP
      expression := replace(expression,
        format('(NULLIF(current_setting(%L::text, true), ''''::text))::uuid', relation.setting),
        'public.current_app_org_id()');
      check_expression := replace(check_expression,
        format('(NULLIF(current_setting(%L::text, true), ''''::text))::uuid', relation.setting),
        'public.current_app_org_id()');
    END LOOP;
    IF coalesce(expression,'') || coalesce(check_expression,'') LIKE '%app.current_org%' THEN
      RAISE EXCEPTION 'UNREVIEWED_TENANT_POLICY: %', policy.polname;
    END IF;
    IF expression IS DISTINCT FROM policy.using_sql OR check_expression IS DISTINCT FROM policy.check_sql THEN
      EXECUTE format('ALTER POLICY %I ON %s%s%s', policy.polname, policy.polrelid::regclass,
        CASE WHEN expression IS NULL THEN '' ELSE format(' USING (%s)', expression) END,
        CASE WHEN check_expression IS NULL THEN '' ELSE format(' WITH CHECK (%s)', check_expression) END);
    END IF;
  END LOOP;

  FOR relation IN
    SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS (
       SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
         AND a.attname='org_id' AND NOT a.attisdropped)
  LOOP
    IF NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity THEN
      RAISE EXCEPTION 'TENANT_TABLE_REQUIRES_FORCED_RLS: %', relation.oid::regclass;
    END IF;
    EXECUTE format('CREATE POLICY canonical_tenant_context ON %s AS RESTRICTIVE FOR ALL TO tc_app '
      'USING (public.app_tenant_context_is_valid()) WITH CHECK (public.app_tenant_context_is_valid())',
      relation.oid::regclass);
  END LOOP;
END;
$$;

-- Self discovery is SELECT-only. An ALL policy with a self predicate also
-- authorises DELETE in other organisations, irrespective of WITH CHECK.
DROP POLICY memberships_tenant_isolation ON public.memberships;
CREATE POLICY memberships_tenant_isolation ON public.memberships FOR ALL
  USING (org_id = public.current_app_org_id())
  WITH CHECK (org_id = public.current_app_org_id());
CREATE POLICY memberships_self_discovery ON public.memberships FOR SELECT
  USING (user_id = nullif(current_setting('app.current_user', true), '')::uuid);

RESET ROLE;

-- Keep the migrator-only future partition provisioner on the same boundary.
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
    'USING (org_id = public.current_app_org_id())',
    partition_table
  );
  EXECUTE format('DROP POLICY IF EXISTS canonical_tenant_context ON %s', partition_table);
  EXECUTE format(
    'CREATE POLICY canonical_tenant_context ON %s AS RESTRICTIVE FOR ALL TO tc_app '
    'USING (public.app_tenant_context_is_valid()) WITH CHECK (public.app_tenant_context_is_valid())',
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
