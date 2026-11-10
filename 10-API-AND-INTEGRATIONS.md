# 10 — API and Integrations

**Status:** Draft v0.2
**Change history:** v0.2 resolves the org-path contradiction (AUD-014), adds SMS (AUD-001), external review (AUD-010), bulk import (AUD-009), package manifest/preview, usage, deletion-request, guest OTP, warranty/defect/variation endpoints, and tightens idempotency and error contracts.
**Style:** REST/JSON over HTTPS, versioned
**Related:** `03` requirements, `05` permissions, `06` states, `08` data, `13` security

---

## 1. Conventions

| Concern | Rule |
|---|---|
| Base path | `/api/v1` |
| Format | JSON (`application/json`), errors `application/problem+json` |
| Casing | `camelCase` |
| IDs | UUIDv7 strings |
| Time | ISO 8601 with offset; API accepts and returns UTC (`Z`) |
| Dates (business) | `YYYY-MM-DD` |
| Money | integer paise + `currency: "INR"` |
| Enums | `SCREAMING_SNAKE_CASE` |
| Auth (browser) | `HttpOnly`, `Secure`, `SameSite=Lax` session cookie holding an **opaque random token** (hashed at rest, DB lookup per request — **not a JWT**), plus a CSRF token. The session row carries `active_org_id`. |
| Auth (machine) | `Authorization: Bearer <token>` (V2) |
| Guest | High-entropy link token exchanged for a scoped session after OTP where required |
| Request ID | `X-Request-Id` accepted or generated; returned on every response |
| Idempotency | `Idempotency-Key` on state-changing POSTs |
| Concurrency | `If-Match: "<rowVersion>"` where `rowVersion` is the integer `row_version` serialised as a quoted decimal string (e.g. `"7"`); `412` on mismatch |
| Pagination | Cursor: `?limit=25&cursor=...`; response `{ data, nextCursor }` |
| Filtering | Explicit query params; no arbitrary query language in MVP |
| Sorting | `?sort=-createdAt` (allow-listed fields only) |
| Versioning | Breaking changes → `/api/v2`; additive changes allowed in v1 |

## 2. Authentication

### 2.1 Browser session

1. `POST /auth/otp/request` with email or E.164 phone.
2. `POST /auth/otp/verify` with identifier + OTP + device hint.
3. Server creates a `sessions` row with `active_org_id` (first active membership, or the one chosen at signup), sets the cookie, and returns the user plus the **active org only**.
4. `GET /auth/me` returns identity, active org, roles and feature flags. Other memberships are listed only by `GET /auth/orgs`.
5. `POST /auth/switch-org` (authenticated) sets `sessions.active_org_id` server-side and returns `204`. Requires an active membership in the target org.
6. `POST /auth/logout` revokes the session.

**Implemented authentication contract (G01-R5):** Browser/member login uses `POST /api/v1/auth/otp/request` followed by `POST /api/v1/auth/otp/verify` with the original `challengeId`, identifier and six-digit code. The OTP expires after 5 minutes and is rate-limited. An authenticated browser session uses an opaque HttpOnly cookie plus session-bound CSRF and authentication generation; owner/admin use TOTP or single-use recovery codes. **Member-login magic-link request/consume and automatic SMS-to-email fallback are not implemented and MUST NOT be advertised or called.** Organisation invitation links are a different, single-use claim flow: a recipient authenticates independently as the intended verified identity before accepting membership. Users may independently request an email OTP only if that destination is already a verified identity; no unverified alternate is selected on their behalf.

### 2.2 CSRF

Cookie-authenticated unsafe methods require `X-CSRF-Token` matching a double-submit cookie or session-bound token. SameSite alone is insufficient for all browsers.

### 2.3 Guest access

- `GET /guest/{token}` validates the link, returns minimal context (contractor name, project name, request summary).
- If OTP is required: `POST /guest/{token}/otp/request`, `POST /guest/{token}/otp/verify`.
- Exchange yields a guest session scoped to the grant. Guest endpoints are explicitly scoped and cannot accept arbitrary project IDs.

