# Production audit handoff — review before any merge or release

**Read first:** [Source-pinned audit (28 findings)](./2026-11-08-tradecloseout-production-source-audit.md) · [CSV verification register](./2026-11-08-tradecloseout-findings.csv)

## What this change does (and does NOT)

This branch adds **documentation only**. It does not patch production logic, add automated tests, or certify a release. It is an actionable handoff for the next engineer/reviewer. **Do not merge this PR as though the findings are fixed.** Keep a separate remediation PR for each coherent fix batch, with executable negative tests and evidence.

- Audited baseline: `main` commit `2449d52f5a6f9ed266b98f1c9526a8d29320ba6e` (2026-11-08).
- Independently open draft [PR #2](https://github.com/omniscient2002/tradecloseout/pull/2) at `7d80d16325864f5bc4fc1eb2f872d6ff02013462`: template consumption, durable payment webhook receipt, verified full dossier access including accepted artifacts, and active-plan catalog. Those changes are **NOT part of this PR or main at audit time**. PR #2 intentionally does not provide payment reconciliation or subscription fulfillment.
- Earlier merged PR #1 repaired the prior checklist baseline race, substantive-waiver invalidation and latest-readiness closing checks; these are not counted as unresolved in this register.
- Evidence classification: `Confirmed by source; runtime reproduction pending` means a code-path observation, **not** a completed exploit or live-test reproduction. Investigate and label confirmed, fixed, false positive, accepted risk or superseded only after a reviewer recreates/inspects the behavior.
- No fresh local DB, HTTP, E2E, real S3, ClamAV, SMTP/SMS, Razorpay sandbox or disaster-recovery test was run for this documentation PR. Main CI success is not a substitute for these checks.
- The 28 entries are an audited shortlist (**4 Critical, 15 High, 9 Medium**), not proof that the system has only 28 defects. Zero-defect production readiness cannot be certified from a static review.

## Reader workflow for every TC-Axx item

1. Open the specific source-pinned links from the audit and inspect the code on the **actual intended merge head**. If reviewing PR #2 or subsequent changes, redo path tracing there: old line numbers refer to audited main.
2. Reproduce the negative/acceptance test from the register in a disposable PostgreSQL-backed tenant. Test with **actual least-privileged app roles**, RLS enabled and HTTP auth where applicable; mocks/unit tests alone are insufficient for identity, data-isolation, durability, or closeout.
3. Record an outcome for each finding: `OPEN`, `CONFIRMED`, `FIXED + TESTED`, `FALSE POSITIVE (with rationale)`, `SUPERSEDED`, or `RISK ACCEPTED` (named approver + expiry).
4. Create a separate remediation PR linked to the exact `TC-Axx` identifiers. Include regression test file, command, environment and observed pass/fail result, SQL migration impact and rollback/forward repair steps.
5. Re-run impacted scenarios end-to-end before declaring a fix: e.g. accepted handover -> download -> closure -> mutation attempt -> audit integrity. Never claim a source observation was runtime-proven if it was not.

## Priority gates with required independent verification

### Gate P0 — identities, authorizations, recipient evidence (block real project access)

- **TC-A01**: supplier-upload guest must get HTTP 403 for project dossier/PDF/package download; authorized client grant passes; cross-project and cross-tenant DENY.
- **TC-A02**: a document uploader cannot self-certify an unrelated client/consultant inspection witness as `AUTHENTICATED_ATTESTATION`; proof binds actual principal, party, inspection and evidence revision.
- **TC-A03**: internal package acceptor must not become an independent legal recipient merely by passing `recipientPartyId`; guest party-specific acceptance and separately verified external evidence work.
- **TC-A04**: accepted RA-bill annexure may not qualify as an accepted complete handover package; latest full-manifest, purpose, required-recipient and snapshot semantics must be explicit.
- **TC-A06/07/13**: warranty updates, defect closure and external signoff must require correct independent permissions, accurate document associations and proof verification.
- **TC-A08**: no recipient status `SENT`/`DISPATCHED` unless actual delivery occurs; include provider receipt, retry, bounce and failure states.

### Gate P1 — immutable closeout and deterministic lifecycle

- **TC-A05**: CLOSED project rejects all asset create/update/delete/retire, related requirement generation and racing writes; test concurrent close vs asset update with transaction boundaries.
- **TC-A09**: allow authorized downloading of the accepted full dossier. This is reported fixed in **unmerged PR #2**, pending review and end-to-end S3 verification.
- **TC-A14/19/20/28**: NOT_APPLICABLE waiver remains correctly represented after countersign; review and closure mutations use required version/ETag preconditions; stale updates return conflict/412; full evidence revision history remains reconstructable.

### Gate P2 — commercial correctness; DO NOT take real payments until green

- **TC-A10/16**: verified webhook receipt is *not* settlement. Implement safe provider-reference reconciliation (duplicates, out-of-order, tenant binding), subscription entitlement changes and explicit invoice status transitions; independently confirm with Razorpay sandbox.
- **TC-A15**: finance and tax owner sign off GST treatment, tax jurisdictions, invoice uniqueness and legal wording; parallel invoice issuance cannot duplicate IDs.
- **TC-A17**: replay idempotent commands after failure between business commit and response-receipt persistence, including worker crash and multi-instance executions.

### Gate P3 — actual deployable product and operations

- **TC-A11/12/24/26**: validate production env variables at startup; build and deploy to isolated staging; check readiness with Redis, storage, scanner and worker failure; prove dead-letter operator replay, metrics/alerts and zero-data-loss restore.
- **TC-A18/21/22/23/27**: test offline multi-tab race, expired presigned URLs and user-switch isolation; fix asset-tag matching; remove/hide fake demo login, hardcoded OTP and intentionally disabled customer actions; seeds refuse production even with prod-like DB URL.
- **TC-A25**: any third-party archive authenticity promise must use an independently anchored cryptographic receipt, not merely self-consistent checksums.

## Commands and end-to-end matrix

Inspect `package.json` scripts on the reviewed head before executing. From an isolated CI or staging environment with disposable databases and services:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
# Requires separately running/staged app and test identities:
pnpm test:e2e
```

Run separate release acceptance suites for: disposable Postgres migration+rollback and tenant RLS; all TC-A01–A08 negative HTTP and transaction tests; malicious/unsigned, replayed and reordered provider webhook events; worker crash/retry and notification delivery; actual S3 key/version pinning and pre-signed URL expiry; ClamAV scanning fail-closed; 100+MB upload resume and cross-account offline queue isolation; PDF and ZIP tampering; complete handover PDF download/recipient acceptance/reopen; real browser role journeys; backup/PITR restore, disaster and deploy rollback.

For each acceptance suite attach: source commit SHA, environment configuration **without secrets**, exact command, assertion list, result logs, failed assertions, database fixtures/cleanup and independent reviewer sign-off.

## PR #2 integration and rebasing safety

This handoff intentionally targets `main`, not the draft PR #2. Before merging **either** PR, compare any changed paths/behaviors with the latest implementation. Mark A09 and A16 as potentially superseded by PR #2 *only after CI + live integration verification*; A10 remains unresolved for full payment settlement. New PR #2 dossier access may expand the A01 authorization surface: re-test its endpoint. If this doc branch merges first, it does not unblock PR #2 or production. If PR #2 merges first, refresh source references and evidence statuses rather than assuming fixes.

## Reviewer decision and merge rules

**This documentation PR:** approve only if all 28 rows match actual source, links open, severity is justified, claimed mitigations are precise, missing tests are explicit, and the handoff is clear. Documentation merge ≠ production release approval.

**Subsequent remediation PRs:** require design/code review, application test results, at least one negative test per affected defect, database migration review, multi-tenant permission check, any rollback plan and independent acceptance.

**Production release:** BLOCKED until all Critical and High defects are fixed with recorded tests or individually accepted as documented risk by authorized stakeholders, and full staging/payment/delivery/S3/DR validation is complete. The source findings alone do not establish `zero issues`.

## Sign-off record (fill in, do not pre-check)

- [ ] Reviewer has inspected all TC-A01–TC-A28 findings against the intended target commit.
- [ ] Owner has triaged each finding and supplied an issue/remediation PR link.
- [ ] Security reviewer has signed off role/tenant/recipient proof flows.
- [ ] Finance/legal owner has signed off warranty, recipient acceptance and payment/tax claims.
- [ ] Tests and real-service evidence are attached to the fix PRs.
- [ ] Release manager has reviewed deployment, recovery and residual risk register.
- [ ] No claim has been made that this docs-only PR fixes source code or deploys the app.
