# Continued implementation — 2026-11-13

Resumed from `487cf48603df148fc3be7961803cbe125b1303e3` on
`fix/phase2-reaudit-20261112`. All code remains a draft candidate. No independent
finding closure, merge, deployment or real provider acceptance is claimed.

## Changes and related finding IDs

- PH2-G20-003/004: durable delivery-attempt history; explicit uncertain gateway
  outcomes; bounded status reconciliation before resending; late-lease fencing;
  channel-fair claiming, bounded concurrency, jitter and shared per-tenant/channel
  rate budgets. A signed callback can settle a recorded send attempt after a
  lost acknowledgement. Terminal attempts cannot be rewritten by the runtime.
- PH2-G20-002/010/011: trusted business-event inbox projection through the outbox,
  current entity-based recipient resolution, safe content and operator metrics,
  attempt inspection and eligible redrive. Review submissions/decisions and
  successful package output now persist their notification event transactionally.
  Ownership intents have registered events and a safe settings link. External
  supplier/business templates still need implementation/review; this is native
  inbox delivery, not claimed email/SMS/WhatsApp acceptance.
- PH2-G20-007/008/009 and PH2-G06-010: exercised configured reminders and output
  consumers; fixed suspended-project reminder preservation, obsolete due-date
  handling and tenant isolation after a reminder failure. NULL due dates do not
  create invented deadlines; a status string alone does not supply evidence.
- PH2-G03-004/005/006/011: pending submission gap counts and role-change admission,
  eligible per-work replacement suggestions, fresh MFA for reactivation, explicit
  emergency-suspension UI and step-up MFA navigation. Reactivation retains removed
  project memberships and historical authorship. External party delegation remains
  blocked until independently verified authority exists.
- PH2-G18-001/009: current-policy lock and replay-safe immutable project-offer
  binding, with a corresponding billing UI. Consumption remains project-bound;
  team capacity follows the explicitly approved offer model. Synthetic test policy
  rows are not real billing/finance approval. Live fulfilment stays disabled.
- Migrations 0064 and 0065 append attempt/uncertainty and rate-budget schemas.
  Earlier migrations were not modified.

## Checks

Node 22.23.5 / pnpm 12.4.1; environment-local disposable PostgreSQL and local HTTP
fixtures; actual runtime SQL uses `tc_app`.

- `pnpm typecheck`: passed, `/tmp/tco-resume-current-typecheck.log`.
- `pnpm build`: all 6 workspace builds passed,
  `/tmp/tco-resume-current-build.log`.
- `pnpm --filter @tradecloseout/worker exec node --import tsx --test test/configuration-consumers.spec.ts test/notification-claims.spec.ts test/notification-provider.spec.ts test/outbox-claim.spec.ts test/notification-reconciliation.spec.ts`:
  28 passed before the final rate-budget concurrency case was added. That file
  was then rerun with all 7 checks passing, including concurrent budget claims:
  `/tmp/tco-resume-reconciliation-final.log`. Combined distinct worker checks: 29.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-codepass-workflows-db.spec.ts`:
  8 passed, `/tmp/tco-resume-api-workflows.log`.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-organisation-recovery-db.spec.ts`:
  1 passed, `/tmp/tco-resume-org-recovery.log`.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-project-offer-db.spec.ts`:
  1 passed, `/tmp/tco-resume-project-offer.log`.
- `git diff --check`: passed.

These checks validate fixture mechanisms, including real local HTTP loss and
restricted-role transactions. They do not certify real provider delivery, actual
MFA enrollment/step-up browser flows, production load, or engineering acceptance.
Full workspace/security/RBAC/browser/CI validation is deferred at the user's request.

## Remaining work

The broader checkpoint's unfinished items remain applicable except where the
specific additions above supply code/evidence. In particular: controlled
suspended-organisation read/export recovery, profile locale/date consumers,
reviewed applicability mapping and material asset/contract invalidation, complete
baseline source/impact checks, supplier templates and approved provider/billing
fulfilment/dunning contracts. Reconcile all original finding outcomes individually;
related fixture success is not whole-finding acceptance.
