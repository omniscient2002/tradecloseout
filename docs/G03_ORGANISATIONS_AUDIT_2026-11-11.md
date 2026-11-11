# G03 — Organisations, onboarding and membership lifecycle

Assessment date: 2026-11-11. **NO-GO for G03 acceptance. All 23 findings are OPEN.** This handoff publishes findings and evidence; it does not implement application fixes.

Exact assessed application SHA: `863e6e0c56ad4a92af2580fbcbfc179832056b2d`, current G01 candidate in draft PR #5. Current canonical main at publication preparation: `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. The assessed worktree is clean. These source lines differ: observations are pinned to the candidate and must be revalidated on the actual proposed implementation head. The assessor also implemented preceding G01 changes; this is not independent acceptance of that implementation.

This is a fresh G03 assessment. `G03-001`–`G03-023` are its initial stable IDs; they are not the unrelated G03 archive finding in an older readiness report. Twenty findings have targeted runtime observations; three (020–022) are source-confirmed missing product workflows. An observed failure, fixture test or structural validator is not CI, independent review or external release acceptance.

## Scope, requirements and evidence

G03 covers company registration/onboarding/profile/branding/defaults, membership/invitations, ownership, suspension, offboarding and responsibility transfer, organisation dashboards/audit boundaries and related tenant transitions. Primary requirements are `03-PRODUCT-REQUIREMENTS.md` FR-ORG/FR-IAM/FR-AUD/FR-BIL, `05-ACTORS-AND-PERMISSIONS.md`, `06-WORKFLOWS-AND-STATE-MACHINES.md` WF-01/WF-02/WF-21, `10-API-AND-INTEGRATIONS.md`, `11-UI-UX-SPECIFICATION.md`, user AGENTS.md and current-main `docs/engineering/agent-collaboration.md`. Later optional/V2 features such as multiple invoicing branches and SSO are not automatically made G03 release requirements.

The source inventory records all registered HTTP routes, the organisation/auth-org subset, tracked web pages, service entry points, profile schema and relevant requirements. This is structural inventory plus targeted behavioral execution, not exhaustive proof over every input, role, route, relationship and concurrency schedule.

Runtime evidence used Node 22.23.2, pnpm 12.4.1, PostgreSQL 16.15 and environment-local Redis. A randomly named disposable DB received all 41 migrations from the assessed head and was deleted by the repository helper. Runtime queries used tc_app with rolsuper=false and rolbypassrls=false. Administrative queries only created/inspected authorization fixtures. Both final pool-reuse checks succeeded.

The HTTP tests ran the actual compiled API in NODE_ENV=production on loopback HTTP, with actual guards, controller metadata, transaction services and global filters/projection. The API/dependency build and emitted JS hashes from the preceding G02 assessment are reused because the exact clean tracked source and compiled hashes are unchanged; this G03 task does not claim a new full build. Seeded sessions/MFA/identities/grants are authentication fixtures, not real login, independent signatory authority or deployed HTTPS/proxy/MFA evidence. Nondelivering provider URLs were configured. Invitation service tests use an explicitly nondelivering adapter. The seat-limit acceptance probe alone switches its own controller process to test-mode debug OTP with an in-memory Redis fixture; it is not strict-production authentication acceptance.

Requirement snapshots, PENDING reviews, PROCESSING objects and CLOSED project rows are minimal authorization fixtures. They do not represent a reviewed HVAC baseline, eligible engineering evidence, real storage/scanner output or accepted closure. No real email/SMS, S3, payment, signing, package, customer data or production deletion was exercised. The concurrency test uses real restricted DB connections and query scheduling hooks, without mocked results, and does not claim deployed multi-node HTTP acceptance.

Evidence: `docs/evidence/g03-audit-863e6e0/` contains the executed script/results/stdout, existing regression output, complete route and source inventories, reused build provenance, commands/versions, source/compiled/bundle hashes and the initial finding model. Publication uses branch `docs/g03-organisations-audit-20261111` through a draft documentation PR. G03 is not added to trusted coordinator policy; publication does not dispatch a native writer or wake the coding chat.

