# 14 — Testing and Acceptance

**Status:** Draft v0.2
**Change history:** v0.2 adds `TC-PTY-*` (AUD-T-01), makes the traceability gate mandatory (AUD-T-02), adds project-isolation and approval-race tests (AUD-004/007), fuzz and abuse tests, SMS-failure recovery, EC mapping and screen acceptance coverage.
**Principle:** a feature is not complete because the UI exists. It is complete when its requirement has a passing test at the appropriate level and its permissions, states, audit and failure paths are verified.
**Related:** `03` requirements, `05` permissions, `06` workflows, `12` edge cases

---

## 1. Test strategy

| Level | Scope | Tooling (proposed) | Runs |
|---|---|---|---|
| Unit | Pure logic: rules, state transitions, naming, money/time, validators | Vitest | Every commit |
| Integration | Module + PostgreSQL + Redis (testcontainers), RLS, repositories, transactions | Vitest + Testcontainers | Every PR |
| Contract | OpenAPI schema vs implementation; webhook payloads | Schemathesis/Dredd | Every PR |
| E2E | Browser flows across roles, mobile viewport | Playwright | Every PR (critical), nightly (full) |
| Permission | Positive/negative for every permission and scope | API-level parameterised suite | Every PR |
| Tenant isolation | Cross-tenant ID substitution for every resource | API/DB suite | Every PR |
| File pipeline | MIME, corrupt, encrypted, malware, large, resume | Integration + fixtures | Every PR |
| PDF/package | Merge, bookmarks, index, checksums, failure | Golden-file + job tests | Nightly |
| Failure/recovery | Kill workers, DB fail, queue backlog, storage errors | Chaos scripts in staging | Weekly |
| Performance | p95 API, uploads, 1,000-item checklist, 500-page package | k6 | Pre-release |
| Security | SAST, dependency, secret, container, DAST, pen test | CI + external | Continuous/annual |
| UAT | Real contractor scenarios with design partners | Manual script | Pilot |

### 1.1 Test environments

- **Local:** Docker Compose (Postgres, Redis, MinIO, ClamAV, Gotenberg).
- **CI:** ephemeral containers; no shared state.
- **Staging:** production-like, synthetic data only; never real customer documents.
- **Production:** smoke tests only, read-only checks; no destructive tests.

### 1.2 Test data rules

- Never use real personal data or customer documents.
- Use synthetic Indian names, GSTIN-like strings (clearly fake), and generated PDFs.
- Include a deliberately infected EICAR file for AV tests (isolated).
- Include English + Hindi text samples for rendering tests.
- Seed a canonical project: 3 assets, 20 requirements, 5 documents, 2 revisions.

## 2. Traceability

Every requirement `FR-*` and `NFR-*` must appear in the test catalogue with:

- at least one happy-path test,
- at least one negative/authorisation test where applicable,
- state-transition coverage where applicable,
- audit assertion where the action is auditable.

**CI gate (mandatory, `AUD-T-02`):** a script parses requirement IDs from `03` and test metadata; **the build fails if any `FR-*` or `NFR-*` has no mapped test.** `TC-*` IDs are stable; a test may cover multiple requirements but must declare them. The gate is a required check on every PR and runs before merge.

Traceability record format:

```yaml
id: TC-DOC-012
requirements: [FR-DOC-001, FR-DOC-014, FR-REV-006]
level: integration
given: a READY document version linked to a requirement
when: the reviewer approves it
then:
  - version.review_status == APPROVED
  - requirement.status == APPROVED
  - audit event DOCUMENT_APPROVED exists
```

## 3. Acceptance criteria — organisation and identity

> Grouped rows cover every requirement ID in the stated range. The CI traceability map expands each range to individual `FR-*` IDs; a range row is not sufficient if any ID in it lacks an executable assertion in the mapped suite.

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-ORG-001–003 | A new visitor can register, verify, and reach the first project step in <2 minutes in E2E; refreshing resumes setup | TC-ORG-001 |
| FR-ORG-004–007 | Profile saves valid GSTIN/PAN; invalid checksum shows field error and does not persist | TC-ORG-002 |
| FR-ORG-008–009 | Invitation expires at 7 days; accepted invite creates exactly one membership; suspended org blocks writes | TC-ORG-003 |
| FR-ORG-010–014 | Deletion requires typed org name; ownership transfer is atomic and leaves exactly one owner | TC-ORG-004 |
| FR-IAM-001–006 | A user in two orgs sees only the active org's data; project roles differ per project | TC-IAM-001 |
| FR-IAM-007–009 | Removing a member invalidates sessions ≤60 s; guest cannot list other projects | TC-IAM-002 |
| FR-IAM-010–013 | Guest link is single-use, expires, is revocable; upload-only link cannot browse | TC-IAM-003 |
| FR-IAM-014–018 | Positive-only additive RBAC (effective = org ∪ project roles); missing grant defaults to denied; every denial is audited; API token scope cannot exceed grant (RT-004) | TC-IAM-004 |