### 2.4 API tokens (V2)

Scoped, hashed at rest, expiring, revocable; never inherit a human's full permissions. Rate-limited separately.

## 3. Authorisation

- **`session.active_org_id` is the only authoritative tenant.** Every `/orgs/{orgId}` path parameter must equal `session.active_org_id`, otherwise the request returns `404`. A path or body `orgId` is **never** authoritative (`AUD-014`).
- Every object is loaded with `(org_id, id)`; cross-tenant access returns `404`.
- Permission check happens before validation that could leak existence.
- Guests are limited by grant capabilities and resource scope.
- See `05` for the full matrix.

## 4. Error model

```json
{
  "type": "https://errors.tradecloseout.in/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "detail": "Document version is APPROVED and cannot be submitted again.",
  "requestId": "01J...",
  "retryable": false,
  "fieldErrors": []
}
```

| HTTP | Code examples | When |
|---|---|---|
| 400 | `VALIDATION_FAILED`, `UNSUPPORTED_FILE_TYPE` | Malformed/invalid input |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED` | No valid session |
| 403 | `FORBIDDEN`, `SELF_APPROVAL_DENIED` | Known resource, action not allowed |
| 404 | `NOT_FOUND` | Missing or outside tenant/scope |
| 409 | `CONFLICT`, `INVALID_STATE_TRANSITION`, `DUPLICATE_REVISION` | State/version conflict |
| 412 | `PRECONDITION_FAILED` | `If-Match` mismatch |
| 413 | `FILE_TOO_LARGE` | Upload limits |
| 422 | `METADATA_INCOMPLETE`, `RULE_CONFLICT` | Semantically invalid |
| 429 | `RATE_LIMITED` | Limit exceeded; `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected; no sensitive detail |
| 503 | `DEPENDENCY_UNAVAILABLE` | Storage/queue/db degraded |

No stack traces or SQL in responses. `requestId` is the support handle.

## 5. Idempotency

Required on:

- `POST /auth/otp/request`, `POST /auth/otp/verify`
- `POST /orgs`, `POST /orgs/{orgId}/invitations`
- `POST /projects`, `POST /projects/{id}/activate`, `/suspend`, `/resume`, `/handover`, `/close`, `/reopen`, `/archive`
- `POST /projects/{id}/checklist/snapshots`
- `POST /requirements/{id}/waivers`, `POST /requirements/{id}/submit-review`
- `POST /auth/switch-org` (`API-009B`)
- `POST /waivers/{id}/countersign` (`API-061A`)
- `POST /document-versions/upload-intents`, `/complete`, `/abort`, `/refresh-upload-urls` (`API-082A`)
- `POST /projects/{id}/documents/bulk-import-intents`, `/bulk-imports/{id}/commit` (`API-095`/`097`)
- `POST /reviews/{id}/decisions`, `POST /document-versions/{id}/external-approval` (`API-106`)
- `POST /packages`, `POST /packages/{id}/retry`
- `POST /submissions`, `POST /submissions/{id}/recipients/{recipientId}/decision` (`API-117`)
- `POST /orgs/{orgId}/subscription/checkout`, `/cancel`
- `POST /billing/...` state changes
- `POST /projects/{id}/defects`, `POST /defects/{id}/close`
- `POST /projects/{id}/warranty-events`, `POST /projects/{id}/variations`

Rules:

- Key scoped to `(org_id, endpoint, key)`.
- Same key + same body hash → return stored response (including status).
- Same key + different body → `409 IDEMPOTENCY_KEY_REUSED`.
- Retention 24 hours (uploads 7 days).
- Keys never used for GET.

## 6. Pagination, filtering, search

```
GET /api/v1/projects/{projectId}/requirements
  ?status=CHANGES_REQUESTED,REJECTED
  &ownerId=...
  &assetId=...
  &dueBefore=2026-11-30
  &q=chiller
  &sort=dueAt
  &limit=50
  &cursor=eyJpZCI6...
```