## Finding index

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| G03-001 | P1 | Organisation audit endpoint bypasses audit permission and project scope | Targeted runtime; limits below |
| G03-002 | P1 | Organisation dashboard fails against the migrated database | Targeted runtime; limits below |
| G03-003 | P1 | Profile PATCH breaks partial updates and cannot clear optional values | Targeted runtime; limits below |
| G03-004 | P2 | Branding, state and retention inputs are not validated | Targeted runtime; limits below |
| G03-005 | P2 | Required profile/default fields are silently ignored | Targeted runtime; limits below |
| G03-006 | P1 | Offboarding accepts replacements without the required role or project access | Targeted runtime; limits below |
| G03-007 | P1 | Self-replacement removes a member while leaving their open work assigned | Targeted runtime; limits below |
| G03-008 | P1 | Bulk reassignment mutates closed-project obligations without lifecycle locking | Targeted runtime; limits below |
| G03-009 | P2 | Gap reports multiply reviews and infer roles from unrelated documents | Targeted runtime; limits below |
| G03-010 | P2 | Bulk reassignment cannot safely handle PARTY review assignments | Targeted runtime; limits below |
| G03-011 | P2 | Offboarding gap omits pending submission responsibility | Targeted runtime; limits below |
| G03-012 | P2 | Organisation suspension blocks promised reads and exports | Targeted runtime; limits below |
| G03-013 | P1 | Emergency member suspension and reactivation lack a supported API workflow | Targeted runtime; limits below |
| G03-014 | P1 | Ownership transfer completes without recipient confirmation | Targeted runtime; limits below |
| G03-015 | P1 | A globally suspended identity can become the sole organisation owner | Targeted runtime; limits below |
| G03-016 | P2 | Seat limits are not enforced at invitation membership activation | Targeted runtime; limits below |
| G03-017 | P2 | Mobile member invitations promised by the contract are unsupported | Targeted runtime; limits below |
| G03-018 | P2 | Successful invitation issue/revocation leaves no business audit event | Targeted runtime; limits below |
| G03-019 | P2 | Organisation member identifiers reach SQL without runtime validation | Targeted runtime; limits below |
| G03-020 | P2 | Resumable company onboarding is not implemented | Source only |
| G03-021 | P2 | Organisation administration has no application UI journey | Source only |
| G03-022 | P2 | Owner-confirmed organisation deletion request workflow is missing | Source only |
| G03-023 | P1 | Offboarding and role-change transactions have an inverse lock order | Targeted runtime; limits below |

## Detailed findings

### G03-001 — Organisation audit endpoint bypasses audit permission and project scope

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** R-SITE lacks audit.read and belongs only to project A. GET /api/v1/orgs/<org>/audit returns 200 and an internal event from unassigned project B, including its after_json. The fixture contains clearly labeled internal notes and a commercial-value marker.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.controller.ts:30`; `apps/api/src/modules/organisations/organisations.service.ts:1136`.

**Correction:** Require the actual audit.read capability plus current tenant/project/resource and field visibility. Do not expose the full tenant audit through org.read. Keep any deliberately public or user-specific activity feed as an explicitly narrower contract.

**Required verification:** Authorized Owner/Admin/auditor access succeeds within approved scope. Site, billing-only and external actors cannot obtain tenant-wide audit history, internal event payloads or unassigned-project events through this endpoint, aliases, counts or pagination. Denial events remain redacted and durable.

**Limits/dependencies:** The event is an authorization fixture, not customer financial data. This is the organisation endpoint manifestation of G02 permission/visibility concerns; a shared correction may address multiple IDs.

### G03-002 — Organisation dashboard fails against the migrated database

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** Owner and Site HTTP dashboard requests both return 500 INTERNAL_ERROR. Actual service execution reports PostgreSQL 42703: column p.retention_at_risk_paise does not exist. All 41 source migrations were applied. The existing dashboard unit test supplies mocked query rows and does not detect this SQL/schema failure.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:49`; `apps/api/src/modules/organisations/organisations.service.ts:109`.

**Correction:** Reconcile the dashboard SQL with actual migrated schema and the authoritative contract/retention calculations. Also address the statically visible extra bound user parameter on statements that omit the scoped $2 predicate for broad roles; fixing the first missing column alone is insufficient. Keep tenant/resource filtering and do not manufacture values.

**Required verification:** Real PostgreSQL and HTTP dashboard requests succeed for every intended role, with zero/one/multiple contracts, correctly scoped requirements, current status/expiry facts and zero-data states. No schema patches or successful mocked rows may substitute for executing the actual SQL.

**Limits/dependencies:** The missing-column failure is reproduced. The parameter-count issue is source-confirmed and currently masked by that first failure; it was not reproduced by altering the application schema.

