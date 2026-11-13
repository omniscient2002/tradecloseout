# Periodic capacity cache reconciliation

Continuation base: `7eac62d`, draft PR #25. Related outcomes:
PH2-G18-002/003/004 and PH2-G05-007. Independent acceptance is unchanged.

The hourly worker job repairs ACTIVE_PROJECTS, SEATS and STORAGE_BYTES from
canonical project, membership and object rows. Each metric uses its existing
capacity mutex in a separate tenant transaction. The job takes no project lock
after a capacity lock and never holds two metric mutexes at once. Failures roll
back the affected metric and continue other tenants; an incomplete run does not
earn a schedule completion marker and can retry. Repairs are idempotent replaces,
not quota increments. Redis lease overlap cannot double-charge a counter.

Active/HANDOVER/SUSPENDED unpurged projects occupy slots; only active memberships
count as seats. The storage cache retains its existing READY-byte meaning;
pending/processing reservations remain in canonical capacity accounting. Monthly
package consumption is not rewritten. Reconciliation grants no allowance and
does not change subscription state or bypass an unapproved billing policy.

Node 22.23.5 / pnpm 12.4.1, isolated local PostgreSQL and restricted `tc_app`:

- `pnpm --filter @tradecloseout/worker exec node --import tsx --test test/usage-reconciliation.spec.ts`:
  1 passed, `/tmp/tco-usage-reconciliation.log`. Covers stale caches, repeat runs,
  exact project/seat/storage semantics, preserved reservations/monthly usage and
  a synthetic per-tenant failure followed by recovery. An initial fixture used
  an ambiguous UUID parameter and a nonexistent metric name; those fixture
  errors were corrected without changing schema constraints.
- `pnpm typecheck`: passed, `/tmp/tco-usage-typecheck.log`.
- `pnpm build`: all 6 workspace builds passed, `/tmp/tco-usage-build.log`.
- `git diff --check`: passed.

Full workspace/load/browser/CI and independent acceptance remain deferred.
