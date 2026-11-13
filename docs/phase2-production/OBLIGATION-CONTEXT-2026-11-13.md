# Material obligation context

Continuation base: `ba99018`, draft PR #25. Related original outcomes:
PH2-G06-006/008/011 and PH2-G05-006/010. No independent acceptance changed.

Migration 0070 captures the recorded project type/parties/value/dates/settings,
active contracts, approved variations, specifications and active equipment facts
in each new immutable baseline. Unknown recorded values remain null or absent;
the code does not run the unapproved legacy HVAC rule examples or invent a
catalogue mapping. Configuration preview and proposal impact expose the actual
facts for explicit independent review. A proposed context checksum is immutable
and rechecked at approval and application under the project lock.

Readiness, evidence qualification and project activation reject a baseline whose
context differs from current facts. An identical requirements payload can form a
new baseline after an approved context change. Such changes conservatively reset
existing obligation qualification and exceptions; the new/current obligations
need current assigned review before readiness returns. Current package submission
and recipient decisions also reject obsolete baseline/context. Historical files,
decisions and authorship remain intact.

Asset creation no longer writes requirements independently or assigns a fallback
document type. It records the equipment and reports that baseline applicability
review is needed; the canonical reviewed applicator expands asset requirements.
Atomic asset imports now use one transaction and project lock rather than opening
separately committed creation transactions for each row. The project UI explains
the required applicability review after equipment registration.

For existing ACTIVE snapshots, migration 0070 records explicitly labelled
`MIGRATION_OBSERVATION` facts without creating or changing any approval. It does
not claim retrospective engineering review. Existing historical snapshots without
captured facts are not newly certified. New snapshots use `BASELINE_APPLICATION`.
This migration/backfill needs the deferred independent upgrade review.

Focused checks use Node 22.23.5 / pnpm 12.4.1, fresh local disposable databases
through 0070 and restricted `tc_app`:

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-material-obligation-qualification-db.spec.ts test/phase2-configuration-sources-db.spec.ts test/phase2-codepass-workflows-db.spec.ts test/phase2-configuration-boundaries.spec.ts`:
  42 passed, `/tmp/tco-context-final-api.log`.
- `pnpm --filter @tradecloseout/worker exec node --import tsx --test test/configuration-consumers.spec.ts test/notification-claims.spec.ts test/notification-provider.spec.ts test/outbox-claim.spec.ts test/notification-reconciliation.spec.ts test/usage-reconciliation.spec.ts`:
  30 passed, `/tmp/tco-context-worker.log`.
- `pnpm typecheck`: passed, `/tmp/tco-context-final-typecheck.log`.
- `pnpm build`: all 6 workspace builds passed, `/tmp/tco-context-build.log`.
- `git diff --check`: passed.

The material fixture uses explicit synthetic requirements and a generated PDF with
synthetic verified-object state. It tests real service transitions, stale context,
package baseline obsolescence, qualification and import rollback. It does not
certify HVAC applicability, real scanning, actual package acceptance or a provider.
Real catalogue/COMP/R-001..013 reconciliation/publication and representative domain
scenarios remain externally blocked. Full validation and independent review are
deferred; locked-pack semantic upgrade authority remains unfinished engineering.