### G03-003 — Profile PATCH breaks partial updates and cannot clear optional values

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** PATCH with only rowVersion and displayName returns 500 and rolls back. The upsert explicitly inserts null into NOT NULL profile fields instead of preserving defaults; PostgreSQL checks insert constraints even when an existing row would conflict. A complete accepted PATCH with pan:null returns 200 but leaves the previous PAN because COALESCE treats explicit null as omission.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:273`; `apps/api/src/modules/organisations/organisations.service.ts:348`; `apps/api/src/modules/organisations/organisations.service.ts:393`.

**Correction:** Define typed PATCH semantics for omitted, changed and explicitly cleared values. Preserve required defaults and validate optional clearing policy. Use actual profile concurrency versions and return controlled errors for invalid or stale writes. Update organisation/profile and audit atomically.

**Required verification:** Partial updates work for existing and initially absent profile rows. Optional fields clear when permitted or return an explicit policy error. Required nulls reject before SQL; omitted fields remain unchanged. Stale concurrent edits fail consistently without partial profile/org/audit writes. Invalid GSTIN still yields the existing 422.

### G03-004 — Branding, state and retention inputs are not validated

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** A full profile PATCH with a valid company name returns 200 while persisting state ZZ, brand_color not-a-color, a data:image/svg+xml logo URL and default_retention_months=-1. The controller accepts any body and validation covers GSTIN/PAN only.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.controller.ts:42`; `apps/api/src/modules/organisations/organisations.service.ts:273`.

**Correction:** Validate runtime types, supported states, colors, lengths, retention bounds and allowed branding object references. Follow WF-02 and the repository SVG prohibition; use tenant-owned eligible immutable logo objects and reviewed rendering rules rather than arbitrary untrusted URLs. Do not lower legal holds/retention through a profile setting.

**Required verification:** Valid PNG/JPEG/WebP branding and supported settings save and render through the intended isolated workflow. SVG/data/file/private-network or unrelated-tenant references, invalid colors/states/retention/types and oversized fields reject before persistence. Verify consumers and storage/scanner outcomes separately.

**Limits/dependencies:** This proves unsafe/unsupported values are stored. It does not demonstrate a renderer fetch, SSRF, XSS, actual SVG upload or retention purge.

### G03-005 — Required profile/default fields are silently ignored

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** A successful profile PATCH includes addressJson, contactEmail, footerText and timeZone, but address_json stays {}, contact_email/footer_text stay null, and the update implementation has no supported persistence path for those inputs. The read projection also omits several profile fields. Multiple signatories and resumable defaults are not completed by the single signatory strings.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:45`; `03-PRODUCT-REQUIREMENTS.md:48`; `03-PRODUCT-REQUIREMENTS.md:53`; `apps/api/src/modules/organisations/organisations.service.ts:273`; `apps/api/src/modules/organisations/organisations.service.ts:235`.

**Correction:** Implement and document the supported company profile, contact/address, branding footer and default preference contract with explicit DTOs/readback. Resolve organisation versus profile setting duplication and actual consumers. Reject unsupported fields explicitly rather than acknowledging their save. Keep billing identity separate from project evidence.

**Required verification:** Save/read/reload returns each approved field and version, preserves unrelated values and tenant boundaries, and applies branding/defaults where intended without rewriting frozen historical packages. Test supported signatory/default workflows and honest unsupported states.

**Limits/dependencies:** The observed payload keys are probe inputs, not a claim that every public field spelling has already been standardized. V2 multiple branches/GSTINs are not promoted into an MVP blocker by this finding.

### G03-006 — Offboarding accepts replacements without the required role or project access

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** POST reassign-work returns 201 when transferring an R-QC member's requirement and pending review to an R-BILLING member with zero project memberships. The only replacement check is active organisation membership. The recipient cannot perform the assigned project/review work.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:794`; `06-WORKFLOWS-AND-STATE-MACHINES.md:616`.

**Correction:** Check current replacement identity/membership, each project and resource scope, required role/stage, self-approval/separation rules and assignment type under the transaction locks. If no eligible replacement exists, block with accurate per-project missing roles. Allow an explicit eligible allocation plan instead of forcing one person to cover incompatible tasks.

**Required verification:** Qualified accessible replacements succeed; billing-only, suspended, unassigned, wrong-stage/role, narrower-scope and self-approval-conflicting recipients fail atomically. Concurrent demotion/removal/scope changes cannot commit stale assignments. Preserve the original history and external party authority.

### G03-007 — Self-replacement removes a member while leaving their open work assigned

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** DELETE /members/<departing-user> with reassignToUserId equal to that same user returns 200. Membership becomes REMOVED while an open requirement remains owned by the removed identity. Providing any replacement bypasses the no-replacement removal blocker, and equality is never rejected.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:779`; `apps/api/src/modules/organisations/organisations.service.ts:794`.

**Correction:** Reject self-replacement for offboarding and validate that an actual eligible transfer occurred. Recompute/verify the remaining open-work manifest under the same protected boundary before removal; distinguish a harmless no-op reassign request from a successful offboarding transfer.

**Required verification:** All same-user replacement variants reject with controlled 4xx and no revocation/removal/assignment side effects. A different eligible replacement receives all intended responsibilities, and no active work remains operationally assigned to an inaccessible departed member.

### G03-008 — Bulk reassignment mutates closed-project obligations without lifecycle locking

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** The same successful reassign-work call changes owner_user_id on a requirement in a CLOSED project. The service bulk-updates by org and assignee without acquiring the shared project lifecycle locks or requiring formal reopening.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:804`; `apps/api/src/modules/organisations/organisations.service.ts:814`; `packages/db/src/tenant-tx.ts:60`.