- `limit` 1–100, default 25.
- Cursor is opaque, signed, encodes sort keys and last ID.
- Total counts are optional (`include=count`), may be approximate.
- Search `q` is metadata-only in MVP; full-text in V1.

## 7. Endpoint catalogue

### 7.1 Auth and identity

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-001 | POST `/auth/otp/request` | Send OTP | Public, rate-limited |
| API-002 | POST `/auth/otp/verify` | Create session | Public |
| API-003 | GET `/auth/me` | Current user + orgs | Authenticated |
| API-004 | POST `/auth/logout` | Revoke session | Authenticated |
| API-005 (withdrawn) | — | Member-login magic-link request is **not implemented**; use API-001 email OTP | — |
| API-006 (withdrawn) | — | Member-login magic-link consumption is **not implemented**; use API-002 OTP verification | — |
| API-007 | GET `/users/me` | Profile | Self |
| API-008 | PATCH `/users/me` | Update name/locale | Self |
| API-009A | GET `/auth/orgs` | List user's active org memberships and guest grants | Authenticated (`RT-002`) |
| API-009B | POST `/auth/switch-org` | Set `sessions.active_org_id` server-side (`Idempotency-Key` required) | Authenticated member of target org (`RT-002`) |

### 7.2 Organisations and members

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-010 | POST `/orgs` | Create org | Authenticated |
| API-011 | GET `/orgs/{orgId}` | Org profile + plan | `org.read` |
| API-012 | PATCH `/orgs/{orgId}` | Update profile/branding | `org.manage` |
| API-013 | GET `/orgs/{orgId}/members` | List members | `org.read` |
| API-014 | POST `/orgs/{orgId}/invitations` | Invite member | `org.manage_members` |
| API-015 | POST `/invitations/{token}/accept` | Accept invite | Authenticated session matching invitation email/phone (`RT-041`) |
| API-016 | PATCH `/orgs/{orgId}/members/{userId}` | Change role/suspend | `org.manage_members` |
| API-017 | DELETE `/orgs/{orgId}/members/{userId}` | Remove member | `org.manage_members` |
| API-018 | POST `/orgs/{orgId}/transfer-ownership` | Transfer owner | `org.transfer_ownership` |
| API-019 | POST `/orgs/{orgId}/reassign-work` | Bulk reassign owned work | `org.manage_members` |

### 7.3 Parties and guests

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-020 | GET `/parties` | List/search parties | `party.read` |
| API-021 | POST `/parties` | Create party | `party.manage` |
| API-022 | PATCH `/parties/{partyId}` | Update party | `party.manage` |
| API-023 | DELETE `/parties/{partyId}` | Soft delete | `party.manage` |
| API-024 | POST `/projects/{projectId}/guest-grants` | Invite guest | `project.manage` |
| API-025 | GET `/projects/{projectId}/guest-grants` | List grants | `project.manage` |
| API-026 | DELETE `/guest-grants/{grantId}` | Revoke | `project.manage` |
| API-027 | POST `/projects/{projectId}/supplier-links` | Create scoped upload link | `party.manage` |
| API-028 | POST `/guest/{token}/session` | Exchange guest token | Public token |
| API-028A | POST `/guest/{token}/otp/request` | Send guest OTP to the grant's currently verified designated contact (max 3/hour, 10/day per grant); no automatic channel switching or guest email fallback | Public token, rate-limited (`RT-010`, `RT-014`) |
| API-028B | POST `/guest/{token}/otp/verify` | Verify guest OTP (5 attempts then 15-min cooldown) | Public token (`RT-010`, `RT-014`) |

**Current guest OTP delivery:** `POST /guest/{token}/otp/request` uses the already-designated email **or** phone for that verified grant; it does not switch to another channel after provider rejection, timeout or an ambiguous response. An email-only grant is not a fallback from SMS. Any contact change needs independently verified reissuance of the guest grant; never guess a recipient or silently redirect authentication. Provider submission acknowledgement is not final recipient delivery evidence.

