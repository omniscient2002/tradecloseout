# Independent G01 re-review — b45f0b5

Published review: https://github.com/omniscient2002/tradecloseout/pull/5#pullrequestreview-5847793285

Reviewed exact source `b45f0b5f4b7c4c1c838a2526aa6209f1a30a5c60` against previously reviewed `4f8a7bb183e892ee4626d9116c00a34dc097f76c`. PR #5 remains draft, unmerged and undeployed. **Changes required; G01 remains NO-GO.** R1–R5 scoped acceptance remains preserved. This review does not recertify the original 21 rows or authorize application merge/deployment.

## New reproduced findings

### G01-R6 / P2 / original G01-014,019: reversed MFA lock order

`apps/api/src/modules/identity/mfa.controller.ts:186` locks the session before the user row at line 188. `confirmEnrollment` locks the user at lines 220–223, then `rotateVerifiedSession` updates the session at lines 107–122 (called at line 251). Concurrent start/confirmation on the same account/session therefore has a real session→user / user→session cycle.

Independent Node 22.23.2 / PostgreSQL 16.15 reproduction ran the actual candidate controllers against a fresh database with all 38 migration files through 0037. Both runtime pools logged in as `tc_app`, non-superuser and without BYPASSRLS. The probe instruments only scheduling around real queries: pause start after successful session lock; run confirmation until it attempts session rotation while holding the user lock; resume start's user lock. PostgreSQL aborted start with SQLSTATE **40P01**; confirmation completed. No HTTP request was run for this probe. Static inspection of the actual global exception filter shows this unmapped database error becomes HTTP 500/INTERNAL_ERROR.

Fix: establish one consistent lock order for MFA operations and relevant session/recovery transitions, retaining in-transaction current token/generation/revocation validation. A small correction may retain existing user-first paths and move start's session recheck after its user lock, before any mutation, after checking the surrounding lock graph. Do not remove the session fence or merely suppress the error. Add deterministic restricted-PG tests for start/confirm overlap and relevant reset/recovery/revocation overlaps; require legitimate completion or deliberate controlled stale/conflict rejection, no 40P01/500, no persisted factor/recovery partial writes, and reusable pool clients. The existing revoke-before-start negative must continue to pass.

### G01-R7 / P2 / original G01-015,016,021: error filter bypasses request-ID privacy normalization

`apps/api/src/common/filters/problem-json.filter.ts:31–34` reads original `x-request-id` and permits any 1–128 character alphanumeric/underscore/dot/colon/hyphen string. It does not use the shared UUID normalizer or the sanitized authentication context. Sensitive-route logging at lines 89–93 stores this value; the error body and X-Request-Id response header also retain it.

Independent execution of the actual candidate filter with disposable fixture header `OTP_123456_INVITE_abcdef0123456789abcdef0123456789` and a simulated internal authentication failure confirmed all three paths retain the raw header, despite a sanitized `req.auth.requestId`. This is a reproduced credential-bearing telemetry path, not a claim of remote credential extraction. The filter probe uses a response/logger capture, not a running HTTP server or real provider.

Fix: use a single canonical safe request ID established before authentication and reused by guard/context/filter/logs/response; never retain the original invalid header as diagnostic metadata. Apply the shared UUID policy or generate a server ID, preserving safe UUID correlation. Add actual-filter tests for credential-shaped ASCII input, null/array/oversize/control values, unauthenticated auth/guest failures and authenticated failures. Assert captured logger arguments, problem body and response headers contain none of the submitted fixture credential. Keep safe exception redaction and controlled 4xx behavior.

## Verified evidence and its scope

- GitHub application run **42878647181** succeeded; actual integration checkout **551361ba35ddcbcbaada43f32e89dbd42e25fe19**, merging candidate b45f0b5 into main c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0. Logs confirm 49 API suites / 319 tests, 16 worker tests, 15 security/RLS, 8 RBAC and six filtered E2E-G01 tests. Typecheck, build and migrations passed. Protocol run **42878647185** passed.
- Independent focused run: **six suites / 23 tests passed**: authentication-security (16), external-document-attestation (1), MFA DB (2), session-guard DB (1), distributed budgets (2), actual legacy migration upgrade (1). No full local workspace/build/browser rerun is claimed.
- New legacy two-tenant upgrade and independently attested-proof preservation regressions passed. New actual child-process budget test passed. New role/session/privacy protections have meaningful targeted coverage, but the two probes expose missing cases.
- Six filtered Playwright tests include helper-only redirect and queued-context tests and an APIRequest origin test. They are not six complete production browser journeys. API OTP/browser configuration remains a fixture; strict NODE_ENV production smoke uses non-delivering provider URLs and loopback HTTP, not deployed TLS/provider/MFA acceptance.
- Original register/acceptance policy were not changed by the candidate delta. PR #9 remains a separate proposed documentation register update, not application approval.