**Correction:** Apply approved lifecycle policy under the shared project lock to every affected requirement/review/package/defect writer. Separate immutable historical provenance from active operational responsibility. Closed-project material changes require formal reopening and affected exception/acceptance invalidation as applicable.

**Required verification:** Closed/archived/cancelled/suspended project writes follow the approved policy even through org-wide administrative operations. Eligible active-project transfers succeed; mixed-project requests have documented atomic behavior. Concurrent closure and reassignment have a deterministic safe boundary.

**Limits/dependencies:** Closed state is a disposable authorization fixture, not a certified closeout. The reproduction proves assignment mutation, not that an accepted engineering package changed.

### G03-009 — Gap reports multiply reviews and infer roles from unrelated documents

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** One pending review is reported as three. Its document is linked only to the QC requirement, but requiredReplacementRoles also includes PM and SAFETY from a different document. The gap query joins document_requirements by tenant/project without binding it to the reviewed document version's document.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:1000`; `apps/api/src/modules/organisations/organisations.service.ts:1019`.

**Correction:** Bind review/version/document/requirement tuples correctly, restrict applicable current links and count distinct actual responsibilities. Derive replacement eligibility from each actual stage/requirement rather than an unrelated project-wide role array.

**Required verification:** Zero/one/many reviews, shared-document requirements, unrelated links and multiple stages yield exact counts and required roles. Cross-project/tenant joins cannot influence results. The corrected manifest must drive the real removal/reassignment decision, not only a mocked display.

### G03-010 — Bulk reassignment cannot safely handle PARTY review assignments

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** A schema-valid PENDING PARTY review identifies the departing member as reviewer_user_id. Bulk reassignment changes reviewer_subject_id to a replacement user but leaves reviewer_subject_type and reviewer_party_id as PARTY. PostgreSQL rejects the transaction with 23514 reviews_check2; other changes roll back.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:814`; `packages/db/migrations/0000_complete_v021_schema_and_rls.sql:765`.

**Correction:** Treat internal USER assignments, external PARTY authority, operational contacts and historical decisions as distinct. Safely transfer only eligible internal responsibilities; explicitly reverify, cancel or escalate external assignments according to their authority contract. Return actionable missing-role/party errors rather than raw SQL failures.

**Required verification:** Mixed USER/PARTY workloads produce an accurate gap/transfer plan. Eligible internal transfer works; no external party becomes an arbitrary internal user or inherits legal authority. Failed transfers retain atomic rollback and do not block emergency suspension.

**Limits/dependencies:** The database constraint correctly prevented a corrupt review. No bypass or successful unauthorized approval is claimed; the gap is the unsupported reassignment workflow.

### G03-011 — Offboarding gap omits pending submission responsibility

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** A member associated with a SENT submission gets a zero-work gap report and can be removed without replacement. computeMemberGapReport examines requirements, reviews, packages and defects only; WF-21 also requires pending submissions and delegations.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:1000`; `06-WORKFLOWS-AND-STATE-MACHINES.md:616`; `packages/db/migrations/0000_complete_v021_schema_and_rls.sql:913`.

**Correction:** Define and track current actionable submission/delegation responsibility in the gap/transfer workflow. Preserve created_by/submitted_by as historical provenance; do not rewrite those fields merely to hide the missing operational owner. Represent missing or external responsibility explicitly and block completion where policy requires.

**Required verification:** Pending submission/follow-up responsibilities and implemented delegation workflows appear in grouped gaps and reach an eligible owner, cancellation or documented external block. Completed history stays immutable. Concurrent new work cannot escape the transfer boundary.

**Limits/dependencies:** The fixture proves a pending row associated with the departing creator/submitter and a zero report. created_by alone is not asserted to be the correct transferable owner; the missing ownership contract must be resolved.

