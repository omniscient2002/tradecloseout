-- ==============================================================================
-- 0016_canonical_tenant_alias_validation.sql
-- N30: Canonical tenant setting validation function and policy alignment
-- Replaces dual-alias OR predicates with canonical current_app_org_id() function
-- that rejects conflicting app.current_org vs app.current_org_id settings.
-- ==============================================================================

SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION current_app_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_org text := nullif(current_setting('app.current_org', true), '');
  v_org_id text := nullif(current_setting('app.current_org_id', true), '');
BEGIN
  IF v_org IS NOT NULL AND v_org_id IS NOT NULL AND v_org <> v_org_id THEN
    RAISE EXCEPTION 'TENANT_ALIAS_MISMATCH: app.current_org (%) does not match app.current_org_id (%)', v_org, v_org_id
      USING ERRCODE = 'data_exception';
  END IF;
  RETURN COALESCE(v_org, v_org_id)::uuid;
END;
$$;

-- Align tables from 0007 and 0013 to use current_app_org_id()
DROP POLICY IF EXISTS procurement_orders_tenant_isolation ON procurement_orders;
CREATE POLICY procurement_orders_tenant_isolation ON procurement_orders
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS procurement_order_lines_tenant_isolation ON procurement_order_lines;
CREATE POLICY procurement_order_lines_tenant_isolation ON procurement_order_lines
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS supplier_document_obligations_tenant_isolation ON supplier_document_obligations;
CREATE POLICY supplier_document_obligations_tenant_isolation ON supplier_document_obligations
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS asset_identity_revisions_tenant_isolation ON asset_identity_revisions;
CREATE POLICY asset_identity_revisions_tenant_isolation ON asset_identity_revisions
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS evidence_revalidations_tenant_isolation ON evidence_revalidations;
CREATE POLICY evidence_revalidations_tenant_isolation ON evidence_revalidations
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS evidence_companion_rules_tenant_isolation ON evidence_companion_rules;
CREATE POLICY evidence_companion_rules_tenant_isolation ON evidence_companion_rules
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

DROP POLICY IF EXISTS archive_exports_tenant_isolation ON archive_exports;
CREATE POLICY archive_exports_tenant_isolation ON archive_exports
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

RESET ROLE;
