# Exact review workbench selection

Continuation base: `144f153`, draft PR #25. Related original outcomes:
PH2-G03-004/005, PH2-G05-011 and PH2-G06-006. Independent acceptance is unchanged.

The project review queue now uses the actual `document_version_id` field and
passes the clicked review ID. The workbench resolves that exact review against
the requested tenant/project/version, displays its bound visible requirement and
exposes a decision action only to its assigned current user. Another authorised
reader receives requirement context with no decision ID or private review
comments. Unknown/unrelated review IDs fail closed. Reading creates no review.
Unconfigured reviewer roles are displayed explicitly instead of a QC fallback.

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-material-obligation-qualification-db.spec.ts test/review-authority-boundaries.spec.ts`:
  10 passed, `/tmp/tco-review-selection-tests.log`, real disposable DB controls plus unit
  negatives for assignment, object verification and read-only behavior.
- `pnpm typecheck`: passed, `/tmp/tco-review-selection-typecheck.log`.
- `pnpm build`: 6 workspace builds passed, `/tmp/tco-review-selection-build.log`.

Node 22.23.5 / pnpm 12.4.1, synthetic evidence states, restricted `tc_app`.
Full validation, complete browser journeys and independent acceptance are deferred.
