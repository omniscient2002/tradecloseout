# Test implementation recheck — 2026-11-06

## Implementation update (Full End-to-End Journey & Migration Deployments)

The high-priority implementation and integration gaps identified in previous reviews have now been resolved and verified across the working tree:

| Area | Implementation and Verification Status |
|---|---|
| **E2E Application Journey (E2E-01 & E2E-03)** | Implemented [`apps/api/test/contractor-user-journey.spec.ts`](file:///home/cassandra/tradecloseout/apps/api/test/contractor-user-journey.spec.ts). Verifies the complete 6-stage lifecycle: contractor upload intent → multipart S3 upload → real ClamAV stream scan (clean + EICAR malware + fail-closed socket error) → technical review (self-approval blocked + QC approval) → handover package dossier compilation (pure-Node pdf-lib fallback, TOC, Bates numbering, S3 versioning & metadata) → client recipient acceptance with unbroken audit hash chain (`broken_count = 0`). |
| **Real Storage & ClamAV Protocol Fixtures** | Built RFC-compliant ClamAV TCP daemon server ([`apps/worker/test/helpers/clamav-server.ts`](file:///home/cassandra/tradecloseout/apps/worker/test/helpers/clamav-server.ts)) supporting `zINSTREAM\0`, clean chunks, EICAR malware quarantine, and fail-closed socket drops. Updated S3 fixture ([`apps/worker/test/helpers/storage-server.ts`](file:///home/cassandra/tradecloseout/apps/worker/test/helpers/storage-server.ts)) to support versioning, `latestVersions` resolution, and `x-amz-meta-*` header persistence and verification. Dynamic `CLAMD_HOST`/`CLAMD_PORT` support added to worker scanner. |
| **Database Migrations 0014 & 0015** | Deployed migration `0014_protect_remaining_tenant_tables.sql` (enforcing FORCE RLS on `config_versions`, `asset_categories`, `notification_templates`, `retention_policies`, `admin_audit_events`, `job_executions`, `payment_events`). Created and deployed forward migration `0015_document_versions_updated_at.sql` adding `document_versions.updated_at` and aligning check constraints for `storage_objects` (`PROCESSING`), `usage_counters` (`PACKAGE_GENERATIONS`), and `submissions` (`SUBMITTED`). |
| **Storage Object Verification & Disaster Recovery Drill** | Reconciled legacy ready storage objects with `provider_version_id` and `observed_size_bytes`. Verified pre-invoice restore drill (`scripts/run-restore-drill.sh`) passes with **3 seconds RTO** (target <= 14,400s), exact row count parity, recomputed SHA-256 payload digests, and verified forced RLS in `pg_class`. |
| **Test Suite Verification** | All monorepo packages pass cleanly: API (22 suites / 151 tests), DB (9 tests), Worker (11 tests), Shared (4 suites / 44 tests), PDF Engine (3 suites), Web Archive Verifier (6 Playwright tests), and Security Suite (`pnpm test:security`, 3 suites / 15 tests). |

### Verification after implementation

- Root `pnpm test` passed across all six workspace packages.
- API: 22 suites, 151 tests passed (including complete contractor journey and committed command replay regression).
- Shared: 4 suites, 44 tests passed.
- DB: 9 tests passed, verifying fresh vs 0005-upgrade schema equivalence and RLS boundaries.
- Worker: 11 tests passed, verifying Redis locks, notification capture gateway, and portable archive processor.
- Browser: 6 offline Chromium cases passed in Playwright.
- PDF Engine: 3 compilation and Bates stamping suites passed.
- Security: `pnpm test:security` passed (3 suites / 15 tests).
- Disaster Recovery Drill: `bash scripts/run-restore-drill.sh` passed in 3 seconds.

### Setup and operational requirements

`pnpm test` builds shared/DB/PDF dependencies, then runs package suites sequentially. `test:unit`, `test:api`, `test:integration`, `test:artifacts`, `test:browser` select lanes. `test:e2e` selects the separately configured application browser project, which still requires running services and appropriate isolated fixtures; it is not included in the offline-browser acceptance claim.

Install Chromium with `pnpm --filter @tradecloseout/web exec playwright install chromium`. Database tests require MIGRATOR_DATABASE_URL with permission to create/drop their own temporary databases; APP_DATABASE_URL must identify the non-owner, NOBYPASSRLS application role. REDIS_URL and the `unzip` tool are required for worker regressions. The helper never resets an existing database. CI supplies these dependencies and uses the password declared by the base migration.

For actual notification delivery configure NOTIFICATION_DELIVERY_URL and NOTIFICATION_DELIVERY_TOKEN to a trusted gateway. It receives the scoped queued notification JSON with Authorization and Idempotency-Key headers, must resolve its recipient, must deduplicate by notification ID even after a database rollback, and must return JSON `{ "accepted": true, "notificationId": "<same notification ID>" }` only after acceptance. Requests time out after 10 seconds. Missing configuration or rejection leaves the notification queued; no external messages were sent during these tests.

Portable exports require versioned object storage and S3_BUCKET for output. Source objects use their recorded bucket and provider version. Metadata-only historical receipts/old pending manifests lacking pinned storage identity are rejected by the new compiler and must be regenerated. Completed artifact identity is in verification_receipt_json.artifact; the outer receipt's total_bytes continues to describe original evidence bytes, while artifact.sizeBytes describes ZIP bytes. SHA-256 consistency is not digital signing or authenticity proof. Keep an independently retained export receipt.

The 281-case extensive guide remains the broader backlog. The fixes above do not claim its full completion or establish pilot readiness.

## Original review

Reviewed the current working tree against `TRADECLOSEOUT_EXTENSIVE_TEST_IMPLEMENTATION_GUIDE.md`. New tests and package commands are present, but the guide is not fully implemented. Passing the new checks does not establish the claimed integration coverage. This review adds this report only; no application fixes were made.

## Executed checks

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed. |
| API Jest, direct execution with local PostgreSQL access | 20 suites / 149 tests passed. Same count as previous review. |
| Shared Jest, direct execution | 4 suites / 36 tests passed. |
| PDF engine package test | Passed its three scripted checks: inspection, front matter, compilation. |
| Root `pnpm test` | Failed before tests: Turbo child spawn `Exec format error`. This is an execution/environment failure, not a failing application assertion. |
| New worker and database scripts | Inspected, not executed. They use an existing local database rather than creating isolated fixtures. Worker script invokes tenant-wide cleanup/dispatch methods that can affect unrelated rows. |

Initial PDF execution hit sandbox IPC restrictions; rerun outside the restriction passed. No real browser, ClamAV/S3 pipeline, restore, migration upgrade or crash-recovery tests were run in this recheck.

## Findings, ordered by severity

### R01 — High: notification test accepts fabricated delivery

`apps/worker/src/scheduler.ts:445` updates external notifications to SENT without calling any provider. This method is called by the worker loop (`apps/worker/src/main.ts:131`). The new worker test at `apps/worker/test/worker-integration.spec.ts:94` asserts this false SENT state rather than requiring provider acknowledgment. This reintroduces the trust failure covered by NOTIF-01/03/04 and T11.

Required test: enqueue one scoped email to a capture provider; assert request, recipient/content and acknowledgment before SENT. Unavailable/rejected provider must leave retryable/failed state, never SENT. Seed another tenant's notification and assert it is untouched by a scoped test.

### R02 — High: idempotency cleanup enables duplicate business effects

`apps/worker/src/scheduler.ts:389` deletes unresolved `response_status = 0` claims older than 15 minutes, including claims whose business command may have committed before response persistence failed. It does not reconcile against a durable command outcome. The scheduled worker calls it at `apps/worker/src/main.ts:123`. The new test inserts an expired completed key only, so it does not exercise this unsafe unresolved-claim branch.

Required TX-05/06 test: commit a non-idempotent business effect, terminate the API before saving its receipt, age the unresolved claim, run reconciliation, and replay the same key. Assert one business effect and a recovered receipt or explicit unresolved rejection. Never delete the protection merely because time elapsed.

### R03 — High: portable archive reports completion without verified evidence

`apps/worker/src/queues/portable-archive.processor.ts:157` skips fetching entirely without S3_BUCKET; skips objects without object_key; catches missing-file fetch errors and continues; GetObject does not pin VersionId; no per-file size/digest verification occurs. It can then mark export COMPLETED even without uploaded durable storage, before deleting local temporary bytes.

The new worker archive fixture has no object_key and uses a generic mock S3 response (`apps/worker/test/worker-integration.spec.ts:145` onward). It checks completion/hash length but never extracts the ZIP or compares evidence bytes. Therefore it can pass while including no evidence, and does not fulfill ARC-02/03 or PKG-04/05.

Required test: real versioned object storage, known file bytes, extract archive independently, assert exact file set and per-file hashes. Missing/corrupt source, overwritten latest key, missing provider config and failed output upload must prevent COMPLETED. Verify durable output version before deleting temporary files.

### R04 — High: generated offline verifier does not verify files

`apps/worker/src/queues/portable-archive.processor.ts:60` reads manifest JSON, displays supplied digests and marks every item verified without reading file bytes, calling cryptographic digest, or checking a signature. It calls the manifest signed without verifying a signature. Manifest fields are also interpolated through innerHTML, allowing untrusted titles/project names to become markup.

Required ARC-03/WEB-UX security tests: open verifier offline through its supported launch method; remove/alter one evidence file and alter the manifest; all must produce explicit failures. Inject markup titles and assert text rendering with no script execution. Verify actual file bytes and integrity provenance before success labels. Browser file:// launch must be tested rather than assuming fetch of sibling files works there.

### R05 — Medium: shared tests include assertions disconnected from production behavior

`packages/shared/test/status-transitions.spec.ts:12` defines transition tables inside the test and asserts their contents; it never invokes application transitions. `packages/shared/test/dates-money.property.spec.ts` checks local BigInt arithmetic and a copied quiet-hours function; it is not randomized property testing. Its purported beyond-safe-integer value is actually below Number.MAX_SAFE_INTEGER, and its negative-amount test contains only positive inputs.

Required SHARED-03/04/05/06 tests: call actual transition/money/date application paths, use independent expected vectors, test values above the safe-integer boundary, submit negative amounts through production validation, and replay seeded randomized command sequences. Removing a production guard must fail its test.

### R06 — Medium: database test labels overstate what is exercised

`packages/db/test/db-integration.spec.ts:24` labels a ledger lookup DB-01/02 without creating or upgrading any database or comparing file checksums. Its RLS insert accepts any thrown error, so a missing required column or unrelated constraint failure counts as proof of RLS. Its catalog check at line 98 excludes tables with RLS entirely disabled. Checking constraint names does not test cross-tenant/project writes. Audit checks validate links/hash length, not recomputed content or tampering; the log claims UPDATE/DELETE while only attempting UPDATE.

Required tests: disposable fresh/upgrade databases, actual file checksum comparison and mismatch rejection, valid foreign-write fixture failing specifically with the intended SQLSTATE/constraint, complete tenant-table inventory including disabled RLS, and controlled tampering with independent digest recomputation. Assert nonzero fixture data so empty tables cannot vacuously pass.

### R07 — Medium: new integration scripts lack fixture isolation and relevant failure coverage

Worker test chooses an arbitrary existing active project with LIMIT 1, seeds persistent rows, uses MockRedis without NX/TTL/ownership semantics, and runs scheduler methods over all active tenants. It does not launch BullMQ workers, inject crashes, extract archives, exercise scanner/provider failure, or test genuine quiet-hour boundaries. Database script also depends on an already-populated local database/ledger.

Required fix: introduce the guide's disposable two-tenant/two-project fixture harness, real Redis, namespaced buckets/queues and deterministic barriers/clocks. Clean up only fixtures owned by this test run. Never call tenant-wide mutation helpers on a shared workspace database just to satisfy an assertion.

### R08 — Medium: browser and release-gate coverage still missing

Browser source remains two scenarios in `apps/web/e2e/critical-flows.spec.ts`; no web test command/configuration was added in the inspected inventory. CI does not run the required browser/provider/storage/scan/crash/recovery matrix. Root `test:security` still invokes a Jest test file through tsx, despite the file relying on Jest globals; wire it through the test runner before treating that CI step as a reliable security gate.

Required work: establish explicit unit/integration/HTTP/artifact/browser lanes, run the guide's E2E-01..08 at their feature gates, and maintain per-case evidence. Merely adding case IDs in comments is not coverage.

## Coverage assessment

There is useful progress: package-level test commands, real shared validator/permission helper checks and a PDF compilation smoke test. However the new DB/worker scripts cover selected assertions, not the wide case ranges claimed by their headings. No defensible percentage of the 281-case guide can be derived from these labels. Keep case IDs marked partial until the actual scenario, boundary and oracle are implemented.

Next order: repair R01–R04 and add tests that fail on those regressions; build isolated infrastructure harness; replace R05/R06 assertions with behavior tests; then expand the HTTP/browser/recovery lanes. Existing green counts are not sufficient to approve pilot readiness.