### 7.4 Projects and contracts

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-030 | GET `/projects` | List/filter | `project.read` |
| API-031 | POST `/projects` | Create draft | `project.create` |
| API-032 | GET `/projects/{id}` | Detail | `project.read` |
| API-033 | PATCH `/projects/{id}` | Update | `project.manage` |
| API-034 | POST `/projects/{id}/activate` | Activate | `project.manage` |
| API-035 | POST `/projects/{id}/suspend` | Suspend | `project.manage` |
| API-036 | POST `/projects/{id}/resume` | Resume | `project.manage` |
| API-037 | POST `/projects/{id}/handover` | Move to handover | `project.manage` |
| API-038 | POST `/projects/{id}/close` | Close | `project.close` |
| API-039 | POST `/projects/{id}/reopen` | Reopen (V1) | `project.close` |
| API-040 | POST `/projects/{id}/archive` | Archive | `project.manage` |
| API-041 | GET `/projects/{id}/dashboard` | Counts/flags | `project.read` |
| API-042 | GET/POST `/projects/{id}/contracts` | Contract register | `contract.manage` |
| API-043 | PATCH `/contracts/{id}` | Update contract | `contract.manage` |
| API-044 | GET/POST `/projects/{id}/specification-refs` | Spec register | `contract.manage` |

### 7.5 Configuration and checklists

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-050 | GET `/templates` | Available trade/client templates | `template.read` |
| API-051 | POST `/templates/{id}/install` | Install into org | `template.manage` |
| API-052 | GET/PUT `/orgs/{orgId}/config` | Org configuration | `template.manage` |
| API-053 | GET `/orgs/{orgId}/config/versions` | Version history | `template.manage` |
| API-054 | POST `/config/versions/{id}/activate` | Activate version | `template.manage` |
| API-055 | POST `/projects/{id}/checklist/preview` | Resolve preview | `checklist.manage` |
| API-056 | POST `/projects/{id}/checklist/snapshots` | Create snapshot | `checklist.manage` |
| API-057 | GET `/projects/{id}/checklist/snapshots` | List snapshots | `checklist.manage` |
| API-058 | GET `/requirements` | List requirements | `project.read` |
| API-059 | GET `/requirements/{id}` | Detail + evidence | `project.read` |
| API-060 | PATCH `/requirements/{id}` | Assignment/due date (pre-activation or permitted) | `checklist.manage` |
| API-061 | POST `/requirements/{id}/waivers` | Waive / N/A | `requirement.waive` |
| API-061A | POST `/waivers/{id}/countersign` | Second approver countersigns a mandatory requirement waiver | `requirement.waive_second` (`Owner`/`Admin`) (`RT-023`) |
| API-062 | POST `/requirements/{id}/submit-review` | Submit evidence (**authoritative**) | `review.submit` |
| API-063 | POST `/projects/{id}/change-requests` | Create change request | `checklist.manage` |
| API-064 | POST `/change-requests/{id}/submit` | Submit | `checklist.manage` |
| API-065 | POST `/change-requests/{id}/decision` | Approve/reject | approver |
| API-066 | POST `/change-requests/{id}/apply` | Create snapshot v+1 | `checklist.manage` |
| API-067 | GET `/projects/{id}/effective-config` | Inspect resolved configuration and provenance for a project | `project.read` (`RT-035`) |

### 7.6 Assets

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-070 | GET `/projects/{id}/assets` | List/filter | `asset.read` |
| API-071 | POST `/projects/{id}/assets` | Create | `asset.manage` |
| API-072 | PATCH `/assets/{id}` | Update | `asset.manage` |
| API-073 | DELETE `/assets/{id}` | Soft delete/retire | `asset.manage` |
| API-074 | POST `/projects/{id}/assets/import` | CSV/Excel import | `asset.manage` |
| API-075 | GET `/projects/{id}/assets/export` | Export | `asset.read` |
| API-076 | GET `/projects/{id}/assets/{assetId}/matrix` | Document matrix | `asset.read` |

