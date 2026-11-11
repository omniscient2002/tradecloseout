# G03 Organisations: production readiness audit and repair contract

Reviewed source: c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0, branch work.
Decision: NO_GO. This is an analysis and verification task; no application changes,
merge, provider certification or deployment were performed. G03 is Organisations,
as identified by docs/groups/G01/original-audit.md:693. Older reports use G03 for
unrelated gap IDs; this report concerns the organisation group.

## Relationship to existing candidate audit

This is the main-source snapshot audit, not the canonical 23-finding G03 candidate
audit in PR #11 (33d32a55a1286fd2b18e1c083b8a02d88a5244f6), which assesses the
G01 candidate 863e6e0c56ad4a92af2580fbcbfc179832056b2d. Local G03-001..038 labels
in this snapshot are source-qualified and must not be substituted for PR #11 IDs.
This bundle lives outside docs/groups/G03 to preserve that existing inventory.
Proposed fixes in PR #13 are also unmerged and require their own exact-head review.

## Evidence and scope

Primary: entire organisations controller/service/module; identity registration,
org chooser/switch; session/permission guards; tenant transaction wrappers; schemas
and migrations 0000 through 0020; project membership; review decision authority;
offboarding-related requirements/packages/defects; billing seat limits; worker
event registry, scheduler, notifications, package compiler; web layout/dashboard,
API client, offline queue and draft storage; requirement and workflow contracts;
relevant tests. Repository-wide cross-reference searches identified consumers.
This does not certify every unrelated module of the product.

Node 22.23.4 / pnpm 12.4.1. Fresh random disposable database migrated with real
repository migrations, PostgreSQL 16.15, restricted tc_app. Test helper verifies
the runtime role is neither superuser nor BYPASSRLS and drops only its created DB.

- pnpm typecheck: passed.
- Four existing API suites: 72 tests passed (auth-iam, discovery-lifecycle-
  foundations, hvac-production-reaudit-remediation, production-reaudit-remediation).
- Audit harness: one Jest test with 34 database/guard probes; passed. Its success
  means the recorded current behavior was reproduced, not that production passes.
  evidence/probe-results.json contains individual observations; evidence/probes.txt contains output.
- No new full workspace build/test, production-mode browser suite, remote CI,
  provider delivery, multi-node revocation or production deployment was certified.
- Existing positive controls: sequential last-owner demotion blocked, second owner
  rejected by unique index, mismatched tenant member list denied, cross-tenant
  profile rows hidden by RLS. Do not regress these controls.
- Current source already rechecks memberships on each guarded request and validates
  switch-org UUID/target org status. The issues below concern remaining behavior.

Evidence classes: R = reproduced against migrated PostgreSQL/restricted role or
actual guard; S = confirmed source/contract gap; H = hardening requirement without
a demonstrated standalone HTTP exploit. Probe numbers refer to probe-results.json.
P0 = ownership/security invariant failure; P1 = release blocker for declared G03
scope; P2 = correctness/operability requiring resolution or explicit scope decision.

## Findings

### G03-001 — P0 / R: ownership transfer and role change can leave zero owners

Source: organisations.service.ts:500-525,691-735; migration 0000:211.
Probe 11 pauses the actual role-change query after it observes A as owner, transfers
A to B on a second connection, then resumes demotion of B. Both service calls
commit; zero ACTIVE R-OWNER rows remain. The partial unique index enforces at most
one, not at least one. Serialize all owner/member transitions on an organisation
lock, re-read target after locking, forbid R-OWNER changes through generic role
updates, and enforce the final owner invariant with a reviewed deferred constraint
or equivalent DB command boundary. Permit registration/transfer intermediate states
only within a transaction. Test transfer/demotion/removal/registration failures and
reverse ordering; assert exactly one eligible owner at commit and rollback.

### G03-002 — P1 / R+S: mutation transactions do not revalidate current authority

Source: organisations.service.ts:307,500,541,692; tenant-tx.ts:86-90;
session-csrf.guard.ts:121-164. Probe 18 removes the actor's membership and a service
call with the previously authenticated context still commits a profile update.
Guards protect fresh requests, so this is not proof of an unauthenticated HTTP
bypass. Guard and mutation use different transactions, leaving in-flight authority
stale. Lock and recheck actor membership, user/org status, permission and relevant
session/generation inside each sensitive transaction. Coordinate offboarding and
role changes with those locks. Test paused authenticated commands resumed after
revocation; ensure a defined linearization point and revocation SLA.

