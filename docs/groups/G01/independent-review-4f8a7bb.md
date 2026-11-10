# Independent supplemental G01 source acceptance — 4f8a7bb

**R1 through R5: scoped source corrections accepted. Original G01-001–021 release acceptance remains open; G01 remains NO-GO. This is not application merge or deployment approval.**

Reviewed candidate: `4f8a7bb183e892ee4626d9116c00a34dc097f76c`.
Independent review: https://github.com/omniscient2002/tradecloseout/pull/5#pullrequestreview-5846558186
Implementation handoff: https://github.com/omniscient2002/tradecloseout/pull/5#issuecomment-6769310107
Tracking issue: https://github.com/omniscient2002/tradecloseout/issues/6

## Scope and disposition

| Supplemental finding | Independent result |
|---|---|
| R1 — org-switch client cleanup | Prior acceptance at 223c468 preserved; relevant source unchanged and current CI regressions pass. |
| R2 — runtime UUID type | Prior acceptance at 223c468 preserved; relevant source unchanged and current CI regressions pass. |
| R3 — bounded denial audit and cancellation | Now accepted for the reviewed source correction after independent real-database reproductions pass. |
| R4 — worker startup mode/config/actual role | Prior acceptance at 223c468 preserved; relevant source unchanged and current CI regressions pass. |
| R5 — unsupported authentication promises | Prior contract-correction acceptance at 2d6aaf1 preserved. This withdraws unsupported promises; it does not implement a provider or recovery feature. |

The new delta from 2d6aaf1 is three files, 203 insertions and 31 deletions. It changes the denial helper, its regressions and timeout documentation. It does not change the accepted org-switch, worker startup, enrollment wrapper or API fallback-correction paths.

The register updates only supplemental R1–R5 to REVIEW_VERIFIED at the candidate SHA. Original 21 rows are preserved verbatim. No row becomes RELEASE_ACCEPTED, no production gate is waived, and no review-policy rule is changed. Reviewer/implementer provenance identifies distinct agent roles; both use the owner's GitHub identity, so this is not a second human GitHub approval.

## Independent reproduction results

The actual candidate helper ran under cached Node **22.23.2**, PostgreSQL **16.15** and locked **pg 8.23.1**. Its original migration runner applied all **36** migrations to a fresh disposable database. Runtime calls used restricted `tc_app` with `rolsuper=false` and `rolbypassrls=false`. Administrator access was used for migration, fixture locks and observing results only.

The previous reproduction logic was reused, changing only candidate identity and disposable database name. Source and dependencies were mounted read-only. No customer/production data, provider credentials or laptop authentication files were used.

| Probe | Previously failed at 2d6aaf1 | Actual result at 4f8a7bb |
|---|---|---|
| Hold only pool connection, await helper, then release | Returned at 1,003 ms; late event committed after release | Returned at **251 ms**; **zero late events**, pool closed normally after late checkout release |
| Hold ACCESS EXCLUSIVE lock on auth_request_budgets | Returned at 752 ms; backend still waiting at ~1,778 ms; late event committed on unlock | Returned at **362 ms**; **no active audit backend** at return or one second later; **zero events** after unlock |
| Sequential distinct-source throttled samples alternating over two restricted pools | 30 events from 40 attempts | **Exactly 30 events from 40 attempts**, shared cap preserved |

Raw results, executed probe and original migration output are in `docs/evidence/g01-recheck-4f8a7bb/`. The warmed parallel load-shedding probe still admits only two samples, so it is not counted as proof of reaching the global cap. The sequential independent probe and new exact-count CI regression provide that proof.

The isolated PostgreSQL container was stopped and automatically removed after the run. No application source or runtime permissions were altered for the probes.

## Source and regression assessment

The helper now explicitly acquires a client with a 250 ms waiting deadline. A checkout delivered after expiry is released without SQL. Once acquired, the helper uses an independent transaction with server-side `SET LOCAL lock_timeout='350ms'` and `statement_timeout='600ms'`. It waits for COMMIT or ROLLBACK and discards a client whose cleanup fails. It does not return a client with an intentionally abandoned SQL operation.

The original access denial, shared event budgets, redaction, enrollment-start auditing, locally capped failure diagnostics and critical unsampled events are preserved. The server settings are transaction-local; the change does not impose a global 600 ms timeout on business transactions.

New actual-PG16 CI regressions test held checkout and held backend lock, no late event/budget writes, pool reuse and exactly 30 persisted events from 40 sequential admitted attempts across two restricted pools. They directly cover the reproduced failures, rather than merely asserting that a Promise returns.

The security contract now explicitly distinguishes acquisition/server timeouts from a strict end-to-end one-second response guarantee under an unresponsive network. Network partitions, cleanup availability and actual multi-node failure behavior remain release acceptance work; they are not claimed verified by this scoped source review.

## CI evidence and limits

[Application run 42828939414](https://github.com/omniscient2002/tradecloseout/actions/runs/42828939414) passed. Its logs show checkout of integration merge `649be33`, merging the candidate into main `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. Recorded results:

- Node 22 / pinned pnpm frozen install, typecheck, production builds and PG16 migrations passed.
- 48 API suites / **315 API tests** passed.
- **16 worker tests**, **15 negative security/RLS tests**, and **four filtered G01 browser tests** passed.
- [Protocol run 42828939263](https://github.com/omniscient2002/tradecloseout/actions/runs/42828939263) passed.

I reran the focused independent database probes, not the full local workspace. The browser API remains test/debug OTP mode. Neither those CI results nor the focused probes establish strict production/provider acceptance.

## Remaining original G01 acceptance

The original 21 findings are not recertified by accepting these supplemental fixes. Their existing register statuses and engineering/operational requirements remain authoritative. Unaccepted gates include independently established external contact/legal delegation and reviewer IAM; real delivery receipts/reconciliation; strict production HTTPS/API/MFA/real offline interruption; actual multi-node restart/replay/network-failure drills; deployed monitoring/privacy/key rotation/retention; recovery contracts and final independent 21-row acceptance. Additional engineering may be needed to satisfy those rows.

PR #5 stays draft/unmerged. This documentation update neither merges its stacked PR #2–#4 dependencies nor approves customer release.

## Commands and reproducibility

Commands used include:

```text
git fetch origin main pull/5/head:refs/remotes/origin/pr-5
git diff --stat 2d6aaf1 4f8a7bb
git diff 2d6aaf1 4f8a7bb -- apps/api/src/modules/identity/auth-security.ts apps/api/test/g01-auth-denial-budget-db.spec.ts 13-SECURITY-PRIVACY-AND-COMPLIANCE.md
git archive 4f8a7bb183e892ee4626d9116c00a34dc097f76c
docker run --detach --rm --name tc-g01-r3-review-4f8a7bb-20261110 -e POSTGRES_PASSWORD=review_disposable_pw postgres:16-alpine
```

The Node container joined only the disposable PostgreSQL container's network, exposing no host port. It mounted the candidate at `/candidate`, existing root/API node_modules read-only at `/home/cassandra/tradecloseout/...`, and the isolated probe/output directory at `/review`. It set `NODE_PATH` to those API/root dependency directories and `TS_NODE_PROJECT=/candidate/apps/api/tsconfig.json`, then ran:

```text
node -r /home/cassandra/tradecloseout/node_modules/ts-node/register/transpile-only /review/probe.cjs
docker stop --timeout 5 tc-g01-r3-review-4f8a7bb-20261110
```

Fixture database names/passwords in the probe belong only to its disposable container. Keep this source evidence separate from provider/staging results. Local unrelated files were preserved, and no application merge or deployment was performed for this review.
