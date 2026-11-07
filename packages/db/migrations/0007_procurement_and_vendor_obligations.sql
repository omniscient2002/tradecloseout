SET ROLE tc_migrator;

-- ==============================================================================
-- 0007_procurement_and_vendor_obligations.sql
-- PO & Vendor-Document Obligation Schedule (Top 25 Item 2 / Future Domain Model §4)
-- Connects supplier requests to upstream PO lines and stages (FAT, Dispatch, Delivery, Handover)
-- ==============================================================================

-- 1. PROCUREMENT ORDERS
CREATE TABLE IF NOT EXISTS procurement_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  supplier_party_id uuid NOT NULL REFERENCES parties(id),
  status text NOT NULL DEFAULT 'ISSUED', -- DRAFT | ISSUED | IN_MANUFACTURING | DISPATCHED | DELIVERED | COMPLETED | CANCELLED
  ordered_at date NOT NULL DEFAULT CURRENT_DATE,
  promised_delivery_at date,
  total_amount_paise bigint,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT procurement_orders_org_proj_po_uq UNIQUE (org_id, project_id, po_number)
);

ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_orders_tenant_isolation ON procurement_orders
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- 2. PROCUREMENT ORDER LINES
CREATE TABLE IF NOT EXISTS procurement_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  asset_category_key text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  asset_id uuid REFERENCES assets(id),
  make text,
  model text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT po_lines_po_line_uq UNIQUE (po_id, line_no)
);

ALTER TABLE procurement_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_order_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_order_lines_tenant_isolation ON procurement_order_lines
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- 3. SUPPLIER DOCUMENT OBLIGATIONS
CREATE TABLE IF NOT EXISTS supplier_document_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_line_id uuid NOT NULL REFERENCES procurement_order_lines(id) ON DELETE CASCADE,
  doc_type_key text NOT NULL,
  stage_key text NOT NULL DEFAULT 'FAT', -- MANUFACTURING | FAT | DISPATCH | DELIVERY | INSTALLATION | HANDOVER | WARRANTY
  title text NOT NULL,
  due_date date,
  supplier_party_id uuid REFERENCES parties(id),
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | UPLOADED | ACCEPTED | OVERDUE
  requirement_id uuid REFERENCES requirements(id),
  document_version_id uuid REFERENCES document_versions(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE supplier_document_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_document_obligations FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_document_obligations_tenant_isolation ON supplier_document_obligations
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org', true), '')::uuid OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
RESET ROLE;