### 7.7 Documents

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-080 | GET `/documents` | List/filter | `document.read` |
| API-081 | GET `/documents/{id}` | Detail + versions + links | `document.read` |
| API-082 | POST `/projects/{id}/documents/upload-intents` | Start upload | `document.upload` |
| API-082A | POST `/document-versions/{id}/refresh-upload-urls` | List uploaded parts and refresh expired presigned URLs | `document.upload` (`RT-012`) |
| API-083 | POST `/document-versions/{id}/complete` | Complete upload | `document.upload` |
| API-084 | POST `/document-versions/{id}/abort` | Abort | `document.upload` |
| API-085 | PATCH `/documents/{id}` | Metadata/edit links | `document.metadata_edit` |
| API-086 | POST `/documents/{id}/versions` | New revision intent | `document.upload` |
| API-087 | ~~POST `/document-versions/{id}/submit-review`~~ | **Deprecated** — use `API-062` | — |
| API-088 | GET `/document-versions/{id}/download-url` | Signed download | `document.download` |
| API-089 | GET `/document-versions/{id}/preview-url` | Signed preview | `document.read` |
| API-090 | DELETE `/documents/{id}` | Soft delete | `document.delete` |
| API-091 | POST `/documents/{id}/restore` | Restore | `document.delete` |
| API-092 | POST `/documents/{id}/reuse` | Reuse in another project | `document.reuse` |
| API-093 | GET `/documents/{id}/history` | Version/review timeline | `document.read` |
| API-094 | POST `/documents/bulk-download` | ZIP selection | `document.download` |
| API-095 | POST `/projects/{id}/documents/bulk-import-intents` | Create presigned upload intent for bulk ZIP + mapping sheet | `document.bulk_import` (`RT-001`) |
| API-096 | POST `/bulk-imports/{id}/dry-run` | Parse ZIP + manifest and return per-file requirement/asset matching report | `document.bulk_import` (`RT-001`) |
| API-097 | POST `/bulk-imports/{id}/commit` | Execute validated bulk import and create document versions | `document.bulk_import` (`RT-001`) |

### 7.8 Reviews

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-100 | GET `/reviews` | Review queue | `review.read` |
| API-101 | GET `/reviews/{id}` | Detail + comments | `review.read` |
| API-102 | POST `/reviews/{id}/decisions` | Approve/request changes/reject | `review.decide` |
| API-103 | POST `/reviews/{id}/comments` | Add comment | `review.read` + assignment |
| API-104 | POST `/reviews/{id}/delegate` | Delegate | `review.decide` + owner |
| API-105 | POST `/reviews/{id}/override` | Admin override | Owner/Admin + reason |
| API-106 | POST `/document-versions/{id}/external-approval` | Record external approval (`STAMPED_PDF`/`EMAIL`/`PORTAL`/`PHYSICAL`) and transition version + requirement to `APPROVED` | `review.record_external` (`RT-022`) |
| API-107 | POST `/reviews/bulk-decisions` | Bulk approve / request changes | `review.decide` |

### 7.9 Packages and submissions

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-110 | POST `/projects/{id}/packages` | Generate | `package.generate` |
| API-111 | GET `/packages/{id}` | Status/progress | `package.generate` or `package.download` |
| API-112 | GET `/packages/{id}/download-url` | PDF/ZIP links | `package.download` |
| API-113 | POST `/packages/{id}/retry` | Retry failed | `package.generate` |
| API-114 | GET `/projects/{id}/packages` | List versions | `package.download` |
| API-115 | POST `/projects/{id}/submissions` | Record submission | `package.submit` |
| API-116 | PATCH `/submissions/{id}` | Update status/ack | `package.submit` |
| API-117 | POST `/submissions/{id}/recipients/{recipientId}/decision` | Record recipient's acceptance, conditional acceptance, or rejection | `package.accept` or `package.submit` (`RT-007`) |
| API-118 | GET `/projects/{id}/readiness` | Completion check | `project.read` |
| API-118A | GET `/packages/{id}/manifest` | Download package manifest (JSON/CSV) with SHA-256 checksums | `package.download` (`RT-010`) |
| API-118B | GET `/packages/{id}/preview` | Resolved item list and page estimate before generation | `package.generate` (`RT-010`) |

