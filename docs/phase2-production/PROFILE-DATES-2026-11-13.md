# Organisation presentation preferences

Continuation base: `153810b` on `fix/phase2-reaudit-20261112`, draft PR #25.
Related original outcome: PH2-G03-002 (supported profile round trips/consumers).
This is candidate implementation evidence; no independent closure is claimed.

Migration 0068 stores supported English locales and date formats. Existing IANA
time-zone preferences round trip with them under the existing versioned profile
PATCH. Unsupported language/format values are rejected. A scoped, member-only
date-preference DTO supplies no profile contact or financial fields.

Project, checklist, review, billing, audit, settings and notification date displays
consume these preferences. Saving settings refreshes the shared presentation
context; changing organisations creates a fresh context. Failed preference reads
display an explicit default-format notice. Calendar-only dates preserve their
recorded day; timestamp displays use the selected zone. Contractual/legal expiry
rules and immutable output formats remain governed by their existing contracts.

Checks: Node 22.23.5 / pnpm 12.4.1, isolated local PostgreSQL, restricted `tc_app`.

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-profile-dates-db.spec.ts test/g03-organisation-validation.spec.ts`:
  6 passed, `/tmp/tco-resume-date-profile.log`. Exercises actual profile and safe
  preference reads, defaults, persistence, stale writes, tenant isolation,
  omission, revoked membership, zone-boundary timestamps and calendar-only dates.
- `pnpm typecheck`: passed, `/tmp/tco-resume-date-final-typecheck.log`.
- `pnpm build`: passed, `/tmp/tco-resume-date-build.log`.
- `git diff --check`: passed.

Browser acceptance is deferred with the full validation requested by the user.
Hindi and multiple-signatory administration are not implemented or advertised.
This addition does not independently close the entire PH2-G03-002 outcome.
