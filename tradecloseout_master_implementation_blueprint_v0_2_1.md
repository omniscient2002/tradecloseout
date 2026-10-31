# TRADECLOSEOUT — MASTER STEP-BY-STEP IMPLEMENTATION BLUEPRINT (v0.2.1)

**Target Specification:** TradeCloseout v0.2.1 (Post-Red-Team Remediation — Approved with Conditions)  
**Target Executor:** Autonomous AI Coding Agent / Principal Full-Stack Engineer  
**Architecture:** Modular Monolith (NestJS + TypeScript + Drizzle ORM) · Next.js PWA · PostgreSQL 16 (Forced RLS + Composite FKs) · Redis 7 (BullMQ) · S3-Compatible Object Storage · ClamAV · Pure-Node PDF Engine (`pdfmake` + `pdf-lib` + `qpdf`)

---

## 0. AGENT EXECUTION PROTOCOL & NON-NEGOTIABLE INVARIANTS

Before generating any application code, the implementing agent must enforce these 10 system-wide engineering rules across every file:

1. **Zero Undocumented Decisions:** Every state transition, permission check, database constraint, and error code must match this blueprint and Specification v0.2.1. If an edge case is encountered, fail closed with an RFC 9457 `application/problem+json` response.
2. **Database Role Separation & Forced RLS (`RT-005`):**
   * **Never** run the application using the database owner/migration role.
   * Migrations run exclusively as `tc_migrator` (table owner).
   * The NestJS API and BullMQ workers connect exclusively as `tc_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`).
   * Every tenant-owned table must have `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`.
3. **Session-Derived Tenant Context (`D-034`, `RT-002`):**
   * The active organisation is resolved exclusively from `sessions.active_org_id` on the server.
   * `sessions.active_org_id` is **nullable** only for newly verified users who have not yet created or joined an organisation.
   * Every `/orgs/{orgId}` path parameter must be compared against `session.active_org_id`; any mismatch immediately returns `404 Not Found` (never `403`, to prevent tenant enumeration).
4. **Cross-Project Referential Integrity (`AUD-004`, `RT-003`):**
   * Every project-scoped child table includes `org_id` and `project_id` and enforces composite foreign keys `(org_id, project_id, <parent_id>)` referencing parent `UNIQUE (org_id, project_id, id)` constraints.
5. **Positive-Only Additive Permission Model (`D-039`, `RT-004`):**
   * There is no explicit deny table. Capabilities are the union of roles:
     $$\text{Effective\_Capabilities} = \text{Org\_Roles} \cup \text{Project\_Roles} \cup \text{Guest\_Grants}$$
   * Scope is evaluated per grant: an Org Owner/Admin's org-wide scope (`A`) is never narrowed by a project membership, while a project member's or guest's capability is filtered by their `scope_json` and `requirements.reviewer_role`.
6. **Pure-Node PDF Generation & Decompression Bomb Protection (`RT-006`, `RT-025`, `RT-034`):**
   * Gotenberg/Chromium is **not** used in MVP. Cover pages, indexes, asset registers, and approval summaries are generated using pure-Node `pdfmake`, and merged/bookmarked using `pdf-lib` and `qpdf`.
   * SVG uploads are strictly banned across all endpoints (`image/png`, `image/jpeg`, `image/webp` only for images/logos).
   * All uploaded PDFs are validated and linearised via `qpdf` with hard limits: max $512\text{ MB}$ RAM, max $1,000$ pages, max $25,000$ PDF objects, and stripped of JavaScript/embedded files.
7. **Money, Time, and Identifiers:**
   * All primary keys use time-sortable **UUIDv7** (`uuidv7` package).
   * All monetary values are stored as integer paise in `BIGINT` columns (never `FLOAT` or `NUMERIC`).
   * All timestamps are stored in UTC (`TIMESTAMPTZ`) and displayed in `Asia/Kolkata` (`DD MMM YYYY`). Host clocks must sync to Indian statutory NTP servers (`samay1.nic.in`, `samay2.nic.in`, `time.nplindia.org`).
8. **Optimistic Concurrency & Idempotency:**
   * All mutable tables carry `row_version INTEGER NOT NULL DEFAULT 1`. `PATCH`/`PUT` and decision endpoints require `If-Match: "<rowVersion>"` and return `412 Precondition Failed` on mismatch.
   * All state-changing `POST` endpoints require `Idempotency-Key: <uuid>` scoped to `(org_id, endpoint, key)`.
9. **Transactional Outbox Pattern (`D-005`):**
   * Business state mutations, `requirement_revisions`, and `outbox_events` are committed inside a single PostgreSQL transaction. Workers process outbox events idempotently to emit notifications and compute the `audit_events` SHA-256 hash chain.
10. **Gate Before Milestone M3:**
    * Milestones M0, M1, and M2 have zero external dependencies and must be implemented first. Milestone M3's default checklist seeder (`TPL-HVAC-IN-001`) must load from a versioned JSON file so it can be updated once the 5 live MEP consultant checklists are validated.

---

## 1. MONOREPO STRUCTURE & INFRASTRUCTURE SCAFFOLDING

### 1.1 Directory Layout (Turborepo + pnpm Workspaces)

Create the repository with the following exact structure:

