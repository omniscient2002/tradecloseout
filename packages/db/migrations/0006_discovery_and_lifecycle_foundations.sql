SET ROLE tc_migrator;

-- ==============================================================================
-- 0006_discovery_and_lifecycle_foundations.sql
-- Second-Pass Discovery & Lifecycle Foundations:
-- 1. Asset identity revisions (effective-dated identity changes)
-- 2. Evidence revalidations (impact review on linked evidence)
-- 3. Evidence companion rules (missing-attachment checks e.g. DT-018 -> DT-041)
-- 4. Dual event time (occurred_at, recorded_at, backdating_reason)
-- 5. Portable self-verifying archive exports
-- ==============================================================================

-- 1. ASSET IDENTITY REVISIONS (Top 25 Item 3 / Future Domain Model §5)
CREATE TABLE IF NOT EXISTS asset_identity_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  tag text NOT NULL,
  name text NOT NULL,
  make text,
  model text,
  serial_no text,
  location text,
  change_type text NOT NULL DEFAULT 'CLERICAL_CORRECTION', -- CLERICAL_CORRECTION | RELOCATION | SUBSTITUTION | REPLACEMENT | TAG_REUSE
  reason text NOT NULL,
  effective_from timestamp with time zone NOT NULL DEFAULT now(),
  effective_to timestamp with time zone,
  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT asset_identity_rev_uq UNIQUE (asset_id, revision_no)
);

ALTER TABLE asset_identity_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_identity_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_identity_revisions_tenant_isolation ON asset_identity_revisions
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_asset_identity_revisions_asset
  ON asset_identity_revisions(org_id, project_id, asset_id, revision_no);

-- 2. EVIDENCE REVALIDATIONS (Top 25 Item 3 / Future Domain Model §5)
CREATE TABLE IF NOT EXISTS evidence_revalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  identity_revision_id uuid NOT NULL REFERENCES asset_identity_revisions(id) ON DELETE CASCADE,
  document_version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING', -- NOT_REQUIRED | PENDING | CONFIRMED | MISMATCH | EXEMPT
  revalidation_notes text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT evidence_reval_doc_rev_uq UNIQUE (identity_revision_id, document_version_id)
);

ALTER TABLE evidence_revalidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_revalidations FORCE ROW LEVEL SECURITY;

CREATE POLICY evidence_revalidations_tenant_isolation ON evidence_revalidations
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_evidence_revalidations_asset
  ON evidence_revalidations(org_id, project_id, asset_id, status);

-- 3. EVIDENCE COMPANION RULES (Top 25 Item 6 / Future Domain Model §2)
CREATE TABLE IF NOT EXISTS evidence_companion_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  rule_code text NOT NULL,
  rule_name text NOT NULL,
  primary_doc_type text NOT NULL,
  companion_doc_type text NOT NULL,
  description text,
  is_mandatory boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT companion_rules_org_code_uq UNIQUE (org_id, rule_code)
);

ALTER TABLE evidence_companion_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_companion_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY evidence_companion_rules_tenant_isolation ON evidence_companion_rules
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- 4. DUAL EVENT TIME COLUMNS (Top 25 Item 4 / Future Domain Model §7)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS occurred_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS occurred_at_precision text NOT NULL DEFAULT 'INSTANT',
  ADD COLUMN IF NOT EXISTS recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS backdating_reason text;

ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS occurred_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS occurred_at_precision text NOT NULL DEFAULT 'INSTANT',
  ADD COLUMN IF NOT EXISTS recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS backdating_reason text;

ALTER TABLE warranty_events
  ADD COLUMN IF NOT EXISTS occurred_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS occurred_at_precision text NOT NULL DEFAULT 'DATE',
  ADD COLUMN IF NOT EXISTS recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS backdating_reason text;

-- 5. PORTABLE ARCHIVE EXPORTS (Top 25 Item 7 / Future Domain Model §12)
CREATE TABLE IF NOT EXISTS archive_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_version text NOT NULL DEFAULT '2.0',
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | COMPLETED | FAILED
  archive_sha256 text,
  total_objects integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  manifest_json jsonb NOT NULL DEFAULT '{}',
  verification_receipt_json jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

ALTER TABLE archive_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_exports FORCE ROW LEVEL SECURITY;

CREATE POLICY archive_exports_tenant_isolation ON archive_exports
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_archive_exports_proj
  ON archive_exports(org_id, project_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
RESET ROLE;