### 7.10 Notifications, search, audit, billing, admin

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-120 | GET `/notifications` | In-app list | Self |
| API-121 | POST `/notifications/{id}/read` | Mark read | Self |
| API-122 | GET/PUT `/notification-preferences` | Preferences | Self |
| API-123 | POST `/projects/{id}/reminders` | Manual reminder | `notification.manage` |
| API-124 | GET `/orgs/{orgId}/usage` | Current plan usage counters | `billing.read` |
| API-130 | GET `/search` | Scoped search | Authenticated |
| API-140 | GET `/projects/{id}/audit` | Project audit | `audit.read` |
| API-141 | GET `/orgs/{orgId}/audit` | Org audit | `audit.read` |
| API-142 | GET `/audit/export` | CSV/JSON export | `audit.read` + export |
| API-143 | POST `/orgs/{orgId}/deletion-request` | DSR: access / correction / deletion | `org.delete` or subject self |
| API-144 | GET `/deletion-requests/{id}` | DSR status | Requester or `org.manage` |
| API-150 | GET `/plans` | Public plans | Public |
| API-151 | GET `/orgs/{orgId}/subscription` | Current subscription | `billing.read` |
| API-152 | POST `/orgs/{orgId}/subscription/checkout` | Start checkout | `billing.manage` |
| API-153 | POST `/orgs/{orgId}/subscription/cancel` | Cancel | `billing.manage` |
| API-154 | GET `/orgs/{orgId}/invoices` | Invoice list | `billing.read` |
| API-155 | GET `/invoices/{id}/download-url` | Invoice PDF | `billing.read` |
| API-160 | POST `/webhooks/razorpay` | Payment webhook | Signature |
| API-170 | GET `/admin/orgs` | Platform org list | Platform admin |
| API-171 | POST `/admin/orgs/{id}/suspend` | Suspend org | Platform admin |
| API-172 | POST `/admin/jobs/{id}/retry` | Retry job | Platform admin |

### 7.11 Warranty, defects and variations

| ID | Method & path | Purpose | Permission |
|---|---|---|---|
| API-180 | GET/POST `/projects/{id}/warranty-events` | Warranty registration and reconciliation | `warranty.manage` |
| API-181 | POST `/warranty-events/{id}/confirm` | Confirm or dispute warranty basis | `warranty.manage` |
| API-182 | GET/POST `/projects/{id}/defects` | Raise snag/defect items | `defect.manage` |
| API-183 | POST `/defects/{id}/close` | Close with closure evidence | `defect.manage` |
| API-184 | GET/POST `/projects/{id}/variations` | Variation orders | `contract.manage` |
| API-185 | POST `/variations/{id}/decision` | Approve / reject variation | approver |
| API-186 | POST `/projects/{id}/handover-scope` | Declare partial-handover scope | `package.submit` |

### 7.12 Sorting contracts

| Endpoint | Allowed sorts | Default |
|---|---|---|
| `GET /reviews` | `dueAt`, `submittedAt`, `documentTitle` | `dueAt` ascending, nulls last |
| `GET /requirements` | `dueAt`, `status`, `groupKey`, `title` | `groupKey`, `dueAt` |
| `GET /documents` | `createdAt`, `title`, `issueDate` | `-createdAt` |
| `GET /projects` | `targetHandoverDate`, `name`, `createdAt` | `-createdAt` |

## 8. Request/response examples

### 8.1 Create upload intent

