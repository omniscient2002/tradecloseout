# Phase 2 implementation — integrated candidate, not release approval

Canonical audit: PR17, `470ea86728021b3fd8a715e5704cb1c890154a43`, 58 group work items. Current repair source incorporated: PR21 `301efedd2f3e023577b3b9f15ceb7ae5ff4c4c31`. G03 source incorporated: PR13 `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08`. Main and the original registers are unchanged. This branch contains unmerged foundation ancestry and is not an isolated patch ready to merge/deploy.

The [progress register](progress.json) keeps all 58 original IDs, twelve planned engineering passes, per-item evidence and separate external gates. **No audit item has been independently closed.** A passing engineering pass records only the work and checks described for that pass; it is not production approval.

The user confirmed that neither HVAC mappings/packs nor billing/grace policy has independent approval. Those gates remain **BLOCKED_EXTERNAL**. Catalogue IDs and contractual obligations must be preserved. No grace duration, price or capacity is inferred as approved. Charging, automatic paid activation and tax issuance remain disabled. Provider integrations are deferred to the final stage; unrelated technical work continues.

## Current verification checkpoint

- Current PR21 plus G03 integration and regression repairs: full workspace tests pass locally — API465/80 suites, shared91/5, database13, worker32, archive/auth-storage browser10, plus PDF engine checks.
- Production build/typecheck, security15 and RBAC8 passed locally. These checks do not establish deployed or provider acceptance.
- New ownership database regression exercises independent recipient identity, fresh MFA, cancellation, expiry, stale organisation version, competing requests, one active owner, session invalidation and an attributable terminal audit event. The G01 role/invitation regression now uses two authenticated sessions and the real two-party flow, retaining ordinary-owner-role escalation denial and the disabled one-sided endpoint.
- Earlier targeted entitlement/configuration experiments in a superseded local checkout are **not** counted as verification of this integrated candidate. Revalidate any selectively retained changes here.
- Exact-head remote CI, complete Phase2 browser journeys and independent review remain required.

## Ownership configuration and limits

`OWNERSHIP_INTENT_TTL_SECONDS` (60–86400) and `OWNERSHIP_MFA_MAX_AGE_SECONDS` (30–900) must be explicitly configured. Missing/invalid policy fails with `OWNERSHIP_POLICY_NOT_CONFIGURED`; test settings are synthetic mechanics, not approved deployment policy. A current owner requests an intent with recipient, current organisation version and UUID request key. Only the independently authenticated intended active member can accept, after fresh MFA and version/expiry checks. Cancellation is limited to the participants. Request/accept/cancel are transactional and preserve exactly one active owner.

These controls do not provide sole-owner account recovery, legal delegation review or a complete administration UI. Those remain tracked work. Do not enable a deployment merely because fixture transactions passed.

## Required final acceptance record

For HVAC, billing/grace and provider acceptance record the exact final candidate SHA, immutable reviewed pack/policy version, accountable qualified reviewer identity, approval date, real acceptance evidence and explicit exceptions. Keep every field unapproved until supplied. Preserve real verified object bytes, current authority, tenant/resource isolation and approved baseline history throughout the remaining work.

## Pass 2 candidate — policy pinning and entitlement consistency

One effective resolver now supplies billing reads, seats, upload capacity, activation/reopening and package generation. It validates all four integer limits, subscription periods/status/cancellation, immutable subscribed values and explicit policy provenance. Existing `ACTIVE` labels do not become approval. No policy, price or allowance is invented. Grace requires both an explicit independently recorded policy allowance and an explicit bounded deadline; no duration is inferred. Application runtime cannot approve/edit policies; a narrow tenant-bound function provides the locking read.

New migrations0048–0050 preserve older ledger checksums and old contract facts; legacy subscriptions receive mechanical snapshots with no retrospective approval and no new billable allowance. Earlier approved offer terms cannot be mutated in place or unlocked by retiring a plan. A new explicit version is required. Policy retirement cannot resurrect itself. Tests use clearly named synthetic approval records only in disposable databases; they are not genuine business approval.

