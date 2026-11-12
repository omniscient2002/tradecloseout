# Phase 2 implementation — integrated candidate, not release approval

Canonical audit: PR17, `470ea86728021b3fd8a715e5704cb1c890154a43`, 58 group work items. Current repair source incorporated: PR21 `301efedd2f3e023577b3b9f15ceb7ae5ff4c4c31`. G03 source incorporated: PR13 `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08`. Main and the original registers are unchanged. This branch contains unmerged foundation ancestry and is not an isolated patch ready to merge/deploy.

The [progress register](progress.json) keeps all 58 original IDs, twelve planned engineering passes, per-item evidence and separate external gates. **No audit item has been independently closed.** A passing engineering pass records only the work and checks described for that pass; it is not production approval.

The user confirmed that neither HVAC mappings/packs nor billing/grace policy has independent approval. Those gates remain **BLOCKED_EXTERNAL**. Catalogue IDs and contractual obligations must be preserved. No grace duration, price or capacity is inferred as approved. Charging, automatic paid activation and tax issuance remain disabled. Provider integrations are deferred to the final stage; unrelated technical work continues.

## Current status — configuration-source continuation

Four of the twelve focused engineering passes have exact-head CI evidence. Pass5 remains **IN_PROGRESS**; independently accepted findings remain **0/58** and Phase2 is **not production ready**. The sections below record earlier checkpoints chronologically; a statement that CI was pending at an earlier checkpoint is not the current CI status.

The governed-publication checkpoint `f64209de7c05b155156698dc965d087d2746eb4a` passed [application CI](https://github.com/omniscient2002/tradecloseout/actions/runs/43262432033) and [protocol verification](https://github.com/omniscient2002/tradecloseout/actions/runs/43262432176). This verifies that checkpoint's technical checks, not independent engineering approval of any pack.

The continuation introduces immutable scoped configuration definitions with server-issued identities, canonical database hashes, exact source manifests and persisted field/item provenance. Ordinary runtime cannot rewrite payloads, forge global authoring or delete history. Exact global/organisation/contract/project versions are validated under narrow, scope-bound locking reads. Archived definitions remain reconstructable; new installations cannot use a retired source merely because another project used it. Additive imports preserve parent source identities and project settings. Identical imports/reapplications do not manufacture new snapshots or invalidate acceptance through a no-op. Legacy claimed identities are recorded as unverified manual history, never upgraded into independent approval.

Package artifact reservation and publication also hold an active-organisation lock before the project lock. A real restricted-role PostgreSQL test proves a concurrent suspension cannot overtake admitted reservation and subsequent admission denies after suspension.

Local verification: the initial full API run passed513/516 with three obsolete source fixtures failing. The repaired focused rerun passed59/59 across five suites, including all three failed suites and the real configuration-source/quota suites. Typecheck, build and negative security15 passed. These runs overlap and are not summed. Logs and source hashes are in `evidence/config-source-*`; the new candidate still needs its own GitHub CI and independent review. Synthetic source definitions and programmable providers do not constitute HVAC, billing or provider acceptance.

Pass5 still requires approved, version-bound impact changes for ACTIVE/HANDOVER baselines, coherent requirement/evidence/waiver/package/submission invalidation, safe pack upgrades that preserve other configuration, real consumer wiring, and the administration/preview journeys. Persisted definitions alone do not satisfy those requirements. Project lifecycle/team operations, organisation offboarding/recovery, invitation/suspension/deletion journeys, notification privacy/preferences/delivery/retries, and complete Phase2 business browser acceptance also remain in later passes.

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


## Pass 3 continuation — compiler artifact reservation

The actual package compiler now reserves its known output bytes before any provider PUT. Unchanged unpublished retries reuse their reservation; a changed build retains an aborted object with unconfirmed cleanup state. Publication checks the current project, effective entitlement, storage occupancy, build owner and exact reservation before recording immutable verified version identity. Existing READY replay performs no extra upload. The separate `build_object_id` has a same-organisation composite foreign key and cannot be mistaken for the published PDF pointer. Uncertain transaction rollback destroys the affected pooled connection.

The real compiler/PG test verifies denial before PUT, a successful reserved publication, stored SHA/version equality, replay and lost-owner rejection through a programmable S3 server. The existing service integration journey still passes with generated artifacts; its misleading real-provider/scanner wording is now explicitly labelled fixture-based. The40-test final boundary run includes6 quota/recovery database cases and the compiler case, plus entitlement-state checks; these overlap earlier runs and are not summed. Typecheck/build passed. Nonfinite cancellation dates and incomplete snapshot facts also fail closed. No provider, scanner or HVAC business acceptance is implied.

The earlier b187d41 checkpoint passed full exact-head GitHub application/protocol CI. The latest artifact/configuration continuation needs its own exact-head CI. Distinct build-attempt leases and abandoned-lease recovery remain tracked in Pass10; physical provider cleanup remains unconfirmed and scheduled for final provider integration. Authorized existing record reads/exports remain distinct from new billable package creation.


## Pass 5 checkpoint — global template publication, not business acceptance

New global pack versions default to DRAFT. Stage/review/retire operations require separately provisioned database identities; author/reviewer are captured from actual session identity, not a request field. No human identity is provisioned or approved by migrations. Review requires distinct authorship and an immutable candidate/qualification/catalogue/mapping/applicability/scenario/exception record. Syntax checks are bounded; they do not assert an HVAC rule is correct. Existing ACTIVE rows have no retrospective approval and are excluded from list/install. Payload/checksum and published review metadata are immutable, and publication events are append-only. Runtime has SELECT only, with no write/trigger/publication authority; a narrow scope-bound locking read supports installation safely.

The operator CLI and HVAC-PUBLICATION.md make the required review workflow concrete. Its connection is explicit and least-privileged, with no application/admin fallback or credential output. These are integration preparations; no real publication, qualified reviewer grant or external approval has been performed. The positive test fixtures use clearly named synthetic author/reviewer principals and example.invalid records, not engineering acceptance.

Targeted8 checks across3 suites cover actual roles, self-review denial, invalid schemas/credentials-in-reference URLs, unsigned legacy rows, immutable publication/retirement, preserved installed snapshots and real migration upgrade. Negative security15, typecheck, CLI typecheck/help and build passed. Exact-head CI remains pending for this checkpoint. Persisted configuration, impact-controlled active changes and consumer wiring remain Pass5 work.

Passes3 and4 passed exact-head application/protocol CI at9bffac16763f87103147ce4c0061f042b2a65bf4. This gives4 focused CI-verified engineering passes; it does not close any canonical finding independently or declare Phase2 production-ready.