```http
POST /api/v1/projects/0192.../documents/upload-intents
Idempotency-Key: 8f14e45f-ea3b-4c1a-9c2f-3d1a2b3c4d5e
Content-Type: application/json

{
  "requirementId": "0192...",
  "assetId": "0192...",
  "filename": "CHLR-01-OMM-R2.pdf",
  "sizeBytes": 48213002,
  "mimeType": "application/pdf",
  "revisionCode": "R2",
  "issueDate": "2026-10-20",
  "title": "Chiller 1 O&M Manual Rev 2",
  "checksumSha256": "9f2c..."
}
```

```http
201 Created

{
  "documentId": "0192...",
  "versionId": "0192...",
  "upload": {
    "mode": "MULTIPART",
    "partSizeBytes": 10485760,
    "parts": [{"partNumber": 1, "url": "https://..."}],
    "expiresAt": "2026-10-31T18:30:00Z"
  }
}
```

### 8.2 Review decision

```http
POST /api/v1/reviews/0192.../decisions
Idempotency-Key: 3c9e...
If-Match: "4"

{
  "decision": "REQUEST_CHANGES",
  "comment": "Page 12 shows model XYZ-400, but installed unit is XYZ-450. Please reissue.",
  "pageComments": [{"page": 12, "body": "Model mismatch"}]
}
```

```http
200 OK

{
  "reviewId": "0192...",
  "decision": "REQUEST_CHANGES",
  "decidedAt": "2026-10-31T12:04:00Z",
  "documentVersionStatus": "CHANGES_REQUESTED",
  "requirementStatus": "CHANGES_REQUESTED",
  "rowVersion": 5
}
```

### 8.3 Problem response

```json
{
  "type": "https://errors.tradecloseout.in/metadata-incomplete",
  "title": "Metadata incomplete",
  "status": 422,
  "code": "METADATA_INCOMPLETE",
  "detail": "Revision code and issue date are required for this document type.",
  "requestId": "01JB...",
  "fieldErrors": [
    {"field": "revisionCode", "message": "Required"},
    {"field": "issueDate", "message": "Required"}
  ]
}
```

## 9. File upload strategy

1. **Intent** creates DB rows and S3 multipart upload; returns presigned part URLs (15–60 min).
2. Client uploads parts directly; supports retry/resume; computes checksum.
3. **Complete** sends part ETags; server calls S3 complete, verifies `HEAD` size, compares checksum.
4. Server enqueues processing; file is **not** downloadable until `READY`.
5. Unsupported/password-protected files fail with actionable errors.
6. Orphaned intents expire after 24 hours and are cleaned by a job.
7. Maximum 100 MB/file (configurable), 1 GB/package; max 20 files per request.

Why not proxy through API: memory, timeouts, mobile networks, and horizontal scaling.

## 10. Rate limits (proposed)

| Scope | Limit |
|---|---|
| OTP request | 5/hour/identifier, 20/hour/IP |
| Login verify | 10/15 min/identifier |
| Upload intents | 60/hour/user |
| Review decisions | 300/hour/user |
| Package generation | 5 concurrent/org, 50/day/org |
| Search | 120/min/user |
| Public guest endpoints | 60/min/token, 20/hour/IP |
| Guest OTP request | 3/hour, 10/day per `grant_id` (5 failed attempts trigger 15-min cooldown; **no automatic email fallback or alternate recipient**; `RT-014`) |
| API tokens | 600/min/token |
| Webhooks (inbound) | Provider-specific + signature |

Limits return `429` with `Retry-After` and the following body:

```json
{ "type": "https://errors.tradecloseout.in/rate-limited", "title": "Too many requests",
  "status": 429, "code": "RATE_LIMITED", "retryable": true,
  "retryAfterSeconds": 30, "requestId": "01J..." }
```

