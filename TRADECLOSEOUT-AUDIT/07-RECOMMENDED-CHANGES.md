# DELIVERABLE 8 — `TRADECLOSEOUT-AUDIT/07-RECOMMENDED-CHANGES.md`
<a id="deliverable-8--07-recommended-changesmd"></a>

This deliverable provides the **exact, copy-pasteable specification and SQL patches** required to fix all blocking and high-severity defects in the original v0.2 specification files.

---

## Patch 1 — `08-DATA-MODEL-AND-ERD.md` (Fixes `RT-002`, `RT-003`, `RT-005`, `RT-007`, `RT-008`, `RT-011`, `RT-014`, `RT-030`, `RT-032`)

### 1.1 Replace §5.1 & §5.2 (Valid Composite Keys + Forced RLS + Non-Owner Role)

```sql
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Role separation so RLS is never bypassed at runtime (RT-005)
-- Run migrations as `tc_migrator` (table owner); run API/Workers as `tc_app`:
-- CREATE ROLE tc_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 2. Parent composite unique keys (RT-003 fixed: no self-FKs, no non-existent columns)
ALTER TABLE projects          ADD CONSTRAINT projects_org_id_id_uq          UNIQUE (org_id, id);
ALTER TABLE contracts         ADD CONSTRAINT contracts_org_proj_id_uq       UNIQUE (org_id, project_id, id);
ALTER TABLE checklist_snapshots ADD CONSTRAINT snaps_org_proj_id_uq         UNIQUE (org_id, project_id, id);
ALTER TABLE assets            ADD CONSTRAINT assets_org_proj_id_uq          UNIQUE (org_id, project_id, id);
ALTER TABLE requirements      ADD CONSTRAINT requirements_org_proj_id_uq    UNIQUE (org_id, project_id, id);
ALTER TABLE documents         ADD CONSTRAINT documents_org_proj_id_uq       UNIQUE (org_id, project_id, id);
ALTER TABLE document_versions ADD CONSTRAINT doc_versions_org_proj_id_uq    UNIQUE (org_id, project_id, id);
ALTER TABLE handover_packages ADD CONSTRAINT packages_org_proj_id_uq        UNIQUE (org_id, project_id, id);
ALTER TABLE submissions       ADD CONSTRAINT submissions_org_proj_id_uq     UNIQUE (org_id, project_id, id);

-- 3. Forced Row-Level Security on every tenant table (RT-005)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_tenant_isolation ON documents
  AS PERMISSIVE FOR ALL TO tc_app
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
```

### 1.2 Fix `sessions` (`§3.1` — Fixes `RT-002`)
Make `active_org_id` nullable so a newly verified user can hold a pre-onboarding session before calling `POST /orgs`:
```sql
CREATE TABLE sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL UNIQUE,
  active_org_id   UUID REFERENCES organisations(id), -- Nullable until first org created/selected
  csrf_token_hash TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  ip              INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.3 Fix `requirements` (`§3.3` & `§5.4` — Fixes `RT-003` & `RT-008`)
Add a true composite FK `asset_id` and `milestone_key`:
```sql
ALTER TABLE requirements
  ADD COLUMN asset_id UUID,
  ADD COLUMN milestone_key TEXT NOT NULL DEFAULT 'HANDOVER'
    CHECK (milestone_key IN (
      'MOBILISATION','SUBMISSION','DELIVERY','INSTALLATION',
      'COMMISSIONING','HANDOVER','FINAL_BILL','DLP_END'
    )),
  ADD CONSTRAINT requirements_asset_same_project_fk
    FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT requirements_scope_key_consistency_chk
    CHECK (
      (asset_id IS NULL AND scope_key = 'project') OR
      (asset_id IS NOT NULL AND scope_key = ('asset:' || asset_id::text))
    );
```

### 1.4 Fix `document_versions` Revision Uniqueness (`§3.5` & `§5.3` — Fixes `RT-011`)
Allow replacing failed or withdrawn unapproved uploads without burning the revision code:
```sql
CREATE UNIQUE INDEX document_versions_rev_code_active_uq
  ON document_versions (document_id, upper(revision_code))
  WHERE deleted_at IS NULL
    AND file_status NOT IN ('FAILED', 'QUARANTINED')
    AND review_status <> 'WITHDRAWN';
