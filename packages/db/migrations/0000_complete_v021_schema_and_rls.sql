-- packages/db/migrations/0000_complete_v021_schema_and_rls.sql
-- Authoritative Base Schema for TradeCloseout v0.2.1

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Migration role (owns tables, runs DDL only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_migrator') THEN
    CREATE ROLE tc_migrator WITH LOGIN PASSWORD 'migrator_local_pw' CREATEDB;
  END IF;
END
$$;

-- 2. Runtime application role (strictly NOBYPASSRLS, cannot alter schema)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_app') THEN
    CREATE ROLE tc_app WITH LOGIN PASSWORD 'app_local_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tc_migrator, tc_app;', current_database());
END
$$;

GRANT CREATE, USAGE ON SCHEMA public TO tc_migrator;
GRANT USAGE ON SCHEMA public TO tc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tc_app;

-- Ensure tc_migrator owns all non-extension public schema objects (tables, sequences, functions)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT 'ALTER TABLE ' || quote_ident(schemaname) || '.' || quote_ident(tablename) || ' OWNER TO tc_migrator;' AS sql
    FROM pg_tables WHERE schemaname = 'public'
    UNION ALL
    SELECT 'ALTER SEQUENCE ' || quote_ident(sequence_schema) || '.' || quote_ident(sequence_name) || ' OWNER TO tc_migrator;' AS sql
    FROM information_schema.sequences WHERE sequence_schema = 'public'
    UNION ALL
    SELECT 'ALTER FUNCTION ' || quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ') OWNER TO tc_migrator;' AS sql
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND d.objid IS NULL AND pg_get_userbyid(p.proowner) != 'tc_migrator'
  ) LOOP
    BEGIN
      EXECUTE r.sql;
    EXCEPTION WHEN OTHERS THEN
      -- ignore if object cannot be altered
    END;
  END LOOP;
END
$$;

SET ROLE tc_migrator;

-- ============================================================================
-- 1. GLOBAL IDENTITY & TENANCY (NO RLS ON GLOBAL TABLES)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email_display   CITEXT,
  phone_display   TEXT,
  locale          TEXT NOT NULL DEFAULT 'en',
  mfa_totp_secret TEXT, -- Encrypted at rest; mandatory for Owner/Admin per DPDP Rules 2025
  mfa_enabled_at  TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  last_login_at   TIMESTAMPTZ,
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('EMAIL','PHONE')),
  value           CITEXT NOT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, value)
);

CREATE TABLE IF NOT EXISTS organisations (
  id              UUID PRIMARY KEY,
  legal_name      TEXT NOT NULL CHECK (char_length(legal_name) BETWEEN 2 AND 200),
  display_name    TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 120),
  entity_type     TEXT NOT NULL DEFAULT 'PRIVATE_LIMITED'
                    CHECK (entity_type IN ('PROPRIETORSHIP','PARTNERSHIP','LLP','PRIVATE_LIMITED','PUBLIC_LIMITED','OTHER')),
  trade           TEXT NOT NULL DEFAULT 'HVAC',
  country         TEXT NOT NULL DEFAULT 'IN',
  state           TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  allow_self_approval BOOLEAN NOT NULL DEFAULT false,
  doc_controller_org_wide_download BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CANCELLED','DELETED')),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  active_org_id   UUID REFERENCES organisations(id) ON DELETE SET NULL, -- Nullable pre-onboarding (RT-002)
  guest_grant_id  UUID,
  mfa_verified    BOOLEAN NOT NULL DEFAULT false,
  ip              INET,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS otp_challenges (
  id              UUID PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  identifier      CITEXT NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('LOGIN','GUEST_ACCESS','ORG_DELETE')),
  guest_grant_id  UUID,
  code_hash       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_challenges_lookup_idx ON otp_challenges (identifier, purpose, created_at DESC);

-- ============================================================================
-- 2. STORAGE OBJECTS & TENANT PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS storage_objects (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  provider        TEXT NOT NULL DEFAULT 'S3',
  bucket          TEXT NOT NULL,
  object_key      TEXT NOT NULL,
  s3_upload_id    TEXT, -- Populated while multipart upload is PENDING (RT-012)
  mime            TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','READY','QUARANTINED','FAILED','DELETED','ABORTED')),
  retention_class TEXT NOT NULL DEFAULT 'PROJECT_PLUS_8Y',
  av_scanned_at   TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, bucket, object_key),
  UNIQUE (org_id, id),
  CHECK (status <> 'READY' OR (sha256 IS NOT NULL AND size_bytes > 0))
);
CREATE INDEX IF NOT EXISTS storage_objects_org_sha_idx ON storage_objects (org_id, sha256) WHERE status = 'READY';