## 3b. Acceptance criteria — parties, suppliers and remediation features

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-PTY-001–003 | A party can hold multiple types and appear on multiple projects; GSTIN/name duplicate produces a suggestion, not a hard error | TC-PTY-001 |
| FR-PTY-004 | A party invited as a project guest sees only granted resources; cross-project enumeration returns 404 | TC-PTY-002 |
| FR-PTY-005 | A supplier assigned to requirements sees only those requirements and cannot browse the project | TC-PTY-003 |
| FR-PTY-006–007 | A scoped upload link is created without an account, expires, is revocable and reissues on `CHANGES_REQUESTED` | TC-PTY-004 |
| FR-PTY-008 | Supplier performance notes are recorded and visible to internal roles only | TC-PTY-005 |
| FR-PTY-009 | Duplicate party detection suggests matches on GSTIN, email or normalised name | TC-PTY-006 |
| FR-PTY-010 | Cross-tenant party access returns 404 for every verb | TC-PTY-007 |
| FR-DOC-031 | A 240-document ZIP + mapping spreadsheet imports with per-file outcomes and a dry-run preview | TC-PTY-008 |
| FR-DOC-032 | A supplier upload not mapped to an assigned requirement is rejected with the available list | TC-PTY-009 |
| FR-DOC-033 | Org-level duplicate detection warns when the same SHA-256 exists in another project | TC-DOC-011 |
| FR-REV-016 | Recording an external approval requires approver, date, method and evidence; the package shows `Approved (external)` | TC-REV-006 |
| FR-REV-017 | Bulk decisions apply to selected versions and are individually audited | TC-REV-007 |
| FR-CHK-016 | Waiving a mandatory requirement requires a second approver | TC-CHK-004 |
| FR-HND-019 | A submission to three recipients records three independent decisions | TC-HND-005 |
| FR-HND-020–021 | Package preview lists items and the manifest carries the snapshot checksum | TC-HND-006 |
| FR-AST-011–012 | Asset register renders replacement lineage; warranty basis drives the start date | TC-AST-004 |
| FR-NOT-014 | Warranty/DLP expiry reminders fire at 30/14/7/1 days | TC-NOT-004 |
| FR-BIL-011–012 | TDS deduction is recorded and tax rates are configuration | TC-BIL-003 |
| FR-INT-012 | OTP is delivered by SMS; two failures fall back to email magic link | TC-INT-002 |

## 4. Acceptance criteria — projects, contracts, checklists

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-PRJ-001–006 | Activation fails without a snapshot/manager; code immutable after activation; suspend blocks writes | TC-PRJ-001 |
| FR-PRJ-007–014 | Reopen increments counter; partial handover only affects selected scope; archive is read-only | TC-PRJ-002 |
| FR-CNT-001–006 | Contract fields validate ranges; spec refs link to requirements; multiple contracts render | TC-CNT-001 |
| FR-CFG-001–005 | Resolution follows level order; locked field rejects override; version history shows provenance | TC-CFG-001 |
| FR-CFG-006–012 | Editing an org template does not change an active project; change request creates snapshot v+1 | TC-CFG-002 |
| FR-CHK-001–005 | Snapshot contains resolved items and is immutable; activation binds version 1 | TC-CHK-001 |
| FR-CHK-006–010 | Waiver requires reason/approver; N/A requires permission; change request with impact works | TC-CHK-002 |
| FR-CHK-011–015 | Multi-evidence requirement stays unsatisfied until all approved; reuse requires attestation | TC-CHK-003 |

## 5. Acceptance criteria — assets

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-AST-001–004 | Duplicate tag (case-insensitive) rejected; CSV import reports row-level errors | TC-AST-001 |
| FR-AST-005–008 | Asset-scoped requirements instantiate per asset; replacement preserves old documents | TC-AST-002 |
| FR-AST-009–010 | Export contains all visible assets and respects filters/permissions | TC-AST-003 |

