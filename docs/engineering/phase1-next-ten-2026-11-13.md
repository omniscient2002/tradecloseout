# Phase 1 next ten repairs — N11–N20

Baseline: draft PR #26 at `6e4230bc8d36936db4660ab19879498d4da00fbd`, itself based on the unmerged Phase 1 candidate. Local tested source and test commit: `6a2c3c80024ecdf2357b50377dce689b1ce0b6fa` (application changes first recorded in `6f5d6bd59511d64571bc6f388238f272924a009e`). Feature branch: `fix/phase1-next-ten-20261113`. Publication uses the connected GitHub app; the final PR records the published SHA and exact matching Git tree.

This pass implements ten bounded controls. They share infrastructure where appropriate; they are not ten fully accepted audit findings. The original 49-row register, independent review requirements, merge authority and deferred provider/service gates are unchanged.

| Control | Original finding IDs | Before → implemented behavior |
|---|---|---|
| N11 — current asset authority | PH1-G02-008 / PH1-G26-004 | Asset services trusted admitted/stale role context. They now lock/check live account, org and membership; load current project role/scope; and deny revoked **S-scoped** authority before dependent rows. |
| N12 — asset lifecycle serialization | PH1-G02-009 | Asset create/update/retire/revalidate/import could write after closure. Each now obtains the shared project `FOR UPDATE` lock before asset/evidence rows and requires ACTIVE/HANDOVER. Retained reads remain available except CANCELLED, subject to authority. |
| N13 — restrictive asset scopes | PH1-G02-001/003 | Stored read-only and asset restrictions were ignored. Supported assetIds/categoryKeys/date/mode/readOnly shapes are strictly validated; unknown/malformed shapes fail closed. Mutations enforce scope and read-only restrictions; scoped creation cannot invent a new ID outside an explicit asset-ID assignment. Replacement targets are also scoped. |
| N14 — scoped asset projections | PH1-G02-001 | Lists, exports and matching could return unassigned assets; history/passport/detail could bypass the parent scope. Lists/matches apply predicates before materialisation, export inherits that result, and indirect/detail reads authorize the actual asset first. |
| N15 — real atomic imports | PH1-G26-006 / PH1-G02-008/009 | An outer “atomic” transaction invoked public createAsset on independent connections. Creation now has an internal same-client implementation; selected rows and staged audit/outbox effects commit or roll back together. Preview retains row-level validation reporting. |
| N16 — eligible revalidation actor | PH1-G02-008 / PH1-G02-001 | asset.manage alone could reach evidence decisions. The live actor additionally needs Owner/Admin/PM/QC org role or PM/QC project role; the existing no-self-revalidation and row-version protections remain. These are role checks, not proof of professional credentials. |
| N17 — asset mutation input contract | PH1-G02-005 | Malformed strings/statuses/dates/replacement IDs could reach SQL or throw .trim errors. Controlled validation now rejects malformed supported mutation fields and revalidation inputs before checkout. Legacy matching tags are escaped before regex use. |
| N18 — MFA attempt input contract | PH1-G01-003 | Arbitrary strings consumed committed MFA budgets before the lower store rejected them. Verify now requires exactly six digits and recovery requires the existing 24-hex-code format before budget/store work. |
| N19 — bulk review identity contract | PH1-G02-005 | Malformed/duplicate bulk IDs could reach guard authorization SQL before service validation. PermissionGuard validates bounded nonempty unique UUID lists before pool work, retaining service validation as a second boundary. |
| N20 — auth connection uncertainty | PH1-G26-006 / PH1-G01-004 | Three scoped SessionCsrfGuard lookups could reuse uncertain connections or mask primary errors with rollback failure. BEGIN/COMMIT uncertainty and rollback failure now destroy clients; primary error/controlled project-denial behavior remains. Lock/statement/idle budgets bound these scoped lookups. |

## Authority and domain review

The current runtime permission evaluator is retained. Owner/Admin authority is derived from current membership, never the caller's orgRole shortcut. Existing explicit organisation-wide A/Y grants remain usable without project assignment; removal of a project assignment revokes S authority, not a separate org-wide grant. A project member's stored restrictions still apply. This pass does **not** settle the outstanding dual-policy/A/Y/S specification disagreement.

The new asset scope vocabulary is explicit: `assetIds`, `categoryKeys`, `readOnly`, `mode`, `startDate`, `endDate`. Dates use valid calendar dates and UTC asset-created dates; empty allowed-ID lists match no assets. Unsupported legacy shapes are denied rather than interpreted as unrestricted. Operator-reviewed legacy scope reconciliation and a canonical versioned scope schema remain open.

Ordinary guest sessions are denied by these internal asset service boundaries. A separately reviewed supplier/client asset workflow with exact live grant/party/resource scope remains required; no internal role is lent to a guest. The code does not claim full guest acceptance.