### G03-003 — P1 / R+S: ownership transfer lacks two-party consent and step-up auth

Source: organisations.controller.ts:110; service:691-735; FR-ORG-014. Probe 10
transfers with only the current owner's request. Require an expiring transfer
proposal bound to org/current owner/target/version, independent target acceptance,
recent strong authentication and single-use consumption. Reject self-transfer,
ineligible users, revoked/stale proposals and forged actor identity. Notify both
parties and record proposal plus completion. Verify repeated/concurrent acceptance
and timeout/cancellation. Legal-authority confirmation remains an external gate.

### G03-004 — P1 / S: controller permission contracts are too coarse

Source: organisations.controller.ts:58-125; shared/permissions.ts; API-014..019.
Membership commands use org.manage instead of org.manage_members; transfer uses
org.manage instead of org.transfer_ownership. The transfer service does check the
owner role, so do not call this an established admin ownership takeover. Use exact
capabilities in controller and transaction checks, owner-only ownership transitions,
valid role enums and explicit promotion/demotion policies. Translate uniqueness,
invalid role and stale state errors into safe domain conflicts, not raw SQL/500.
Test all org roles and guests against every endpoint and direct command boundary.

### G03-005 — P1 / S: invitation acceptance and identity-bound membership join absent

Source: organisations.controller.ts (no accept endpoint), identity.controller.ts:361-
420; API-015/FR-ORG-008. Implement token-hash lookup, lock invitation, check status,
expiry, org and authenticated verified intended email/mobile, then create/reactivate
only the intended membership and consume once atomically. Define removal/reinvite
and suspended-member policies; do not revive an account through an old link. Use
an identity bootstrap session when the invitee has no org. Test forwarded link,
wrong/unverified identity, replay, concurrent accept/revoke/expiry, and failed commit.

### G03-006 — P1 / S: invitation issuance has no delivery workflow

Source: organisations.service.ts:424-463; worker/event-registry.ts:87;
worker/main.ts:456. Issuance saves a token hash and returns the raw token to the
caller; no invitation mail/SMS job or delivery event is emitted. Add durable
transactional delivery intent, verified target routing, expiring token protection,
retry/dedup/dead-letter handling and explicit queued/sent/failed status. Do not
claim an informational registry entry delivers mail. Avoid bearer tokens in logs,
audit, analytics and generic durable response receipts; arrange narrowly scoped
delivery-secret storage if required. Prove delivery with actual configured providers.

### G03-007 — P1 / R: invitation revocation always references a missing column

Source: service:474-476; migration 0000:215-231. Probe 6 produces 42703 because
invitations has no updated_at. Add an append-only migration and matching schema,
or remove the invalid write while adding explicit revoke metadata. Keep revocation
and acceptance mutually exclusive under a lock and audit the actor/time. Test a
fresh install and upgrade from the actual previous schema; revoked token cannot join.

### G03-008 — P1 / R+S: invitation lifecycle permits invalid and duplicate records

Source: service:409-459; invitations DDL. Probes 7,8,25 store not-an-email and an
unknown role, create two pending invitations concurrently, and list expired records
as pending. Validate EMAIL/PHONE and organisation roles; exclude owner invitation
from ordinary role administration; normalize consistently; supersede/revoke earlier
live invitations with a concurrency-safe uniqueness strategy. Model expiry and
resend token rotation; phone invitation is part of FR-ORG-008 but not implemented.
Test old-token rejection, identity-channel matching, duplicate races and clock edges.

### G03-009 — P1 / S: seat/abuse limits are not integrated with membership writes

Source: service:424,492,533; warranty-and-billing.service.ts:584;
tenant-tx.ts:consumePlanQuota. Billing describes maxSeats; G03 does not atomically
enforce seat additions/reactivations or reconcile removals. Define which membership
states consume seats, atomically claim/release quota at acceptance/reactivation,
serialize concurrent last-seat joins, and add invitation/reinvite abuse limits.
Handle missing plan explicitly. Do not charge for undelivered invites accidentally.
Test parallel joins at limit, retry/rollback and counter reconciliation.