## 5b. Acceptance criteria — warranty and defects (RT-028)

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-WTY-001 | Precedence rule: An existing `asset.warranty_start` (e.g. from commissioning) is preserved; assets without a start date resolve to package acceptance date based on `asset.warranty_start_basis`. Expiry reminders compute correctly. | TC-WTY-001 |
| FR-DEF-001 | Defect lifecycle: Defects can be logged against project/asset during DLP, assigned to responsible party, verified via rectification evidence upload, and closed with sign-off. | TC-DEF-001 |

## 6. Acceptance criteria — documents

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-DOC-001–003 | Upload uses a presigned URL; API does not receive file bytes; permission checked before intent | TC-DOC-001 |
| FR-DOC-004–006 | A 90 MB upload resumes after interruption; 101 MB rejected; EXE rejected by content | TC-DOC-002 |
| FR-DOC-007–009 | SHA-256 stored; duplicate warns; infected file becomes QUARANTINED and is not downloadable | TC-DOC-003 |
| FR-DOC-010–011 | Encrypted PDF rejected with guidance; links to requirement/asset persist | TC-DOC-004 |
| FR-DOC-012–014 | Missing required metadata blocks submit; revision creates v+1 and only one CURRENT | TC-DOC-005 |
| FR-DOC-015–017 | Approved version is immutable; expiry transitions requirement; preview works for PDF/image | TC-DOC-006 |
| FR-DOC-018–021 | Signed URL expires; bulk ZIP has manifest; soft delete restores within 30 days | TC-DOC-007 |
| FR-DOC-022–025 | Metadata edit after approval requires reason; reuse creates new project record; page count shown | TC-DOC-008 |
| FR-DOC-026–028 | Failed upload gives actionable error and retains file; retention class overrides default | TC-DOC-009 |
| FR-DOC-029–030 | Batch upload shows per-file progress/errors; split PDF produces separate documents with correct page ranges | TC-DOC-010 |

## 7. Acceptance criteria — reviews

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-REV-001–003 | Submit requires READY + metadata; request changes without comment rejected | TC-REV-001 |
| FR-REV-004–006 | Page comments persist; multi-stage (V1) blocks approval until all stages pass | TC-REV-002 |
| FR-REV-007–009 | Rejection notifies uploader; resubmission links prior version; self-approval denied | TC-REV-003 |
| FR-REV-010–012 | Admin override requires reason and is labelled; delegation respects permission/expiry | TC-REV-004 |
| FR-REV-013–015 | Concurrent decisions: one 200, one 409; guest reviewer requires grant and Party type | TC-REV-005 |

## 8. Acceptance criteria — notifications and handover

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-NOT-001–004 | Missing derived correctly; reminder respects schedule, quiet hours and dedup | TC-NOT-001 |
| FR-NOT-005–009 | WhatsApp failure falls back; digest contains only permitted items; escalation fires after N days | TC-NOT-002 |
| FR-NOT-010–013 | Notification failure does not roll back transition; message body contains no document content | TC-NOT-003 |
| FR-HND-001–004 | Package contains cover, index, approvals, waivers, asset register, merged docs and manifest | TC-HND-001 |
| FR-HND-005–009 | Generation is async, cancellable, versioned; snapshot consistent; missing files fail safely | TC-HND-002 |
| FR-HND-010–014 | Submission records recipient/method; acceptance/rejection requires decision; regeneration links versions | TC-HND-003 |
| FR-HND-015–018 | Package never includes another project's files; manifest checksums verify | TC-HND-004 |

## 9. Acceptance criteria — search, audit, billing, admin

| Requirements | Acceptance criterion | Test |
|---|---|---|
| FR-SRCH-001–005 | Search never returns out-of-scope items even with manipulated filters | TC-SRCH-001 |
| FR-RPT-001–006 | Reports match DB counts for a seeded project; exports respect permissions | TC-RPT-001 |
| FR-AUD-001–008 | Audit rows cannot be updated/deleted by app role; hash chain verifies; export includes checksums; legal hold blocks purge | TC-AUD-001 |
| FR-BIL-001–005 | Limits enforced; read access survives suspension; invoice shows GST fields | TC-BIL-001 |
| FR-BIL-006–010 | Failed payment → grace → suspension; paise arithmetic exact; credit note audited | TC-BIL-002 |
| FR-ADM-001–007 | Support cannot read content without break-glass; break-glass notifies and audits | TC-ADM-001 |
| FR-INT-001–011 | Email bounce handled; webhook signature invalid → 401; storage abstraction swap tested | TC-INT-001 |

## 10. Permission test matrix

For each permission in `05` §3, test:

1. Owner allow.
2. Admin allow/deny as per matrix.
3. Project member with role allow.
4. Member without project access → 404.
5. Guest with grant allow for scoped resource.
6. Guest without grant → 404.
7. Cross-tenant → 404.
8. Suspended membership → 401/403.
9. Archived project → read allow, write 409.
10. Self-approval → 403 unless override.

Automated test generation (**AUD-034**, **L-3**, **AUD-S-50**): tests must be **generated directly from the role matrix table** in `05` §4 across all 36 permissions × 10 roles, asserting exact allow/deny/scoped decisions, rather than relying on ad-hoc manual test sampling. Security tests must not rely on UI hiding.

## 10b. Project-isolation and integrity tests (AUD-004)

For `document_requirements`, `document_assets`, `document_contracts`, `package_items`:

1. Insert a row whose `project_id` belongs to a different project → expect a foreign-key violation, not an application error.
2. Cross-project `package_item` insert via the API → expect `404`.
3. Link a document from Project A to a requirement in Project B → expect `404`.
4. Verify the `package_items` FK covers both `package_id` and `document_version_id` scopes.
5. Verify `document_assets` permits exactly one `is_primary = true` per document.

## 10c. Approval race tests (AUD-007)

1. Submit versions V1 and V2 of the same document; approve both concurrently → exactly one succeeds; the other returns `409 INVALID_STATE_TRANSITION`.
2. Assert `documents.current_approved_version_id` is consistent after the race.
3. Assert the requirement state matches the winning version.
4. Assert both `reviews` rows are consistent (the loser is `CANCELLED` or absent).
5. Repeat 100 times under concurrency to detect flakiness.

## 11. Tenant-isolation test suite

For every top-level resource (`project`, `document`, `asset`, `requirement`, `package`, `party`, `review`, `submission`, `invoice`):

1. Create resource in Org A.
2. Authenticate as Org B owner.
3. `GET /resource/{id}` → 404.
4. `PATCH`/`DELETE` → 404.
5. List endpoints do not include A's resource.
6. Search with A's ID/term → no result.
7. Signed URL from A used by B → 403/expired.
8. Guest from A cannot access B.
9. Background job with forged org → rejected.
10. RLS direct query without `app.current_org` returns zero rows.

Also test storage key enumeration and PDF generation with a forged document ID.

## 12. File and PDF test corpus

| Fixture | Expected |
|---|---|
| Valid 1-page PDF | READY |
| 500-page PDF | READY; package within limit |
| Corrupt PDF | FAILED |
| Encrypted PDF | FAILED (MVP) |
| PDF with JavaScript | Accepted but no execution; sanitised preview |
| 0-byte file | FAILED |
| 101 MB file | 413 |
| EXE renamed `.pdf` | Rejected by sniffing |
| DOCX with macros (`.docm`) | Rejected |
| EICAR in ZIP | QUARANTINED (nested scan policy) |
| JPEG with GPS EXIF | Preview strips metadata |
| Scanned PDF | READY; no text |
| Zip bomb | Rejected by ratio/size |
| PDF with missing fonts | Renders with substitution; no crash |
| Unicode/Hindi filename | Display correct; storage key safe |

## 13. Workflow state tests

For every transition in `06`:

- Valid transition succeeds.
- Invalid transition returns `409` and writes no state.
- Side effects occur exactly once (notification, audit, job).
- Idempotent replay does not duplicate.
- Concurrent transition: one wins.
- Permission denied does not change state.

Property-based tests for requirement progress: random sets of evidence states produce the documented aggregate.

## 14. Failure-recovery tests

| Scenario | Expected |
|---|---|
| Kill worker mid-package | Job retried; no READY partial; no duplicate package |
| Redis restart | Queue recovers; in-flight jobs retried; uploads unaffected |
| DB connection loss | 503; retry; no partial transaction |
| Storage 500 on complete | Version stays UPLOADING/FAILED; retry works |
| Email provider 500 | Notification retried; review still approved |
| AV scanner down | Files stay PROCESSING; no download |
| Duplicate webhook | Single invoice update |
| Restore backup to staging | App boots; checksums match; RLS active |

## 15. Performance and load acceptance

| Test | Target |
|---|---|
| Project dashboard, 1,000 requirements | p95 <800 ms server, <2.5 s TTI |
| Checklist list with filters | p95 <500 ms |
| Upload intent | p95 <300 ms |
| Review decision | p95 <400 ms |
| Package 500 pages / 500 MB | p95 <10 min, memory <2 GB |
| Concurrent uploads (50 users) | no errors; queue depth bounded |
| Search 100k docs | p95 <800 ms |
| Audit export 100k rows | <60 s streaming |