### G03-012 — Organisation suspension blocks promised reads and exports

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** After the test organisation becomes SUSPENDED, a previously valid owner session receives 401 SESSION_EXPIRED on org read and archive-export listing as well as on writes. FR-ORG-009 requires write blocking while preserving read access and exports. Login selection and session validation require ACTIVE organisations only.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:50`; `apps/api/src/common/guards/session-csrf.guard.ts:257`; `apps/api/src/modules/identity/identity.controller.ts:660`.

**Correction:** Model organisation status separately from identity/session validity and permitted actions. Preserve explicitly authorized suspended-org read/export and account-recovery/billing paths while rejecting writes and cancelled/deleted states according to the approved contract.

**Required verification:** Test existing sessions, new login and org switching for each org status and role. Authorized suspended-org reads/exports work with required export reason/reauth/rate controls; state mutations remain denied. No cross-tenant access or cancelled/deleted data resurrection.

**Limits/dependencies:** The tested write denial is a control that held. This finding requests the legitimate read/export contract, not weakening suspension broadly.

### G03-013 — Emergency member suspension and reactivation lack a supported API workflow

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** Removing a member with open work returns 409 OPEN_WORK_REQUIRES_REASSIGNMENT and correctly rolls back revocation, leaving their session valid. PATCH member with status:SUSPENDED returns 422 INVALID_MEMBER_ROLE, and the probed suspend route is 404. An internal SUSPEND helper exists but no registered controller exposes the documented suspend/reactivate workflow.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.controller.ts:78`; `apps/api/src/modules/organisations/organisations.service.ts:723`; `06-WORKFLOWS-AND-STATE-MACHINES.md:616`.

**Correction:** Expose a validated, authorized, audited membership-state transition that can suspend promptly even when an eligible replacement is unavailable. Separate emergency access revocation from the later responsibility transfer/removal. Reactivation must verify current eligibility and not restore old sessions/grants implicitly.

**Required verification:** An authorized administrator can immediately suspend a member with unresolved work, with old sessions/invitations unusable within the contract and gaps retained. Invalid actors, protected owner transitions, stale requests and malformed states deny. Eligible reactivation requires the documented new authentication path.

**Limits/dependencies:** A blocked REMOVE should remain atomic; its rollback is not itself a revocation bypass. The defect is the absence of the distinct emergency SUSPEND workflow.

### G03-014 — Ownership transfer completes without recipient confirmation

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** Current owner POST transfer-ownership with only targetUserId returns 201 and changes ownership. No recipient confirmation is supplied, and the target fixture has no verified MFA state. FR-ORG-014 requires both parties to confirm. Revoking both sessions after the transfer does not provide that prior confirmation.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:55`; `apps/api/src/modules/organisations/organisations.service.ts:891`.

**Correction:** Implement an expiring, identity-bound two-party transfer intent with explicit current-owner confirmation, eligible-recipient acceptance, required fresh assurance and atomic final role change. Handle cancel, rejection, expiry and stale authority without granting ownership early.

**Required verification:** One-sided, replayed, expired, wrong-recipient and changed-authority attempts cannot finalize. Both legitimate parties can confirm through the intended browser/API workflow; one owner remains and both assurance states rotate/revoke safely. Audit intent and final outcome separately.

**Limits/dependencies:** Owner authentication/MFA is a seeded fixture; no actual deployed MFA bypass is claimed. Existing same-owner/invalid-target/sole-owner protections must remain.

### G03-015 — A globally suspended identity can become the sole organisation owner

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** The destination membership is ACTIVE but its users.status is SUSPENDED. Actual HTTP transfer returns 201, demotes the previous owner and leaves the sole active owner membership attached to that suspended user, who cannot authenticate under the guard.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:913`; `apps/api/src/common/guards/session-csrf.guard.ts:262`.

**Correction:** Require current eligible identity and active membership, intended-party confirmation and necessary assurance under compatible transaction locks. Serialize against global suspension/recovery/offboarding. Do not transfer sole control to a principal that cannot legitimately exercise it.

**Required verification:** Suspended/deleted/unverified/ineligible target identities reject without changing roles or sessions. Eligible accepted transfers work. Races with user suspension, membership removal and recovery serialize safely, with a documented account recovery path and no lock inversion.