### G03-010 — P1 / R+S: immediate suspension is not reachable and failed removal
rolls back attempted access revocation

Source: controller:78-108; service:563-588. PATCH accepts role only; SUSPEND exists
only as a service action. Probe 33 finds REMOVE with open work throws and its session
revocation rolls back, leaving the session active. Provide a dedicated authorised,
audited suspend action committed independently of reassignment success, then finish
offboarding separately. Define restore/remove transitions and state preconditions;
never require finding a replacement before suspending a compromised account. Test
all sessions/nodes within 60s, blocked removal, logout, in-flight commands and resume.

### G03-011 — P1 / R: departing user accepted as their own replacement

Source: service:592-645. Probe 12 removes a member after reassigning open defects
back to that same user; work is orphaned. Reject source==replacement at validation
and transaction layers. Verify after mutation that all transferable obligations have
an eligible active assignee; do not silently null assignments. Test every work type
and concurrent reassign/remove, with atomic rollback on invalid replacement.

### G03-012 — P1 / R: replacement eligibility is insufficient

Source: service:593-635. Probe 13 assigns defects to an R-BILLING member without
project membership. Only membership.status is checked. Check active user, org and
membership, project access, permission, reviewer role, relevant separation of duties
and external/legal authority per item. Support multiple replacements by work type
and project. Revalidate under locks rather than trusting a preview. Test cross-tenant,
inactive, wrong-project, wrong-role, uploader/self-review and external-subject cases.

### G03-013 — P2 / R: gap report multiplies reviews by unrelated project links

Source: service:780-790. Probe 24 creates one pending review and two links on an
unrelated document in that project; pendingReviewsCount is 2. Join review to its
document_version/document before document_requirements, count distinct review IDs,
and derive roles only from relevant current linked requirements. Return item IDs,
versions and stable project groups. Verify multiple links, multiple stages, no links,
superseded versions and overlapping requirements without double counting.

### G03-014 — P1 / S: offboarding manifest omits workflow obligations

Source: service:765-899; WF-21. Report covers requirements, pending reviews, packages
and OPEN/IN_PROGRESS defects. It does not provide the required delegation/pending
submission coverage, replacement plans for project responsibilities or domain-specific
follow-up obligations. Inventory every user-bearing responsibility across reviews,
submissions, commissioning/witness/seasonal tasks and related queues; distinguish
historical attribution from active duty. Where delegation is unimplemented, state that
capability gap rather than pretending cleanup occurs. Removal must block or explicitly
cancel/reassign every applicable active duty. Test a fixture for each real work type.

### G03-015 — P1 / S: reassignment changes historical provenance and subject identity

Source: service:612-626; reviews DDL unique/subject checks. requested_by records who
requested a package; replacing it on QUEUED/GENERATING packages rewrites provenance.
Introduce a current responsibility field/transfer ledger while preserving requester,
creator and frozen package metadata. For reviews, transfer USER assignments explicitly;
do not overwrite PARTY subject IDs with member UUIDs. Use cancel/recreate or recorded
assignment transitions as appropriate. Test that prior approvals, signatures, versions,
package manifests and original actor identity remain immutable.

### G03-016 — P1 / S: review reassignment can collide and abort all offboarding

Source: service:612-618; migration 0000:786. If replacement already has a review for
the same document version/stage/subject, bulk UPDATE collides with unique identity.
Define a conflict-safe plan preserving review history and required independent
approvers; do not delete rows or drop the constraint to pass. Show conflicts during
preview and recheck at execution. Test duplicate assignments, PARTY/USER boundaries,
multi-stage review, uploader conflicts and rollback/session-suspension separation.

### G03-017 — P1 / R+S: offboarding bypasses project lifecycle and assignment locks

Source: service:541-647; other project/assignment writers. Probe 23 modifies the owner
of a HANDED_OVER requirement on a CLOSED project. Use the shared project lifecycle
lock and a documented order for org/project/member/work locks. Preserve frozen
historical records; formal reopen is required for baseline changes. Coordinate new
assignment writers with membership status so work cannot be assigned during/after
offboarding. Test closed/suspended projects, close-vs-reassign, new-work races,
replacement removal and deadlock/serialization handling.

### G03-018 — P1 / R+S: project membership survives removal and accepts outsiders

