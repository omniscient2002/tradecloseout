# Phase 1 ten-fix implementation evidence

Local tested application source commit: **`5c5b9b248141327c6bd3ed124f9d56b33564e6c0`**. Baseline: **`dd21bdbaa8096c3f5e15b51e0e8bd7e96d319bf5`** (unmerged draft PR #19). Branch: `fix/phase1-easy-fixes-20261112`. Subsequent evidence-only commits preserve this application source; [source hashes](../evidence/phase1-ten-fixes-20261112/source-sha256.json) identify all changed application/test files.

[The difficulty matrix](phase1-difficulty-and-ten-fixes-2026-11-12.md) maps all 49 original PH1 rows to Easy/Medium/Hard and describes E01–E10. Ten implementations are small subrequirements across ten original finding IDs, not ten fully accepted findings. Broader requirements and provider/service acceptance remain open. This author proposes fixes and evidence; no independent acceptance, merge or production approval is asserted.

## Change and risk review

- **Authentication/privacy:** one UUID correlation policy is applied before auth and reused by guards/filter; invalid raw headers are discarded. Valid UUID correlation survives. MFA proposal IDs/codes are validated before attempt-budget and SQL work, including store entry points. Existing encrypted factor, expiry, replay, CSRF and rotation behavior is retained and exercised in PG regressions.
- **Authorization/tenant isolation:** absent permission metadata now denies. Every currently registered UUID route parameter name is covered by the shared validation list; invitation/signing token/key segments retain their separate contracts. The current-org alias remains explicit. Document-controller policy is loaded from the migrated column and cannot be inherited by guests. This does not resolve all A/Y/S or row-scope issues. The review-read permission change was deliberately excluded because its services still need scope enforcement.
- **Uncertain outcomes:** handler failure/non-success cannot prove rollback, so the generic idempotency interceptor preserves its unresolved claim. A real committed DB effect followed by an injected lost acknowledgement cannot re-execute on the same key. This is a deliberate fail-closed tradeoff: failed commands can stay pending. An authorized durable outcome/reconciliation workflow remains required; clients/operators must not clear claims or retry an irreversible command based only on age.
- **Worker/storage safety:** production/staging fail before queue startup if the bounded qpdf probe fails. Notification gateway configuration rejects insecure transport outside explicit loopback development/test, credential URLs and redirects; streamed JSON ACKs are bounded to 4 KiB and require exact accepted notification identity. Scheduler connections are discarded after uncertain BEGIN/COMMIT or failed rollback. Complete lease fencing, short notification/outbox claims, retry/dead letters, readiness and sandbox controls remain open.
- **Schema/migrations/domain:** no SQL migration was added or changed, and no permissions/RLS constraints were weakened. ORM projections remove nonexistent columns and use the actual migrated download-policy column; real restricted-PG select-all queries passed. This is a local ORM correction, not full schema equivalence. HVAC baseline, evidence qualification and closure logic were not changed; affected workspace/domain regressions remain mandatory.

## Environment

Node **22.23.5**, pnpm **12.4.1**, isolated PostgreSQL **16** and Redis **7**, official Arch qpdf **12.3.2**, unzip and existing Playwright Chromium. Source was edited in a separate worktree; the main checkout and its unrelated untracked audit files were preserved. Dependencies were installed with `pnpm install --frozen-lockfile --store-dir /tmp/tco-phase1-pnpm-store`; the lockfile is unchanged. pnpm's normal supply-chain policy verification remained enabled. No real provider credentials or customer data were copied or used.

The Node22 path was `/tmp/tco-phase2-node22/node_modules/node-linux-x64/bin/node`; exact `node --version` is captured with the final environment record. The temporary pnpm shell shim only adapts the installed shebang-less pnpm launcher for Turbo's direct process spawning. It delegates to the same pinned pnpm and does not alter checks, scanner/policy, dependency versions or lockfile.

A fresh `tco-phase1-easy-pg` container exposed **127.0.0.1:55439** only, and a fresh `tco-phase1-easy-redis` exposed **127.0.0.1:56389** only. Both were task-local disposable services. Random database helpers created/dropped their own databases. Runtime queries used restricted `tc_app`; migrator/fixture connections were separate. No BYPASSRLS or runtime privilege relaxation was introduced.

## Commands and results

The following environment was used for the completed broad rerun. Values are synthetic disposable test credentials:

```sh
export PATH=/tmp/tco-phase2-node22/node_modules/node-linux-x64/bin:/tmp/tco-phase1-toolchain:/tmp/tco-phase1-toolchain/usr/bin:/usr/bin:/bin
export LD_LIBRARY_PATH=/tmp/tco-phase1-toolchain/usr/lib
export MIGRATOR_DATABASE_URL=postgres://postgres:phase1_disposable@127.0.0.1:55439/tradecloseout
export APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout
export TEST_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout
export REDIS_URL=redis://127.0.0.1:56389
export DB_HOST=127.0.0.1
export DB_PORT=55439
export DB_NAME=tradecloseout
export DB_MIGRATOR_USER=tc_migrator
export DB_MIGRATOR_PASSWORD=migrator_local_pw
```

| Exact command | Result and evidence |
|---|---|
| `pnpm typecheck` | PASS; [log](../evidence/phase1-ten-fixes-20261112/typecheck.log). |
| `pnpm build` | PASS, all six workspace builds; [log](../evidence/phase1-ten-fixes-20261112/build.log). Turbo reused applicable unchanged build cache. |
| `pnpm db:migrate` | PASS on fresh disposable base DB; [log](../evidence/phase1-ten-fixes-20261112/migrations.log). Random integration DBs run the actual migrations separately. |
| `pnpm test` | PASS on the committed source: 53 API suites / 387 tests; 43 DB tests; 56 worker checks; 44 shared tests; six archive browser tests and all PDF checks; [full log](../evidence/phase1-ten-fixes-20261112/workspace-tests.log). |
| `pnpm test:security` | PASS, 3 suites / 15 tests under restricted runtime; [log](../evidence/phase1-ten-fixes-20261112/security.log). |
| `pnpm test:rbac` | PASS, 1 suite / 8 tests; [log](../evidence/phase1-ten-fixes-20261112/rbac.log). Role helpers alone are not endpoint-wide authorization acceptance. |
| `pnpm test:e2e --grep 'PH1-G27-007\|E2E-01'` | PASS, two selected application tests with actual production-built web/API; [log](../evidence/phase1-ten-fixes-20261112/application-browser.log). Does not include the portfolio/debug-OTP journey. |
| `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase1-easy-boundaries.spec.ts test/phase1-problem-error-redaction.spec.ts` | PASS, final guards/privacy rerun; [log](../evidence/phase1-ten-fixes-20261112/final-boundaries.log). |
| `node --import tsx --test test/phase1-easy-boundaries.spec.ts` from apps/worker | PASS, 20 tests including 18 scheduler fault cases; [log](../evidence/phase1-ten-fixes-20261112/focused-worker.log). |

Additional focused DB/MFA/receipt and API results are retained in the same evidence directory. Most are subsumed by the workspace run; do not add overlapping totals together.

The real built API ran in `NODE_ENV=production` against the disposable services. Three HTTP requests with a credential-shaped request-ID canary returned sanitized UUID correlation: health **200**, unauthenticated auth/me **401**, malformed project ID **400 / INVALID_RESOURCE_ID**. [Observed HTTP results](../evidence/phase1-ten-fixes-20261112/production-http.json) record exact status and safe IDs. These are loopback HTTP checks, not deployed TLS/provider acceptance.

## Failed setup attempts and scope limits

- An initially copied dependency tree was rejected as belonging to another checkout. The offline container attempted normal policy/tarball verification and could not access the network. That attempt was stopped, and a proper frozen-lockfile installation succeeded with checks enabled. No scanner/policy failure was bypassed.
- The installed pnpm launcher lacked an executable shebang, so Turbo initially received ENOEXEC. A temporary shell adapter fixed direct process launch; the actual pinned pnpm and checks remained unchanged.
- An early typecheck caught a missing scheduler disposal variable during implementation; corrected before the recorded passing checks.
- The initial qpdf mirror URL from the local package index had expired (404); the exact official Arch package archive supplied the test binary. No converter/scanner stub replaced it.
- The first broad/security run mixed URL settings with legacy DB_* defaults in two suites, causing three API / two security assertions to fail. The fixture seeding connections and runtime were not pointed at the same DB. The environment contract was corrected, including TEST_DATABASE_URL, and the entire workspace plus security were rerun. Do not call that initial run green or weaken assertions/permissions to repair it.
- Regression fixtures and injected provider/commit failures do not certify real SMTP/SMS/scanner/storage acceptance, actual network interruption, multi-process ownership correctness or a complete authenticated browser journey. The full third application journey requires its approved isolated portfolio/login fixtures and was not run. No external integration, release approval or deployment is asserted.

The shell Git push had no HTTPS credentials. Publication uses the connected GitHub app, whose commit metadata can differ from the local source commit. The published candidate must match the tested file hashes; its exact SHA and matching tree are recorded in the PR. GitHub application/protocol CI must be inspected on the final PR head, separately from these local results. The PR description records those observations without changing original acceptance registers. No merge is authorized by this evidence.
