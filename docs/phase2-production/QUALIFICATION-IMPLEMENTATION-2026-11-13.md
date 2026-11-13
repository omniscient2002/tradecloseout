# Configuration sources and applicable review qualification

Continuation base: `2442e1b63be12aa56fe0d8278918ed069c0f63f9`.
Candidate branch: `fix/phase2-reaudit-20261112`, draft PR #25. This report is
implementation evidence, not an independent closure or release acceptance.

## Source changes

- PH2-G06-003/005: validate every applied layer against its exact immutable,
  published source, tenant, project, schema and checksum. Legacy import/manual
  inputs now have immutable persisted identities (migration 0066). A snapshot
  reapply preserves the complete configuration and provenance as a no-op.
  Requirement-only legacy writers reject configurations they cannot preserve.
- PH2-G06-001/006: protect mandatory child items as well as explicitly locked
  items. An independently approved, version-bound change can modify a nonlocked
  mandatory obligation. Explicitly locked semantic changes remain blocked.
  Revalidate current sources when approving and applying a proposal; a revoked
  source cannot apply, but its obsolete pending proposal can be rejected.
- PH2-G06-006 and PH2-G05-010: material changes now include description, group,
  validity and explicit due-date rules. They invalidate exceptions and applicable
  review proof, cancel stale pending reviews and mark old package/submission
  baselines obsolete. Evidence objects and historical authorship are preserved.
  Readiness and package evidence queries require immutable qualification against
  the current obligation after a material change (migration 0067). Legacy
  unchanged obligations retain their prior behavior until a material change.
- PH2-G03-004/005 and PH2-G20-002/011: new review submissions select a real,
  currently eligible reviewer and bind one requirement. Listing, decisions,
  reassignment checks and notifications observe that binding. The review page
  displays current obligation details and can request a new assigned review.
  Terminal decision facts and qualification records cannot be rewritten.

## Focused evidence

Node 22.23.5, pnpm 12.4.1. Fresh disposable PostgreSQL databases applied all
migrations through 0067; runtime SQL used restricted `tc_app`.

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-configuration-boundaries.spec.ts test/phase2-configuration-sources-db.spec.ts test/phase2-material-obligation-qualification-db.spec.ts test/phase2-codepass-workflows-db.spec.ts test/phase2-organisation-recovery-db.spec.ts`:
  43 passed, `/tmp/tco-resume-qualified-api.log`.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-material-obligation-qualification-db.spec.ts test/review-authority-boundaries.spec.ts`:
  10 passed after the shared-document case and removed-obligation cancellation
  were added, `/tmp/tco-resume-binding-controls.log`.
- `pnpm --filter @tradecloseout/worker exec node --import tsx --test test/configuration-consumers.spec.ts test/notification-claims.spec.ts test/notification-provider.spec.ts test/outbox-claim.spec.ts test/notification-reconciliation.spec.ts`:
  29 passed, `/tmp/tco-resume-qualified-worker.log`.
- `production-review-remediation.spec.ts` and
  `g03-organisation-validation.spec.ts`: 19 passed in the initial review boundary
  run; its one old query-count assertion failed and was corrected and rerun above.
- `pnpm typecheck`: passed, `/tmp/tco-resume-qualified-final-typecheck.log`.
- `pnpm build`: passed, `/tmp/tco-resume-qualified-final-build.log`.
- `git diff --check`: passed.

The material-change fixture uses explicit synthetic contract records and a valid
generated PDF with synthetic verified-object state. It exercises assignment,
decision, immutable proof, source validation, baseline application and readiness;
it does not certify real HVAC content, scanning or external proof acceptance.

Full workspace/security/RBAC/browser/CI validation, migration upgrade review,
independent domain/security review and real provider acceptance remain deferred.
The wider remaining work in the continuation report still applies. No canonical
finding status, independent acceptance, merge or deployment changed.