### G03-016 — Seat limits are not enforced at invitation membership activation

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** An ACTIVE test subscription specifies maxSeats=1 and has one active owner. A real invitation is issued using a nondelivering mail fixture; the actual IdentityController invitation acceptance creates a second ACTIVE membership. No capacity/seat reservation or atomic quota check runs on that insertion.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:315`; `apps/api/src/modules/organisations/organisations.service.ts:431`; `apps/api/src/modules/identity/identity.controller.ts:595`; `packages/db/src/tenant-tx.ts:168`.

**Correction:** Coordinate G03 membership activation with the authoritative plan entitlement/quota contract. Define invited versus active seat accounting, atomically serialize capacity, and release/reconcile reservations on revoke/expiry/removal without blocking legitimate re-login or duplicate acceptance.

**Required verification:** At-limit activation fails explicitly without consuming an unrecoverable proof or creating a membership. Below-limit activation succeeds. Concurrent invitations/acceptances and plan/status changes cannot overbook or miscount; retries are idempotent. Runtime stays restricted tc_app.

**Limits/dependencies:** Acceptance used test-mode debug OTP and fixture delivery; this is real restricted DB/application-path quota evidence, not production login/provider acceptance. Coordinate with billing/plan group instead of enabling disabled payments.

### G03-017 — Mobile member invitations promised by the contract are unsupported

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** POST invitations with a phone and role returns 422 INVALID_INVITATION_INPUT. The issuer accepts email only and sends an email link, although FR-ORG-008 supports email or mobile and the identity acceptance query already has a phone_e164 branch.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:49`; `apps/api/src/modules/organisations/organisations.controller.ts:59`; `apps/api/src/modules/organisations/organisations.service.ts:437`.

**Correction:** Provide one validated identity-bound destination contract for supported email/mobile invitations, including canonicalization, expiry, issuer hierarchy, recipient matching and configured delivery outcomes. Preserve the G01 single-use proof and current issuer checks; do not repurpose unsupported member-login magic links or invent fallback delivery.

**Required verification:** Email and approved mobile invitation flows issue/revoke/supersede/accept once for the intended verified identity. Mismatched numbers, unsupported destinations and unavailable delivery fail honestly. Real SMS/provider acknowledgement and operational acceptance remain separate.

**Limits/dependencies:** No real message was sent. If mobile invitation scope is explicitly deferred by accountable product review, record that approved scope decision; silently treating the MVP requirement as implemented is not acceptable.

### G03-018 — Successful invitation issue/revocation leaves no business audit event

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** Actual service issue/promote and revoke leaves an invitation REVOKED but creates zero audit_events for its org. These transactions do not emit membership/invitation domain audit events. The nondelivering in-process mail adapter bypasses real provider transport only, not application DB methods.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.service.ts:431`; `apps/api/src/modules/organisations/organisations.service.ts:589`; `03-PRODUCT-REQUIREMENTS.md:304`.

**Correction:** Audit issuance, delivery-state transitions, supersession, revocation and acceptance with safe principal/issuer/target/role/reason correlation and transactional outcome semantics. Keep raw tokens, invitation URLs, OTPs and provider secrets out of immutable history. Reuse G01 delivery ledger evidence without confusing it with membership audit.

**Required verification:** Successful and failed invitation lifecycle transitions have correctly scoped durable records after commit/rollback, with no secret leakage and bounded duplicate events. Provider receipt history and business membership history correlate but retain their distinct purposes.

**Limits/dependencies:** This is absence of the business audit path in the actual service. It does not claim absence of every possible external mail/proxy log.

### G03-019 — Organisation member identifiers reach SQL without runtime validation

**Priority/status:** P2 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** DELETE /members/not-a-uuid returns 500 INTERNAL_ERROR. Path parameters and several inline body types are not validated before database use. Narrowly validated invitation/ownership inputs do not cover all org/member operations.

**Source at 863e6e0:** `apps/api/src/modules/organisations/organisations.controller.ts:99`; `apps/api/src/modules/organisations/organisations.service.ts:733`.

**Correction:** Apply validated UUIDs, enums, body shapes and size constraints before guards/services use them in SQL. Retain stable controlled 4xx, current authority checks and cleanup. Share the correction with G02-016/G01-016 instead of implementing divergent validators.

**Required verification:** Malformed path/body/collection/string/array/object/null inputs reject before resource lookups/writes. Valid inputs preserve tenant binding and domain behavior; every failure releases/rolls back clients. Exact org/path mismatch still returns non-disclosing 404.

**Limits/dependencies:** This is an org-group manifestation of an existing cross-group validation concern; one root-cause fix can satisfy all linked IDs.

### G03-020 — Resumable company onboarding is not implemented

**Priority/status:** P2 / OPEN. **Evidence:** SOURCE_CONFIRMED.

**Observed:** Source contains signup identity/company/state capture and immediately creates an ACTIVE org/owner. The web route tree has login/MFA/dashboard/project journeys but no company→trade pack→first project→invite onboarding flow or persisted resumable setup state. The specified required terms/privacy checkbox/state is also absent from the signup form.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:44`; `06-WORKFLOWS-AND-STATE-MACHINES.md:316`; `11-UI-UX-SPECIFICATION.md:139`; `apps/web/src/app/(public)/login/page.tsx:14`; `apps/api/src/modules/identity/identity.controller.ts:702`.

