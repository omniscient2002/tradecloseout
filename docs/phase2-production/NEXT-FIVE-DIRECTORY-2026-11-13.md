# Phase 2 — five directory and organisation-target repairs

Baseline: `109ab9d0b145c6b12d276d6122dcfab5fa11d297`. Stable batch IDs D01–D05 are grouped as PH2-NEW-010. These are five engineering mechanisms, not five independently closed original audit rows. They relate to the existing supplier/organisation setup workflow and the historical input-contract, current-authority and transactional-history findings; original finding IDs and acceptance remain unchanged.

| ID | Baseline mechanism | Candidate correction |
|---|---|---|
| D01 | Missing/empty party types silently become SUPPLIER_OEM; arbitrary/duplicate types can be inserted | Require explicit, unique directory types from the existing data-model vocabulary, retaining the SUPPLIER alias already consumed by procurement. Do not rewrite historical rows |
| D02 | Party name/contact inputs call trim or bind to SQL without runtime validation; invalid GSTIN, email and phone values can be stored | Admit a bounded detached allowlisted request before SQL; validate name, existing GSTIN checksum policy, canonical contact email and E.164 phone syntax. Optional absent/blank contacts remain NULL |
| D03 | Command service relies on outer HTTP guards/session context for directory issuance authority | Deny guests and unapproved SYSTEM creation paths; lock/reload an ACTIVE user and organisation membership and evaluate org-level party.manage. Stale role/project-role claims cannot grant unscoped directory writes |
| D04 | Directory creation has no atomic attributable business audit/outbox event | Use the shared tenant transaction; commit PARTY_CREATED history with the directory row, or roll back all effects. The event contains classification/status/identity, not contact PII |
| D05 | Reads/profile accept orgs/current, but invitation/member/offboarding mutation wrappers reject that alias | Resolve only current or the actual active tenant before each affected service boundary. Preserve foreign-target rejection and existing hierarchy/session/offboarding controls |

D03 is service defense, not a claim that the existing HTTP party.manage guard or authenticated-session fencing was bypassed. Directory classifications confer neither membership nor guest principal authority, legal delegation, supplier qualification or engineering approval. A stored ACTIVE directory entry is not verified evidence. GSTIN/email/phone checks establish input syntax/canonicalization, not tax registration, identity ownership, phone allocation or real delivery. International landline/mobile E.164 syntax is accepted without pretending every value is eligible for the India OTP provider.

D05 retains the same active tenant: it does not switch organisations or introduce a new target selector. It covers invitation creation/revocation, member-role update, suspend/remove/reassign wrappers and the offboarding gap read. Ownership transfer/MFA and the disabled one-sided transfer endpoint are untouched. Real provider acceptance and the missing full administration/onboarding browser journeys remain separate gates.

## Evidence and scope

Before source edits,17 baseline admission/alias probes failed. This establishes missing command admission/alias checks; it is not17 defects or a full HTTP exploitation claim. Remaining database behavior is source-confirmed at the exact baseline and exercised by actual restricted tc_app/disposable PostgreSQL regression after correction.

The real database test verifies normalized contacts and explicit multi-role classification, optional NULL contacts, attributable audit/outbox identities without contact PII, stale-owner/project-role denial, suspended-user denial, and full rollback when a synthetic audit-insert failure is injected. It exercises current-alias invitation creation/revocation, member-role mutation and gap reporting against real records, and rejects another organisation without creating data there. The invitation case uses the existing nonproduction token fixture path only: no real message/provider acceptance is claimed. Synthetic GSTIN input uses the checksum-valid value already covered by the shared validator tests; an initial incorrect fixture checksum was corrected without relaxing validation.

Unit negatives cover missing/empty/unsupported/duplicate party types, malformed body/name/contact/unknown fields, guest issuance and foreign targets on every affected service wrapper. The worker outbox test proves informational PARTY_CREATED and PROCUREMENT_ORDER_ISSUED history is acknowledged without queue/provider calls. All values, users and contacts are explicitly synthetic, not customer data or engineering evidence.

Node22.23.5/pnpm12.4.1, the existing isolated PostgreSQL16 fixture at127.0.0.1:55432, Redis at127.0.0.1:56379 and the signature-verified real qpdf binary were used. Runtime remained restricted tc_app. No migrations, permission relaxation, provider activation, data backfill, scanner bypass or acceptance-policy changes are included. Full root-workspace/application-browser acceptance, exact-head remote CI and independent review remain pending. The draft PR still targets the existing Phase2 integration branch, so main-only application CI does not automatically run for it.

Exact commands/logs and changed-source hashes are under `evidence/next-five-20261113/`. Counts overlap between targeted/full/security/RBAC runs and must not be summed.

## Completed local checkpoint

- `pnpm --filter @tradecloseout/api test`: **575 passed across91 suites**, one complete invocation, including the production-mode two-API/worker HTTP fixture.
- `pnpm --filter @tradecloseout/worker test`: **33 passed**, including informational-event acknowledgement without provider execution.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-next-five-db.spec.ts test/phase2-next-five.spec.ts test/g03-organisation-validation.spec.ts test/phase2-organisation-offboarding-db.spec.ts test/g01-invitation-db.spec.ts`:28 passed across5 suites. Final boundary-only rerun after extending foreign-target coverage:17 passed. These overlap the full API result.
- `pnpm typecheck`: passed on final source/test files.
- `pnpm build`:6 tasks passed (4 unchanged tasks cached; API and worker rebuilt).
- `pnpm test:security`:15 passed. `pnpm test:rbac`:8 passed. These overlap the full API result.
- `git diff --check`: passed.

Commands inherited the local Node22/qpdf launchers and the isolated fixture URLs described above. Passing programmable TLS/storage/scanner fixtures are not external provider acceptance. No merge, deployment, self-approval or production-ready claim is made.
