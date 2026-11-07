-- ==============================================================================
-- 0013_reconcile_tenant_policies_and_composite_constraints.sql
-- 1. Reconcile tenant isolation policies for 0006 tables to support both app.current_org and app.current_org_id (TC-F023)
-- 2. Add composite tenant/project keys and foreign keys for procurement and asset identity (TC-F023)
-- ==============================================================================

-- 1. Reconcile RLS policies on tables introduced in 0006
DROP POLICY IF EXISTS asset_identity_revisions_tenant_isolation ON asset_identity_revisions;
CREATE POLICY asset_identity_revisions_tenant_isolation ON asset_identity_revisions
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS evidence_revalidations_tenant_isolation ON evidence_revalidations;
CREATE POLICY evidence_revalidations_tenant_isolation ON evidence_revalidations
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS evidence_companion_rules_tenant_isolation ON evidence_companion_rules;
CREATE POLICY evidence_companion_rules_tenant_isolation ON evidence_companion_rules
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS archive_exports_tenant_isolation ON archive_exports;
CREATE POLICY archive_exports_tenant_isolation ON archive_exports
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- 2. Add composite tenant/project keys to procurement entities
ALTER TABLE procurement_orders
  ADD CONSTRAINT procurement_orders_org_proj_id_uq UNIQUE (org_id, project_id, id);

ALTER TABLE procurement_order_lines
  ADD CONSTRAINT procurement_order_lines_org_proj_id_uq UNIQUE (org_id, project_id, id);

-- 3. Composite foreign keys for procurement line and obligation
ALTER TABLE procurement_order_lines
  ADD CONSTRAINT procurement_order_lines_composite_po_fk
  FOREIGN KEY (org_id, project_id, po_id)
  REFERENCES procurement_orders(org_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE supplier_document_obligations
  ADD CONSTRAINT supplier_document_obligations_composite_line_fk
  FOREIGN KEY (org_id, project_id, po_line_id)
  REFERENCES procurement_order_lines(org_id, project_id, id) ON DELETE CASCADE;