## Original engineering still unfinished

The coder's own matrix accurately keeps all 21 original rows open for release. Its claim that currently accessible engineering/fixture work is complete is too broad:

1. **G01-011,010,020:** no durable provider message-ID/receipt correlation, signed callback verification and idempotent retry/reconciliation. Generic gateway contract, persistence/state machine, duplicate/stale/bounce/accepted-but-response-lost fixture tests can be implemented without real provider secrets; genuine provider adapter verification remains external.
2. **G01-014,019,020:** lost-all-factor/destination recovery is still engineering plus policy/IAM work. Design a fail-closed, independently reviewed case/approval/revocation/notification flow and identify exact owner policy decisions. Do not invent legal identity proof or add a bypass merely to close the row.
3. **G01-015,016,019:** exhaustive event and privileged-route inventory and the all-route malformed-input/canonicalization matrix remain unexecuted engineering verification. Automate inventory checks against actual routes, and exercise restricted-role/production-mode fixtures. External SIEM and deployed browser evidence is a separate requirement.
4. **G01-005,007,009,010,013,018:** two budget helper processes do not prove two HTTP API instances, crash/lost-response semantics or real interrupted multipart upload. Build the disposable reproducible harness where feasible; isolate genuine infrastructure/provider prerequisites precisely.

Complete provider-independent work while obtaining named owner/provider/staging prerequisites. Preserve the full 21-row acceptance policy; do not reclassify unfinished engineering as credential-only blocking. Real legal delegation, reviewer IAM, provider receipts, TLS/S3/staging/operations and independent final acceptance remain mandatory.

## Reproduction and raw artifacts

Local evidence: `docs/evidence/g01-recheck-b45f0b5/` contains the exact executed CJS probes, JSON outputs, focused Jest result and migration output. All data/keys/IDs are disposable fixtures. Source and dependency mounts were read-only; PostgreSQL had no published host port, and the isolated container was stopped/removed after execution. Unrelated workspace files were preserved.

Focused command inside cached Node 22 container at `/candidate/apps/api`:

```text
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory=/tmp/jest-review test/g01-legacy-external-migration-upgrade-db.spec.ts test/g01-external-document-attestation-db.spec.ts test/g01-mfa-db.spec.ts test/g01-distributed-rate-budgets.spec.ts test/g01-authentication-security.spec.ts test/g01-session-guard-db.spec.ts --json --outputFile=/review/focused-tests.json
```

The container joined disposable `tc-g01-review-b45f0b5-20261111` PostgreSQL network, with migration URL using disposable postgres and runtime URL using restricted tc_app; helper-created databases were random and removed. Probe commands:

```text
NODE_ENV=test TS_NODE_PROJECT=/candidate/apps/api/tsconfig.json NODE_PATH=/candidate/node_modules:/candidate/apps/api/node_modules:/candidate/node_modules/.pnpm/node_modules node -r ts-node/register/transpile-only /review/mfa-lock-order-probe.cjs
NODE_ENV=test TS_NODE_PROJECT=/candidate/apps/api/tsconfig.json NODE_PATH=/candidate/node_modules:/candidate/apps/api/node_modules:/candidate/node_modules/.pnpm/node_modules node -r ts-node/register/transpile-only /review/auth-filter-request-id-probe.cjs
docker stop --timeout 5 tc-g01-review-b45f0b5-20261111
```

The privacy probe ran with networking disabled. The MFA probe ran the actual migration runner in its own new disposable DB. Initial setup attempts failed on a missing read-only mount point and a missing transitive dependency path; corrected mount/module resolution produced the reported completed executions. No code or permissions were weakened to obtain passing fixture tests.
