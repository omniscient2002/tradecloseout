SET ROLE tc_migrator;

-- 1. RT-002: Allow nullable active_org_id on sessions during pre-org onboarding (SCR-003 -> SCR-004)
ALTER TABLE sessions ALTER COLUMN active_org_id DROP NOT NULL;

-- 2. RT-014: Add Guest OTP brute-force lockout & target identity columns on guest_grants
ALTER TABLE guest_grants
  ADD COLUMN IF NOT EXISTS target_phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS target_email TEXT,
  ADD COLUMN IF NOT EXISTS otp_attempts_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;

-- 3. RT-003, RT-008, RT-040: Add asset_id FK, milestone_key, and PENDING_WAIVER support on requirements
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS asset_id UUID,
  ADD COLUMN IF NOT EXISTS milestone_key TEXT NOT NULL DEFAULT 'HANDOVER'
    CHECK (milestone_key IN (
      'MOBILISATION','SUBMISSION','DELIVERY','INSTALLATION',
      'COMMISSIONING','HANDOVER','FINAL_BILL','DLP_END'
    ));

ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_asset_same_project_fk,
  ADD CONSTRAINT requirements_asset_same_project_fk
    FOREIGN KEY (org_id, project_id, asset_id)
    REFERENCES assets (org_id, project_id, id) ON DELETE RESTRICT;

ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_scope_key_asset_consistency_chk,
  ADD CONSTRAINT requirements_scope_key_asset_consistency_chk
    CHECK (
      (asset_id IS NULL AND scope_key = 'project') OR
      (asset_id IS NOT NULL AND scope_key = ('asset:' || asset_id::text))
    );

ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_status_v021_chk,
  ADD CONSTRAINT requirements_status_v021_chk
    CHECK (status IN (
      'NOT_STARTED','REQUESTED','UPLOADED','IN_REVIEW','APPROVED',
      'CHANGES_REQUESTED','REJECTED','EXPIRED','PENDING_WAIVER',
      'WAIVED','NOT_APPLICABLE','HANDED_OVER','SUPERSEDED'
    ));

-- 4. RT-023: Waivers status support for two-step mandatory waivers (PENDING_SECOND_APPROVAL -> ACTIVE | REJECTED)
ALTER TABLE waivers
  DROP CONSTRAINT IF EXISTS waivers_status_v021_chk,
  ADD CONSTRAINT waivers_status_v021_chk
    CHECK (status IN ('PENDING_SECOND_APPROVAL','ACTIVE','REJECTED','SUPERSEDED'));

-- 5. RT-011: Replace blanket revision_code unique index with active-only partial unique index
DROP INDEX IF EXISTS document_versions_doc_rev_code_uq;
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_active_rev_code_uq
  ON document_versions (document_id, upper(revision_code))
  WHERE deleted_at IS NULL
    AND file_status NOT IN ('FAILED', 'QUARANTINED')
    AND review_status <> 'REJECTED';

-- 6. RT-001: Create bulk_import_jobs table for stateful ZIP + manifest bulk imports (SCR-055)
CREATE TABLE IF NOT EXISTS bulk_import_jobs (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id),
  project_id          UUID NOT NULL,
  zip_object_id       UUID NOT NULL REFERENCES storage_objects(id),
  manifest_object_id  UUID REFERENCES storage_objects(id),
  status              TEXT NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN ('UPLOADED','DRY_RUN_READY','PROCESSING','COMPLETED','FAILED')),
  dry_run_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT bulk_import_jobs_project_fk
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

ALTER TABLE bulk_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bulk_import_jobs_tenant_isolation ON bulk_import_jobs;
CREATE POLICY bulk_import_jobs_tenant_isolation ON bulk_import_jobs
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 7. RT-032: Enforce reviewer_subject_type integrity on reviews
ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS reviews_subject_type_consistency_chk,
  ADD CONSTRAINT reviews_subject_type_consistency_chk
    CHECK (
      (reviewer_subject_type = 'USER' AND reviewer_user_id = reviewer_subject_id AND reviewer_party_id IS NULL) OR
      (reviewer_subject_type = 'PARTY' AND reviewer_party_id = reviewer_subject_id)
    );

-- 8. RT-007: Multi-recipient submission aggregation columns & PARTIALLY_ACCEPTED state
ALTER TABLE submission_recipients
  ADD COLUMN IF NOT EXISTS is_required_approver BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_status_v021_chk,
  ADD CONSTRAINT submissions_status_v021_chk
    CHECK (status IN ('DRAFT','SENT','ACKNOWLEDGED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','WITHDRAWN'));

ALTER TABLE handover_packages
  DROP CONSTRAINT IF EXISTS handover_packages_status_v021_chk,
  ADD CONSTRAINT handover_packages_status_v021_chk
    CHECK (status IN (
      'DRAFT','QUEUED','GENERATING','READY','FAILED',
      'SUBMITTED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','SUPERSEDED'
    ));

-- 9. RT-030 & RT-015: Asynchronous Form 16A TDS status & configurable tax configuration table
ALTER TABLE invoice_tds
  ALTER COLUMN certificate_reference DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DEDUCTED_PENDING_CERT'
    CHECK (status IN ('DEDUCTED_PENDING_CERT','CERT_UPLOADED','RECONCILED')),
  ADD COLUMN IF NOT EXISTS certificate_object_id UUID REFERENCES storage_objects(id);

CREATE TABLE IF NOT EXISTS billing_tax_configs (
  id                          UUID PRIMARY KEY,
  effective_from              DATE NOT NULL,
  sac_code                    TEXT NOT NULL,
  gst_rate_bps                INTEGER NOT NULL CHECK (gst_rate_bps BETWEEN 0 AND 5000),
  supplier_state_code         TEXT NOT NULL,
  supplier_gstin              TEXT NOT NULL,
  supplier_pan                TEXT NOT NULL,
  einvoice_enabled            BOOLEAN NOT NULL DEFAULT false,
  einvoice_turnover_limit_inr BIGINT NOT NULL,
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. RT-013 & DPDP Rules 2025: 6-Hour CERT-In incident deadline & 365-day security log retention
ALTER TABLE security_events
  ADD COLUMN IF NOT EXISTS cert_in_reportable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS report_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reported_to_cert_in_at TIMESTAMPTZ;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
RESET ROLE;