Storage reserves PENDING and PROCESSING bytes, preventing capacity from disappearing while scanning. The old duplicate delete/restore text-to-BIGINT SQL is corrected. Full storage recovery/expiry/restore enforcement remains work in Pass3. The single-project offer lacks a durable project binding, so new consumption is explicitly unavailable; this is an open product gap, not a silently accepted scope exclusion.

The billing screen now shows recorded subscription information, effective restrictions, actual usage/reservations and exact byte limits, without calling unapproved data verified. Existing authorized records remain available when billing approval is absent. Suspended-organisation access and complete recovery journeys remain tracked separately.

Local evidence: workspace suite passed API492/81, shared91/5, DB13, worker32, browser10 and PDF checks; targeted boundary suite44 passed, including two added real database upgrade/profile-concurrency cases. Those runs overlap and must not be added together. Source hashes and exact logs are in evidence. Final exact-head CI and independent per-item acceptance are still required; all original audit rows remain OPEN/BLOCKED_EXTERNAL.


## Pass 3 checkpoint — quota and recovery work remains in progress

- Final-seat invitation acceptance is a business conflict (409), not a bad-identity response. A real production-mode PostgreSQL OTP race grants one seat and retains the losing invitation/proof transaction for a successful single-use retry after explicit capacity recovery. Identity delivery uses a test-only adapter; no real delivery is certified.
- Upload/restore capacity uses canonical object rows instead of trusting counter drift. PENDING/PROCESSING remain reserved even after a document is soft-deleted. READY objects are counted once, with retained document identity and shared-object semantics. Restore consumes capacity transactionally and rolls back on denial.
- Upload, delete, restore, scan finalization and expiry use a common project→storage mutex→target lock order. Live authority revalidation selects an initial stronger project lock for authenticated mutation requests, avoiding a shared-lock upgrade. Two independent authenticated guest upload-intent transactions complete in real PostgreSQL; there is no grant/CSRF/MFA bypass.
- Expiry retains FAILED/ABORTED rows and latest-version references. `upload_cleanup_requested_at` records unconfirmed physical cleanup; no provider deletion receipt is fabricated. Existing 24h expiry behavior is preserved; physical cleanup integration/acceptance remains pending.
- Both full handover and RA evidence-pack requests use the same IST-month quota and lifecycle lock. RA requests require transport idempotency. Missing, zero, exhausted and terminal-state cases deny; failed creation rolls back capacity. No charging or financial issuance is enabled.

Verification: the full local workspace run passed DB13/shared91/browser10/PDF and API498/499; its sole failure was an obsolete exact query-count assertion after the added lifecycle lock. The assertion now tests the original security property (no mutation on unauthorized review) and the final targeted run passed18 tests across3 suites, including5 real quota/recovery/concurrency database cases. Typecheck, build, negative security15 and RBAC8 passed. These overlapping counts are not summed. Exact-head CI is still required before calling this checkpoint verified.

Pass3 is deliberately **IN_PROGRESS**. Generated artifact writers still need consistent reservation/accounting, provider completion/cleanup recovery needs final integration, and project lifecycle/seat reactivation coverage will be completed in their passes. These are engineering gaps alongside the separately blocked policy/provider approvals. All58 canonical audit items retain OPEN/BLOCKED_EXTERNAL; independently accepted closures remain0.


## Pass 4 candidate — configuration safety and explanatory provenance

Inherited mandatory obligations cannot be removed or made optional by a child layer, even if the mutable `locked` flag was absent. Boolean obligation flags and remove operations now have explicit types; ambiguous remove-and-replace patches reject. The compatibility wrapper preserves a supplied schema version so an unsupported version cannot become v1.0 silently. MIME allowlists require MIME strings. Aggregate JSON, accessor, sparse-array and byte budgets reject before resolution without losing source-field error location.

Resolution records per-item/per-field origins and removal tombstones alongside the existing field winners. A no-op/failed child patch cannot take provenance credit, and conflicts identify the protecting item's actual level. These extra origins still require persistence and usable preview in Pass5/11. Parser tests do not certify persisted layer identity or an HVAC mapping.

Targeted checks passed51 across3 suites, including existing real checklist/readiness/isolated database regressions. Typecheck passed. Original findings remain OPEN; exact-head CI and independent acceptance remain required.
