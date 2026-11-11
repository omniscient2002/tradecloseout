# Phase 2 evidence and reproduction

The primary source is `e1b2d9506f2f5d1cbd853a91cade58f8bab3cee4` (PR16). G03-only source is `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08` (PR13). Main/policy source is `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. Git blob links in reports carry the actual source SHA; repository collaboration policy was read from main because it is not present on these divergent application branches. Source manifests cover 633 app/package/workflow/spec/policy blobs across both source snapshots, not generated node_modules/dist or the newly added audit harnesses. No application file was edited for publication.

## What was executed

All local service data is synthetic, on loopback PostgreSQL16/Redis with the repository's randomly named disposable database helper. Migrations run on the disposable DB with the migrator; service methods run as restricted `tc_app` (no SUPERUSER/BYPASSRLS). The helper refuses target mismatch and removes only its created random database. Do not point these probes at production or import real customer/environment secrets.

Node22 and package-manager version from package.json (pnpm12.4.1) were used, with qpdf/unzip and Playwright Chromium. Each frozen checkout used `pnpm install --frozen-lockfile`. The clean primary typecheck/build/workspace suite completed before audit probes were added. Full results are in typecheck.log, build.log, test.log, security.log and rbac.log. Test counts reflect the pinned candidate, not historical main or earlier PR12.

Primary commands, from repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
```

Runtime coordinates were supplied using `APP_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `REDIS_URL`, `PLAYWRIGHT_BROWSERS_PATH` and PATH. Use only your isolated local service credentials. No real provider token, OTP, payment key or customer data was used. The only HTTP delivery test starts a loopback server and sets a synthetic test token for that call, then restores the environment.

## Replay the independent observations

Copy this evidence directory into `docs/audits/phase2-2026-11-12/evidence` in a disposable checkout/archive of the exact candidate. Install its frozen dependencies and use Node22/pnpm12.4.1. Set isolated DB/Redis coordinates as above. From the repository root:

```bash
bash docs/audits/phase2-2026-11-12/evidence/run-probes.sh shared
```

For the separate PR13 source, copy the same evidence directory there and run:

```bash
bash docs/audits/phase2-2026-11-12/evidence/run-probes.sh g03
```

The runner verifies every manifested source byte for the selected snapshot before execution; it does not switch or merge branches. It selects only that candidate's harness. Output JSON defaults to a temporary file; set `PHASE2_PROBE_RESULTS` or `G03_PROBE_RESULTS` to retain an explicit result path. It does not write code or reset an existing DB.

The shared harness has 33 named observations: C01..C09 configuration, P01..P23 actual-service DB observations, N01 loopback transport. The G03 harness has 11 observations, G01..G11 (observation labels, not new group finding IDs). One Jest test wraps each observation collection; do not misreport these as 44 independent Jest tests or 44 vulnerabilities. Recorded IDs/hashes and JSON observations are the reproducible evidence.

Most probes record returned state rather than assert future corrected behavior; their final assertion checks collection/setup completion. Selected controls explicitly assert expected allow/deny outcomes. Passing this harness reproduces current behavior, including defects. It is not product acceptance and must be replaced/supplemented by meaningful regression tests when implementation changes that behavior. Probe-development type/fixture mistakes were corrected before the final evidence run; unsuccessful exploratory logs are not represented as product failures.

G03 G08 pauses an actual SQL query result after selecting editable affected projects, closes the project through another connection, then releases the actual service to commit reassignment. SQL results are never mocked. G03 G10 first proves ACTIVE-plan seat rejection, then changes the same synthetic subscription to PAST_DUE and retries the actual OTP/invitation acceptance. Debug OTP and an in-memory Redis/nondelivering mail adapter are used solely for this membership-capacity path; they do not certify G01 production authentication or delivery.

P20 intentionally supplies two clearly labelled synthetic authorization requirements with unregistered document-type IDs through public import service. It demonstrates missing catalogue/version/change-control validation. It is **not** an approved HVAC template, baseline, generated dossier or engineering readiness fixture. The activation-only empty snapshot rows likewise isolate manager/quota checks; no readiness/closure success is claimed from them.

P13 disproves a cross-project contract-reference hypothesis: the composite FK rejects with SQLSTATE23503. G03 G11 disproves a missing-contact/footer-read hypothesis on PR13: new fields round trip. C08/C09 and G03 proposed-fix positives also document controls that work. These are retained so rejected hypotheses are not converted into findings.

## CI and provenance limits

[PR16 application run](https://github.com/omniscient2002/tradecloseout/actions/runs/43105998545) succeeds on the exact primary SHA; its group-protocol run also succeeds. [PR13 application run](https://github.com/omniscient2002/tradecloseout/actions/runs/42991530966) fails on the exact separate SHA: two API tests fail, 347 pass. The failing suites are discovery-lifecycle-foundations and g01-member-invitation-authority-db; newer safety restrictions invalidate an older expected workflow/fixture. Resolve their contracts and actual path coverage; do not weaken offboarding or re-enable one-sided transfer merely to turn CI green. Downstream PR13 security/RBAC/strict-production/API-browser steps are skipped in that run. Group-protocol success is structural and does not override failed application CI.

Remote metadata and bounded failure excerpts are in ci.json. These are retrieved evidence, not a new CI run initiated by this audit. The local G03 recheck reproduces the same two failures (2 failed / 11 passed in those two suites); its focused validation/typecheck logs are separate from full primary results. Portable replay passes for both snapshots after checking all 323 shared and 310 G03 source blobs; see portable-shared.log and portable-g03.log. No full local PR13 build/workspace run, integrated candidate, full Phase2 production-built application journey, real provider acceptance, sustained production load, legal retention/tax review or deployed validation is claimed. Retain these as explicit gaps.

Canonical G03 IDs/statuses remain unchanged. This is source assessment and documentation publication under the repository's independent-review protocol; it grants no self-approval or release certification. SHA256SUMS fingerprints the deliverable bundle and source-manifest.json fingerprints reviewed source; hashes provide integrity, not external attestation.