```text
tradecloseout/
├── apps/
│   ├── api/                          # NestJS Modular Monolith (HTTP API + BullMQ Workers)
│   │   ├── src/
│   │   │   ├── common/               # Guards, interceptors, RFC9457 filter, crypto, UUIDv7, time
│   │   │   ├── config/               # Zod-validated environment configuration
│   │   │   ├── database/             # Drizzle client, RLS transaction wrapper, migrations, seeds
│   │   │   ├── modules/
│   │   │   │   ├── auth/             # OTP, Magic Link, TOTP MFA, Sessions, Switch-Org (API-001..009B)
│   │   │   │   ├── orgs/             # Org CRUD, Branding, Memberships, Invitations, Reassign (API-010..019)
│   │   │   │   ├── parties/          # Parties, Contacts, Guest Grants, Supplier Links (API-020..028B)
│   │   │   │   ├── projects/         # Projects, Contracts, Variations, Spec Refs (API-030..044, 184..186)
│   │   │   │   ├── customisation/    # L0-L4 Config Resolver, Templates, Client Profiles (API-050..055)
│   │   │   │   ├── checklists/       # Snapshots, Requirements, Waivers, Change Requests (API-056..066)
│   │   │   │   ├── assets/           # Assets, Categories, CSV Import/Export, Matrix (API-070..076)
│   │   │   │   ├── documents/        # Upload Intents, S3 Multipart, ClamAV, Bulk Import (API-080..097)
│   │   │   │   ├── reviews/          # In-App Reviews, External Approvals, Overrides (API-100..107)
│   │   │   │   ├── packages/         # Readiness, Preview, PDF/ZIP Builder, Submissions (API-110..118B)
│   │   │   │   ├── warranty-defects/ # Warranty Events & DLP Snag/Defect Tracker (API-180..183)
│   │   │   │   ├── notifications/    # In-App, SES Email, DLT SMS, WhatsApp Links, Digest (API-120..123)
│   │   │   │   ├── audit/            # Outbox Dispatcher, Hash-Chain Worker, DSR, Exports (API-140..144)
│   │   │   │   ├── billing/          # Plans, Subscriptions, Rule 46 GST Invoices, 194J TDS (API-124, 150..160)
│   │   │   │   └── admin/            # Platform Admin Break-Glass & Job Management (API-170..172)
│   │   │   ├── worker.main.ts        # Dedicated BullMQ worker entrypoint
│   │   │   └── main.ts               # HTTP API entrypoint
│   │   └── test/                     # Integration, RLS, Concurrency, and Contract test suites
│   └── web/                          # Next.js 15 (App Router) PWA Frontend
│       ├── src/
│       │   ├── app/                  # Routes mapped 1:1 to SCR-001..SCR-059
│       │   ├── components/           # Mobile Upload Sheet, PDF.js Sandbox Viewer, Checklist Table
│       │   ├── lib/                  # Generated OpenAPI client, IndexedDB upload queue, CSRF handler
│       │   └── styles/
├── packages/
│   ├── shared/                       # Shared Zod schemas, Status enums, Permission matrix, Types
│   └── pdf-engine/                   # Pure-Node pdfmake + pdf-lib + qpdf wrapper & bomb-check utilities
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # Local & Single-VM stack (PG16, Redis 7, MinIO, ClamAV)
│   │   └── postgres-init.sql         # Creates tc_migrator and tc_app (NOBYPASSRLS) roles
│   └── terraform/                    # AWS ap-south-1 (Mumbai) VPC, RDS, S3, EC2/ALB definitions
├── scripts/
│   └── verify-traceability.ts        # Mandatory CI gate parsing FR-* to TC-* coverage
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### 1.2 Local & Single-VM Infrastructure (`infra/docker/postgres-init.sql` & `docker-compose.yml`)

Create `infra/docker/postgres-init.sql` first so that local development and CI immediately enforce role separation (`RT-005`):

```sql
-- infra/docker/postgres-init.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Migration role (owns tables, runs DDL only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_Roles WHERE rolname = 'tc_migrator') THEN
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

GRANT CONNECT ON DATABASE tradecloseout TO tc_migrator, tc_app;
GRANT CREATE, USAGE ON SCHEMA public TO tc_migrator;
GRANT USAGE ON SCHEMA public TO tc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tc_app;
```

Create `infra/docker/docker-compose.yml`:

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_root_pw
      POSTGRES_DB: tradecloseout
      TZ: Asia/Kolkata
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres-init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tc_app -d tradecloseout"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio_admin
      MINIO_ROOT_PASSWORD: minio_local_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data

  clamav:
    image: clamav/clamav:1.3
    ports:
      - "3310:3310"
    volumes:
      - clamavdata:/var/lib/clamav

volumes:
  pgdata:
  redisdata:
  miniodata:
  clamavdata:
```

---

## 2. PRE-M0 TECHNICAL SPIKES (RUN BEFORE MILESTONE M0)

Execute and pass these two verification spikes before starting feature work:

### 2.1 Spike 1: Drizzle ORM + Forced RLS Transaction Context Wrapper

Implement `apps/api/src/database/tenant-db.service.ts`. Every tenant-scoped database operation in HTTP controllers and BullMQ workers **must** run inside `withTenantContext`:

```typescript
// apps/api/src/database/tenant-db.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export interface ExecutionContext {
  orgId: string;
  userId: string;
  actorType: 'USER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  requestId: string;
}

@Injectable()
export class TenantDbService {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async withTenantContext<T>(
    ctx: ExecutionContext,
    fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    if (!ctx.orgId) {
      throw new ForbiddenException('Missing active organisation context for tenant transaction');
    }
    return this.db.transaction(async (tx) => {
      // Transaction-local settings cleared automatically on COMMIT/ROLLBACK
      await tx.execute(sql`SELECT set_config('app.current_org', ${ctx.orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user', ${ctx.userId}, true)`);
      await tx.execute(sql`SELECT set_config('app.actor_type', ${ctx.actorType}, true)`);
      return fn(tx);
    });
  }
}
```

**Spike 1 Acceptance Test:** Connect via `tc_app`, insert a row in Org A, then query `SELECT * FROM projects` outside `withTenantContext`. Assert that $0$ rows are returned (fail-closed RLS).

### 2.2 Spike 2: Pure-Node PDF Generation & `qpdf` Bomb/Sanitisation Pipeline

In `packages/pdf-engine/src/sanitise-pdf.ts`, implement the `qpdf` pre-check and active-content stripper (`RT-006`, `RT-034`):

```typescript
// packages/pdf-engine/src/sanitise-pdf.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PdfInspectionResult {
  pageCount: number;
  objectCount: number;
  isEncrypted: boolean;
}

