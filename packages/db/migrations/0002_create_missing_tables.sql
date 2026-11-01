-- Create any missing tables defined in packages/db/src/schema.ts
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS document_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  project_id      UUID NOT NULL,
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT de_same_project_doc_fk FOREIGN KEY (org_id, project_id, document_id) REFERENCES documents(org_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_overrides (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL REFERENCES organisations(id),
  project_id         UUID NOT NULL,
  review_id          UUID NOT NULL REFERENCES reviews(id),
  actor_id           UUID NOT NULL REFERENCES users(id),
  reason             TEXT NOT NULL,
  previous_decision  TEXT,
  new_decision       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submission_events (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  project_id      UUID NOT NULL,
  submission_id   UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_layouts (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id),
  key             TEXT NOT NULL,
  channel         TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en',
  subject         TEXT,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT notification_templates_uq UNIQUE (org_id, key, channel, locale)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  channel         TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  digest          TEXT NOT NULL DEFAULT 'IMMEDIATE'
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id),
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

CREATE TABLE IF NOT EXISTS job_executions (
  id              UUID PRIMARY KEY,
  org_id          UUID REFERENCES organisations(id),
  job_type        TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  error           TEXT
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

CREATE TABLE IF NOT EXISTS retention_policies (
  id                UUID PRIMARY KEY,
  org_id            UUID REFERENCES organisations(id),
  code              TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  retention_months  INTEGER NOT NULL DEFAULT 96,
  basis             TEXT NOT NULL DEFAULT 'PROJECT_CLOSURE',
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS legal_holds (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  project_id      UUID NOT NULL REFERENCES projects(id),
  reason          TEXT NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organisations(id),
  subject_type    TEXT NOT NULL,
  subject_id      UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'REQUESTED',
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  owner_user_id   UUID NOT NULL REFERENCES users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
RESET ROLE;
