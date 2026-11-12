# Phase 2 — notification command authority

Baseline: `f4d8191f4585cddc3852336f56af64029acf9e3d` on the existing Phase 2 feature branch and draft PR #25. New finding **PH2-NEW-011**, cross-referenced to **PH2-G20-002**. This is one completed command-authority repair, not independent closure of the broader original notification visibility finding.

## Confirmed defect and correction

`createNotification` checked live membership only when a project was supplied. Without a project, a command caller with a demoted/suspended/removed membership or inactive account could still insert or retrieve a deduplicated notification. With a project, any active project membership sufficed, without testing the live notification capability or narrower scope. Guest principals also lacked an explicit command-level denial. These are reproduced service-boundary defects; existing HTTP guards and authenticated-session revalidation reduce exposure. No production HTTP authentication bypass is claimed.

Interactive issuance now locks and reloads the ACTIVE user, organisation and membership within the notification transaction. Projectless issuance requires the existing organisation-wide `notification.manage` capability. A scoped PM/document-controller capability requires a concrete project plus current project membership; permission evaluation uses current roles rather than caller claims. The existing project-role catalogue does not grant `notification.manage` to a project-only PM, and this repair does not invent that permission.

Project member scope is validated from the locked row. Read-only or malformed scope is denied. Resource/date-restricted scope is denied because this envelope identifies no asset, document or requirement against which those restrictions can be verified. Empty scope, `readOnly:false` and `mode:READ_WRITE` retain their existing meaning. Owner/admin project visibility remains organisation-wide only while their live role grants it. Guest or unsupported principals fail before SQL; the explicit internal SYSTEM producer path remains separate. External template/provider gates remain enforced.

Authority is checked before both insertion and deduplication lookup. A revoked caller cannot retrieve an old notification through a retry; the original notification and delivery metadata remain unchanged. Transaction rollback and connection release continue through `TenantDbService`. No migrations, permission grants, provider activation, HVAC classification, evidence changes or acceptance-policy changes are included.

## Reproduction and verification

The new database suite was first run against the exact baseline service source: **15 failed, 3 passed**. Two later coverage cases (project-only PM cannot gain an absent permission; inactive organisation denied) extend the final database suite to 20 cases. Initial attempts against the earlier fixture failed on unavailable connection/runtime credentials and are setup failures, not reproduction evidence. A new isolated PostgreSQL16 container was created on `127.0.0.1:55441`; existing services/customer data were not changed. Runtime remains restricted `tc_app`, with a stronger fixture-only password for production-mode checks. Node22.23.5 and pnpm12.4.1 were used; the lockfile was unchanged and existing installed dependencies were reused.

The concurrent test holds a real membership demotion uncommitted, observes the notification transaction waiting for that row in PostgreSQL, commits the demotion, and checks that the command rejects with no inserted notification. A subsequent authorized transaction succeeds. This exercises actual row locks and rollback, not a mocked authorization predicate. Other database cases cover stale roles, active owner/admin and scoped PM admission, account/organisation/membership inactivity, foreign tenants/projects, capability absence, malformed/read-only/resource scope, and immutable retry behavior. Unit cases reject guest/unsupported principals before connection acquisition and preserve the explicit SYSTEM path.

Existing channel and deduplication mocks now supply a live authorized member so they still reach and exercise their original control. The prior positive project fixture used an R-SITE caller without notification capability; it now uses an authorized live R-PM. A new negative case separately enforces denial of R-SITE project membership and a project-only PM role.

Commands inherit only local test coordinates and the existing Node22/pnpm/qpdf launchers. Evidence is in `evidence/notification-authority-20261113/`. Test counts overlap and must not be summed. Final command results and source hashes are recorded in the checkpoint below. Full application browser journeys, independent review, exact-head remote application CI and real provider/HVAC/billing approval remain separate acceptance gates. No merge, deployment, self-approval or production acceptance is authorized or claimed.

The first full workspace run reached **599 passing API tests and one failed legacy channel mock** after passing the DB/shared/PDF/archive/auth-storage projects. The channel mock had no current member row; it was corrected to supply a live owner, retaining its original external-message rejection and addressed in-app assertions. The failed run is retained as `workspace-initial.txt`; it is not reported as a passing workspace invocation.

## Final command checkpoint

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-notification-authority-db.spec.ts test/phase2-notification-project-authority-db.spec.ts test/phase2-notification-visibility.spec.ts test/phase2-notification-issuer.spec.ts test/phase2-easy-ten.spec.ts`: **54 passed across 5 suites**.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/sol-integrity-verification.spec.ts`: **4 passed**, preserving the channel invariant after fixture correction.
- `pnpm typecheck`: passed after the final test-file correction.
- `pnpm build`: **6 tasks passed**, 5 unchanged tasks cached and API rebuilt. Application source was unchanged by the later mock-only correction.
- `pnpm test:security`: **15 passed**; `pnpm test:rbac`: **8 passed**. Authority source and these test files were unchanged by the later legacy mock correction; their assertions also run inside the full API regression.
- `pnpm db:migrate`: passed on the isolated PostgreSQL16 fixture. No migration file was changed.
- `git diff --check`: passed. `git merge-base --is-ancestor main HEAD`: passed.

`source-hashes.json` identifies every changed implementation/test file, including the corrected legacy fixture. No application browser (`pnpm test:e2e`) run is claimed; the root workspace browser projects cover archive verification and auth storage only. The stacked PR targets `fix/phase2-integrated-readiness`, while application CI and group verification trigger only for main; local checks do not supply missing remote CI or independent acceptance.

- Final `pnpm test`: **passed in one complete invocation** — API **600/600 across 93 suites**, worker **33/33**, shared **91/91**, database **13/13**, browser **10/10**, PDF inspection/front-matter/compilation checks passed. See `workspace-final.txt`. Counts overlap targeted/security/RBAC runs and must not be summed. This is fixture-based local verification, not provider or production acceptance.

Stored text logs normalize terminal carriage returns, trailing whitespace and final blank lines. `log-hashes.json` records raw and stored SHA256 values; log messages and results are preserved.