Source: service:638-646; projects.service.ts:833-866. Probe 14 retains ACTIVE project
membership after org removal; probe 20 adds a user with no org membership and an
invented role. Fresh org guards still block a removed member; do not describe dormant
project rows as an established immediate bypass. Deactivate/review grants on removal,
require eligible org membership and valid project roles on assignment, and do not
automatically revive historical access on rejoin. Test remove/reinvite/reactivate,
cross-org user IDs, project-specific roles and restoration policy.

### G03-019 — P2 / R+S: responsibility states and concurrency versions are inconsistent

Source: service:604-635,770-810. Probe 15 shows defect reassignment leaves row_version
unchanged; HANDED_OVER and superseded requirements can enter open-work predicates.
RECTIFIED defects require explicit resolution of follow-up responsibility. Centralize
current/open predicates by work type, exclude frozen/superseded history, increment
the right row versions and return before/after counts. Probe 26 shows role edits also
lack stale-version protection. Test stale edit conflicts and count-to-execution parity.

### G03-020 — P1 / R+S: suspended orgs cannot read/export or escape via org chooser

Source: session-csrf.guard.ts:154-164; identity.controller.ts:373,527,563;
FR-ORG-009. Probe 19 denies GET with SESSION_EXPIRED for suspended orgs. Separate
identity authentication from org-state action policy: suspended tenants preserve
authorised reads/exports while writes stop. An authenticated user must be able to
choose another eligible org even if the current org is suspended. Login selection
must consider org eligibility and current user status. Test all org states, multi-org
accounts, fresh/existing sessions, member suspension versus tenant suspension, exports.

### G03-021 — P1 / S: organisation creation/onboarding contract is incomplete

Source: identity.controller.ts:361-420; organisations.controller.ts;
FR-ORG-001..004/API-010. No authenticated POST /orgs route exists; unknown OTP
identities implicitly create a company with fallback legal name/state/entity type.
Separate explicit registration, existing-user org creation and invited-user joining;
collect and validate required legal/trade details, atomically create exactly one owner
and initialise the selected plan/policy. Implement resumable onboarding or explicitly
reduce the launch contract. Test new identity, existing member, invitee with no org,
parallel registration, duplicate identity, partial failure and deliberate company creation.

### G03-022 — P1 / R: partial profile PATCH violates NOT NULL constraints

Source: service:340-367. Probe 2 submits displayName only; UPSERT supplies null for
brand_color and fails 23502 before ON CONFLICT can preserve the existing value.
Differentiate absent fields from explicit null; preserve existing values and use
actual defaults for a new profile. Do not require clients to resend every setting.
Test each individual field, combinations, no-op, absent profile and rollback of the
organisation row_version/profile/audit when any validation fails.

### G03-023 — P1 / R+S: optimistic concurrency contract is disconnected

Source: controller:44-50; service:321,386-388; web/api-client.ts:90.
Client sends If-Match, controller reads no header, wrapper defaults body.rowVersion
to 1. Probe 5 succeeds once then conflicts on the next otherwise valid update.
Parse and require documented preconditions, return ETag/current rowVersion, reject
stale writes with 412 and absence with documented policy (usually 428), and protect
role/owner/state transitions too. If retaining body versions, reconcile both contracts
explicitly. Test two clients, profile+org version consistency, stale tokens and retry.

### G03-024 — P2 / R+S: profile clearing, fields and schema contracts disagree

Source: service:250,269-283,343-367; schema.ts:49-152; profile DDL.
Probe 4 cannot clear PAN with explicit null because COALESCE restores it. Distinguish
omission/null, support the promised address/contact/footer/timezone/locale fields,
and return a canonical typed DTO rather than mixed naming. Reconcile Drizzle with
deployed migrations: invitation phone vs phone_e164, missing profile fields, download
flag naming, nullable pre-onboarding session and owner constraint representation.
Use append-only upgrade migrations and fresh/upgrade/schema compatibility tests.

### G03-025 — P1 / R+S: saved organisation policy settings do not control behavior

