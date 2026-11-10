# PR #5 independent G01 closure review — 2026-11-10

**Decision: No, the latest PR does not close all G01 findings. Keep draft; no merge or production sign-off.**

This review compares the original 21 findings in the local `docs/group1_analysis` with the actual candidate source, migrations, test implementations and GitHub Actions logs. Substantial corrective code is present. Remaining work includes source defects, incomplete feature/operational contracts and missing acceptance evidence. This is not a claim that every original vulnerability remains exploitable.

## Exact candidate and evidence

- PR: https://github.com/omniscient2002/tradecloseout/pull/5
- Head: `0b1523e4deee1abe66e861fe6bbe8e060e0a192a`.
- Base `main`: `2449d52f5a6f9ed266b98f1c9526a8d29320ba6e`.
- Merge base: `d8e2a31990a98b7a23a4547f0b4f780882281ded`.
- PR diff: 103 files, 8,711 insertions, 557 deletions. The branch stacks unmerged PRs #2–#4.
- PR metadata was rechecked after source inspection: same head, open, draft, unmerged. No reviews/comments were returned by the PR discussion tool.
- CI associated with this head: https://github.com/omniscient2002/tradecloseout/actions/runs/42795542130 — **success**.
- Important precision: Actions checked out synthetic merge `bcddab7df2cd849be9c2fe93e1b8c9ffa74fd3a5`, merging this head into the above main, rather than checking out the head directly. This is valid integration evidence for this candidate/base pair.

## Remaining source findings

### R1 — P1: org-switch rejection can leak a checked-out database connection