**Correction:** Implement the reviewed skippable/resumable onboarding contract with explicit progress, validated company/trade/project/team steps and the required consent state. Use real reviewed HVAC mappings and an honest empty project state. Do not generate fake engineering evidence or silently select DT-001.

**Required verification:** Actual application-browser tests cover new verified owner, skip/resume/reload, multiple devices/tabs, validation and partial failures, with tenant isolation and accessible loading/error states. Persist user choices and required consent according to the approved product contract.

**Limits/dependencies:** Source-confirmed workflow gap only; no browser onboarding run or legal-compliance certification is claimed. Member-login magic links remain unsupported under the current G01 contract. No fabricated sample baseline is authorized.

### G03-021 — Organisation administration has no application UI journey

**Priority/status:** P2 / OPEN. **Evidence:** SOURCE_CONFIRMED.

**Observed:** The tracked app routes have no organisation settings, team/invitation administration, membership suspension, responsibility-transfer manifest or ownership-confirmation UI. Backend endpoints and helper tests alone do not deliver SCR-042/SCR-056 or a usable management workflow.

**Source at 863e6e0:** `11-UI-UX-SPECIFICATION.md:97`; `11-UI-UX-SPECIFICATION.md:110`; `apps/web/src/app/(contractor)/layout.tsx`; `apps/web/src/lib/api-client.ts`.

**Correction:** Build the approved organisation/team/settings/offboarding/ownership UI against the corrected APIs. Use current actor/tenant context, validated forms, accessible errors, accurate affected-work manifests and explicit confirmation for sensitive transitions. Do not display successful delivery, acceptance or access removal before server confirmation.

**Required verification:** Actual web/API E2E covers authorized owner/admin flows, ordinary-member/external negatives, current-role changes, tenant switch/stale tabs, failed delivery/save/removal, eligible replacement and reload. Screens must reflect real state and not demo identities or mocked success.

**Limits/dependencies:** The route/source inventory confirms the gap; no deployed browser screenshots or E2E success is asserted. Generic configuration-resolver code is not a completed company administration UI.

### G03-022 — Owner-confirmed organisation deletion request workflow is missing

**Priority/status:** P2 / OPEN. **Evidence:** SOURCE_CONFIRMED.

**Observed:** The schema has deletion_requests and the permission vocabulary has org.delete, but the registered application controllers expose no owner-name-confirmed organisation deletion request/status/cancellation workflow. A retention table does not implement FR-ORG-010.

**Source at 863e6e0:** `03-PRODUCT-REQUIREMENTS.md:51`; `06-WORKFLOWS-AND-STATE-MACHINES.md:74`; `packages/db/src/schema.ts:1769`; `apps/api/src/app.module.ts`.

**Correction:** Implement a separately reviewed staged request/confirmation/status/cancel contract with current owner, fresh assurance and exact-name confirmation. Preserve legal holds, immutable audit, configured retention and project/customer evidence. Coordinate privacy/retention operations; do not add an immediate destructive purge or fabricate external legal/operational approval.

**Required verification:** Isolated tests cover authorized requests, wrong name/role/tenant, replay, cancellation, holds, retention clocks and honest blocked states. Independent retention/privacy/operational acceptance precedes any real deletion execution; no production purge is authorized by this handoff.

**Limits/dependencies:** Source-confirmed missing request workflow. Retention-law conclusions and real deletion/provider acceptance are outside this source audit. V2 branches and other unrelated product additions are excluded.

### G03-023 — Offboarding and role-change transactions have an inverse lock order

**Priority/status:** P1 / OPEN. **Evidence:** TARGETED_RUNTIME_OBSERVATION.

**Observed:** A deterministic two-connection test runs actual service SQL: an administrator role-change holds its session SHARE lock, while owner offboarding locks that administrator membership FOR UPDATE and waits to revoke its session. The role-change then waits for the membership. PostgreSQL rejects the role-change with 40P01 deadlock detected; offboarding commits and the pool remains reusable.

**Source at 863e6e0:** `packages/db/src/tenant-tx.ts:79`; `apps/api/src/modules/organisations/organisations.service.ts:634`; `apps/api/src/modules/organisations/organisations.service.ts:733`; `apps/api/src/modules/organisations/organisations.service.ts:764`.

**Correction:** Establish one compatible lock order for current actor identity/session/membership, target membership, invitations and audit/session FK dependencies. Serialize the two operations safely and map/retry only reviewed transient failures where necessary. Do not remove G01 session fences, weaken roles, skip audit or merely swallow deadlock errors.