```

### 1.5 Add `bulk_import_jobs` (`§3.5` — Fixes `RT-001`)
```sql
CREATE TABLE bulk_import_jobs (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  zip_object_id         UUID NOT NULL REFERENCES storage_objects(id),
  manifest_object_id    UUID REFERENCES storage_objects(id),
  status                TEXT NOT NULL DEFAULT 'UPLOADED'
                          CHECK (status IN ('UPLOADED','DRY_RUN_READY','PROCESSING','COMPLETED','FAILED')),
  dry_run_report_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_report_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id)
);
```

---

## Patch 2 — `10-API-AND-INTEGRATIONS.md` (Fixes `RT-001`, `RT-002`, `RT-007`, `RT-010`, `RT-012`, `RT-022`, `RT-023`)

Add the missing endpoints and resolve the duplicate IDs in `10` §7:

| ID | Method & Path | Purpose | Permission |
|---|---|---|---|
| **API-009A** | `GET /auth/orgs` | List user's active org memberships and guest grants | Authenticated |
| **API-009B** | `POST /auth/switch-org` | Set `sessions.active_org_id` server-side (`Idempotency-Key` required) | Authenticated member of target org |
| **API-028A** | `POST /guest/{token}/otp/request` | Send guest OTP (max 3/hr, 10/day per grant; email fallback) | Public token, rate-limited |
| **API-028B** | `POST /guest/{token}/otp/verify` | Verify guest OTP (5 attempts then 15-min cooldown) | Public token |
| **API-061A** | `POST /waivers/{id}/countersign` | Second approver countersigns a mandatory requirement waiver | `requirement.waive_second` (`Owner`/`Admin`) |
| **API-067** | `GET /projects/{id}/effective-config` | Inspect resolved configuration and provenance for a project | `project.read` |
| **API-082A** | `POST /document-versions/{id}/refresh-upload-urls` | List uploaded parts from S3 and issue fresh presigned URLs for remaining parts | `document.upload` |
| **API-095** | `POST /projects/{id}/documents/bulk-import-intents` | Create presigned upload intent for bulk ZIP + mapping sheet | `document.bulk_import` |
| **API-096** | `POST /bulk-imports/{id}/dry-run` | Parse ZIP + manifest and return per-file requirement/asset matching report | `document.bulk_import` |
| **API-097** | `POST /bulk-imports/{id}/commit` | Execute validated bulk import and create document versions | `document.bulk_import` |
| **API-106** | `POST /document-versions/{id}/external-approval` | Record external approval (`STAMPED_PDF`/`EMAIL`/`PORTAL`/`PHYSICAL`) and transition version + requirement to `APPROVED` | `review.record_external` |
| **API-117** | `POST /submissions/{id}/recipients/{recipientId}/decision` | Record recipient's acceptance, conditional acceptance, or rejection | `package.accept` or `package.submit` |
| **API-118A** | `GET /packages/{id}/manifest` | Download package manifest (JSON/CSV) with SHA-256 checksums | `package.download` |
| **API-118B** | `GET /packages/{id}/preview` | Resolved item list and page estimate before generation | `package.generate` |

---

## Patch 3 — `03-PRODUCT-REQUIREMENTS.md` (Fixes `RT-004`, `RT-015`, `RT-016`, `RT-017`, `RT-028`)

1. **Fix `FR-IAM-018` (`§4`):** Replace with:
   > `FR-IAM-018`: *"A member's effective permissions are computed via the positive-only model (`05` §3.2): capabilities are the union of org role and project role, scoped to the target project/resource, and gated by `requirements.reviewer_role` for review decisions."*
2. **Fix `FR-DOC` duplicate rows (`§9`):** Delete the duplicate `FR-DOC-029` and `FR-DOC-030` rows after `FR-DOC-033`.
3. **Add `FR-WTY` and `FR-DEF` (`§8b`):**
   - `FR-WTY-001` (M / MVP): Record OEM warranty registration (`DT-090`), start date, end date, and `warranty_start_basis` per asset, flagging conflicts between contract basis and OEM basis.
   - `FR-DEF-001` (M / MVP): Raise, assign, rectify (with closure photo/PDF evidence), and close defects/snags during commissioning and the Defect Liability Period (`WF-25`).
4. **Fix `FR-BIL-005` (`§15`):** Issue Rule 46 GST-compliant tax invoices (with SAC `998315`, buyer GSTIN, and place of supply) in MVP; enable IRP e-invoicing (`irn`/`qr_payload`) via configuration when supplier turnover approaches the ₹5 Crore CBIC threshold.
5. **Replace Authoritative Traceability Table (`§19`):**

| Area | Permissions | States | Data Entities | API | Screens | Tests |
|---|---|---|---|---|---|---|
| `ORG` | `05` §4 | `06` §3.2 | `E-ORGANISATION`, `E-ORG_PROFILE` | `API-010`–`019` | `SCR-001`–`005`, `SCR-042` | `TC-ORG-*` |
| `IAM` | `05` §4–6 | `06` §3.3–3.4 | `E-USER`, `E-USER_IDENTITY`, `E-SESSION`, `E-MEMBERSHIP`, `E-INVITATION`, `E-GUEST_GRANT` | `API-001`–`009B`, `API-013`–`019`, `API-024`–`028B` | `SCR-002`–`005`, `SCR-040`–`041`, `SCR-056` | `TC-IAM-*` |
| `PTY` | `05` §2.3, §6 | `06` `WF-08` | `E-PARTY`, `E-PARTY_CONTACT`, `E-GUEST_GRANT` | `API-020`–`028B` | `SCR-032`–`036` | `TC-PTY-*` |
| `PRJ/CNT` | `05` §4 | `06` §3.1, `WF-03`/`05`/`26` | `E-PROJECT`, `E-CONTRACT`, `E-SPECIFICATION_REF`, `E-VARIATION` | `API-030`–`044`, `API-184`–`186` | `SCR-010`–`013` | `TC-PRJ-*`, `TC-CNT-*` |
| `CHK/CFG` | `05` §4 | `06` §3.5–3.6, `WF-06`/`20` | `E-CONFIG_VERSION`, `E-CHECKLIST_SNAPSHOT`, `E-REQUIREMENT`, `E-REQUIREMENT_REVISION`, `E-WAIVER` | `API-050`–`067` | `SCR-014`–`017`, `SCR-037`–`039` | `TC-CHK-*`, `TC-CFG-*` |
| `AST` | `05` §4 | `06` `WF-07` | `E-ASSET`, `E-ASSET_CATEGORY` | `API-070`–`076` | `SCR-018`–`020` | `TC-AST-*` |
| `DOC` | `05` §4 | `06` §3.7–3.8, `WF-09`/`11`/`13` | `E-DOCUMENT`, `E-DOCUMENT_VERSION`, `E-STORAGE_OBJECT`, `E-BULK_IMPORT_JOB` | `API-080`–`097` | `SCR-021`–`025`, `SCR-055` | `TC-DOC-*` |
| `REV` | `05` §4 | `06` §3.8–3.9, `WF-12`/`23` | `E-REVIEW`, `E-REVIEW_COMMENT`, `E-APPROVAL_OVERRIDE` | `API-100`–`107` | `SCR-025`–`027` | `TC-REV-*` |
| `HND` | `05` §4 | `06` §3.11–3.12, `WF-15`–`18` | `E-HANDOVER_PACKAGE`, `E-PACKAGE_ITEM`, `E-PACKAGE_REQUIREMENT`, `E-SUBMISSION`, `E-SUBMISSION_RECIPIENT` | `API-110`–`118B` | `SCR-028`–`031`, `SCR-057` | `TC-HND-*` |
| `NOT` | `05` §4 | `06` `WF-14` | `E-NOTIFICATION`, `E-NOTIFICATION_PREFERENCE` | `API-120`–`123` | `SCR-043`, `SCR-048` | `TC-NOT-*` |
| `WTY/DEF` | `05` §4 | `06` `WF-24`/`25` | `E-WARRANTY_EVENT`, `E-DEFECT` | `API-180`–`183` | `SCR-058`–`059` | `TC-WTY-*`, `TC-DEF-*` |
| `SRCH/RPT` | `05` §4 | n/a | `E-DOCUMENT_SEARCH` | `API-130` | `SCR-047` | `TC-SRCH-*`, `TC-RPT-*` |
| `AUD` | `05` §4 | `06` `WF-19` | `E-AUDIT_EVENT`, `E-SECURITY_EVENT` | `API-140`–`144` | `SCR-046`, `SCR-053`–`054` | `TC-AUD-*` |
| `BIL` | `05` §4 | `06` §3.13 | `E-SUBSCRIPTION`, `E-INVOICE`, `E-INVOICE_LINE`, `E-INVOICE_TDS`, `E-USAGE_COUNTER` | `API-124`, `API-150`–`160` | `SCR-044`–`045` | `TC-BIL-*` |
| `ADM` | `05` §4 | n/a | `E-ADMIN_AUDIT_EVENT`, `E-JOB_EXECUTION` | `API-170`–`172` | `SCR-051`–`052` | `TC-ADM-*` |

---
---