Source: [identity.controller.ts lines 945–951](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/modules/identity/identity.controller.ts#L945-L951), [SessionCsrfGuard lines 66–70](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/common/guards/session-csrf.guard.ts#L66-L70).

`switchActiveOrg` calls `pool.connect()` before checking that `req.cookies.tc_session` is present. Missing-cookie rejection occurs before the `try/finally` that releases the client. The guard explicitly accepts bearer sessions, so an authenticated bearer request with valid CSRF and a valid target UUID can reach this branch without a cookie. Repetition can exhaust the shared connection pool. Other exceptions during setup before the `try` have the same cleanup problem.

Move cookie/setup validation before acquiring the client and place all post-acquisition work within `try/finally`. Verify repeated bearer-only rejections do not increase checked-out connections and subsequent legitimate requests still complete. Static control-flow finding; pool exhaustion was not executed locally.

### R2 — P2 / G01-016: org-switch input still relies on coercion

Source: [identity.controller.ts lines 934–965](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/modules/identity/identity.controller.ts#L934-L965).

`targetOrgId` has only an inline TypeScript type and a regex test, without a runtime string check. A JSON value such as `{"targetOrgId":["01999999-1234-7000-8000-999999999999"]}` passes the regex through array-to-string coercion. The original array is then passed to PostgreSQL, where the driver serializes it as an array value rather than a UUID. The resulting database error is not mapped to a validation response by the problem filter; a 500 is expected. This is a validation defect, not a demonstrated tenant bypass.

Use a runtime DTO/schema or explicit string validation and add HTTP object/array/number negatives. The expected HTTP/database outcome is source-derived, not a locally executed reproduction.

### R3 — P2 / G01-015: authentication history is still incomplete in code

Source: [mfa.controller.ts lines 220–270](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/modules/identity/mfa.controller.ts#L220-L270), [SessionCsrfGuard](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/common/guards/session-csrf.guard.ts), [auth-security.ts lines 233–250](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/modules/identity/auth-security.ts#L233-L250).

Invalid/replayed TOTP and invalid recovery codes throw without a corresponding durable denied event. Session rejection paths likewise lack a consistent security-event writer. Successful MFA events and sampled rate-limit events exist, but do not reconstruct individual failed attempts. The event schema/writer also lacks trusted source metadata and a structured reason field. These are implementation omissions, not merely missing monitoring screenshots.

Add bounded, redacted denial/recovery/session events that survive the rejected operation's rollback, with an explicit event-store failure policy. Test event persistence and secret exclusion for each critical outcome.

### R4 — P2 / G01-012: startup validation does not cover the worker process

Source: [worker main.ts lines 24–62](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/worker/src/main.ts#L24-L62), [API main.ts](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/main.ts).

The API invokes fail-fast configuration and actual database privilege validation. The worker still falls back to local PostgreSQL/Redis URLs, accepts an unknown/missing environment mode and does not perform an equivalent actual-role check. It now participates in authentication/invitation cleanup. The original requirement was validated runtime configuration per process; worker parity remains source work. This does not establish that any deployed worker currently uses unsafe credentials.

### R5 — P2 / G01-020: documented authentication features remain unsupported

Source: [API contract lines 157–158](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/10-API-AND-INTEGRATIONS.md#L157-L158), [provider contract line 489](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/10-API-AND-INTEGRATIONS.md#L489), [identity.controller.ts lines 225–234](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/src/modules/identity/identity.controller.ts#L225-L234).

The current contract still lists magic-link request/consume endpoints and email magic-link fallback after two SMS failures. The controller implements OTP and tells the user to try a verified email; that is not automatic verified-account fallback. Sending an organisation invitation through a helper named `sendMagicLinkEmail` does not implement the advertised authentication endpoints. Implement the supported recovery mechanism or revise the contract explicitly, as the original audit permits.

## What the successful CI actually establishes

Inspected job `129759662828` logs, not just its green badge:

- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm db:migrate`, `pnpm test`, `pnpm test:security` passed under configured Node 22 / pnpm 12.4.1 with disposable PostgreSQL 16 and Redis.
- API workspace: **46 suites, 304 tests passed**, including `rbac-matrix.spec.ts`. The separate `pnpm test:rbac` command was not a distinct workflow step.
- Negative security suite: **3 suites, 15 tests passed**.
- Other workspace suites and six archive-browser checks passed.
- Application project filtered to `E2E-G01`: **4 tests passed**. The actual journey covers OTP registration, TOTP enrollment, cookie rotation, stale-cookie denial, two-tab logout and revoked-cookie denial.

Limits are visible in the implementation:

- [Workflow line 88](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/.github/workflows/deploy.yml#L88) runs the API with `NODE_ENV=test ENABLE_DEBUG_OTP=true`; only Next runs in production mode. Consequently the journey uses the development Redis challenge path and does not exercise production API startup enforcement, production PostgreSQL OTP issuance, HTTPS cookies or production owner/admin MFA enforcement end to end.
- [Queue browser test lines 115–129](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/web/e2e/critical-flows.spec.ts#L115-L129) calls `isQueuedUploadContextCurrent` on plain objects. It does not run IndexedDB, multipart upload or account-switch timing. Two other checks mock `/auth/me` or OTP responses.
- [Distributed budget test](https://github.com/omniscient2002/tradecloseout/blob/0b1523e4deee1abe66e861fe6bbe8e060e0a192a/apps/api/test/g01-distributed-rate-budgets.spec.ts) uses two PostgreSQL pools. This is useful shared-counter concurrency proof, not two deployed API nodes with proxy spoofing, process crashes or dropped responses.
- The workflow runs an application subset, not the complete `pnpm test:e2e` journey. Successful fixture/provider-HTTP tests do not establish real provider acceptance or end-user receipt.

## Original 21-finding disposition

“Source addressed” means the original mechanism has corrective code and relevant inspected test coverage. It is not production acceptance, nor an assertion of exhaustive independent verification of every path.

| G01 | Source assessment | Remaining closure condition |
|---|---|---|
| 001 | Real distinct principals, restricted two-reviewer approval functions, current project-party binding, immutable decisions and emergency revocation are implemented. The old claim that no independent-review implementation exists is obsolete. | Independently obtained legal/contact/delegation evidence, distinct human reviewer IAM, legitimate positive guest witness/review/acceptance and issuer self-approval negatives in staging. |
| 002 | Issuer/guest subject separation addressed; legacy guest sessions invalidated. | Deployed downstream audit attribution and tenant/guest identity verification. |
| 003 | Origin checks and browser-bound login intent implemented. | Production proxy/cross-site/deep-link/browser negatives. |
| 004 | Logout callsites use server revocation and honor failure. | Full reachable-control failure/timeout browser verification. |
| 005 | Generation/epoch invalidation and queue fencing implemented; real two-tab logout passes CI. | Tenant/account/guest switching, in-flight requests and interrupted multipart/IndexedDB browser proof. |
| 006 | Authenticated CSRF bootstrap implemented. | Storage-loss and cross-origin proof through deployed proxy. |
| 007 | PostgreSQL shared IP/contact/grant/global budgets and proxy configuration checks implemented. | Real two-node/proxy saturation and provider spend/alert evidence. |
| 008 | Production HMAC removes store-only OTP guessing. | OTP key rotation/version policy and outstanding challenge behavior; MFA previous-key support is not OTP key rotation proof. |
| 009 | Production OTP consumption and session issuance share a PostgreSQL transaction. | Crash/commit/response-loss/replay outcomes across API instances; no durable login-result replay contract was established by this review. |
| 010 | Guest resend supersedes prior challenges. | Real provider/two-node request-versus-verify races. |
| 011 | Delivery persists state and leaves grant lock before provider I/O; ambiguous outcomes fail closed. | Receipt/retry/reconciliation integration and crash recovery; cleanup alone is not reconciliation. |
| 012 | API startup hardening implemented; worker parity incomplete (R4). | Worker configuration fix plus deployed TLS/role/secret/rotation evidence. |
| 013 | User/member/org eligibility checked during session issuance. | Concurrent suspension and deployed HTTP verification. |
| 014 | Idle/absolute expiry, credential rotation, revoke-one/all and role-change revocation implemented. | R1 connection cleanup plus lost-destination/compromise recovery and multi-device acceptance. |
| 015 | Useful protected success/revocation/OTP events implemented; denial/event contract incomplete (R3). | Complete critical-event coverage, trusted metadata, monitoring and retention. |
| 016 | Many runtime validations added; org-switch coercion still escapes them (R2). | Fix and run full malformed-body/header/path/canonicalization negatives. |
| 017 | Return-path allowlist replaces unchecked navigation. | Encoded redirect/browser/proxy matrix. |
| 018 | Real service/PG tests and a genuine partial browser journey replace much of the weak evidence. | Production-mode API/browser, actual queue integration and multi-instance failure proof. |
| 019 | Encrypted TOTP, replay prevention, recovery codes, explicit MFA route allowlist and reset revocation implemented. | Full privileged endpoint inventory, production enforcement and lost-factor recovery browser/operational acceptance. |
| 020 | Explicit signup and intended-identity, single-use, delivery-gated invitations implemented. | R5 unsupported promises, verified alternate-contact recovery and real invitation delivery. |
| 021 | Auth no-store/referrer policies and redacted exception paths implemented. | Deployed proxy/browser/cache/analytics/log inspection and token-retention evidence. |

## Method, commands and limitations

Read-only source investigation used these commands (plus targeted `rg`, `sed`, `cat` and `nl -ba` reads of the cited files):

```text
git status --short --branch
git rev-parse HEAD
git fetch origin pull/5/head:refs/remotes/origin/pr-5
mkdir -p /tmp/tc-g01-review-0b1523e
git archive 0b1523e4deee1abe66e861fe6bbe8e060e0a192a | tar -x -C /tmp/tc-g01-review-0b1523e
git merge-base 2449d52 0b1523e
git diff --stat 2449d52...0b1523e
git diff --stat ecc4be6 0b1523e
node --version
pnpm --version
```

GitHub connector reads: `search_prs`, `get_pr_info`, `fetch_pr_comments`, `fetch_commit_workflow_runs`, `fetch_workflow_run_jobs`, `fetch_workflow_job_logs`, `fetch_workflow_run_artifacts`. The returned artifact list contains a browser report, not signed provider/delegation/staging acceptance.

Local runtime is Node `v26.4.0`, pnpm `12.4.1`; no local application tests, destructive pool-exhaustion experiment, services, provider calls, migrations or deployment were run. Test results above are inspected CI evidence under Node 22, not a claimed independent local rerun. Newly identified source findings need dedicated reproductions/regressions. Source inspection was targeted to G01 and its interfaces, not an exhaustive review of every stacked HVAC/billing change. Existing workspace changes were preserved; this review document is the only authored repository file. No PR comment, approval, merge or deployment was submitted.

**Acceptance remains incomplete.** Fix the remaining source defects, resolve the feature/recovery contracts, pass final-head CI after changes, then attach the production browser, provider, distributed-failure, reviewer IAM/delegation and operational evidence to the 21-row closure register. Green CI is meaningful engineering evidence; it cannot supply those missing results.