**Required verification:** Deterministic multi-connection role-change/offboarding/ownership/recovery races produce a documented serial outcome without SQL deadlocks, stale authority or partial audit/assignment state. Preserve G01 account-lock/FK regression coverage and verify failure cleanup under bounded timeouts.

**Limits/dependencies:** The harness only pauses actual queries at lock boundaries; it does not mock SQL results. This is an in-process multi-connection service test, not a deployed multi-API or browser race.

## Controls that held and policy questions

- Foreign-org path access returned 404 NOT_FOUND. Sole-owner removal returned 409 CANNOT_REMOVE_SOLE_OWNER. Invalid GSTIN returned 422 INVALID_GSTIN. These controls remain required.
- Removal without replacement while open work exists returns 409 and rolls back, including session revocation. That atomic rollback is expected; 013 identifies the missing separate emergency suspension route.
- Ownership transfer revokes the old owner session as designed, and the retained G01 tests cover session invalidation, owner-role escalation guards, identity-bound invitation acceptance and nonredeemable uncertain delivery. Those protections must not be removed to repair G03.
- Admin peer-role edit returned 403 PROTECTED_MEMBER_ROLE_CHANGE while removing the same peer returned 200. This is a real policy inconsistency requiring an explicit hierarchy decision; section 05 permits Admin member management but does not unambiguously prohibit peer removal. It is **not counted here as a confirmed privilege-escalation finding**. Preserve current observations and resolve the intended hierarchy through accountable review.
- A PARTY review reassignment fails and rolls back because the database subject constraint works. Fix the workflow without weakening that constraint or replacing external-party authority with arbitrary user IDs.

## Validation performed

The final probe completed successfully as a capture script, with outcomes interpreted per finding. It intentionally records defects, so exit 0 / COMPLETED is not a passing security-suite claim. Source status, timestamps, migration names/checksums, restricted role and pool reuse are in results.json.

The existing targeted command was:

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH \
APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout \
MIGRATOR_DATABASE_URL=postgres://postgres:fix_disposable_pw@127.0.0.1:55439/tradecloseout \
DB_PORT=55439 NODE_ENV=test \
pnpm --filter @tradecloseout/api test --runTestsByPath \
  test/g01-member-invitation-authority-db.spec.ts \
  test/g01-invitation-db.spec.ts \
  test/g01-auth-session-transaction-fence-db.spec.ts
```

Result: exit 0, **3 suites / 7 tests passed**. These are retained-control regressions, not tests of every new G03 finding. Exact final probe commands and safe environment-local fixture credentials are in the evidence README.

No new application source patch, full workspace/security/RBAC/browser run, CI certification, independent approval or deployment is claimed by this documentation task. No test is replaced by fabricated data or a sample success artifact.

## Implementation and acceptance order

1. Reproduce on the real feature-branch head based on current main. Explicitly account for the unmerged G01 dependency and the open G02 application handoff; coordinate shared guard/transaction/DTO changes without competing writers on a PR. Keep these original G03 IDs and link cross-group root causes instead of silently renumbering or declaring them fixed elsewhere.
2. Close access/authority and orphaning defects first: 001, 006–008, 013–015 and 023. Preserve tenant transactions, current session/role/scope under lock, project lifecycle locks, immutable evidence and independent external authority.
3. Repair database-backed dashboard/profile/gap/assignment contracts (002–005, 009–012), runtime validation/audit (018/019), capacity/mobile contracts (016/017), then the missing legitimate product journeys (020–022). External or policy dependencies must be explicit; do not fabricate delivery, evidence, legal delegation or deletion acceptance.
4. Add meaningful positive, negative, mixed-scope, rollback/retry, alias/list/count and deterministic multi-connection regressions for each correction. Use Node 22, the root-pinned pnpm and frozen lockfile. Run typecheck, production build, workspace tests, security/RLS tests and RBAC on the exact proposed head. Run actual application E2E with web/API/isolated fixtures; root archive-verifier browser checks are not the full application journey. Append migrations and verify fresh/upgrade paths where required.
5. Report per ID: reproduction/dispute, fix SHA, changed behavior, exact command/results, artifact links and limitations. Current-head concrete evidence may dispute a finding; dropping IDs or changing policy to pass is not allowed.
6. Obtain distinct accountable independent review of security, tenant isolation, HVAC/evidence semantics, migrations, regressions and CI. Deployed browser/proxy/MFA, real provider delivery, legal/retention, multi-node operational and user release acceptance remain separate gates. A coder can propose statuses but cannot self-approve REVIEW_VERIFIED/RELEASE_ACCEPTED, auto-merge, deploy or declare production readiness. No production purge is authorized.
