-- apps/api/src/database/migrations/0001_initial_schema.sql
SET ROLE tc_migrator;

-- ============================================================================
-- 1. GLOBAL IDENTITY & TENANCY (NO RLS ON GLOBAL TABLES)
-- ============================================================================
CREATE TABLE users (
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

CREATE TABLE user_identities (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('EMAIL','PHONE')),
  value           CITEXT NOT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, value)
);

CREATE TABLE organisations (
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

CREATE TABLE sessions (
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
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_challenges (
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
CREATE INDEX otp_challenges_lookup_idx ON otp_challenges (identifier, purpose, created_at DESC);

-- ============================================================================
-- 2. STORAGE OBJECTS & TENANT PROFILES
-- ============================================================================
CREATE TABLE storage_objects (
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
                    CHECK (status IN ('PENDING','READY','QUARANTINED','FAILED','DELETED')),
  retention_class TEXT NOT NULL DEFAULT 'PROJECT_PLUS_8Y',
  av_scanned_at   TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, bucket, object_key),
  UNIQUE (org_id, id),
  CHECK (status <> 'READY' OR (sha256 IS NOT NULL AND size_bytes > 0))
);
CREATE INDEX storage_objects_org_sha_idx ON storage_objects (org_id, sha256) WHERE status = 'READY';

CREATE TABLE org_profiles (
  org_id                UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  gstin                 TEXT CHECK (gstin IS NULL OR char_length(gstin) = 15),
  pan                   TEXT CHECK (pan IS NULL OR char_length(pan) = 10),
  address_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_object_id        UUID,
  brand_color           TEXT NOT NULL DEFAULT '#0F172A',
  footer_text           TEXT,
  signatory_name        TEXT,
  signatory_designation TEXT,
  contact_email         CITEXT,
  contact_phone         TEXT,
  row_version           INTEGER NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, logo_object_id) REFERENCES storage_objects(org_id, id)
);

CREATE TABLE memberships (
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
CREATE UNIQUE INDEX memberships_one_active_owner_uq
  ON memberships (org_id)
  WHERE role = 'R-OWNER' AND status = 'ACTIVE';

CREATE TABLE invitations (
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
CREATE TABLE parties (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  types           TEXT[] NOT NULL,
  gstin           TEXT,
  email           CITEXT,
  phone_e164      TEXT,
  address_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (org_id, id)
);
CREATE INDEX parties_org_name_idx ON parties (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE party_contacts (
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

CREATE TABLE projects (
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
CREATE UNIQUE INDEX projects_org_code_uq ON projects (org_id, upper(code));

CREATE TABLE project_members (
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

CREATE TABLE guest_grants (
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
  cooldown_until    TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, party_id) REFERENCES parties(org_id, id),
  CHECK (target_email IS NOT NULL OR target_phone_e164 IS NOT NULL)
);

CREATE TABLE contracts (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  parent_contract_id UUID,
  reference          TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('ITEM_RATE','PERCENTAGE_RATE','LUMP_SUM','EPC','OTHER')),
  value_paise        BIGINT CHECK (value_paise IS NULL OR value_paise >= 0),
  retention_bps      INTEGER NOT NULL DEFAULT 500 CHECK (retention_bps BETWEEN 0 AND 10000),
  dlp_months         INTEGER NOT NULL DEFAULT 12 CHECK (dlp_months BETWEEN 0 AND 120),
  warranty_terms     TEXT,
  milestones_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date         DATE,
  end_date           DATE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED')),
  row_version        INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, reference),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, parent_contract_id) REFERENCES contracts(org_id, project_id, id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE specification_refs (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  contract_id     UUID,
  title           TEXT NOT NULL,
  issuer          TEXT,
  revision        TEXT,
  issue_date      DATE,
  object_id       UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, contract_id) REFERENCES contracts(org_id, project_id, id),
  FOREIGN KEY (org_id, object_id) REFERENCES storage_objects(org_id, id)
);

-- ============================================================================
-- 4. CONFIGURATION, ASSETS, CHECKLIST SNAPSHOTS & REQUIREMENTS
-- ============================================================================
CREATE TABLE template_packs (
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

CREATE TABLE config_versions (
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

CREATE TABLE client_profiles (
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

CREATE TABLE asset_categories (
  id                   UUID PRIMARY KEY,
  org_id               UUID REFERENCES organisations(id) ON DELETE CASCADE,
  key                  TEXT NOT NULL,
  name                 TEXT NOT NULL,
  parent_key           TEXT,
  metadata_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX asset_categories_uq
  ON asset_categories (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE TABLE assets (
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
CREATE UNIQUE INDEX assets_project_tag_uq ON assets (project_id, upper(trim(tag))) WHERE deleted_at IS NULL;

CREATE TABLE checklist_snapshots (
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

CREATE TABLE requirements (
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
                          'NOT_STARTED','REQUESTED','UPLOADED','IN_REVIEW',
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
CREATE UNIQUE INDEX requirements_stable_key_uq
  ON requirements (project_id, requirement_key, scope_key)
  WHERE superseded_at IS NULL;
CREATE INDEX requirements_project_status_idx ON requirements (org_id, project_id, status);

CREATE TABLE requirement_change_requests (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  requested_by        UUID NOT NULL REFERENCES users(id),
  reason              TEXT NOT NULL CHECK (char_length(reason) >= 5),
  items_json          JSONB NOT NULL,
  impact_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','APPLIED')),
  approved_by         UUID REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  applied_snapshot_id UUID,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, applied_snapshot_id) REFERENCES checklist_snapshots(org_id, project_id, id)
);

CREATE TABLE requirement_revisions (
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

CREATE TABLE waivers (
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
                        CHECK (status IN ('PENDING_SECOND_APPROVAL','ACTIVE','REVOKED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id),
  FOREIGN KEY (org_id, evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (status <> 'ACTIVE' OR NOT is_mandatory_item OR (second_approved_by IS NOT NULL AND second_approved_by <> approved_by))
);

-- ============================================================================
-- 5. DOCUMENTS, VERSIONS, BULK IMPORT & REVIEWS
-- ============================================================================
CREATE TABLE documents (
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
CREATE INDEX documents_project_status_idx ON documents (org_id, project_id, status) WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
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
CREATE UNIQUE INDEX document_versions_one_approved_current
  ON document_versions (document_id)
  WHERE deleted_at IS NULL AND review_status = 'APPROVED' AND superseded_at IS NULL;

-- Soft-deleted, withdrawn, and failed uploads do not permanently lock revision_code (RT-011)
CREATE UNIQUE INDEX document_versions_rev_code_active_uq
  ON document_versions (document_id, upper(revision_code))
  WHERE deleted_at IS NULL
    AND file_status NOT IN ('FAILED', 'QUARANTINED')
    AND review_status <> 'WITHDRAWN';

CREATE TABLE document_requirements (
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

CREATE TABLE document_assets (
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
CREATE UNIQUE INDEX document_assets_one_primary_uq
  ON document_assets (document_id) WHERE is_primary = true;

CREATE TABLE document_contracts (
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

CREATE TABLE bulk_import_jobs (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  zip_object_id       UUID NOT NULL,
  mapping_object_id   UUID,
  status              TEXT NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN ('UPLOADED','DRY_RUN_READY','PROCESSING','COMPLETED','FAILED')),
  dry_run_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, zip_object_id) REFERENCES storage_objects(org_id, id)
);

CREATE TABLE reviews (
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
  CHECK (method <> 'EXTERNAL' OR (external_method IS NOT NULL AND external_approver_name IS NOT NULL))
);

CREATE TABLE review_comments (
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

-- ============================================================================
-- 6. HANDOVER PACKAGES, SUBMISSIONS, WARRANTY, DEFECTS & VARIATIONS
-- ============================================================================
CREATE TABLE handover_packages (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  version_no         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','QUEUED','GENERATING','READY','FAILED','SUBMITTED','ACCEPTED','REJECTED','SUPERSEDED')),
  scope_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_id        UUID NOT NULL,
  snapshot_checksum  TEXT NOT NULL,
  pdf_object_id      UUID,
  zip_object_id      UUID,
  manifest_object_id UUID,
  checksum           TEXT,
  override_reason    TEXT,
  error_code         TEXT,
  error_detail       TEXT,
  requested_by       UUID NOT NULL REFERENCES users(id),
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

CREATE TABLE package_items (
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

CREATE TABLE package_requirements (
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

CREATE TABLE submissions (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL,
  package_id      UUID,
  method          TEXT NOT NULL CHECK (method IN ('PORTAL','EMAIL','PHYSICAL')),
  reference       TEXT,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','ACKNOWLEDGED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','WITHDRAWN')),
  sent_at         TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  decided_at      TIMESTAMPTZ,
  notes           TEXT,
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, package_id) REFERENCES handover_packages(org_id, project_id, id)
);

CREATE TABLE submission_recipients (
  id                   UUID PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL,
  submission_id        UUID NOT NULL,
  recipient_party_id   UUID NOT NULL,
  recipient_role       TEXT NOT NULL CHECK (recipient_role IN ('CLIENT','MC','CONSULTANT','OTHER')),
  is_required_approver BOOLEAN NOT NULL DEFAULT true,
  status               TEXT NOT NULL DEFAULT 'SENT'
                         CHECK (status IN ('SENT','ACKNOWLEDGED','ACCEPTED','ACCEPTED_WITH_EXCEPTIONS','REJECTED')),
  decision             TEXT CHECK (decision IN ('ACCEPT','ACCEPT_WITH_EXCEPTIONS','REJECT')),
  remarks              TEXT,
  decided_at           TIMESTAMPTZ,
  UNIQUE (submission_id, recipient_party_id),
  FOREIGN KEY (org_id, project_id, submission_id) REFERENCES submissions(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, recipient_party_id) REFERENCES parties(org_id, id)
);

CREATE TABLE warranty_events (
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
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, evidence_object_id) REFERENCES storage_objects(org_id, id),
  CHECK (warranty_end >= warranty_start)
);

CREATE TABLE defects (
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

CREATE TABLE variations (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL,
  contract_id       UUID NOT NULL,
  reference         TEXT NOT NULL,
  description       TEXT NOT NULL,
  value_paise_delta BIGINT NOT NULL DEFAULT 0,
  time_days_delta   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  requested_by      UUID NOT NULL REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  change_request_id UUID,
  row_version       INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, reference),
  FOREIGN KEY (org_id, project_id, contract_id) REFERENCES contracts(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, change_request_id) REFERENCES requirement_change_requests(org_id, project_id, id),
  CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_by <> requested_by))
);

-- ============================================================================
-- 7. NOTIFICATIONS, OUTBOX, AUDIT, BILLING & RETENTION
-- ============================================================================
CREATE TABLE notifications (
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
CREATE UNIQUE INDEX notifications_dedup_uq
  ON notifications (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id));

CREATE TABLE outbox_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id      UUID,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  dispatched_at   TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_undispatched_idx ON outbox_events (created_at ASC) WHERE dispatched_at IS NULL;

CREATE TABLE audit_events (
  id              UUID NOT NULL,
  org_id          UUID NOT NULL,
  project_id      UUID,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('USER','GUEST','SYSTEM','ADMIN')),
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_events_2026_10 PARTITION OF audit_events
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE audit_events_2026_11 PARTITION OF audit_events
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE security_events (
  id              UUID PRIMARY KEY,
  org_id          UUID,
  actor_user_id   UUID,
  event_type      TEXT NOT NULL,
  detail_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip              INET,
  user_agent      TEXT,
  request_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now() -- Retained >= 365 days per DPDP Rules 2025
);

CREATE TABLE idempotency_keys (
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

CREATE TABLE plans (
  id              UUID PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  limits_json     JSONB NOT NULL, -- {maxActiveProjects, maxSeats, maxStorageBytes, maxPackageGenerationsPerMonth}
  price_paise     BIGINT NOT NULL CHECK (price_paise >= 0),
  interval        TEXT NOT NULL CHECK (interval IN ('MONTHLY','ANNUAL')),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE subscriptions (
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

CREATE TABLE usage_counters (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL CHECK (metric IN ('ACTIVE_PROJECTS','SEATS','STORAGE_BYTES','PACKAGES_MONTH')),
  period          TEXT NOT NULL DEFAULT 'ALL_TIME',
  value           BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, metric, period)
);

CREATE TABLE invoices (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
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

CREATE TABLE invoice_tds (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  invoice_id            UUID NOT NULL REFERENCES invoices(id),
  section               TEXT NOT NULL DEFAULT '194J' CHECK (section IN ('194J_A_2PCT','194J_B_10PCT','194C','OTHER')),
  rate_bps              INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 2000),
  amount_paise          BIGINT NOT NULL CHECK (amount_paise > 0),
  certificate_reference TEXT, -- Nullable at deduction time; updated quarterly upon Form 16A receipt (RT-030)
  certificate_object_id UUID,
  status                TEXT NOT NULL DEFAULT 'PENDING_CERTIFICATE'
                          CHECK (status IN ('PENDING_CERTIFICATE','CERTIFICATE_UPLOADED','RECONCILED')),
  deducted_at           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
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
    'document_requirements','document_assets','document_contracts','bulk_import_jobs',
    'reviews','review_comments','handover_packages','package_items',
    'package_requirements','submissions','submission_recipients',
    'warranty_events','defects','variations','notifications','outbox_events',
    'audit_events','idempotency_keys','subscriptions','usage_counters',
    'invoices','invoice_tds'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid);',
      t, t
    );
  END LOOP;
END
$$;

-- Prevent customer updates/deletes on append-only audit_events
REVOKE UPDATE, DELETE ON audit_events FROM tc_app;
REVOKE UPDATE, DELETE ON security_events FROM tc_app;