Response headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` are always present on throttled endpoints. Auth endpoints use CAPTCHA after repeated failures.

## 11. Outbound webhooks (V2)

Events: `project.activated`, `document.approved`, `requirement.waived`, `package.ready`, `submission.accepted`, `submission.rejected`.

Headers:

```
X-TC-Event: package.ready
X-TC-Delivery: 0192...
X-TC-Timestamp: 1790000000
X-TC-Signature: t=...,v1=HMAC_SHA256(timestamp + "." + body, secret)
```

Rules: 5-second timeout, retries with exponential backoff for 24 hours, idempotent by delivery ID, secret rotation supported, SSRF protection (no private IPs), HTTPS only.

## 12. Integrations

| Integration | MVP | V1 | Notes |
|---|---|---|---|
| Email (SES/Postmark) | Yes | Yes | Implemented email OTP and organisation invitations; reminders/invoices are separate provider workflows. **No member-login magic-link endpoint.** Provider acceptance does not prove recipient delivery; bounce/complaint reconciliation requires separate operational verification. |
| **SMS (OTP + transactional)** | **Yes** | Yes | DLT-registered sender ID and template; submission acknowledgment and shared rate limits. **No automatic SMS-to-email fallback or email magic-link recovery.** Real delivery receipts and retry/reconciliation remain a release gate. |
| WhatsApp deep link (`wa.me`) | Yes | Yes | Pre-filled message; manual send; no delivery proof |
| WhatsApp Business API | No | Yes | Template approval, opt-in, delivery status, cost per message |
| Razorpay | Yes | Yes | Subscriptions, UPI/cards, webhooks, invoices |
| Object storage | Yes | Yes | S3-compatible abstraction |
| E-signature | No | No | V2: Aadhaar eSign/DSC via licensed provider; store signed PDF + certificate |
| Accounting export | No | No | V2: Tally/Zoho Books CSV or API |
| Email ingestion | No | No | V2: forward to project inbox |
| Calendar | No | No | Optional later |
| BIM/Aconex | No | No | Export formats only; no deep integration |

### 12.1 Payment integration rules

- Never store card data; use hosted checkout.
- Verify webhook signatures and timestamps.
- Reconcile subscriptions daily.
- Store provider IDs, not raw payloads containing sensitive data (or redact).
- Idempotent webhook processing by `event_id`.
- Handle out-of-order events by fetching current state from the provider.

### 12.2 WhatsApp rules

- MVP deep links contain no document content, only a short request reference and URL.
- V1 Business API requires documented opt-in and template approval.
- A failed WhatsApp send always falls back to email/in-app.
- Provider abstraction so the vendor can change.

## 13. Validation rules (selected)

| Field | Rule |
|---|---|
| Project code | 2–30 chars, `A-Z0-9-_`, unique per org (case-insensitive) |
| Asset tag | 1–50 chars, no leading/trailing spaces, unique per project |
| Revision code | 1–10 chars, `A-Z0-9.-`, unique per document |
| Email | RFC-compliant, normalised lowercase |
| Indian mobile | `+91` + 10 digits starting 6–9 |
| GSTIN | 15 chars, state code + PAN + entity + checksum (V1) |
| PAN | 10 chars, `AAAAA9999A` pattern (V1) |
| File | Allowed MIME by content sniff, ≤100 MB |
| Dates | Issue date ≤ today + 1 day; expiry ≥ issue date |
| Retention | 0–100%; DLP 0–120 months |
| Money | Integer paise, ≥0, ≤10^13 |

## 14. API governance

- OpenAPI 3.1 is the source of truth once implementation starts; generated TypeScript client.
- Contract tests run in CI against schemas.
- Deprecation: 6-month notice for public API; `Sunset` header.
- No breaking changes to webhook payloads without a new event version.
- Every endpoint has: auth requirement, permission, idempotency, rate limit, audit event, error cases.

## 15. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial API and integration spec |
| 0.2 | 2026-10-31 | Remediation: session/active-org binding + `POST /auth/switch-org` (AUD-014); SMS (AUD-001); external/bulk decisions (AUD-010); bulk import (AUD-009); package manifest/preview; usage; deletion-request; guest OTP; warranty/defect/variation endpoints; idempotency, `If-Match`, 429/retryable and sort contracts; `API-087` deprecated |