export async function inspectAndSanitisePdf(
  inputPath: string,
  outputPath: string,
): Promise<PdfInspectionResult> {
  // 1. Check encryption & basic structure with strict memory/time limits
  const { stdout: jsonOut } = await execFileAsync(
    'qpdf',
    ['--json', '--json-key=pages', '--json-key=encrypt', '--json-key=objects', inputPath],
    { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
  );

  const parsed = JSON.parse(jsonOut);
  if (parsed.encrypt) {
    throw new Error('FILE_ENCRYPTED_REJECTED');
  }

  const pageCount = Array.isArray(parsed.pages) ? parsed.pages.length : 0;
  const objectCount = parsed.objects ? Object.keys(parsed.objects).length : 0;

  if (pageCount < 1 || pageCount > 1000) {
    throw new Error(`PDF_PAGE_LIMIT_EXCEEDED: ${pageCount}`);
  }
  if (objectCount > 25000) {
    throw new Error(`PDF_BOMB_OBJECT_LIMIT_EXCEEDED: ${objectCount}`);
  }

  // 2. Flatten annotations, linearise, and strip document-level JavaScript/actions
  await execFileAsync(
    'qpdf',
    [
      '--empty',
      '--pages',
      inputPath,
      '1-z',
      '--',
      '--flatten-annotations=all',
      '--linearize',
      outputPath,
    ],
    { timeout: 60_000 },
  );

  return { pageCount, objectCount, isEncrypted: false };
}
```

---

## 3. MILESTONE M0 — DATABASE SCHEMA, AUTHENTICATION, SESSIONS & AUDIT OUTBOX

### 3.1 Authoritative PostgreSQL 16 DDL Migration (`0001_initial_schema.sql`)

Execute the following complete DDL as role `tc_migrator`. It incorporates every v0.2.1 remediation (`RT-001` through `RT-042`):

```sql
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
```

### 3.2 Authentication, Sessions, Pre-Onboarding & Org Switcher (`apps/api/src/modules/auth`)

Implement the authentication and session lifecycle with these exact rules:

1. **OTP Generation & SMS/Email Fallback (`API-001 POST /auth/otp/request`, `FR-INT-012`):**
   * Generate a 6-digit OTP via `crypto.randomInt(100000, 999999)`.
   * Store `sha256(otp + server_pepper)` in `otp_challenges` with `expires_at = now() + 5 minutes`.
   * If `identifier` is an E.164 Indian mobile (`+91[6-9]\d{9}`), send via DLT SMS provider adapter. Track delivery attempts; if SMS fails twice (`EC-TECH-26`), automatically trigger an email magic link if the user has a verified email identity, and return `{ fallbackChannel: 'EMAIL' }`.
2. **OTP Verification & Nullable `active_org_id` (`API-002 POST /auth/otp/verify`, `RT-002`):**
   * Verify `code_hash` in constant time (`crypto.timingSafeEqual`). Increment `attempts` on failure; lock challenge after 5 failures and log `AUTH_OTP_FAILED` in `security_events`.
   * Upsert `users` and `user_identities`.
   * Query active `memberships` for `user_id`:
     * If $0$ memberships exist (new visitor in `WF-01`), create a `sessions` row with `active_org_id = NULL`.
     * If $\ge 1$ memberships exist, set `active_org_id` to the most recently used org (or first active membership).
   * Generate a 32-byte CSPRNG session token (`base64url`) and a 32-byte CSRF token. Store `sha256(sessionToken)` in `sessions.token_hash`.
   * Set cookie `tc_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`) and return `csrfToken` in the JSON body.
3. **Multi-Org Listing & Switching (`API-009A` & `API-009B`, `RT-002`):**
   * `GET /api/v1/auth/orgs` (`API-009A`): Queries `memberships` (`WHERE user_id = $1 AND status = 'ACTIVE'`) without tenant RLS, returning `[{ orgId, displayName, role }]`.
   * `POST /api/v1/auth/switch-org` (`API-009B`): Validates that `user_id` holds an `ACTIVE` membership in `body.orgId`. If `role IN ('R-OWNER','R-ADMIN')` and `user.mfa_enabled_at IS NOT NULL`, verifies `session.mfa_verified = true` (per DPDP Rules 2025 Rule 6). Updates `sessions.active_org_id = body.orgId`, rotates `csrf_token_hash`, logs `ORG_SWITCHED` in `security_events`, and returns `200 OK`.

---

## 4. MILESTONE M1 — POSITIVE-ONLY RBAC GUARD, FIELD PROJECTION & GUEST GRANTS

### 4.1 Positive-Only Additive Permission Guard (`apps/api/src/common/guards/permission.guard.ts`)

Implement the exact mathematical model from `05` §3.2 and `RT-004`:

```typescript
// packages/shared/src/permissions.ts
export const ORG_ROLE_PERMISSIONS: Record<string, Record<string, 'Y' | 'A' | 'S'>> = {
  'R-OWNER': {
    'org.read': 'Y', 'org.manage': 'Y', 'org.manage_members': 'Y', 'org.transfer_ownership': 'Y',
    'org.delete': 'Y', 'billing.read': 'Y', 'billing.manage': 'Y', 'party.read': 'Y', 'party.manage': 'Y',
    'template.read': 'Y', 'template.manage': 'Y', 'project.create': 'Y', 'project.read': 'A',
    'project.manage': 'A', 'project.close': 'Y', 'contract.manage': 'Y', 'checklist.manage': 'Y',
    'asset.read': 'A', 'asset.manage': 'Y', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'A', 'document.metadata_edit': 'A', 'document.delete': 'A',
    'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A', 'review.decide': 'A',
    'review.record_external': 'Y', 'requirement.waive': 'Y', 'requirement.waive_second': 'Y',
    'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y', 'package.accept': 'Y',
    'warranty.manage': 'Y', 'defect.manage': 'Y', 'notification.manage': 'Y', 'audit.read': 'Y',
    'export.data': 'Y',
  },
  'R-ADMIN': {
    'org.read': 'Y', 'org.manage': 'Y', 'org.manage_members': 'Y', 'billing.read': 'Y',
    'party.read': 'Y', 'party.manage': 'Y', 'template.read': 'Y', 'template.manage': 'Y',
    'project.create': 'Y', 'project.read': 'A', 'project.manage': 'A', 'project.close': 'Y',
    'contract.manage': 'Y', 'checklist.manage': 'Y', 'asset.read': 'A', 'asset.manage': 'Y',
    'document.read': 'A', 'document.upload': 'A', 'document.download': 'A', 'document.metadata_edit': 'A',
    'document.delete': 'A', 'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A',
    'review.decide': 'A', 'review.record_external': 'Y', 'requirement.waive': 'Y',
    'requirement.waive_second': 'Y', 'package.generate': 'Y', 'package.download': 'Y',
    'package.submit': 'Y', 'package.accept': 'Y', 'warranty.manage': 'Y', 'defect.manage': 'Y',
    'notification.manage': 'Y', 'audit.read': 'Y', 'export.data': 'Y',
  },
  'R-PM': {
    'org.read': 'Y', 'party.read': 'Y', 'party.manage': 'Y', 'template.read': 'Y',
    'project.create': 'Y', 'project.read': 'A', 'project.manage': 'A', 'project.close': 'Y',
    'contract.manage': 'Y', 'checklist.manage': 'Y', 'asset.read': 'A', 'asset.manage': 'Y',
    'document.read': 'A', 'document.upload': 'A', 'document.download': 'A', 'document.metadata_edit': 'A',
    'document.delete': 'A', 'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A',
    'review.decide': 'S', // Scoped to requirements where reviewer_role matches (AUD-005)
    'review.record_external': 'Y', 'requirement.waive': 'Y', 'package.generate': 'Y',
    'package.download': 'Y', 'package.submit': 'Y', 'package.accept': 'Y',
    'warranty.manage': 'Y', 'defect.manage': 'Y', 'notification.manage': 'Y', 'audit.read': 'Y',
  },
  'R-SITE': {
    'org.read': 'Y', 'party.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'asset.manage': 'S',
    'document.read': 'S', 'document.upload': 'S', 'document.download': 'S', 'document.metadata_edit': 'S',
    'review.read': 'S', 'review.submit': 'S', 'package.download': 'S', 'defect.manage': 'S',
  },
  'R-DOC': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'A', 'asset.read': 'A',
    'asset.manage': 'Y', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'S', // Widened to 'A' only if org.doc_controller_org_wide_download = true
    'document.metadata_edit': 'A', 'document.delete': 'A', 'document.bulk_import': 'Y',
    'review.read': 'A', 'review.submit': 'A', 'review.record_external': 'Y',
    'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y', 'notification.manage': 'Y',
  },
  'R-PROC': {
    'org.read': 'Y', 'party.read': 'Y', 'party.manage': 'Y', 'project.read': 'S', 'asset.read': 'S',
    'asset.manage': 'S', 'document.read': 'S', 'document.upload': 'S', 'document.download': 'S',
    'document.metadata_edit': 'S', 'review.read': 'S', 'review.submit': 'S', 'warranty.manage': 'S',
  },
  'R-QC': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'S', 'asset.read': 'S',
    'asset.manage': 'S', 'document.read': 'S', 'document.upload': 'S', 'document.download': 'S',
    'document.metadata_edit': 'S', 'review.read': 'S', 'review.submit': 'S', 'review.decide': 'S',
    'defect.manage': 'S',
  },
  'R-SAFETY': {
    'org.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'document.read': 'S',
    'document.upload': 'S', 'document.download': 'S', 'review.read': 'S', 'review.submit': 'S',
  },
  'R-REVIEWER': {
    'org.read': 'Y', 'party.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'document.read': 'S',
    'document.download': 'S', 'review.read': 'S', 'review.decide': 'S', 'package.download': 'Y',
  },
  'R-AUDITOR': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'A', 'asset.read': 'A',
    'document.read': 'A', 'document.download': 'A', 'review.read': 'A', 'package.download': 'Y',
    'audit.read': 'Y',
  },
  'R-BILLING': {
    'org.read': 'Y', 'billing.read': 'Y', 'billing.manage': 'Y',
  },
};
```

### 4.2 Guest Grant Rate Limiting & Cooldown (`API-028`, `API-028A`, `API-028B`, `RT-014`)

1. **`GET /api/v1/guest/:token`:** Looks up `guest_grants` by `token_hash = sha256(token)`. Checks `status = 'ACTIVE'`, `expires_at > now()`, and `cooldown_until IS NULL OR cooldown_until < now()`.
2. **`POST /api/v1/guest/:token/otp/request` (`API-028A`):**
   * Enforces Redis sliding-window rate limit: max **3 requests/hour** and **10 requests/day** per `grant.id`.
   * Sends OTP to `grant.target_phone_e164` (or `grant.target_email`).
3. **`POST /api/v1/guest/:token/otp/verify` (`API-028B`):**
   * On wrong code, increments `guest_grants.failed_otp_count`. When `failed_otp_count >= 5`, sets `cooldown_until = now() + interval '15 minutes'` and resets `failed_otp_count = 0` after cooldown (preventing permanent link destruction from typos).
   * On success, creates a guest `sessions` row with `active_org_id = grant.org_id` and `guest_grant_id = grant.id`.

---

## 5. MILESTONE M2 — PROJECTS, CONTRACTS, VARIATIONS & USAGE LOCKING

1. **Plan Usage Locking (`API-031 POST /projects`, `AUD-A-08`):**
   * Inside `withTenantContext`, execute:
     ```sql
     SELECT value FROM usage_counters
     WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'
     FOR UPDATE;
     ```
   * Compare `value` against `plans.limits_json->>'maxActiveProjects'`. If `value >= maxActiveProjects`, throw `409 PLAN_LIMIT_BLOCKED`.
2. **Project Activation Guard (`API-034 POST /projects/:id/activate`, `FR-PRJ-003`):**
   * Verify `project.status = 'DRAFT'`.
   * Verify an `ACTIVE` (or newly created) `checklist_snapshots` row exists for `project_id`.
   * Verify at least one `project_members` row exists with `role IN ('R-OWNER','R-ADMIN','R-PM')`.
   * Transition `project.status = 'ACTIVE'`, increment `usage_counters.value`, and emit `PROJECT_ACTIVATED`.

---

## 6. MILESTONE M3 — CUSTOMISATION ENGINE, SNAPSHOTS & MANDATORY WAIVERS

### 6.1 Deterministic L0–L4 Configuration Resolver (`apps/api/src/modules/customisation/config-resolver.service.ts`)

Implement the exact resolution algorithm (`07` §4):

```typescript
// apps/api/src/modules/customisation/config-resolver.service.ts
export type OverridePolicy = 'locked' | 'inherit_only' | 'overridable' | 'additive' | 'keyed_merge';

