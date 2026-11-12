# Phase 4 · Pass 03 — defect scanned-byte and exact target-set qualification

Date: 2026-11-12
Scope: PH4-G17-001 and PH4-G17-002
Plan: [Phase 4 acceptance-gated passes](./phase4-production-closure-pass-plan.md)
Review: [Phase 4 draft PR #23](https://github.com/omniscient2002/tradecloseout/pull/23)

## Engineering changes (PARTIAL / VERIFY)

1. File-processing worker now timestamps the successful full-byte scanner/AV result as `storage_objects.av_scanned_at` alongside scanner-computed SHA-256 when transitioning a matching immutable provider version from PROCESSING to READY. Legacy READY storage objects without this receipt are deliberately **not** silently backfilled or re-certified.
2. Migration `0050_phase4_defect_immutable_byte_receipts.sql` adds an exact scanner SHA-256, immutable provider version, observed size, scanner timestamp and full linked asset set to the defect's active remedy projection, plus equivalent immutable columns on transition events. Historical records without these facts remain readable but **cannot** be independently closed without explicit requalification.
3. Both remedy and independent close require a READY storage object with a scanner timestamp, valid SHA-256, immutable provider-version marker, positive safe size and exactly matching provider-observed byte size. When client-declared expected hash exists, it must equal scanner-computed SHA-256. READY alone or user-controlled object-key text is not authority.
4. The document resolver requires one current approved version for the exact project and object, locks its document row `FOR UPDATE`, locks **every** document-asset association and active asset row `FOR SHARE`, and rejects retired/deleted targets. A multi-asset document can be reused for distinct defects only when the entire target set is active and explicitly contains each defect asset. A non-asset defect must have an exact requirement link or an explicit version-level `remedyDefectId` declaration; generic project-only evidence fails closed.
5. Submission stores the current scanner receipt, immutable provider version, size and complete sorted scope on the defect, and appends the receipt to its transaction-bound immutable event ledger. Independent closure rechecks the exact reviewed document version and compares all pinned bytes and complete scope; any drift, including same-size SHA mutation or a newly added/removed unrelated asset, blocks CLOSED without side effects.
6. Rejected and reopened remedies clear the current active receipt while preserving prior receipts in `defect_transition_events` for audit. Historical unpinned records remain explicitly uncertified.
7. Existing project-first lifecycle locks, internal assignment, guest party/asset authority, expected row versions and no-self-verification restrictions are retained. No new external provider was connected or enabled.

## Regression evidence

- `apps/api/test/phase4-pass3-remedy-byte-scope.spec.ts`: missing scan receipt, missing/incorrect hash, unversioned provider, mismatched observed size, zero-sized object, no asset binding, inactive shared target, project-only unbound defect, requirement-bound project-only evidence, multi-asset reuse, exact scanned immutable receipt, changed byte hash (same size), provider-version/size/scan mutation and full target-set changes.
- `apps/api/test/phase4-pass3-remedy-db.spec.ts`: disposable PostgreSQL migration, approved reviewed shared source, two distinct asset-bound defects, scanner-byte/target-set pinning in both projection and append-only ledger, blocked close on changed SHA at fixed size, blocked close on changed asset association, successful independent verified close after scope restored.
- Legacy Pass 1/2 and Phase 4 scope/HVAC fixtures now carry verified scanner timestamps and pinned scope where required.
- Final exact-head CI URL, SHA and conclusion must be added after GitHub completion; intermediate CI is not accepted as a new release certificate.

## Remaining independent release gates — explicitly NOT CLOSED

- Real immutable provider-version byte retrieval / streaming rehash and provider-side immutable-version guarantee must be accepted with the final external storage provider, not simulated. A database-reported unchanged SHA cannot detect an unreported change of bytes at a mutable object key. Until that proof exists, this is engineering hardening rather than absolute byte authenticity.
- Requalification of pre-migration remedies and preexisting READY storage objects needs an explicit controlled migration/scan with independent record owners, not a silent timestamp backfill.
- Fully documented reuse/asset-scope policy, requirement-specific documents, changed-design obligations, multi-process link-insert/removal race replay with the real DB, tenant RLS and HTTP/browser reviewer acceptance remain outstanding.
- Exact output artifact lineage, OEM/customer proof and external storage/provider integration will be accepted in later gates. **PH4-G17-001 and PH4-G17-002 remain PARTIAL / VERIFY; PR is DRAFT/NO-GO.**