CREATE TABLE IF NOT EXISTS org_profiles (
  org_id                   UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  gstin                    TEXT CHECK (gstin IS NULL OR char_length(gstin) = 15),
  pan                      TEXT CHECK (pan IS NULL OR char_length(pan) = 10),
  address_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_object_id           UUID,
  logo_url                 TEXT,
  brand_color              TEXT NOT NULL DEFAULT '#0F172A',
  accent_color             TEXT,
  watermark_enabled        BOOLEAN NOT NULL DEFAULT false,
  allow_self_approval      BOOLEAN NOT NULL DEFAULT false,
  default_retention_months INTEGER NOT NULL DEFAULT 96,
  footer_text              TEXT,
  signatory_name           TEXT,
  signatory_designation    TEXT,
  contact_email            CITEXT,
  contact_phone            TEXT,
  row_version              INTEGER NOT NULL DEFAULT 1,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, logo_object_id) REFERENCES storage_objects(org_id, id)
);

CREATE TABLE IF NOT EXISTS memberships (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN (
                    'R-OWNER','R-ADMIN','R-BILLING','R-PM','R-SITE',
                    'R-DOC','R-PROC','R-QC','R-SAFETY','R-REVIEWER','R-AUDITOR'
                  )),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REMOVED','EXPIRED','REVOKED')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, id)
);
-- Exactly one active Owner per Organisation (FR-IAM-004)
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_active_owner_uq
  ON memberships (org_id)
  WHERE role = 'R-OWNER' AND status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email           CITEXT,
  phone_e164      TEXT,
  role            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED','SUPERSEDED')),
  expires_at      TIMESTAMPTZ NOT NULL,
  invited_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

