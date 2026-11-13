# Implementation checkpoint — 2026-11-13

The user requested implementation first, focused checks afterward, and deferred
full validation to a later session. The user then requested wrapping up for now.
Work stopped at this checkpoint. **All engineering fixes are not complete.**
No canonical finding was independently closed, and no merge/deployment occurred.

Source baseline: `5cf388d4edb17dbb71372266f8002fe8aadd3a0c`.
Feature worktree: `/tmp/tco-phase2-reaudit`.
Branch: `fix/phase2-reaudit-20261112`; existing draft PR #25.
The checkpoint commit is local unless a later session explicitly records a push.
Preserve the unrelated untracked audit documents in the original workspace.

## Candidate code written

- Versioned lifecycle commands with durable replay receipts, live authority,
  required reasons, cancellation/archive/resume and existing closure qualification.
- Immutable persisted configuration authoring, independent publication, governed
  pack installation/upgrade lineage, preview, independent baseline review and
  version-bound change proposal/approval/application. Existing baseline writers
  pass through the same lifecycle and change-control checks.
- Recipient-scoped safe inbox DTOs, pagination/read state, optimistic preferences,
  signed nonessential unsubscribe, correlated signed delivery receipts, expiry,
  dispatch preference/visibility checks and audited redrive.
- Membership reactivation with seat accounting; role/project-grant cleanup;
  package/submission operational responsibility separated from authorship;
  per-work allocation with version checks, atomic replay and qualification checks;
  emergency suspension path that can suspend otherwise unmanaged projects.
- Resumable onboarding and fresh-MFA owner deletion-review requests. Physical
  deletion remains disabled pending retention/legal/provider review.
- Explicit one-project offer binding only under a separately approved policy;
  project-bound consumption uses the immutable binding.
- Candidate consumers for approved reminder schedules, shared qualified overdue
  indicators, upload restrictions, safe package naming and immutable package
  branding snapshots with bounded exact-version logo retrieval.
- New inbox, preferences, unsubscribe, onboarding, settings/ownership/allocation,
  configuration and expanded project lifecycle web controls.
- Append-only migrations 0055–0063 and corresponding schema additions.

## Evidence obtained

Use Node 22.23.5 and pnpm 12.4.1. Environment-local disposable services only;
fixture runtime uses restricted `tc_app`. No real provider/customer data was used.

- `pnpm db:migrate`: passed on the existing disposable service through 0059.
  Later fresh disposable workflow databases successfully applied through 0063.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-codepass-workflows-db.spec.ts`:
  **7 passed**, final log `/tmp/tco-codepass-final-workflows.log`. Covers lifecycle
  replay/stale writes; independent configuration/baseline review and approved
  changes; inbox projection/pagination/read/preferences/unsubscribe; onboarding
  concurrency; signed delivery receipt correlation/replay; role cleanup; atomic
  per-work allocation and preserved submission authorship.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-configuration-boundaries.spec.ts test/phase2-entitlements.spec.ts test/phase2-project-lifecycle-lock.spec.ts test/phase1-notification-producer-db.spec.ts test/phase2-two-party-ownership-db.spec.ts`:
  73 passed, one old mock needed current authority. After updating that fixture,
  configuration boundaries passed (32 tests). The other four suites passed;
  they have not been repeated after subsequent code additions.
- `phase2-easy-ten.spec.ts`: 16 passed during focused runs.
- `pnpm build`: 6 workspace builds passed, log `/tmp/tco-codepass-build.log`.
  This was an in-progress snapshot; subsequent dashboard/schema and fixture edits
  mean this is **not** an exact-checkpoint-head build claim.
- Final `pnpm typecheck`: passed (exit 0), log
  `/tmp/tco-codepass-checkpoint-typecheck.log`.
- `git diff --check`: passed before checkpoint documentation was added.

These are service/database fixture checks and compilation evidence. They do not
certify complete application journeys, real delivery, or HVAC domain acceptance.

## Known unfinished engineering / first work on resume

1. Run focused worker tests for the new reminder SQL, expiry/eligibility settlement,
   shared overdue definition, package-profile trigger, branding integrity and
   naming/upload consumers. These newest paths have no functional acceptance yet.
2. Complete trusted business-event notification producers through the outbox,
   supplier templates/deep links, provider outcome reconciliation after ambiguous
   acceptance, attempt history, fair channel claiming, jitter/rate limits and
   operational queue metrics. Provider/privacy approval remains external.
3. Complete subscription fulfilment/reconciliation/dunning under real approved
   provider/finance policy. Live payment and financial issuance remain disabled.
   Check immutable project binding replay, period boundaries and all consumers.
4. Finish suspended-organisation read/export recovery without weakening account,
   member, guest, MFA or transaction authority. Existing suspension still denies
   most application access. Finish profile locale/date-format round trips and
   consistent consumers; unsupported settings must not be claimed as working.
5. Finish per-work eligible replacement suggestions, pending submission counts in
   the legacy gap report, role-change responsibility checks for submissions,
   emergency-suspension browser controls and fresh-assurance/reactivation tests.
   Explicit per-work allocation exists, but external party delegation still fails
   closed until independently verified authority is available.
6. Finish reviewed applicability inputs/mapping preview and material asset/contract
   change invalidation. Real HVAC catalogue/COMP/R-001..013 mapping and publication
   need accountable engineering review; do not fabricate a baseline or approval.
7. Review mandatory/locked change semantics, snapshot source verification on
   approved application, package/submission acceptance invalidation, readiness
   qualification and lifecycle concurrency across every writer.
8. Reconcile all 58 original outcomes individually in IMPLEMENTATION-REGISTER.json.
   Entries intentionally remain partial candidate/external states. The prior 34
   scoped implementation corrections are not 34 independently closed findings.
9. Then perform the user-deferred full workspace/security/RBAC/browser/CI checks,
   migration upgrade/rollback review, independent security/tenant/HVAC review and
   real integration acceptance on one exact proposed SHA. No self-approval.

All current code is candidate code and may need correction after these checks.