Source: service:341-367; schema.ts:59; session guard:286;
reviews.service.ts:628; worker retention/compile code. Probe 3 writes profile
allow_self_approval=true while organisations.allow_self_approval stays false;
review decision unconditionally prohibits self-approval. The download policy is
hardcoded false in auth context; default_retention_months has no G03 enforcement
path. Choose one authoritative policy and effective version. Connect approved
settings or remove unsupported toggles. Preserve separation of duties and legal
holds: never simply enable self-approval or shorten retention to match the form.
Test policy effects via real APIs/workers, including prior approved packages.

### G03-026 — P1 / R+S: runtime input validation is missing at G03 boundaries

Source: controller DTO any/inline types; service:286-305,430,492;
main.ts:ValidationPipe. Interfaces do not provide runtime validation metadata.
Probe 22 accepts negative retention and invalid colour; missing email throws at
trim(), malformed UUID/role values reach SQL, and coercible values can be accepted.
Use runtime schemas/classes for every body/param/header, reject unknown keys,
bound strings/collections, strict integer/boolean types and legal entity/state enums.
Persist the parsed normalized GSTIN/PAN values: probe 34 shows a space-padded PAN
passes the trimming validator but the untrimmed value reaches SQL and fails 23514.
Validate related state/PAN consistency when
claimed. Map 22xxx/23xxx database errors without SQL leakage. Test omitted/null,
arrays/objects, numeric strings, oversized fields and unsupported settings.

### G03-027 — P2 / S: branding is not a controlled, versioned production asset

Source: service:250,279,363; org_profiles.logo_object_id FK;
handover-package.processor.ts:68-84,237. G03 accepts logoUrl; the compiler uses
the current legal name and does not consume the full promised logo/footer/signatory
branding. Use same-tenant verified/scanned object versions with MIME/dimension/size
limits. If external URLs remain, define safe fetch/origin rules before implementing
consumption; an actual SSRF exploit was not reproduced. Version profile/branding and
snapshot effective legal name/signatory at package request. Test rename/change while
queued, cross-tenant logo, unsafe media and immutable old output.

### G03-028 — P1 / R: audit history is exposed through org.read

Source: controller:30-33; service:901-914; permissions.ts:R-SITE.
Probe 31 uses actual route metadata, PermissionGuard and database: R-SITE passes
org.read and receives an internal audit note. Require audit.read, apply its project
scope, deny guests and use explicit safe projections. Do not rely on the external
guest projection for internal roles. Define redaction and personal-data visibility,
including before/after JSON. Test every org role, sensitive records and unassigned
projects; preserve legitimate auditor/owner access and tenant isolation.

### G03-029 — P1 / R+S: membership audit events are absent or misnamed

Source: service:424-525,649-658; worker/event-registry.ts:85-91;
tenant-tx.ts:redactSensitiveFields; session guard userContext. Probe 9 records no
role-change audit/outbox entry. Invitation issue/revoke omit emission. Removal emits
MEMBER_REMOVE while registry expects MEMBER_REMOVED; REASSIGN_ONLY/SUSPEND also
do not align. Emit agreed versioned events atomically, register actual semantics,
record before/after role/status and per-item transfers without secrets, and queue
required notifications. Carry validated IP/user-agent/request ID into actor context.
Capture old profile values too. Test actual outbox consumption, rollback, redaction,
same-command retries and notification failures separately from audit success.

### G03-030 — P1 / R: owner/admin dashboard fails against migrated schema

Source: service:83-120,157-185; migration 0005. Probe 1 hits missing
p.retention_at_risk_paise (42703). Scope-free project/expiry/attention queries also
pass two values while using only $1; probe 21 isolates the expiry-query 08P01 bind
failure. Derive retention from the actual project value/bps or authoritative contracts
with agreed precision and supply only used parameters. Test Owner/Admin/PM/DOC and
project-scoped roles on fresh/upgrade databases, empty orgs and null contract values.
Mock SQL-substring tests cannot establish schema compatibility.

### G03-031 — P2 / S: dashboard metrics misrepresent actionable work

Source: service:91-98,156-195,212-217. awaitingMyReviewCount counts all in-review
requirements in visible projects instead of reviews actionable by the caller. Expiry
counts every matching version without current/approved/not-deleted filtering; missing
predicates omit other states; null due dates display ASAP. Define each KPI from
canonical current evidence/work predicates, role/assignment and project lifecycle,
with explicit timezone and no invented urgency. Reconcile evidence validity with
readiness without using a status string as proof. Test duplicates, superseded/deleted
versions, unassigned reviews, closed projects and midnight IST boundaries.

