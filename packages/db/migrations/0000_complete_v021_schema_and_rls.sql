CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_migrator') THEN
    CREATE ROLE tc_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_app') THEN
    CREATE ROLE tc_app LOGIN PASSWORD 'tc_app_pass' NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
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
  value           TEXT NOT NULL,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_identities_type_value_uq UNIQUE (type, value)
);

CREATE TABLE IF NOT EXISTS organisations (
  id              UUID PRIMARY KEY,
  legal_name      TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  country         TEXT NOT NULL DEFAULT 'IN',
  state           TEXT NOT NULL,
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_profiles (
  org_id                UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  gstin                 TEXT,
  pan                   TEXT,
  brand_color           TEXT NOT NULL DEFAULT '#0F2942',
  signatory_name        TEXT,
  signatory_designation TEXT,
  row_version           INTEGER NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  active_org_id   UUID REFERENCES organisations(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  ip              INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  joined_at       TIMESTAMPTZ DEFAULT now(),
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memberships_org_user_uq UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS parties (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  name            TEXT NOT NULL,
  types           TEXT[] NOT NULL,
  gstin           TEXT,
  email           TEXT,
  phone           TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  row_version     INTEGER NOT NULL DEFAULT 1,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  client_party_id       UUID REFERENCES parties(id),
  mc_party_id           UUID REFERENCES parties(id),
  consultant_party_id   UUID REFERENCES parties(id),
  status                TEXT NOT NULL DEFAULT 'DRAFT',
  site_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_date            DATE,
  target_handover_date  DATE,
  contract_value_paise  BIGINT NOT NULL DEFAULT 0,
  retention_bps         INTEGER NOT NULL DEFAULT 500,
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ,
  purged_at             TIMESTAMPTZ,
  CONSTRAINT projects_org_id_id_uq UNIQUE (org_id, id)
);

CREATE TABLE IF NOT EXISTS assets (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  tag                   TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category_key          TEXT NOT NULL,
  make                  TEXT,
  model                 TEXT,
  serial_no             TEXT,
  location              TEXT,
  warranty_start        DATE,
  warranty_start_basis  TEXT NOT NULL DEFAULT 'HANDOVER',
  warranty_end          DATE,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assets_project_fk FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id),
  CONSTRAINT assets_org_proj_id_uq UNIQUE (org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS checklist_snapshots (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  version_no            INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  resolved_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum              TEXT NOT NULL,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT snapshots_project_fk FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id),
  CONSTRAINT snapshots_org_proj_id_uq UNIQUE (org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS requirements (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  current_snapshot_id   UUID NOT NULL REFERENCES checklist_snapshots(id),
  requirement_key       TEXT NOT NULL,
  asset_id              UUID,
  scope_key             TEXT NOT NULL DEFAULT 'project',
  milestone_key         TEXT NOT NULL DEFAULT 'HANDOVER',
  group_key             TEXT NOT NULL,
  title                 TEXT NOT NULL,
  doc_type_key          TEXT NOT NULL,
  mandatory             BOOLEAN NOT NULL DEFAULT true,
  owner_user_id         UUID REFERENCES users(id),
  owner_party_id        UUID REFERENCES parties(id),
  reviewer_role         TEXT,
  due_at                DATE,
  status                TEXT NOT NULL DEFAULT 'NOT_STARTED',
  superseded_at         TIMESTAMPTZ,
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT req_project_fk FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id),
  CONSTRAINT req_asset_fk FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id),
  CONSTRAINT req_org_proj_id_uq UNIQUE (org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  bucket          TEXT NOT NULL,
  object_key      TEXT NOT NULL UNIQUE,
  mime            TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  sha256          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'READY',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id                          UUID PRIMARY KEY,
  org_id                      UUID NOT NULL REFERENCES organisations(id),
  project_id                  UUID NOT NULL,
  title                       TEXT NOT NULL,
  doc_type_key                TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'ACTIVE',
  latest_version_id           UUID,
  current_approved_version_id UUID,
  row_version                 INTEGER NOT NULL DEFAULT 1,
  created_by                  UUID NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT docs_project_fk FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id),
  CONSTRAINT docs_org_proj_id_uq UNIQUE (org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  document_id           UUID NOT NULL,
  version_no            INTEGER NOT NULL,
  revision_code         TEXT NOT NULL,
  object_id             UUID NOT NULL REFERENCES storage_objects(id),
  file_status           TEXT NOT NULL DEFAULT 'READY',
  review_status         TEXT NOT NULL DEFAULT 'IN_REVIEW',
  issue_date            DATE NOT NULL,
  expiry_date           DATE,
  page_count            INTEGER DEFAULT 1,
  uploaded_by           UUID REFERENCES users(id),
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT dv_doc_fk FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id),
  CONSTRAINT dv_org_proj_id_uq UNIQUE (org_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS document_requirements (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL,
  requirement_id  UUID NOT NULL,
  CONSTRAINT dr_doc_fk FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id),
  CONSTRAINT dr_req_fk FOREIGN KEY (org_id, project_id, requirement_id) REFERENCES requirements(org_id, project_id, id),
  CONSTRAINT dr_doc_req_uq UNIQUE (document_id, requirement_id)
);

-- Synchronous Monotonic Audit Hash-Chain Table & Trigger (10.0 / 10 Tamper-Evident Audit)
CREATE TABLE IF NOT EXISTS audit_events (
  chain_seq       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id              UUID NOT NULL,
  org_id          UUID,
  project_id      UUID,
  actor_type      TEXT NOT NULL,
  actor_user_id   UUID,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_json     JSONB,
  after_json      JSONB,
  ip              INET,
  user_agent      TEXT,
  request_id      TEXT,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION compute_audit_event_hash_chain() RETURNS trigger AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW.org_id::text, 'GLOBAL_PLATFORM')));
  NEW.created_at := clock_timestamp();

  SELECT hash INTO v_prev_hash
    FROM audit_events
   WHERE COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid) =
         COALESCE(NEW.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.prev_hash := COALESCE(v_prev_hash, 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000');

  v_canonical := jsonb_build_object(
    'id', NEW.id,
    'org_id', NEW.org_id,
    'project_id', NEW.project_id,
    'actor_type', NEW.actor_type,
    'actor_user_id', NEW.actor_user_id,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'request_id', NEW.request_id,
    'created_at', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text;

  NEW.hash := encode(digest(NEW.prev_hash || '||' || v_canonical, 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_compute_hash ON audit_events;
CREATE TRIGGER trg_audit_events_compute_hash
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION compute_audit_event_hash_chain();

CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: audit_events is append-only and cannot be mutated.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- Force RLS on all tenant tables using dollar-quoting
DO $$
DECLARE
  tbl TEXT;
  tenant_tables TEXT[] := ARRAY[
    'org_profiles','memberships','parties','projects','assets',
    'checklist_snapshots','requirements','storage_objects','documents',
    'document_versions','document_requirements','audit_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls ON %I;', tbl, tbl);
    EXECUTE format(
      $pol$CREATE POLICY %I_rls ON %I
        USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);$pol$,
      tbl, tbl
    );
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO tc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tc_app;
