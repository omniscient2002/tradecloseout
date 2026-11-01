-- 1. Create Monthly-Partitioned Append-Only Audit Table (08 §5.6)
CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID NOT NULL,
  org_id          UUID,
  project_id      UUID,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('MEMBER','GUEST','SYSTEM','ADMIN')),
  actor_user_id   UUID,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_json     JSONB,
  after_json      JSONB,
  ip              INET,
  user_agent      TEXT,
  request_id      TEXT,
  prev_hash       TEXT,
  hash            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_events_2026_10 PARTITION OF audit_events
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_events_2026_11 PARTITION OF audit_events
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_events_2026_12 PARTITION OF audit_events
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE INDEX IF NOT EXISTS audit_events_org_proj_idx
  ON audit_events (org_id, project_id, created_at DESC);

-- Prevent UPDATE or DELETE on audit_events by any runtime role (FR-AUD-001)
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: audit_events is append-only and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- 2. Partial Unique Indexes & Integrity Constraints (08 §5.3, §5.4, §6, §8)
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_one_approved_current
  ON document_versions (document_id)
  WHERE deleted_at IS NULL
    AND review_status = 'APPROVED'
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS requirements_stable_key_uq
  ON requirements (project_id, requirement_key, scope_key)
  WHERE superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_assets_one_primary_uq
  ON document_assets (document_id)
  WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_uq
  ON notifications (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id));

ALTER TABLE document_versions
  ADD CONSTRAINT dv_approved_requires_ready_chk
  CHECK (review_status <> 'APPROVED' OR file_status = 'READY');

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_ready_requires_sha256_chk
  CHECK (status <> 'READY' OR sha256 IS NOT NULL);

ALTER TABLE handover_packages
  ADD CONSTRAINT pkg_snapshot_checksum_chk
  CHECK (status = 'DRAFT' OR snapshot_checksum IS NOT NULL);

-- 3. Cross-Project Composite Foreign Keys (AUD-004 / 08 §5.5)
ALTER TABLE package_items
  ADD CONSTRAINT package_items_same_project_pkg_fk
    FOREIGN KEY (org_id, project_id, package_id)
    REFERENCES handover_packages (org_id, project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT package_items_same_project_ver_fk
    FOREIGN KEY (org_id, project_id, document_version_id)
    REFERENCES document_versions (org_id, project_id, id);

ALTER TABLE document_requirements
  ADD CONSTRAINT dr_same_project_doc_fk
    FOREIGN KEY (org_id, project_id, document_id)
    REFERENCES documents (org_id, project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT dr_same_project_req_fk
    FOREIGN KEY (org_id, project_id, requirement_id)
    REFERENCES requirements (org_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE document_assets
  ADD CONSTRAINT da_same_project_doc_fk
    FOREIGN KEY (org_id, project_id, document_id)
    REFERENCES documents (org_id, project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT da_same_project_asset_fk
    FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES assets (org_id, project_id, id) ON DELETE CASCADE;

-- 4. Enable & Force Row-Level Security on All Tenant Tables (RT-005 & AUD-035)

-- Memberships: User can view memberships in their active org OR belonging to themselves
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_tenant_isolation ON memberships;
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  );

DO $$
DECLARE
  tbl TEXT;
  tenant_tables TEXT[] := ARRAY[
    'org_profiles','invitations','parties','party_contacts',
    'projects','project_members','guest_grants','contracts','specification_refs',
    'client_profiles','checklist_snapshots','requirements','requirement_change_requests',
    'requirement_revisions','waivers','assets','storage_objects','documents',
    'document_versions','document_requirements','document_assets','document_contracts',
    'document_events','reviews','review_comments','approval_overrides',
    'handover_packages','package_items','package_requirements','submissions',
    'submission_recipients','submission_events','package_layouts','notifications',
    'notification_preferences','audit_events','security_events','idempotency_keys',
    'outbox_events','subscriptions','invoices','invoice_lines','invoice_tds',
    'usage_counters','credit_notes','warranty_events','defects','variations',
    'legal_holds','deletion_requests'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I
         USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)
         WITH CHECK (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid);',
      tbl, tbl
    );
  END LOOP;
END
$$;