## 15b. Injection and abuse tests (AUD-S-45/46/47/48)

| Test | Expectation |
|---|---|
| Payload in every user-controlled field rendered into a package | PDF contains escaped literal text; no active content |
| Fuzz metadata (title, remark, revision, filename) | No crash, no injection, no unescaped output |
| Fuzz PDF parser with corrupt/hostile files | Worker survives; file marked `FAILED` |
| Bulk export repeated 10× in 10 minutes | Rate-limited `429`; reason required; alert raised |
| Guest link used from 50 IPs in 5 minutes | Rate-limited; alert; link revocable |
| Session fixation attempt on login | New session id issued after authentication |
| SMS provider returns 500 twice | Email magic-link fallback issued; `EC-TECH-26` behaviour verified |

## 16. Security test acceptance

- OWASP Top 10 checks pass; no critical/high findings open.
- Auth rate limits verified.
- CSRF enforced.
- SSRF blocked on webhook URLs.
- XSS: user content escaped in UI and generated PDFs.
- SQL injection: parameterised queries; fuzz tests.
- IDOR: tenant suite passes.
- File upload: corpus passes.
- Secrets: no hits in repo history.
- Dependency: no known critical vulnerabilities at release.
- Pen test before paid launch; remediation plan.

## 17. NFR acceptance

| NFR | Acceptance |
|---|---|
| NFR-PERF-001–006 | Load tests meet targets; queue fairness verified |
| NFR-AVL-001–005 | Uptime dashboard; failover drill; degraded-mode test |
| NFR-SEC-001–012 | Security suite + pen test |
| NFR-PRV-001–006 | DSR drill; retention job verified |
| NFR-UX-001–007 | Usability test with 3 contractors; mobile viewport checks; axe accessibility scan |
| NFR-MNT-001–007 | Architecture lint; migration test; restore drill; runbook review |

## 17b. Edge-case coverage map (AUD-T-03)

Every `EC-*` scenario in `12` marked `Manual? = No` must have a `TC-EC-*` test. The map is maintained alongside `12` and regenerated here by the traceability script. Automatable scenarios include EC-DOC-01/05/06/07/12/19/23/24/25/26/27, EC-PRJ-05/16, EC-USR-04/07/15/16, EC-TECH-02/07/26/27/28/29/30, EC-SEC-07/08, EC-BIL-04/08.

## 18. UAT script (pilot)

1. Owner signs up and creates org (no assistance).
2. PM creates a project from HVAC template, customises 3 items.
3. Site engineer registers 5 assets via CSV.
4. Procurement invites a supplier; supplier uploads 2 documents on a phone.
5. Reviewer requests changes on one, approves the other.
6. PM generates a package with a known missing item and confirms the block/override.
7. Client accepts the package via guest link.
8. Owner exports the audit log.
9. Measure: time per step, errors, support interventions, SUS score.

**Pass:** 8/10 pilot users complete steps 1–6 without assistance; ≥90% requirement accuracy on the seeded project; no data-integrity defects.

## 18b. Screen acceptance coverage (AUD-T-06)

Every screen in `11` §3 must have at least one acceptance criterion and one E2E test before its feature is marked done. `11` §9 lists the key screens; the remainder are covered by the standard state matrix (empty / loading / error / permission-denied / offline banner).

## 19. Definition of done (per feature)

1. Requirement ID mapped to tests.
2. Unit + integration + E2E (where user-facing) passing.
3. Permission positive/negative tests.
4. Tenant-isolation test.
5. Audit event verified.
6. Failure path handled and tested.
7. Mobile viewport verified.
8. Accessibility check.
9. Analytics/telemetry (if applicable) contains no PII.
10. Documentation updated (`README` change control).
11. No open critical/high security findings.
12. Staging demo recorded.

## 20. Coverage targets

- Line coverage: ≥80% for domain modules; ≥70% overall.
- Branch coverage: ≥70% for state machines and permission logic.
- Every state transition covered.
- Every permission covered.
- Every endpoint has at least one auth test.
- Every migration has a rollback/forward test.

Coverage is a guardrail, not a goal; critical paths need explicit tests even at 100%.

## 21. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial test strategy and acceptance criteria |
| 0.2 | 2026-10-31 | Remediation: `TC-PTY-*` block (AUD-T-01); mandatory traceability gate (AUD-T-02); project-isolation and approval-race tests; injection/fuzz/abuse tests; SMS-failure recovery; EC coverage map; screen acceptance coverage |