### G03-032 — P1 / S: essential G03 product journeys have no web implementation

Source: web/src/app route inventory; contractor/layout.tsx:78,220,255;
FR-ORG-003..014. No settings/member management/invitation accept/ownership/offboarding
pages or functioning org chooser exist in this checkout. Implement permission-aware
profile/branding, invitation status/resend/revoke, accept/join, role/suspend/gap report,
per-project replacements, transfer consent, resumable setup and suspended read-only
states. Derive company/GSTIN from real tenant data; remove hardcoded Deccan/GSTIN
and fake fallback persona identity from production. Verify keyboard/mobile/error,
conflict/loading and destructive-action confirmation paths against real API responses.

### G03-033 — P1 / S: tenant/identity transitions are not coordinated across tabs

Source: web/api-client.ts:28-43; contractor/layout.tsx:78-86;
offline-upload-queue.ts:35-41,214-215; draft-storage.ts:19;
identity.controller.ts:563-610. Shared session cookie can change while stale tab
state/CSRF and global localStorage offline partition remain. Draft keys omit actor
identity. Introduce authoritative session generation and typed active context;
broadcast switch/logout/revocation, cancel in-flight requests, clear/reload query/UI
state and bind drafts/uploads to user+tenant+grant/generation. Keep queue isolation
already present. Test two users/tenants/tabs, blocked replay, offline reconnect,
switch during mutation, late responses and logout failure. Shared dependency G01/G22/G23.

### G03-034 — P1 / R+S: owner digest discovery silently sees no owners under RLS

Source: worker/scheduler.ts:163-169. The global query joins FORCE-RLS memberships
before any tenant context; probe 32 sees zero owners despite active orgs. Discover
permitted tenant IDs through the intended system boundary, then query active owner
inside each tenant transaction or a narrowly reviewed scheduler function. Do not
use superuser/BYPASSRLS. Add reconciliation and zero-recipient alerts. Test actual
scheduler with restricted role, multiple tenants, suspended orgs, ownership changes,
notification recipients, dedup and real provider delivery.

### G03-035 — P1 / R+S: command retries and state transitions are not durable

Source: controller; service:533-668; idempotency.interceptor.ts:33-60,148-180;
identity.controller.ts:switchActiveOrg. No G03 decorator requires an idempotency
key; DELETE/PATCH bypass the POST interceptor. Probe 16 removes an already removed
member again and emits a second event. Enforce valid transitions/preconditions and
idempotent results, require protected POST receipts, and resolve business commit
versus receipt-persistence ambiguity. Define retry semantics for switching (active
org changes the receipt namespace). Test lost responses, repeated DELETE/PATCH,
concurrent retry, process death after commit and recovery of stuck receipts.

### G03-036 — P2 / S+H: list/export scale and query budgets are undefined

Source: service:82-120,394-417,765-914. Entire projects/member/invitation lists are
unbounded; audit limits to 100 with no continuation; gap report can update all tenant
work in one long transaction. Add stable cursor pagination, indexed validated filters,
date/project scoping, snapshot/revision semantics and query/lock time budgets. For
large offboarding, keep suspension immediate and use a resumable audited transfer
job with explicit progress and final invariant checks. Do not treat tenant-path
service argument inconsistency (probe 17) as a proven cross-tenant HTTP bypass:
the central guard currently rejects it. Standardise checks for internal callers.
Validate query plans and latency with realistic tenant sizes and concurrent activity.

### G03-037 — P1 / S: declared organisation lifecycle/retention/export is incomplete

Source: organisations.controller; FR-ORG-009/010; deletion_requests/legal_holds DDL;
worker scheduler. Tables and an org.delete permission do not implement owner-confirmed
deletion. Build request/confirmation/cooling-off, strong reauth, legal-hold/retention
checks, tenant-safe export, purge queue/provider version reconciliation and audit
retention. Keep account cancellation separate from erasure and prove backup handling.
Multi-signatory authority and org defaults also need implementation or explicit launch
scope decisions. FR-ORG-013 branches/multiple GSTINs is V2, not automatically a G03
MVP blocker. CA/legal/provider acceptance is external, never established by fixtures.