export function resolveConfigHierarchy(
  layers: Array<{ level: 'PLATFORM' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT'; payload: Record<string, any> }>,
  schemaPolicies: Record<string, { policy: OverridePolicy; ownerLevel?: string }>,
) {
  const result: Record<string, any> = {};
  const provenance: Record<string, string> = {};
  const conflicts: Array<{ path: string; level: string; reason: string }> = [];

  for (const layer of layers) {
    for (const [path, val] of Object.entries(layer.payload)) {
      const rule = schemaPolicies[path] ?? { policy: 'overridable' };

      if (rule.policy === 'locked' && provenance[path] !== undefined) {
        if (JSON.stringify(result[path]) !== JSON.stringify(val)) {
          conflicts.push({ path, level: layer.level, reason: 'LOCKED_FIELD_OVERRIDE_ATTEMPT' });
        }
        continue;
      }
      if (rule.policy === 'inherit_only' && rule.ownerLevel && layer.level !== rule.ownerLevel) {
        continue;
      }
      if (rule.policy === 'additive') {
        const existing = Array.isArray(result[path]) ? result[path] : [];
        result[path] = Array.from(new Set([...existing, ...(Array.isArray(val) ? val : [])]));
      } else if (rule.policy === 'keyed_merge') {
        const existingArr: Array<Record<string, any>> = Array.isArray(result[path]) ? [...result[path]] : [];
        const byKey = new Map(existingArr.map((item) => [item.key, item]));
        for (const incoming of Array.isArray(val) ? val : []) {
          if (incoming.$remove === true) {
            byKey.delete(incoming.key);
          } else {
            const prev = byKey.get(incoming.key) ?? {};
            byKey.set(incoming.key, { ...prev, ...incoming });
          }
        }
        result[path] = Array.from(byKey.values());
      } else {
        if (val && typeof val === 'object' && val.$clear === true) {
          result[path] = null;
        } else if (val !== undefined && val !== null) {
          result[path] = val;
        }
      }
      provenance[path] = layer.level;
    }
  }
  return { payload: result, provenance, conflicts };
}
```

### 6.2 Snapshot Instantiation & Per-Asset Expansion (`API-056`, `WF-06`, `RT-003`)

When `POST /api/v1/projects/:id/checklist/snapshots` is called:
1. Run `resolveConfigHierarchy` across `PLATFORM` $\rightarrow$ `ORG` (which holds the installed copy of `TPL-HVAC-IN-001`) $\rightarrow$ `CLIENT_CONTRACT` $\rightarrow$ `PROJECT` (including any approved `variations` overrides).
2. Compute canonical JSON SHA-256 `checksum` and insert `checklist_snapshots`.
3. For each requirement item in `resolved_payload_json.requirements`:
   * If `item.scope === 'P'` or `item.scope === 'C'`:
     * Upsert `requirements` with `scope_key = 'project'` and `asset_id = NULL`.
   * If `item.scope === 'A'` or `item.scope === 'AC'`:
     * Query all active `assets` on `project_id` matching `item.assetCategoryKey`.
     * For each matching `asset`, upsert `requirements` with `scope_key = 'asset:' || asset.id` and `asset_id = asset.id` (`RT-003`).

### 6.3 Dual-Approver Mandatory Waivers (`API-061` & `API-061A`, `RT-023`)

* `POST /api/v1/requirements/:id/waivers` (`API-061`):
  * If `requirement.mandatory = false`: creates `waivers` with `status = 'ACTIVE'` and transitions `requirement.status = 'WAIVED'` (or `'NOT_APPLICABLE'`).
  * If `requirement.mandatory = true`: creates `waivers` with `status = 'PENDING_SECOND_APPROVAL'`, transitions `requirement.status = 'PENDING_WAIVER'`, and notifies Org Owners/Admins.
* `POST /api/v1/waivers/:id/countersign` (`API-061A`):
  * Requires permission `requirement.waive_second` (`R-OWNER` or `R-ADMIN`) and `user.id <> waiver.approved_by`.
  * Sets `waiver.second_approved_by = user.id`, `waiver.second_approved_at = now()`, `waiver.status = 'ACTIVE'`, and transitions `requirement.status = 'WAIVED'`.

---

## 7. MILESTONE M4 — EQUIPMENT/ASSET REGISTER & DYNAMIC INSTANTIATION

1. **Asset Creation & Dynamic Requirement Expansion (`API-071` & `API-074`, `WF-07`):**
   * When a new asset is created (`POST /projects/:id/assets`) or imported via CSV (`POST /projects/:id/assets/import`) on an `ACTIVE` project:
     * Insert the `assets` row.
     * Read the active `checklist_snapshots.resolved_payload_json` for the project.
     * Filter all requirement definitions where `scope IN ('A','AC')` and `assetCategoryKey == asset.category_key`.
     * Instantiate the corresponding `requirements` rows with `scope_key = 'asset:' || asset.id` and `asset_id = asset.id` in the same transaction.
2. **Asset Replacement (`FR-AST-006`, `FR-AST-011`):**
   * When an asset is replaced by a successor asset: set `oldAsset.status = 'REPLACED'` and `oldAsset.replaced_by_asset_id = newAsset.id`. Existing documents stay linked to `oldAsset`; new requirements are instantiated for `newAsset`.

---

## 8. MILESTONE M5 — DOCUMENT PIPELINE, RESUMABLE MULTIPART & BULK ZIP IMPORT

### 8.1 Direct-to-S3 Multipart Upload & URL Refresh (`API-082`, `API-082A`, `API-083`, `RT-012`)

1. **Upload Intent (`POST /projects/:id/documents/upload-intents` — `API-082`):**
   * Validate MIME type against allow-list (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `image/vnd.dwg`, `application/zip`). **Reject `image/svg+xml`, `.exe`, `.docm`, `.xlsm` immediately with `400 UNSUPPORTED_FILE_TYPE`.**
   * If `sizeBytes > 10 * 1024 * 1024`, initiate S3 Multipart Upload (`CreateMultipartUpload`), store `s3_upload_id` in `storage_objects`, and return presigned part URLs (`partSizeBytes = 10485760`, TTL 15 minutes).
2. **Refresh Multipart URLs (`POST /document-versions/:id/refresh-upload-urls` — `API-082A`, `RT-012`):**
   * Calls S3 `ListParts` using `storage_objects.s3_upload_id`, returns uploaded part numbers/ETags, and generates fresh 15-minute presigned URLs for remaining parts.
3. **Complete Upload & Worker Verification (`POST /document-versions/:id/complete` — `API-083`, `WF-11`):**
   * Completes S3 multipart upload, sets `file_status = 'PROCESSING'`, and enqueues BullMQ job `file.process`.
   * Worker `file.process` executes:
     1. Streams object from S3, computes SHA-256, and sniffs first 4,096 bytes with `file-type` (magic-byte check).
     2. Streams bytes to ClamAV daemon (`clamd` TCP port 3310 `INSTREAM`). If infected $\rightarrow$ set `file_status = 'QUARANTINED'`, emit `FILE_QUARANTINED` security event.
     3. If PDF $\rightarrow$ run `inspectAndSanitisePdf` (`qpdf` check: max 1,000 pages, max 25,000 objects, not encrypted, strip JS).
     4. If Image (`JPEG`/`PNG`/`WebP`) $\rightarrow$ re-encode via `sharp().rotate()` (strips EXIF GPS coordinates while preserving orientation, `AUD-S-09`).
     5. If `version.expiry_date < CURRENT_DATE` $\rightarrow$ set `checks_json.expired_on_upload = true` (`RT-009`).
     6. Set `file_status = 'READY'` and transition linked `requirements.status = 'UPLOADED'` (if currently `NOT_STARTED` or `REQUESTED`).

### 8.2 Bulk Document Import (`API-095`–`097`, `SCR-055`, `RT-001`)

1. **`POST /api/v1/projects/:id/documents/bulk-import-intents` (`API-095`):**
   * Creates a `bulk_import_jobs` row (`status = 'UPLOADED'`) and returns presigned S3 upload URLs for the ZIP archive (up to $500\text{ MB}$) and optional mapping CSV/XLSX.
2. **`POST /api/v1/bulk-imports/:id/dry-run` (`API-096`):**
   * Worker streams the ZIP central directory (checking compression ratio $\le 100:1$ and max $500$ files to block zip bombs) and parses the mapping sheet (`filename, revision_code, issue_date, asset_tag, requirement_key`).
   * Matches each row against the project's `assets.tag` and `requirements.requirement_key`.
   * Saves per-file validation outcomes (`MATCHED`, `UNMAPPED_REQUIREMENT`, `UNKNOWN_ASSET_TAG`, `DUPLICATE_HASH`, `INVALID_EXTENSION`) in `dry_run_report_json` and sets `status = 'DRY_RUN_READY'`.
3. **`POST /api/v1/bulk-imports/:id/commit` (`API-097`):**
   * Extracts all `MATCHED` files from the ZIP to project storage keys, creates `documents` and `document_versions` rows, and enqueues `file.process` for each.

---

## 9. MILESTONE M6 — REVIEWS, ATOMIC APPROVAL LOCKING & EXTERNAL APPROVALS

### 9.1 Submit for Review (`API-062 POST /requirements/:id/submit-review`)

* Verify `version.file_status === 'READY'`.
* **Expired Certificate Guard (`RT-009`):** If `version.expiry_date !== null && version.expiry_date < currentDate`, reject with **`422 DOCUMENT_ALREADY_EXPIRED`**.
* Verify required metadata fields for `doc_type_key` (including `accreditation_id` and `lab_name` for third-party lab reports `DT-025`, `DT-054`, `DT-055`).
* Set `version.review_status = 'IN_REVIEW'`, `requirement.status = 'IN_REVIEW'`, and create a `reviews` row (`status = 'IN_REVIEW'`).

### 9.2 Atomic Approval Transaction (`API-102 POST /reviews/:id/decisions`, `AUD-007`)

Execute inside `withTenantContext`:

```typescript
// apps/api/src/modules/reviews/reviews.service.ts
export async function decideReview(tx: DbTransaction, ctx: ExecutionContext, reviewId: string, dto: DecisionDto) {
  const review = await tx.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!review || review.status !== 'IN_REVIEW') {
    throw new ConflictException('INVALID_STATE_TRANSITION');
  }

  // 1. Acquire row-level lock on parent document to prevent concurrent version approval race (AUD-007)
  const [doc] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, review.documentId)))
    .for('update');

  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, review.documentVersionId))
    .for('update');

  // 2. Ensure this version is the most recently submitted version
  if (doc.latestVersionId !== version.id || version.reviewStatus !== 'IN_REVIEW') {
    throw new ConflictException('INVALID_STATE_TRANSITION: Superseded by a newer submission');
  }

  // 3. Enforce self-approval prohibition (FR-REV-009)
  if (version.uploadedBy === ctx.userId && !dto.isOverride) {
    throw new ForbiddenException('SELF_APPROVAL_DENIED');
  }

  if (dto.decision === 'APPROVE') {
    // Supersede previous approved version if one exists
    if (doc.currentApprovedVersionId && doc.currentApprovedVersionId !== version.id) {
      await tx
        .update(documentVersions)
        .set({ reviewStatus: 'SUPERSEDED', supersededAt: new Date() })
        .where(eq(documentVersions.id, doc.currentApprovedVersionId));
    }

    await tx
      .update(documentVersions)
      .set({ reviewStatus: 'APPROVED', rowVersion: sql`${documentVersions.rowVersion} + 1` })
      .where(eq(documentVersions.id, version.id));

    await tx
      .update(documents)
      .set({ currentApprovedVersionId: version.id, rowVersion: sql`${documents.rowVersion} + 1` })
      .where(eq(documents.id, doc.id));

    // Satisfy linked requirements
    await tx
      .update(requirements)
      .set({ status: 'APPROVED', updatedAt: new Date(), rowVersion: sql`${requirements.rowVersion} + 1` })
      .where(
        inArray(
          requirements.id,
          tx.select({ id: documentRequirements.requirementId })
            .from(documentRequirements)
            .where(eq(documentRequirements.documentId, doc.id)),
        ),
      );
  } else {
    const nextStatus = dto.decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
    await tx.update(documentVersions).set({ reviewStatus: nextStatus }).where(eq(documentVersions.id, version.id));
    await tx
      .update(requirements)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(
        inArray(
          requirements.id,
          tx.select({ id: documentRequirements.requirementId })
            .from(documentRequirements)
            .where(eq(documentRequirements.documentId, doc.id)),
        ),
      );
  }
}
```

### 9.3 First-Class External Approval Recording (`API-106 POST /document-versions/:id/external-approval`, `WF-23`, `RT-022`)

* Accepts `{ decision: 'APPROVE', externalMethod: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL', externalApproverName, externalReference, decidedAt, evidenceObjectId }`.
* Works whether the version is currently `NOT_SUBMITTED` or `IN_REVIEW` (`RT-022`).
* Acquires `FOR UPDATE` lock on `documents`, inserts a `reviews` row with `method = 'EXTERNAL'` and `status = 'APPROVED'`, updates `documents.current_approved_version_id`, and transitions the requirement to `APPROVED`.

---

## 10. MILESTONE M7 — PURE-NODE HANDOVER PACKAGE BUILDER & MULTI-RECIPIENT SUBMISSIONS

### 10.1 Handover Package Compilation (`packages/pdf-engine/src/package-builder.ts`)

When `POST /api/v1/projects/:id/packages` (`API-110`) is queued:
1. **Snapshot Freeze (`AUD-008`):** Copy all in-scope `requirements` into `package_requirements` and all `current_approved_version_id`s into `package_items` along with `checklist_snapshots.checksum`.
2. **Pre-Flight Storage Check (`AUD-S-12`):** Execute S3 `HeadObject` on every `package_items.document_version_id` and compare size/SHA-256.
3. **Pure-Node Cover, Signature Block, Index & Asset Register (`RT-006`, `RT-025`):**
   * Use `pdfmake` (server-side Node pdfmake with embedded Noto Sans fonts for English/Hindi/₹ rendering) to generate the front-matter PDF. Because `pdfmake` builds a PDF AST directly without an HTML parser or Chromium browser, HTML/XSS/SSRF injection is structurally impossible.
4. **PDF Merging, Page Numbering & Bookmarks:**
   * Use `pdf-lib` and `qpdf` to merge the generated front-matter PDF with each `package_items` PDF in `sort_order`, recording exact `page_start` and `page_end` back into `package_items` and creating top-level PDF outline bookmarks per section and document.
5. **ZIP & Manifest:**
   * Stream all individual files plus `manifest.json` and `manifest.csv` (containing SHA-256 checksums for every file) into a ZIP archive via `archiver`, upload both the merged PDF and ZIP to S3, and transition `handover_packages.status = 'READY'`.

### 10.2 Multi-Recipient Submission Aggregation (`API-117 POST /submissions/:id/recipients/:recipientId/decision`, `RT-007`)

When a recipient records a decision (`ACCEPT`, `ACCEPT_WITH_EXCEPTIONS`, or `REJECT`):
1. Update `submission_recipients` for `recipientId`.
2. If `decision === 'ACCEPT_WITH_EXCEPTIONS'`, automatically create a `DRAFT` `requirement_change_requests` row populated with the exception remarks (`AUD-P-16`).
3. Re-evaluate all `submission_recipients` where `is_required_approver = true`:
   * If $\ge 1$ required recipient has `status = 'REJECTED'` $\rightarrow$ set `submissions.status = 'REJECTED'` and `handover_packages.status = 'REJECTED'`.
   * Else if **all** required recipients have `status IN ('ACCEPTED','ACCEPTED_WITH_EXCEPTIONS')` $\rightarrow$ set `submissions.status = 'ACCEPTED'` and `handover_packages.status = 'ACCEPTED'`.
   * Else if $\ge 1$ required recipient has accepted and others are still `SENT`/`ACKNOWLEDGED` $\rightarrow$ set `submissions.status = 'PARTIALLY_ACCEPTED'`.

---

## 11. MILESTONE M8 & M9 — NOTIFICATIONS, OWNER DIGEST, RAZORPAY & TDS

1. **Weekly Owner Digest (`BR-GTM-07`, `RT-029`):**
   * Scheduled cron job every Monday at `08:30 Asia/Kolkata`.
   * Queries each active organisation's projects, grouping missing mandatory requirements by `milestone_key` (`DELIVERY`, `INSTALLATION`, `COMMISSIONING`, `HANDOVER`, `FINAL_BILL`, `DLP_END`) and computing the associated contract/retention rupee amount at risk.
   * Emails a 1-page summary PDF to `R-OWNER`.
2. **Rule 46 GST Invoicing & Section 194J TDS (`FR-BIL-005`, `FR-BIL-011`, `RT-015`, `RT-030`):**
   * Razorpay webhook (`API-160 POST /webhooks/razorpay`) verifies `X-Razorpay-Signature` HMAC-SHA256 and processes idempotently via `payment_events.event_id`.
   * Generates sequential GST tax invoices (`SAC 998315`, 18% GST: 9% CGST + 9% SGST intra-state or 18% IGST inter-state) with the Rule 48(4) $< ₹5\text{ Crore}$ e-invoicing exemption declaration.
   * Allows customers/admins to record Section 194J TDS deductions (`2%` or `10%`) at payment time with `status = 'PENDING_CERTIFICATE'` and upload the quarterly **Form 16A** PDF later to transition to `RECONCILED`.

---

## 12. MILESTONE M10 — NEXT.JS PWA FRONTEND & CI TRACEABILITY GATE

### 12.1 Mobile-First Upload Sheet & Draft Persistence (`SCR-023`, `11` §4.8)

In `apps/web/src/components/upload-sheet.tsx`:
* Store selected `File` handles and partially entered metadata (`revisionCode`, `issueDate`, `remarks`) in **IndexedDB** (`idb-keyval`) keyed by `(projectId, requirementId)`.
* If 4G connectivity drops mid-upload, poll `navigator.onLine`; upon reconnection, call `POST /api/v1/document-versions/:id/refresh-upload-urls` (`API-082A`) and resume uploading only the remaining $10\text{ MB}$ chunks.

### 12.2 Mandatory CI Requirement-to-Test Traceability Script (`scripts/verify-traceability.ts`, `AUD-T-02`)

Add the following script to CI (`pnpm run verify:traceability`) so that no PR can merge if any `FR-*` or `NFR-*` requirement in `03-PRODUCT-REQUIREMENTS.md` lacks an automated test:

```typescript
// scripts/verify-traceability.ts
import fs from 'node:fs';
import path from 'node:path';
import glob from 'fast-glob';

const specContent = fs.readFileSync(
  path.resolve(__dirname, '../03-PRODUCT-REQUIREMENTS.md'),
  'utf8',
);

// Extract all FR-* and NFR-* IDs defined in 03-PRODUCT-REQUIREMENTS.md
const definedIds = new Set<string>();
const idRegex = /\b((?:N?FR)-[A-Z]+-\d{3})\b/g;
let match: RegExpExecArray | null;
while ((match = idRegex.exec(specContent)) !== null) {
  definedIds.add(match[1]);
}

// Scan all test files for @traces('FR-...') annotations
const testFiles = glob.sync(['apps/api/test/**/*.spec.ts', 'apps/web/e2e/**/*.spec.ts']);
const coveredIds = new Set<string>();

for (const file of testFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let testMatch: RegExpExecArray | null;
  while ((testMatch = idRegex.exec(content)) !== null) {
    coveredIds.add(testMatch[1]);
  }
}

const missing = [...definedIds].filter((id) => !coveredIds.has(id));
if (missing.length > 0) {
  console.error(`[FAIL] ${missing.length} requirements have no mapped test:`, missing);
  process.exit(1);
}
console.log(`[PASS] All ${definedIds.size} requirements are covered by automated tests.`);
```

---

## 13. STEP-BY-STEP EXECUTION CHECKLIST FOR THE CODING AGENT

Execute implementation in this strict order, running the verification suite at the end of each step:

1. **Step 1 (M0 — Infra & Schema):** Initialize Turborepo, start `docker-compose.yml`, run `0001_initial_schema.sql` as `tc_migrator`, and run `test/rls-isolation.spec.ts` as `tc_app` to prove `FORCE ROW LEVEL SECURITY` blocks un-scoped queries across all 42 tenant tables.
2. **Step 2 (M0 — Auth & Sessions):** Implement `auth` module (`API-001`–`009B`), OTP challenge hashing, pre-onboarding nullable `active_org_id`, TOTP MFA for Owner/Admin, and CSRF middleware.
3. **Step 3 (M1 — Orgs, RBAC & Guests):** Implement `orgs` and `parties` modules (`API-010`–`028B`), the positive-only `PermissionGuard`, the field-level visibility interceptor (`05` §6.4), and guest OTP cooldowns.Generate and run the $36 \times 11$ automated RBAC matrix test suite.
4. **Step 4 (M2 — Projects & Contracts):** Implement `projects`, `contracts`, `variations`, and `specification_refs` (`API-030`–`044`, `API-184`–`186`) with `usage_counters` `FOR UPDATE` locking and `If-Match` optimistic concurrency.
5. **Step 5 (M3 & M4 — Config, Checklists & Assets):** Implement the L0–L4 config resolver, `TPL-HVAC-IN-001` JSON seeder (98 document types + `milestone_key`), immutable `checklist_snapshots`, `assets` CRUD/CSV import (`API-070`–`076`), per-asset requirement instantiation, and dual-approver mandatory waivers (`API-061` & `API-061A`).
6. **Step 6 (M5 — Document Pipeline & Bulk Import):** Implement S3 multipart upload intents (`API-082`), URL refresh (`API-082A`), the BullMQ `file.process` worker (magic-byte sniff + ClamAV + `qpdf` bomb check + `sharp` EXIF strip), and the 3-step Bulk ZIP Import (`API-095`–`097`).
7. **Step 7 (M6 — Reviews, External Approvals & DLP):** Implement `decideReview` with `SELECT ... FOR UPDATE` document locking, `API-106` external approval recording, `warranty_events` (`API-180`–`181`), and `defects` (`API-182`–`183`).
8. **Step 8 (M7 — Handover Packages & Submissions):** Implement the pure-Node `pdfmake` + `pdf-lib` + `qpdf` package generator (`API-110`–`118B`) and multi-recipient submission decision aggregation (`API-115`–`117`).
9. **Step 9 (M8 & M9 — Notifications, Digest & Billing):** Implement IST quiet-hour notifications, Rupee-at-risk Owner Digest, Rule 46 GST invoices (`SAC 998315`), Razorpay webhook handler, and Section 194J TDS tracking.
10. **Step 10 (M10 — Next.js PWA & Full E2E Suite):** Build screens `SCR-001`–`SCR-059`, wire IndexedDB upload persistence, run Playwright mobile E2E tests for all 11 scenarios (`S-1`–`S-11`), and pass `scripts/verify-traceability.ts`.