-- ============================================================================
-- 3. PARTIES, PROJECTS, CONTRACTS & GUEST GRANTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS parties (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  types           TEXT[] NOT NULL,
  gstin           TEXT,
  email           CITEXT,
  phone           TEXT,
  phone_e164      TEXT,
  address_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES users(id),
  UNIQUE (org_id, id)
);
CREATE INDEX IF NOT EXISTS parties_org_name_idx ON parties (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS party_contacts (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  party_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  email           CITEXT,
  phone_e164      TEXT,
  designation     TEXT,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, party_id) REFERENCES parties(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  name                 TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  project_type         TEXT NOT NULL DEFAULT 'PRIVATE_COMMERCIAL'
                         CHECK (project_type IN ('PRIVATE_COMMERCIAL','GOVT_PWD','PSU','INSTITUTIONAL','INDUSTRIAL')),
  client_party_id      UUID,
  mc_party_id          UUID,
  consultant_party_id  UUID,
  site_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_date           DATE,
  target_handover_date DATE,
  currency             TEXT NOT NULL DEFAULT 'INR',
  status               TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','HANDOVER','CLOSED','CANCELLED','ARCHIVED')),
  settings_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  reopen_count         INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  closed_at            TIMESTAMPTZ,
  archived_at          TIMESTAMPTZ,
  purged_at            TIMESTAMPTZ,
  row_version          INTEGER NOT NULL DEFAULT 1,
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_party_id) REFERENCES parties(org_id, id),
  FOREIGN KEY (org_id, mc_party_id) REFERENCES parties(org_id, id),
  FOREIGN KEY (org_id, consultant_party_id) REFERENCES parties(org_id, id),
  CHECK (status <> 'ACTIVE' OR purged_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_code_uq ON projects (org_id, upper(code));

CREATE TABLE IF NOT EXISTS project_members (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  scope_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REMOVED')),
  added_by        UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guest_grants (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL,
  party_id          UUID NOT NULL,
  target_email      CITEXT,
  target_phone_e164 TEXT,
  grant_type        TEXT NOT NULL CHECK (grant_type IN (
                      'SUPPLIER_UPLOAD','SUPPLIER_CONTRIBUTOR','CONSULTANT_REVIEW',
                      'CLIENT_VIEW','MC_VIEW','AUDITOR_READ'
                    )),
  role              TEXT NOT NULL,
  capabilities      TEXT[] NOT NULL,
  scope_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  otp_required      BOOLEAN NOT NULL DEFAULT true,
  token_hash        TEXT NOT NULL UNIQUE,
  failed_otp_count  INTEGER NOT NULL DEFAULT 0,
  otp_attempts_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until    TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, party_id) REFERENCES parties(org_id, id),
  CHECK (target_email IS NOT NULL OR target_phone_e164 IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS contracts (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  parent_contract_id UUID,
  reference          TEXT DEFAULT '',
  contract_ref       TEXT,
  title              TEXT,
  party_id           UUID REFERENCES parties(id),
  type               TEXT NOT NULL DEFAULT 'ITEM_RATE' CHECK (type IN ('ITEM_RATE','PERCENTAGE_RATE','LUMP_SUM','EPC','OTHER')),
  value_paise        BIGINT CHECK (value_paise IS NULL OR value_paise >= 0),
  retention_bps      INTEGER NOT NULL DEFAULT 500 CHECK (retention_bps BETWEEN 0 AND 10000),
  dlp_months         INTEGER NOT NULL DEFAULT 12 CHECK (dlp_months BETWEEN 0 AND 120),
  warranty_terms     TEXT,
  milestones_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date         DATE,
  end_date           DATE,
  commencement_date  DATE,
  completion_date    DATE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED')),
  row_version        INTEGER NOT NULL DEFAULT 1,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, parent_contract_id) REFERENCES contracts(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS specification_refs (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  contract_id     UUID,
  title           TEXT NOT NULL,
  spec_number     TEXT,
  division        TEXT,
  document_id     UUID,
  issuer          TEXT,
  revision        TEXT,
  issue_date      DATE,
  object_id       UUID,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, contract_id) REFERENCES contracts(org_id, project_id, id),
  FOREIGN KEY (org_id, object_id) REFERENCES storage_objects(org_id, id)
);

-- ============================================================================
-- 4. CONFIGURATION, ASSETS, CHECKLIST SNAPSHOTS & REQUIREMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS template_packs (
  id              UUID PRIMARY KEY,
  trade           TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  payload_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','DEPRECATED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE IF NOT EXISTS config_versions (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  level           TEXT NOT NULL CHECK (level IN ('PLATFORM','TRADE','ORG','CLIENT_CONTRACT','PROJECT')),
  scope_type      TEXT NOT NULL,
  scope_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  version_no      INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  payload_json    JSONB NOT NULL,
  checksum        TEXT NOT NULL,
  source_pack_id  UUID REFERENCES template_packs(id),
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  UNIQUE (level, scope_type, scope_id, version_no)
);

CREATE TABLE IF NOT EXISTS client_profiles (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  client_party_id UUID,
  payload_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_party_id) REFERENCES parties(org_id, id)
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id                   UUID PRIMARY KEY,
  org_id               UUID REFERENCES organisations(id) ON DELETE CASCADE,
  key                  TEXT NOT NULL,
  name                 TEXT NOT NULL,
  parent_key           TEXT,
  metadata_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_uq
  ON asset_categories (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE TABLE IF NOT EXISTS assets (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL,
  tag                  TEXT NOT NULL CHECK (char_length(trim(tag)) BETWEEN 1 AND 50),
  name                 TEXT NOT NULL,
  category_key         TEXT NOT NULL,
  make                 TEXT,
  model                TEXT,
  serial_no            TEXT,
  location             TEXT,
  capacity_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  refrigerant          TEXT,
  install_date         DATE,
  warranty_start       DATE,
  warranty_start_basis TEXT NOT NULL DEFAULT 'HANDOVER'
                         CHECK (warranty_start_basis IN ('COMMISSIONING','HANDOVER','ACCEPTANCE','SUPPLY')),
  warranty_end         DATE,
  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','REPLACED','RETIRED')),
  replaced_by_asset_id UUID,
  metadata_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_version          INTEGER NOT NULL DEFAULT 1,
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, replaced_by_asset_id) REFERENCES assets(org_id, project_id, id),
  CHECK (warranty_end IS NULL OR warranty_start IS NULL OR warranty_end >= warranty_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS assets_project_tag_uq ON assets (project_id, upper(trim(tag))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS checklist_snapshots (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL,
  version_no            INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED','ARCHIVED')),
  resolved_payload_json JSONB NOT NULL,
  provenance_json       JSONB NOT NULL,
  source_json           JSONB NOT NULL,
  checksum              TEXT NOT NULL,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_no),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requirements (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  current_snapshot_id UUID NOT NULL,
  requirement_key     TEXT NOT NULL,
  scope_key           TEXT NOT NULL DEFAULT 'project',
  asset_id            UUID, -- Enforces composite FK to assets (RT-003)
  group_key           TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  doc_type_key        TEXT NOT NULL,
  milestone_key       TEXT NOT NULL DEFAULT 'HANDOVER'
                        CHECK (milestone_key IN (
                          'MOBILISATION','SUBMISSION','DELIVERY','INSTALLATION',
                          'COMMISSIONING','HANDOVER','FINAL_BILL','DLP_END'
                        )),
  mandatory           BOOLEAN NOT NULL DEFAULT true,
  owner_user_id       UUID REFERENCES users(id),
  owner_party_id      UUID,
  reviewer_role       TEXT NOT NULL DEFAULT 'R-QC',
  due_at              TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'NOT_STARTED'
                        CHECK (status IN (
                          'NOT_STARTED','REQUESTED','UPLOADED','IN_REVIEW','UNDER_REVIEW',
                          'CHANGES_REQUESTED','REJECTED','APPROVED','EXPIRED',
                          'PENDING_WAIVER','WAIVED','NOT_APPLICABLE','HANDED_OVER','SUPERSEDED'
                        )),
  validity_rule_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  superseded_at       TIMESTAMPTZ,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, current_snapshot_id) REFERENCES checklist_snapshots(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id),
  FOREIGN KEY (org_id, owner_party_id) REFERENCES parties(org_id, id),
  CONSTRAINT requirements_scope_key_consistency_chk
    CHECK ((asset_id IS NULL AND scope_key = 'project') OR (asset_id IS NOT NULL AND scope_key = 'asset:' || asset_id::text))
);
CREATE UNIQUE INDEX IF NOT EXISTS requirements_stable_key_uq
  ON requirements (project_id, requirement_key, scope_key)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS requirements_project_status_idx ON requirements (org_id, project_id, status);

CREATE TABLE IF NOT EXISTS requirement_change_requests (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  requirement_id      UUID,
  change_type         TEXT,
  delta_json          JSONB DEFAULT '{}'::jsonb,
  title               TEXT,
  justification       TEXT,
  requested_by        UUID NOT NULL REFERENCES users(id),
  reason              TEXT NOT NULL DEFAULT 'Change request submitted',
  items_json          JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','APPLIED','PENDING')),
  approved_by         UUID REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  applied_snapshot_id UUID,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, applied_snapshot_id) REFERENCES checklist_snapshots(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS requirement_revisions (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL,
  requirement_id    UUID NOT NULL,
  snapshot_id       UUID NOT NULL,
  change_request_id UUID,
  field_diff_json   JSONB NOT NULL,
  reason            TEXT NOT NULL,
  changed_by        UUID NOT NULL REFERENCES users(id),
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, snapshot_id) REFERENCES checklist_snapshots(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, change_request_id) REFERENCES requirement_change_requests(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS waivers (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  requirement_id      UUID NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('WAIVE','NOT_APPLICABLE')),
  is_mandatory_item   BOOLEAN NOT NULL DEFAULT true,
  reason              TEXT NOT NULL CHECK (char_length(reason) >= 10),
  evidence_object_id  UUID,
  requested_by        UUID NOT NULL REFERENCES users(id),
  approved_by         UUID NOT NULL REFERENCES users(id),
  second_approved_by  UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  second_approved_at  TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('PENDING_SECOND_APPROVAL','ACTIVE','REJECTED','SUPERSEDED','REVOKED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id),
  FOREIGN KEY (org_id, evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (status <> 'ACTIVE' OR NOT is_mandatory_item OR (second_approved_by IS NOT NULL AND second_approved_by <> approved_by))
);

-- ============================================================================
-- 5. DOCUMENTS, VERSIONS, BULK IMPORT & REVIEWS
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id                          UUID PRIMARY KEY,
  org_id                      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id                  UUID NOT NULL,
  title                       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  doc_type_key                TEXT NOT NULL,
  category_key                TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE','SUPERSEDED','ARCHIVED')),
  latest_version_id           UUID,
  current_approved_version_id UUID,
  language                    TEXT NOT NULL DEFAULT 'en',
  metadata_json               JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_class             TEXT NOT NULL DEFAULT 'PROJECT_PLUS_8Y',
  row_version                 INTEGER NOT NULL DEFAULT 1,
  created_by                  UUID NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ,
  deleted_by                  UUID REFERENCES users(id),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS documents_project_status_idx ON documents (org_id, project_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS document_versions (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL,
  document_id           UUID NOT NULL,
  version_no            INTEGER NOT NULL CHECK (version_no >= 1),
  revision_code         TEXT NOT NULL CHECK (revision_code ~ '^[A-Za-z0-9._-]{1,10}$'),
  object_id             UUID NOT NULL,
  file_status           TEXT NOT NULL DEFAULT 'PENDING_UPLOAD'
                          CHECK (file_status IN ('PENDING_UPLOAD','UPLOADING','PROCESSING','READY','QUARANTINED','FAILED','ARCHIVED')),
  review_status         TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
                          CHECK (review_status IN ('NOT_SUBMITTED','IN_REVIEW','APPROVED','CHANGES_REQUESTED','REJECTED','SUPERSEDED','WITHDRAWN')),
  supersedes_version_id UUID,
  superseded_at         TIMESTAMPTZ,
  issue_date            DATE NOT NULL,
  expiry_date           DATE,
  validity_basis        TEXT NOT NULL DEFAULT 'NONE'
                          CHECK (validity_basis IN ('NONE','FIXED','EVENT_WARRANTY','REVISION','PROJECT_LIFE')),
  uploader_comment      TEXT,
  internal_note         TEXT,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  checks_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by           UUID REFERENCES users(id),
  uploaded_by_grant_id  UUID,
  submitted_at          TIMESTAMPTZ,
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  UNIQUE (document_id, version_no),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, object_id) REFERENCES storage_objects(org_id, id),
  CHECK (review_status <> 'APPROVED' OR file_status = 'READY'),
  CHECK (expiry_date IS NULL OR expiry_date >= issue_date)
);
-- Only one current approved version per document (08 §5.3)
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_one_approved_current
  ON document_versions (document_id)
  WHERE deleted_at IS NULL AND review_status = 'APPROVED' AND superseded_at IS NULL;

-- Soft-deleted, withdrawn, and failed uploads do not permanently lock revision_code (RT-011)
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_rev_code_active_uq
  ON document_versions (document_id, upper(revision_code))
  WHERE deleted_at IS NULL
    AND file_status NOT IN ('FAILED', 'QUARANTINED')
    AND review_status NOT IN ('WITHDRAWN', 'REJECTED');

CREATE TABLE IF NOT EXISTS document_requirements (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL,
  requirement_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, requirement_id),
  FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_assets (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL,
  asset_id        UUID NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, asset_id),
  FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS document_assets_one_primary_uq
  ON document_assets (document_id) WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS document_contracts (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL,
  contract_id     UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, contract_id),
  FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, contract_id) REFERENCES contracts(org_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bulk_import_jobs (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  zip_object_id       UUID NOT NULL,
  manifest_object_id  UUID,
  mapping_object_id   UUID,
  status              TEXT NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN ('UPLOADED','DRY_RUN_READY','PROCESSING','COMPLETED','FAILED')),
  dry_run_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, zip_object_id) REFERENCES storage_objects(org_id, id),
  FOREIGN KEY (org_id, manifest_object_id) REFERENCES storage_objects(org_id, id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL,
  document_version_id   UUID NOT NULL,
  stage_key             TEXT NOT NULL DEFAULT 'DEFAULT',
  reviewer_subject_type TEXT NOT NULL CHECK (reviewer_subject_type IN ('USER','PARTY')),
  reviewer_subject_id   UUID NOT NULL,
  reviewer_user_id      UUID REFERENCES users(id),
  reviewer_party_id     UUID,
  method                TEXT NOT NULL DEFAULT 'IN_APP' CHECK (method IN ('IN_APP','EXTERNAL')),
  external_method       TEXT CHECK (external_method IN ('STAMPED_PDF','EMAIL','PORTAL','PHYSICAL')),
  external_approver_name TEXT,
  external_reference    TEXT,
  evidence_object_id    UUID,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','IN_REVIEW','APPROVED','CHANGES_REQUESTED','REJECTED','CANCELLED')),
  decision              TEXT CHECK (decision IN ('APPROVE','REQUEST_CHANGES','REJECT')),
  comment               TEXT,
  due_at                TIMESTAMPTZ,
  decided_at            TIMESTAMPTZ,
  on_behalf_of_user_id  UUID REFERENCES users(id),
  is_override           BOOLEAN NOT NULL DEFAULT false,
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, stage_key, reviewer_subject_type, reviewer_subject_id),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, document_version_id) REFERENCES document_versions(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (decision NOT IN ('REQUEST_CHANGES','REJECT') OR (comment IS NOT NULL AND char_length(trim(comment)) >= 5)),
  CHECK (method <> 'EXTERNAL' OR (external_method IS NOT NULL AND external_approver_name IS NOT NULL)),
  CHECK (
    (reviewer_subject_type = 'USER' AND reviewer_user_id = reviewer_subject_id AND reviewer_party_id IS NULL) OR
    (reviewer_subject_type = 'PARTY' AND reviewer_party_id = reviewer_subject_id)
  )
);

CREATE TABLE IF NOT EXISTS review_comments (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  review_id       UUID NOT NULL,
  page_no         INTEGER CHECK (page_no IS NULL OR page_no >= 1),
  body            TEXT NOT NULL CHECK (char_length(trim(body)) >= 1),
  visibility      TEXT NOT NULL DEFAULT 'EXTERNAL' CHECK (visibility IN ('INTERNAL','EXTERNAL')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, review_id) REFERENCES reviews(org_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_overrides (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID,
  review_id          UUID NOT NULL,
  actor_id           UUID REFERENCES users(id),
  overridden_by      UUID REFERENCES users(id),
  reason             TEXT,
  justification      TEXT,
  previous_decision  TEXT,
  previous_status    TEXT,
  new_decision       TEXT,
  new_status         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, review_id) REFERENCES reviews(org_id, project_id, id) ON DELETE CASCADE
);

-- ============================================================================
-- 6. HANDOVER PACKAGES, SUBMISSIONS, WARRANTY, DEFECTS & VARIATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS handover_packages (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  version_no         INTEGER NOT NULL DEFAULT 1,
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','QUEUED','GENERATING','READY','FAILED','SUBMITTED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','SUPERSEDED')),
  scope_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_id        UUID,
  snapshot_checksum  TEXT,
  pdf_object_id      UUID,
  zip_object_id      UUID,
  manifest_object_id UUID,
  checksum           TEXT,
  override_reason    TEXT,
  error_code         TEXT,
  error_detail       TEXT,
  requested_by       UUID REFERENCES users(id),
  created_by         UUID REFERENCES users(id),
  row_version        INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_no),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, snapshot_id) REFERENCES checklist_snapshots(org_id, project_id, id),
  FOREIGN KEY (org_id, pdf_object_id) REFERENCES storage_objects(org_id, id),
  FOREIGN KEY (org_id, zip_object_id) REFERENCES storage_objects(org_id, id),
  FOREIGN KEY (org_id, manifest_object_id) REFERENCES storage_objects(org_id, id)
);

CREATE TABLE IF NOT EXISTS package_items (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  package_id          UUID NOT NULL,
  document_version_id UUID NOT NULL,
  section_key         TEXT NOT NULL,
  sort_order          INTEGER NOT NULL,
  page_start          INTEGER,
  page_end            INTEGER,
  included            BOOLEAN NOT NULL DEFAULT true,
  exclusion_reason    TEXT,
  FOREIGN KEY (org_id, project_id, package_id) REFERENCES handover_packages(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, document_version_id) REFERENCES document_versions(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS package_requirements (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL,
  package_id           UUID NOT NULL,
  requirement_id       UUID NOT NULL,
  requirement_key      TEXT NOT NULL,
  scope_key            TEXT NOT NULL,
  title                TEXT NOT NULL,
  doc_type_key         TEXT NOT NULL,
  mandatory            BOOLEAN NOT NULL,
  status_at_generation TEXT NOT NULL,
  due_at_at_generation TIMESTAMPTZ,
  asset_tag            TEXT,
  decision             TEXT,
  decided_by           TEXT,
  decided_at           TIMESTAMPTZ,
  decision_method      TEXT,
  FOREIGN KEY (org_id, project_id, package_id) REFERENCES handover_packages(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS package_layouts (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  package_id      UUID,
  method          TEXT NOT NULL DEFAULT 'PORTAL' CHECK (method IN ('PORTAL','EMAIL','PHYSICAL')),
  reference       TEXT,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','ACKNOWLEDGED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','WITHDRAWN','SUBMITTED')),
  sent_at         TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  decided_at      TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  submitted_by    UUID REFERENCES users(id),
  cover_note      TEXT,
  notes           TEXT,
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, package_id) REFERENCES handover_packages(org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS submission_recipients (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id           UUID,
  submission_id        UUID NOT NULL,
  party_id             UUID,
  recipient_party_id   UUID,
  recipient_role       TEXT CHECK (recipient_role IS NULL OR recipient_role IN ('CLIENT','MC','CONSULTANT','OTHER')),
  role                 TEXT,
  name                 TEXT,
  email                TEXT,
  is_required_approver BOOLEAN NOT NULL DEFAULT true,
  status               TEXT NOT NULL DEFAULT 'SENT'
                         CHECK (status IN ('SENT','ACKNOWLEDGED','ACCEPTED','ACCEPTED_WITH_EXCEPTIONS','REJECTED')),
  decision             TEXT CHECK (decision IN ('ACCEPT','ACCEPT_WITH_EXCEPTIONS','REJECT')),
  remarks              TEXT,
  decided_at           TIMESTAMPTZ,
  FOREIGN KEY (org_id, project_id, submission_id) REFERENCES submissions(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, recipient_party_id) REFERENCES parties(org_id, id)
);

CREATE TABLE IF NOT EXISTS submission_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  submission_id   UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warranty_events (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  asset_id           UUID NOT NULL,
  event_type         TEXT NOT NULL CHECK (event_type IN ('REGISTRATION','CONFIRMATION','CLAIM','EXTENSION')),
  oem_reference      TEXT NOT NULL,
  registered_at      DATE NOT NULL,
  warranty_start     DATE NOT NULL,
  warranty_end       DATE NOT NULL,
  basis              TEXT NOT NULL CHECK (basis IN ('COMMISSIONING','HANDOVER','ACCEPTANCE','SUPPLY')),
  status             TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','CONFIRMED','DISPUTED','CLAIMED')),
  evidence_object_id UUID,
  notes              TEXT,
  row_version        INTEGER NOT NULL DEFAULT 1,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (warranty_end >= warranty_start)
);

CREATE TABLE IF NOT EXISTS defects (
  id                         UUID PRIMARY KEY,
  org_id                     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id                 UUID NOT NULL,
  asset_id                   UUID,
  requirement_id             UUID,
  title                      TEXT NOT NULL,
  description                TEXT NOT NULL,
  severity                   TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  mandatory                  BOOLEAN NOT NULL DEFAULT true,
  assigned_user_id           UUID REFERENCES users(id),
  assigned_party_id          UUID,
  raised_by                  UUID NOT NULL REFERENCES users(id),
  raised_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at                     TIMESTAMPTZ,
  status                     TEXT NOT NULL DEFAULT 'OPEN'
                               CHECK (status IN ('OPEN','IN_PROGRESS','RECTIFIED','CLOSED','WAIVED')),
  closure_evidence_object_id UUID,
  closed_by                  UUID REFERENCES users(id),
  closed_at                  TIMESTAMPTZ,
  row_version                INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id),
  FOREIGN KEY (org_id, closure_evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (status <> 'CLOSED' OR closure_evidence_object_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS variations (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL,
  contract_id       UUID NOT NULL,
  reference         TEXT DEFAULT '',
  variation_ref     TEXT,
  title             TEXT,
  description       TEXT DEFAULT '',
  cost_delta_paise  BIGINT NOT NULL DEFAULT 0,
  value_paise_delta BIGINT NOT NULL DEFAULT 0,
  time_days_delta   INTEGER NOT NULL DEFAULT 0,
  scope_delta_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  requested_by      UUID REFERENCES users(id),
  created_by        UUID REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  change_request_id UUID,
  row_version       INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, contract_id) REFERENCES contracts(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, change_request_id) REFERENCES requirement_change_requests(org_id, project_id, id)
);

-- ============================================================================
-- 7. NOTIFICATIONS, OUTBOX, AUDIT, BILLING & RETENTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_templates (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  channel         TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en',
  subject         TEXT,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT notification_templates_uq UNIQUE (org_id, key, channel, locale)
);

CREATE TABLE IF NOT EXISTS notifications (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID,
  recipient_user_id  UUID REFERENCES users(id),
  recipient_party_id UUID,
  channel            TEXT NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  event_key          TEXT NOT NULL,
  payload_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','READ','FAILED')),
  dedup_key          TEXT NOT NULL,
  sent_at            TIMESTAMPTZ,
  read_at            TIMESTAMPTZ,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_uq
  ON notifications (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id));

CREATE TABLE IF NOT EXISTS notification_preferences (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  channel         TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  digest          TEXT NOT NULL DEFAULT 'IMMEDIATE'
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  dispatched_at   TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_events_undispatched_idx ON outbox_events (created_at ASC) WHERE dispatched_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS audit_events_chain_seq;

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID NOT NULL,
  org_id          UUID,
  project_id      UUID,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('USER','MEMBER','GUEST','SYSTEM','ADMIN')),
  actor_user_id   UUID,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_json     JSONB,
  after_json      JSONB,
  ip              INET,
  user_agent      TEXT,
  request_id      TEXT NOT NULL,
  prev_hash       TEXT,
  hash            TEXT,
  chain_seq       BIGINT DEFAULT nextval('audit_events_chain_seq'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_events_2026_10 PARTITION OF audit_events
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_events_2026_11 PARTITION OF audit_events
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_events_2026_12 PARTITION OF audit_events
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS audit_events_default PARTITION OF audit_events DEFAULT;

CREATE INDEX IF NOT EXISTS audit_events_org_proj_idx ON audit_events (org_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id) ON DELETE SET NULL,
  admin_user_id   UUID NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL,
  reason          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_json     JSONB,
  after_json      JSONB,
  ip              INET,
  request_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_events (
  id                   UUID PRIMARY KEY,
  org_id               UUID,
  actor_user_id        UUID,
  event_type           TEXT NOT NULL,
  detail_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip                   INET,
  user_agent           TEXT,
  request_id           TEXT NOT NULL,
  cert_in_reportable   BOOLEAN NOT NULL DEFAULT false,
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_due_at        TIMESTAMPTZ,
  reported_to_cert_in_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now() -- Retained >= 365 days per DPDP Rules 2025
);

CREATE TABLE IF NOT EXISTS job_executions (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json   JSONB NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key, endpoint)
);

CREATE TABLE IF NOT EXISTS plans (
  id              UUID PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  limits_json     JSONB NOT NULL, -- {maxActiveProjects, maxSeats, maxStorageBytes, maxPackageGenerationsPerMonth}
  price_paise     BIGINT NOT NULL CHECK (price_paise >= 0),
  interval        TEXT NOT NULL CHECK (interval IN ('MONTH','YEAR','MONTHLY','ANNUAL','ONE_TIME_PROJECT')),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES plans(id),
  status               TEXT NOT NULL DEFAULT 'TRIAL'
                         CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
  provider             TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_ref         TEXT,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  cancel_at            TIMESTAMPTZ,
  row_version          INTEGER NOT NULL DEFAULT 1,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL CHECK (metric IN ('ACTIVE_PROJECTS','SEATS','STORAGE_BYTES','PACKAGES_MONTH')),
  period          TEXT NOT NULL DEFAULT 'ALL_TIME',
  value           BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, metric, period)
);

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  subscription_id UUID,
  number          TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT','ISSUED','PAID','VOID')),
  subtotal_paise  BIGINT NOT NULL CHECK (subtotal_paise >= 0),
  tax_paise       BIGINT NOT NULL CHECK (tax_paise >= 0),
  total_paise     BIGINT NOT NULL CHECK (total_paise = subtotal_paise + tax_paise),
  tax_rate_bps    INTEGER NOT NULL DEFAULT 1800,
  sac             TEXT NOT NULL DEFAULT '998315',
  place_of_supply TEXT NOT NULL,
  buyer_gstin     TEXT,
  irn             TEXT, -- V2 (>= 5 Cr turnover)
  qr_payload      TEXT,
  einvoice_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  pdf_object_id   UUID,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_paise      BIGINT NOT NULL,
  tax_rate_bps    INTEGER NOT NULL,
  amount_paise    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_tds (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  invoice_id            UUID NOT NULL REFERENCES invoices(id),
  section               TEXT NOT NULL DEFAULT '194J' CHECK (section IN ('194J_A_2PCT','194J_B_10PCT','194C','OTHER')),
  rate_bps              INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 2000),
  amount_paise          BIGINT NOT NULL CHECK (amount_paise > 0),
  certificate_reference TEXT, -- Nullable at deduction time; updated quarterly upon Form 16A receipt (RT-030)
  certificate_object_id UUID REFERENCES storage_objects(id),
  status                TEXT NOT NULL DEFAULT 'PENDING_CERTIFICATE'
                          CHECK (status IN ('PENDING_CERTIFICATE','DEDUCTED_PENDING_CERT','CERTIFICATE_UPLOADED','CERT_UPLOADED','RECONCILED')),
  deducted_at           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id),
  provider        TEXT NOT NULL DEFAULT 'RAZORPAY',
  event_id        TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  number          TEXT NOT NULL UNIQUE,
  amount_paise    BIGINT NOT NULL,
  reason          TEXT NOT NULL,
  approved_by     UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS digital_signatures (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL,
  target_type           TEXT NOT NULL CHECK (target_type IN ('DOCUMENT_VERSION', 'HANDOVER_PACKAGE', 'COMPLETION_CERTIFICATE')),
  target_id             UUID NOT NULL,
  signer_user_id        UUID REFERENCES users(id),
  signer_name           TEXT NOT NULL,
  signer_designation    TEXT NOT NULL,
  signature_standard    TEXT NOT NULL CHECK (signature_standard IN ('PADES_B_LT', 'CLASS_3_DSC_PKCS7', 'LICENSED_ASP_ESIGN')),
  asp_provider          TEXT,
  asp_transaction_id    TEXT UNIQUE,
  certificate_serial    TEXT NOT NULL,
  certificate_issuer    TEXT NOT NULL,
  certificate_subject   TEXT NOT NULL,
  signed_pdf_sha256     TEXT NOT NULL,
  pkcs7_signature_hex   TEXT NOT NULL,
  rfc3161_tst_token_hex TEXT,
  verification_code     TEXT NOT NULL UNIQUE,
  signed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  financial_year TEXT PRIMARY KEY,
  last_seq_no    INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id                UUID PRIMARY KEY,
  org_id            UUID REFERENCES organisations(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  retention_months  INTEGER NOT NULL DEFAULT 96,
  basis             TEXT NOT NULL DEFAULT 'PROJECT_CLOSURE',
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS legal_holds (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subject_type    TEXT NOT NULL,
  subject_id      UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'REQUESTED',
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  owner_user_id   UUID NOT NULL REFERENCES users(id)
);

-- ============================================================================
-- 8. ENFORCE ROW-LEVEL SECURITY ON ALL TENANT TABLES (RT-005)
-- ============================================================================
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'storage_objects','org_profiles','memberships','invitations',
    'parties','party_contacts','projects','project_members','guest_grants',
    'contracts','specification_refs','client_profiles','assets',
    'checklist_snapshots','requirements','requirement_change_requests',
    'requirement_revisions','waivers','documents','document_versions',
    'document_requirements','document_assets','document_contracts','document_events',
    'bulk_import_jobs','reviews','review_comments','approval_overrides',
    'handover_packages','package_items','package_requirements','package_layouts',
    'submissions','submission_recipients','submission_events',
    'warranty_events','defects','variations','notifications','notification_preferences',
    'outbox_events','audit_events','security_events','idempotency_keys','subscriptions',
    'usage_counters','invoices','invoice_lines','invoice_tds','credit_notes',
    'digital_signatures','legal_holds','deletion_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I;', t, t);
      EXECUTE format(
        'CREATE POLICY %I_tenant_isolation ON %I USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid);',
        t, t
      );
    END IF;
  END LOOP;
END
$$;

-- Refined RLS policies for bootstrap and user/guest access (CB-007)
DROP POLICY IF EXISTS memberships_tenant_isolation ON memberships;
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  );

DROP POLICY IF EXISTS guest_grants_tenant_isolation ON guest_grants;
CREATE POLICY guest_grants_tenant_isolation ON guest_grants
  USING (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.current_token_hash', true), '')
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.current_token_hash', true), '')
  );

DROP POLICY IF EXISTS invitations_tenant_isolation ON invitations;
CREATE POLICY invitations_tenant_isolation ON invitations
  USING (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.current_token_hash', true), '')
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.current_token_hash', true), '')
  );

GRANT USAGE ON SCHEMA public TO tc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tc_app;

-- Prevent customer updates/deletes on append-only audit_events and security_events
REVOKE UPDATE, DELETE ON audit_events FROM tc_app;
REVOKE UPDATE, DELETE ON security_events FROM tc_app;

RESET ROLE;