### G03-038 — P1 / R+S: existing tests do not certify the G03 controls

Source: auth-iam.spec.ts; discovery-lifecycle-foundations.spec.ts:700;
hvac-production-reaudit-remediation.spec.ts:770; web/e2e/critical-flows.spec.ts.
Several tests assert constants/local objects or mock SQL matching instead of real
ownership/invitation/offboarding mechanisms. They pass while reproduced defects
persist. Add persistent real PG16/tc_app regressions, complete HTTP role matrices,
deterministic transaction races, production-mode browser journeys with isolated
fixtures, actual worker events and provider acceptance. Preserve stable finding IDs
in a G03 register and independent review at the proposed head. No self-approval or
synthetic release evidence. A green typecheck/fixture test is not RELEASE_ACCEPTED.

## Implementation order and integration contract

1. Security/integrity: 001-004,010-012,017-018,028. Lock protocol and explicit status
   semantics first; other writers must adopt them. Add invariant regression tests.
2. Schema/API correctness: 007,013,019,022-026,030,035. Forward-only migrations with
   fresh/upgrade validation; no edits to migrations already applied.
3. Complete workflows: 005-009,014-016,020-021,027,029,031-034,037. UI must reflect
   implemented server behavior; hide unsupported claims instead of fake success.
4. Operational validation: 036,038 and all cross-group acceptance. Feature branch,
   independent review, current CI, user-authorised merge/deployment only.

Canonical Phase 1 dependencies (provided by the owner on 2026-11-12): G26 is
database schema/constraints/migrations/transactions; G01 is authentication/OTP/MFA/
sessions; G02 is RBAC/permissions/resource isolation; G27 is security controls/audit
integrity/observability; G24 is background workers/queues/retries/scheduling.
Earlier G01 dependency references use some different labels. Those historical labels
must not override this owner-provided mapping. External-party, commissioning,
handover, billing, offline, UI and infrastructure interfaces still require acceptance;
confirm their group numbers from the master inventory before assigning ownership.

Expected migration/data repair package: inventory current ownerless orgs, duplicate/
invalid/expired invitations, dormant project grants, illegal assignments and divergent
settings; quarantine/report ambiguous rows, do not auto-invent an owner or legal
authority. Reconcile profile defaults/columns, invitation revoke/consume timestamps,
contact-role constraints, pending uniqueness/lookup indexes, profile policy version,
consent proposals, work assignment/provenance, transition preconditions and quota
records. Preserve audit history and immutable package/review artifacts. Simulate
upgrade failures and rollback of source deployment without reversing applied DDL.

## Release acceptance (all applicable rows mandatory)

1. Fresh and prior-version PG16 upgrade succeeds, restricted role and RLS unchanged.
2. Exactly one eligible active owner after all commits; deterministic races pass.
3. Full org-role/guest/tenant HTTP matrix, malformed inputs, CSRF and preconditions.
4. Intended verified contact joins intended org once; revoke/expire/race/replay deny.
5. Real email/SMS delivery, queued/failure/retry/bounce behavior and secrets handling.
6. Suspend immediately; revocation across real replicas/sessions within <=60 seconds.
7. In-flight/worker/offline actions respect current authority and lifecycle policy.
8. Complete gap report; eligible replacements; zero orphaned active obligations.
9. Immutable creator/requester/party authority, review evidence and package snapshots.
10. Lost-response/process-crash retry tests; stable receipts; no duplicate effects.
11. Profile defaults/clear/update/versioning; settings affect only permitted behavior.
12. Multi-tenant/two-tab browser journeys with real org data and no demo success paths.
13. Restricted-role worker discovery, event routing, notifications and recovery/DLQ.
14. Realistic load/query plans, pagination, lock budgets and resumable offboarding.
15. Legal-hold/export/deletion/retention and provider/backup operational acceptance.
16. Exact candidate SHA: pnpm typecheck, pnpm build, pnpm test, test:security,
    test:rbac and full application test:e2e with real isolated fixtures; remote CI and
    independent security/domain/migration review. Revalidate affected assertions on
    every new head. User retains merge/deploy authority.

Only after these gates pass can the exact reviewed release be called production
ready for its declared G03 scope. Other product groups and real infrastructure still
need their own acceptance. No finite audit proves that all possible bugs are absent.