No migrations, applied SQL checksums, runtime role grants, RLS, package lockfile or acceptance-policy files were weakened or rewritten. Asset identity revision/evidence invalidation logic remains in the same transactional implementation. The change does not create or certify an HVAC baseline, immutable scanner evidence, legal authority or a customer-accepted package. Authorization-only fixtures intentionally contain no fabricated engineering evidence.

The atomicity guarantee covers the rows selected by the import's existing validation/conflict policy. Explicit SKIP can still skip conflicts; non-atomic imports retain per-item outcomes. UPDATE conflict semantics still need a separately reviewed identity-revision workflow; no automatic replacement of historical identity/evidence is claimed.

## Verification

**Final local results:** typecheck/build/migrations PASS; workspace PASS (55 API suites / 429 tests, 43 DB checks, 56 worker checks, 44 shared tests, six archive browser tests and PDF checks); security/RLS 15 PASS; RBAC 8 PASS. The full authenticated application browser suite was not run in this pass.

The final evidence directory is `docs/evidence/phase1-next-ten-20261113/`. It records source hashes, raw logs and the actual production-mode HTTP probe. Local tests use Node 22.23.5, pnpm 12.4.1, fresh isolated PostgreSQL16/Redis7, restricted tc_app, actual qpdf12.3.2/unzip and Chromium for the root archive browser project.

Commands (from the feature worktree):

```text
pnpm install --frozen-lockfile --store-dir /tmp/tco-phase1-pnpm-store
pnpm db:migrate
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
pnpm --filter @tradecloseout/api exec jest --runInBand test/phase1-next-asset-authority.spec.ts test/phase1-next-input-auth.spec.ts test/discovery-lifecycle-foundations.spec.ts test/hvac-domain-excellence.spec.ts test/phase0-evidence-integrity-remediation.spec.ts test/hvac-production-reaudit-remediation.spec.ts
```

Disposable-service contract: PostgreSQL on `127.0.0.1:55440`, Redis on `127.0.0.1:56390`, base DB `tradecloseout`. MIGRATOR_DATABASE_URL uses disposable postgres; APP_DATABASE_URL and TEST_DATABASE_URL use restricted `tc_app:app_local_pw`. DB_HOST/DB_PORT/DB_NAME and DB_MIGRATOR_USER/PASSWORD were set consistently to the same disposable cluster. No laptop authentication files or external provider keys were used. Test containers and the task-owned API are stopped after validation.

The regression evidence includes:

- Actual SessionCsrfGuard + PermissionGuard admission, followed by real project-member removal: later asset mutation denies.
- Real PostgreSQL shared membership/project locks: opposing removal/closure reaches 55P03 while the admitted transaction holds its locks; post-removal mutation denies.
- Real positive allowed asset mutation, negative other-asset mutation, read-only writes, category/date/empty scopes, cross-tenant parent denial, guest denial, scoped list/export/matching/history/passport access and unqualified revalidation denial.
- Single-connection successful import plus an injected second-row DB failure: earlier new assets and audit effects roll back. No separate nested connection or partial persisted first row.
- Nine actual `NODE_ENV=production` loopback HTTP results: scoped list/detail, read-only and out-of-scope write rejection, authorized write, closed-project denial and malformed MFA/recovery/bulk requests. Sessions and CSRF are synthetic DB fixtures. This is not a real OTP/MFA provider or deployed TLS/browser journey.
- Deterministic malformed-input and failure-injection tests for the changed auth and guard paths.

Older domain-only mock tests now declare explicit current-authority fixtures; the real authority/race tests are separate PostgreSQL tests. The legacy F01–F07 DB fixture now seeds its actual Owner and assigned independent PM. The old MAINTENANCE asset status was replaced with a valid RETIRED non-identity transition because the real schema never permitted MAINTENANCE. The wrong-asset revalidation test now supplies mandatory expectedRowVersion=1 so it reaches its original NotFound assertion. No assertion or runtime constraint was relaxed.

Initial failures included missing authority fixtures, a now-rejected invalid status, test typing, and a missing revalidation precondition. One focused invocation lacked sandbox access to its DB and timed out; it was stopped and rerun with disposable-service access. Failed attempts are not counted as passing controls. Final command results and exact GitHub CI are recorded in the PR and retained logs.

## Remaining work

Document batch-link and other command-family authority/lifecycle gaps remain. Canonical permission/scope policy, all-route/body-ID validation, full external guest workflows, session/system-caller inventory, multi-process crash/revocation semantics, complete receipt recovery, lease/outbox/notification state machines, sandboxing, operational instrumentation and full authenticated browser journeys remain outside these ten scoped controls. No original PH1 finding is marked independently accepted or released.
