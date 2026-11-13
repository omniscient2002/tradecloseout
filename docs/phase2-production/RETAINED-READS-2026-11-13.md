# Reviewed suspended-organisation reads

Continuation base: `d84e30e`, draft PR #25. Related original outcome:
PH2-G03-008. Candidate implementation only; independent approval and release
acceptance remain unchanged.

## Access contract

Suspension denies access by default. Migration 0069 adds immutable, expiring
retained-read grants for an externally reviewed BILLING or POLICY suspension.
A grant permits existing roles and scopes on an explicit GET allowlist. It
grants no project, document, commercial or export capability. New endpoints do
not inherit suspended access. Uploads, decisions, baseline changes, payments,
new archive generation and other business writes remain denied. Existing verified
document/package/archive downloads and register reads retain their normal checks.

Only a separately provisioned accountable identity in the NOLOGIN
`tc_org_recovery_reviewer` group can execute
`review_organisation_retained_reads(grant_id, org_id, kind, evidence_ref, expiry)`
or `revoke_organisation_retained_reads(grant_id)`. Runtime `tc_app`, superusers
and bypass-RLS identities cannot issue a review. The reviewer must establish the
actual suspension reason and read/export eligibility from real evidence before
issuing it. The evidence must be a durable HTTPS record; the maximum grant is
30 days. Grant identity, reviewer, organisation version, expiry and evidence are
immutable. Identical command replay is safe. Revoke through the narrow command;
do not grant the group to the application runtime. No real grant or identity is
provisioned by this implementation.

Grants bind the current organisation row version, so reactivation or a later
versioned suspension needs a new review. Disabled accounts, suspended/revoked
members and guests receive no retained access. Normal CSRF, generation, session,
MFA and tenant/resource guards remain. MFA enrollment/verification/recovery and
emergency session controls are explicitly reachable; they grant no business write.
Owner/admin retained data reads also recheck current MFA under transaction locks.

The transaction fence locks current account/organisation/membership/session and
rechecks the grant in a new statement after the organisation lock is acquired.
Revocation takes the same organisation lock. A transaction-local flag additionally
rejects business table writes from an otherwise allowed read handler. Audit/outbox
append paths remain available for read/download history. The flag resets on
commit/rollback. New business tables need the same fence when added in future.
Retained read admissions produce an authentication ledger event. The UI displays
the restricted mode and limits navigation; core mutation controls are disabled.

## Focused checks

Node 22.23.5 / pnpm 12.4.1, isolated PostgreSQL with `tc_app` runtime SQL.

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-retained-organisation-reads-db.spec.ts test/g01-session-guard-db.spec.ts test/phase1-live-session-eligibility-db.spec.ts test/g01-org-switch-review-regressions.spec.ts test/phase2-profile-dates-db.spec.ts`:
  7 passed, `/tmp/tco-retained-final-authority.log`.
  Tests cover the default denial, runtime inability to self-issue a grant,
  synthetic distinct database-reviewer identity, immutable exact-version download
  parameters, tenant isolation, business-write fence, stale MFA, revoked account
  and membership, grant-revocation race, restored active access and flag cleanup.
  Existing session/CSRF/current-authority/switching regressions run alongside it.
- The final retained-access fixture was rerun with actual grant expiry and later
  suspension-version binding: 1 passed, `/tmp/tco-retained-expiry-final.log`.
- `pnpm typecheck`: passed, `/tmp/tco-retained-exact-typecheck.log`.
- `pnpm build`: all 6 workspace builds passed, `/tmp/tco-retained-build.log`.
- `git diff --check`: passed.
- Initial retained-read fixture failed because its synthetic document omitted a
  required issue date. The fixture was corrected; no schema/control was weakened.

The reviewer role and storage signer in tests are synthetic local fixtures. This
does not establish real suspension eligibility, engineering evidence, provider
download acceptance or a complete browser journey. New export generation is
deliberately outside retained-read access; the UI states this limit.
Full validation and independent policy/security review remain deferred.
