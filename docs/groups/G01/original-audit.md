The second pass found important counter-evidence: internal OTP verification uses the challenge’s stored identity and atomically consumes its Redis generation; guest invalid-code attempts are committed; production/staging exclude debug OTP responses; and backend logout revokes token_hash.

I will not report 123456 as a universal backend bypass. It is used by the active quick-switch UI, but the backend still compares it against a random OTP. Guest resend behavior, issuer-derived guest identities, multi-tab state and the absence of a CSRF restoration contract remain defensible findings.
A. Executive assessment
G01 is not ready for unrestricted customer deployment. The implementation has useful foundations, but authentication identity, browser state, abuse resistance and recovery still require corrective work.

This was a read-only, static audit. I did not modify files, execute application code, run tests, build, migrate, send OTPs, or change GitHub settings. Earlier executable reviews are historical evidence, not runtime verification performed in this assignment.
Verified baseline
Repository: omniscient2002/tradecloseout
Item	State verified for this audit
Canonical branch	main
Main commit	2449d52f5a6f9ed266b98f1c9526a8d29320ba6e
PR #2	Open, unmerged; 7d80d16325864f5bc4fc1eb2f872d6ff02013462
PR #3	Open, unmerged; f674033931cf81983c2226ef5b51806cdbb6f935
PR #4	Open, unmerged; ecc4be6a7c796df47500b6ae5108cdcd7adcde12


Main is the primary audit baseline. PR #4’s guest witness and recipient changes are assessed separately as proposed integration behavior. They are not described as deployed.
Findings
Severity	Count
Critical	1
High	6
Medium	13
Low	1
Total	21


These counts include confirmed source defects, missing verification and recommended improvements. They do not represent 21 runtime-confirmed exploits.

The principal release blockers are:
- Contractor-issued guest credentials do not establish independent external-party authority.
- Guest sessions identify the invitation issuer as their user.
- Login/session-establishment endpoints lack a demonstrated login-CSRF defense.
- Browser tabs can retain authentication and tenant context inconsistent with the shared session cookie.
- OTP abuse controls lack the documented IP-level protection.
- Security-critical production configuration is not validated consistently at startup.
- Privileged MFA required by the security specification is not implemented.
Important existing protections
The following should not be reported as absent:
- Internal OTP generation uses cryptographic randomness.
- Internal OTP verification derives identity from the stored challenge.
- Redis Lua performs generation checking, attempt counting and successful consumption atomically.
- Guest verification locks the grant and challenge.
- Guest incorrect-code attempts are committed before the error is raised.
- Session tokens are random, opaque and hashed in PostgreSQL.
- Protected mutations require session-bound CSRF tokens.
- The guard rechecks user, organisation, membership and guest-grant status.
- Backend logout uses token_hash and awaits revocation.
- Explicit production/staging modes exclude debug OTP responses.
- Legacy guest bearer/PIN session exchange is disabled.
———
B. Complete domain inventory
References below use these abbreviations:
- IC: apps/api/src/modules/identity/identity.controller.ts
- IM: apps/api/src/modules/identity/identity.module.ts
- SG: apps/api/src/common/guards/session-csrf.guard.ts
- PS: apps/api/src/modules/parties/parties.service.ts
- PC: apps/api/src/modules/parties/parties.controller.ts
Line references refer to the audited main commit unless explicitly marked PR #4.
Implementation inventory
File	Authentication responsibilities / significant entry points	Dependencies	Change assessment
AGENTS.md	Repository, evidence and security invariants	Entire repository	Follow; no change required by this audit
apps/api/src/app.module.ts	Registers IdentityModule and global interceptors	API modules	Add executable route/public-boundary inventory
apps/api/src/main.ts	Cookie parser, validation, CORS, application bootstrap	Nest, Express	Production config and origin policy changes
apps/api/src/modules/identity/identity.controller.ts	OTP request/verify, session issuance, /me, /orgs, switch-org, logout	Redis, PostgreSQL, gateways	Required
apps/api/src/modules/identity/identity.module.ts	Redis implementation selection; SMS/email adapters; magic-link delivery helper	Redis, HTTP providers	Required
apps/api/src/common/guards/session-csrf.guard.ts	Session lookup, status checks, CSRF, trusted request contexts	PostgreSQL	Required
apps/api/src/common/guards/permission.guard.ts	Consumes authenticated user/grant context	Shared permissions, PostgreSQL	G02 coordination; preserve authentication boundaries
apps/api/src/common/decorators/idempotency.decorator.ts	Marks retry-protected commands	Interceptor	Clarify authentication endpoint policy
apps/api/src/common/interceptors/idempotency.interceptor.ts	Uses actor and active-org context for receipts	PostgreSQL, request context	Coordinate session/actor identity changes
apps/api/src/common/interceptors/visibility-projection.interceptor.ts	Reads several request identity representations	Guards, response payloads	Use one canonical actor context
apps/api/src/common/filters/problem-json.filter.ts	Authentication errors, retry headers, internal error logging	Nest logger	Redaction and stable auth errors
apps/api/src/database/database.module.ts	Shared database and guard providers	TenantDbService	Validate runtime role/config
apps/api/src/database/tenant-db.service.ts	Tenant/user/token-bound transactions and global session queries	PostgreSQL	Required configuration and subject-contract changes
apps/api/src/modules/parties/parties.controller.ts	Public guest lookup, OTP request/verify, disabled legacy exchange, guest context	PartiesService	Required
apps/api/src/modules/parties/parties.service.ts	Grant creation/revocation, guest OTPs and sessions	PostgreSQL, delivery gateways	Required
apps/api/src/modules/parties/supplier-guest.service.ts	Alternate supplier-link creation and token lookup	PostgreSQL, party contacts	Consolidate identity/contact policy
apps/api/src/modules/parties/parties.module.ts	Guest service/gateway wiring	IdentityModule, database	Verify consolidated service wiring
apps/api/src/modules/organisations/organisations.controller.ts	Membership invitations, removal and role changes	Session and permission guards	Invitation/recovery contract changes
apps/api/src/modules/organisations/organisations.service.ts	Invitation issuance; member role updates; offboarding session revocation	PostgreSQL	Required integration changes
apps/api/src/modules/commissioning/commissioning.service.ts	Consumes witness identity; PR #4 adds party-bound guest checks	Guest grants, audit/outbox	G12 interface dependency
apps/api/src/modules/handover/handover.service.ts	Consumes guest identity for recipient decisions	Grants, submissions	G15 interface dependency
apps/web/src/middleware.ts	Cookie-presence navigation check	Next request cookies	Document as UX only; restoration changes
apps/web/next.config.mjs	Same-origin API forwarding	API_URL / NEXT_PUBLIC_API_URL	Validate deployment origin/proxy contract
apps/web/src/lib/api-client.ts	Credentialed fetch, CSRF storage, 401 redirects, auth wrapper	Browser storage, fetch	Required
apps/web/src/app/(public)/login/page.tsx	Internal login/signup, OTP, return navigation, demo personas	apiFetch, router	Required
apps/web/src/app/(contractor)/layout.tsx	Session loading, active actor partition, logout, quick persona switch	apiFetch, browser storage	Required
apps/web/src/components/modals/login-switch-user-modal.tsx	Alternate login and persona switch implementation	Auth wrapper	Remove/isolate demo flow; caller reachability not established
apps/web/src/components/layout/header.tsx	Alternate identity display/logout implementation	fetch, browser storage	Broken logout implementation; current caller not established
apps/web/src/app/(guest)/guest/[token]/page.tsx	Guest token view, OTP, session restoration, actor partition	Guest API, offline queue	Required
apps/web/src/components/views/client-guest-view.tsx	Guest presentation interface	Guest context	Inspect during principal-contract implementation
apps/web/src/components/views/supplier-guest-view.tsx	Supplier presentation interface	Guest context	Inspect during principal-contract implementation
apps/web/src/lib/offline-upload-queue.ts	Authentication partition at asynchronous upload boundaries	IndexedDB, localStorage	G22 coordination required
apps/web/src/components/pwa-register.tsx	Starts/resumes queue processing	Service worker, queue	Gate resumption on restored identity
apps/web/src/app/layout.tsx	Mounts PWA lifecycle globally	PwaLifecycleManager	Coordinate startup restoration
apps/web/public/sw.js	Cache exclusions and background-sync notifications	CacheStorage, browser clients	Preserve API non-caching; test auth transitions
packages/shared/src/env.ts	Declared environment schema	Zod	Required
packages/shared/src/permissions.ts	Internal/guest capability vocabulary	PermissionGuard	G02/G04 coordination
packages/shared/src/validators.ts	Shared validation boundary	Zod	Add/reuse explicit authentication schemas
packages/db/src/schema.ts	ORM representations of users, identities, sessions, grants	Drizzle	Align with authentication migration design
packages/db/src/tenant-tx.ts	Actor propagation to audit/outbox records	PostgreSQL	Required subject/provenance changes
packages/db/migrations/0000_complete_v021_schema_and_rls.sql	Primary authentication tables and constraints	PostgreSQL	New additive migration needed; do not edit applied file
packages/db/migrations/0001_rls_and_constraints.sql	Tenant policies and constraints	Authentication context	Review compatibility when introducing principal model
packages/db/migrations/0003_v021_redteam_patches.sql	Session onboarding/nullability and guest OTP fields	Earlier schema	Historical compatibility
packages/db/migrations/0011_guest_grant_token_lookup.sql	Token-context grant SELECT; revokes legacy guest sessions	Guest authentication	Preserve; extend migration strategy
packages/db/migrations/0016_canonical_tenant_alias_validation.sql	Tenant-context consistency	Transaction wrappers	Preserve
apps/worker/src/main.ts	Worker database identity and system-initiated processing	PostgreSQL, Redis	G27 service identity/config handoff
apps/worker/src/scheduler.ts	Scheduled cleanup interfaces	PostgreSQL	Authentication cleanup jobs absent from inspected implementation
infra/docker/docker-compose.yml	Development runtime/service configuration	API, Redis, database	G28 environment parity review
infra/terraform/main.tf	Deployment configuration interface	Cloud infrastructure	G28 HTTPS/secrets verification


“Inventory” does not mean every line of these interface files received equal scrutiny. Guest authentication, session handling and internal OTP received detailed tracing; unrelated business logic did not.
Tests and documentation inspected
File / set	What the inspection establishes
apps/api/test/guest-session-boundaries.spec.ts	Mocked grant-context, legacy-exchange rejection, public response allowlist and attempt-commit tests
apps/api/test/modules/auth-iam.spec.ts	Several tests assert local objects/hash examples rather than production authentication behavior
apps/api/test/hvac-production-reaudit-remediation.spec.ts	Internal OTP replay, supersession and rate-limit cases; mixed real Redis and mocked database/provider boundaries
apps/api/test/production-reaudit-remediation.spec.ts	In-memory Redis, configuration and generation-safe cleanup cases
apps/api/test/production-review-remediation.spec.ts	Relevant identity/provider/session assertions inspected selectively
apps/api/test/security-invariants.e2e-spec.ts	Existing security-suite file identified; not a complete route-by-route authentication proof
apps/web/e2e/critical-flows.spec.ts	Two application scenarios; demo internal login/portfolio, not complete production authentication coverage
PR #4 apps/api/test/pr4-authorization-evidence-gates.spec.ts	Proposed guest attestation/acceptance checks; not merged
03-PRODUCT-REQUIREMENTS.md:61–76	FR-IAM authentication, session, guest and MFA product requirements
05-ACTORS-AND-PERMISSIONS.md:266–275,304–322	Guest OTP, revocation and authoritative active-org requirements
10-API-AND-INTEGRATIONS.md:22–62,153–173,448–455	Session/CSRF, documented endpoints and rate limits
13-SECURITY-PRIVACY-AND-COMPLIANCE.md:116–124,193–204,293	Session rotation, privileged MFA, hashing and failed-auth audit requirements
Existing local PR #2/#3 and PR #4 review reports	Historical findings, cross-group interfaces and earlier evidence
PR #3 audit/handoff documents	Source-audit classification and release gates


No test results from these files are claimed in this assignment.

———
C. Authentication architecture
Internal authentication
Actual flow:

Browser
POST /api/v1/auth/otp/request
→ normalize identifier
→ Redis identifier request counter
→ create random six-digit code
→ store salted digest + challenge, five-minute TTL
→ supersede previous Redis generation
→ call SMS/email gateway

Browser
POST /api/v1/auth/otp/verify
→ Redis Lua:
resolve challenge/alias
check active generation
count attempts
verify digest
consume challenge
return stored identifier
→ PostgreSQL transaction:
find identity, or create user + organisation + owner membership
select active organisation
insert hashed session + CSRF token
insert session-created security event
→ commit
→ set HttpOnly session cookie
→ return identity, active organisation and CSRF token

Sources: IC 47–188, 197–483.

There is no implemented password login, SSO login or functioning magic-link request/consume flow in the inspected active implementation. A mail helper capable of sending a magic URL is not an authentication protocol.
Protected request authentication
Cookie, otherwise Authorization token
→ SHA-256 token digest
→ session + user + active organisation lookup
→ member membership OR guest grant lookup
→ expiry/status checks
→ CSRF digest comparison for unsafe methods
→ project membership lookup where applicable
→ construct req.auth, req.user, req.userContext
→ PermissionGuard
→ controller/service

Source: SG 32–283.

Roles are read from current membership state rather than embedded permanently in the session. This is a positive control.
Guest authentication
Contractor issues grant
→ random invitation token; only digest stored
→ party/project/capabilities/contact recorded

Public token request
→ token-scoped PostgreSQL grant lookup
→ allowlisted invitation metadata

Guest OTP request
→ lock grant
→ enforce per-grant request limits/cooldown
→ insert five-minute OTP challenge
→ deliver inside database transaction

Guest verification
→ lock grant and challenge
→ check code
→ persist failure count OR consume challenge
→ create session with:
guest_grant_id = grant.id
user_id = grant.created_by
→ commit
→ set same tc_session cookie used by members

Sources: PS 139–250, 340–375, 413–600; PC 160–208.

The code proves control of the configured OTP destination. It does not independently prove the recipient’s legal authority to represent a party.
Sessions, switching and logout
- Internal sessions: fixed expires_at = now() + 30 days.
- Guest sessions: fixed 24-hour expiry.
- No sliding-expiry update was found.
- No explicit refresh endpoint was found.
- Switch-org updates the existing session’s active organisation and CSRF digest.
- Logout revokes the current token and clears its cookie.
- Offboarding revokes sessions currently active in the departing organisation.
- No user-facing device-session inventory or logout-all workflow was found.
Workers
Workers use database/Redis service credentials, not browser sessions. Their system actions need distinct service-principal attribution. They must not manufacture an authenticated human actor merely to satisfy a shared context type.

———
D. Detailed findings
For each finding below, the source reference identifies the affected files and lines; the proposed verification is future work. Confidence is about the static conclusion, not runtime exploitability.
G01-001 — Issuer-selected OTP contact becomes external-party authority
Critical · Confirmed source defect · Confidence: high

Sources: PS 139–240, 470–477; proposed PR #4 commissioning service 458–480 and handover service 437–461.

Workflow/interfaces: Guest invitation → OTP → attestation/acceptance; API, database, actor context.

Current behavior/root cause: The issuer selects a party ID and supplies dto.email or dto.phone. The verified guest then inherits that party’s authority through the grant. PR #4 checks party/project/grant matching, but still trusts issuer-controlled contact assignment.

Failure scenario: An authorized contractor creates a client grant naming the client but directing OTP to a contractor-controlled mailbox. OTP possession then satisfies guest authentication for that client identity.

Impact: False attribution of commercially consequential witness or recipient decisions.

Required remediation:
- Introduce an external principal and independently approved party-contact/delegation record.
- Sensitive grants must reference that record, not arbitrary contact text.
- Contact changes must require appropriate independent confirmation.
- Merely copying parties.email is insufficient if the same contractor can change it.
- Bind authentication evidence to principal, party, contact revision and grant.
- Keep recorded external evidence distinct from directly authenticated external decisions.
Tests/acceptance: Contractor-selected email/phone must not establish independent client authority; repeat after contact edits, grant reissue and contact changes between request and verification. Approved external representatives must still authenticate successfully.

Cross-groups: G04, G12, G15, G26.
G01-002 — Guest sessions use the invitation issuer’s user identity
High · Confirmed source defect · Confidence: high

Sources: PS 588–600; SG 49–61, 243–280; IC 506–520.

Current behavior/root cause: Guest session user_id is grant.created_by. Session lookup joins that user; /auth/me and downstream audit contexts consequently carry the contractor issuer’s ID/name.

Failure scenario: A genuine external guest acts, but records identify the issuing employee. Suspending/deleting the issuer can also affect otherwise valid external sessions.

Impact: Unreliable actor attribution, independence checks and security investigation.

Remediation: Model a guest/external principal separately from the issuer. Preserve issued_by_user_id as provenance. Use a discriminated actor context and carry principal ID, party, grant and authentication event into audits.

Tests/acceptance: Two external contacts invited by one employee remain distinct; /me never represents them as that employee; issuer offboarding follows an explicit grant policy rather than accidental user joins.

Dependencies: G03, G04, G12, G15, G26.
G01-003 — No demonstrated login-CSRF protection on session establishment
High · Confirmed missing control; exploit sequence requires browser verification · Confidence: high for omission

Sources: IC 195–207, 463–470; PC 182–201; main.ts:11–22.

Current behavior: OTP verification creates/replaces the browser cookie without the protected-request CSRF guard, a pre-login nonce or an explicit origin check.

Risk: An attacker may submit their own valid login proof through a victim’s browser, placing the victim into the attacker’s account. Cross-origin readability restrictions do not by themselves prevent a server from processing a request.

Remediation: Add a short-lived pre-authentication transaction bound to the initiating browser; validate exact permitted Origin/Fetch Metadata and accepted content types; consume the login transaction with the OTP. Support legitimate guest-link navigation without accepting arbitrary cross-site session creation.

Tests/acceptance: Cross-site form and scripted login submissions cannot replace a victim’s session; same-origin internal and guest login continue working. Verify through the actual Next proxy and production cookie settings.

Dependencies: G23, G27.
G01-004 — Alternate logout implementation omits CSRF and ignores failure
Medium · Confirmed component defect; active production reachability unconfirmed · Confidence: high

Sources: components/layout/header.tsx:67–79; modal 156–158; SG 168–190.

The header sends a raw POST without CSRF, ignores non-success HTTP responses, then tries to delete an HttpOnly cookie with JavaScript. That cannot reliably revoke the session. The modal also ignores the auth wrapper’s returned logout error.

Counter-evidence: Contractor layout 89–99 uses the safer API path and preserves failure state. A current caller of the alternate header/modal was not established.

Remediation: Consolidate all logout controls on one function. Clear browser state and navigate only after confirmed server revocation, or clearly offer local cleanup without claiming server logout.

Acceptance: Every reachable logout control handles 403, database outage and timeout honestly; old-token reuse is denied after confirmed success.

Dependencies: G23.
G01-005 — Shared cookies and tab-local state can disagree about actor/organisation
High · Confirmed state-management gap · Confidence: high

Sources: api-client.ts:28–43; contractor layout 78–86,102–121; IC 602–610; offline queue 35–41,211–219.

Cookies are shared across tabs, but CSRF retrieval prefers stale sessionStorage. Login or org switching in one tab can change the effective session while another tab retains its previous user, tenant and upload context. No coordinated authentication-change broadcast was found.

Impact: Failed mutations, misleading identity display and requests issued from stale tenant views. A universal cross-tenant authorization bypass is not established.

Remediation: Introduce an authentication/session generation, cross-tab invalidation and a central context store. Cancel pending operations and pause uploads when that generation changes. Require context restoration before resuming work.

Acceptance: Internal↔guest login, user switching, org switching and logout invalidate all tabs; stale-tab mutations are rejected or explicitly reconfirmed.

Dependencies: G03, G22, G23, G26.
G01-006 — Existing-cookie sessions cannot restore a lost CSRF token
Medium · Confirmed contract gap · Confidence: high

Sources: IC 496–520; api-client.ts:28–43.

The raw CSRF token is returned on login/switching and retained in browser storage. /auth/me cannot restore it. A valid cookie with cleared storage can read data but fail every mutation, including logout.

Remediation: Provide a same-origin authenticated bootstrap that safely rotates/issues CSRF material; do not expose it through permissive cross-origin access. Integrate restoration before enabling mutations.

Acceptance: Storage loss with a valid cookie recovers safely; an untrusted origin cannot obtain or reset usable credentials.

Dependencies: G23, G27.
G01-007 — OTP abuse limits omit documented IP/global controls
High · Confirmed source gap · Confidence: high

Sources: IC 63–76; PS 442–462; 10-API-AND-INTEGRATIONS.md:448–455.

Internal delivery limits are per identifier; guest limits are per grant. The documented 20/hour/IP control is absent from the inspected path. Attackers can distribute requests across identifiers or many grants.

Remediation: Distributed layered limits for identifier/contact, IP/network, grant, verification attempts, tenant and total provider spend. Define trusted proxy handling before using forwarded IPs. Bound pending challenges and expose operational alerts.

Acceptance: Multiple instances enforce shared limits; changing identifiers/grants cannot bypass source-level or global budgets. Redis failure cannot silently disable protection.

Dependencies: G04, G27, G28.
G01-008 — Low-entropy OTP hashes lack a server-side secret
Medium · Confirmed source weakness · Confidence: high

Sources: IC 79–83,289–291; PS 465–466,557–559.

Internal OTP uses salted SHA-1; guest OTP uses unsalted SHA-256. Both can be exhaustively searched over a small numeric space after disclosure of the relevant store. This is about OTP entropy and missing secret protection—not SHA-1 collision exploitation.

Remediation: Use a keyed MAC with a separately managed secret, challenge ID, purpose and canonical destination. Include key versioning and constant-time comparison where applicable. Preserve atomic consume/attempt semantics.

Acceptance: Store disclosure alone does not allow validating guesses without the external secret; wrong-purpose and wrong-challenge substitutions fail; key rotation handles outstanding challenges predictably.

Dependencies: G26, G27.
G01-009 — Internal OTP is consumed before session creation commits
Medium · Confirmed reliability defect · Confidence: high

Sources: IC 294–302, 350–461.

Redis consumes the OTP before PostgreSQL connection, onboarding and session insertion. A database outage, unique-identity race or transaction failure destroys the proof without establishing a session.

Remediation: Use one transactional authentication store or an explicitly designed claimed/consumed state machine with a durable, single-use login outcome. Do not restore a raw reusable OTP after an ambiguous session commit.

Acceptance: Inject failure at each boundary. Exactly one recoverable authentication outcome exists; retry cannot issue uncontrolled duplicate sessions or permanently strand a valid proof.

Dependencies: G26, G27.
G01-010 — Guest resend leaves older challenges valid
Medium · Confirmed source behavior inconsistent with a superseding-resend policy · Confidence: high

Sources: PS 465–477,545–547,578–581.

Issuing another guest OTP inserts a new row without superseding earlier challenges. Successful verification consumes only the chosen challenge. Other unexpired codes can still be used.

Remediation: Define one active generation per grant/purpose and invalidate older proofs atomically. Bind verification to the generation and destination revision. Retain historical rows for audit without leaving them usable.

Acceptance: After resend, all previous codes fail; concurrent request/verify has one documented winner; successful verification cannot leave another current login proof active.

Dependencies: G04, G26.
G01-011 — Guest delivery occurs while holding a database transaction and grant lock
Medium · Confirmed reliability/abuse concern · Confidence: high

Sources: PS 415–501; gateway timeout logic in IM 194–209,246–260.

A slow provider holds a PostgreSQL connection and grant lock. Provider acceptance followed by timeout/rollback can deliver a code whose challenge never committed. Failed deliveries also do not leave committed request rows for the per-grant counting logic.

Remediation: Persist a delivery attempt/challenge state and budget reservation before external delivery; perform delivery outside the grant transaction; record accepted/failed/ambiguous results idempotently. Define whether ambiguous delivery may activate a challenge.

Acceptance: Slow providers do not exhaust the database pool; failed delivery does not reset abuse budgets; duplicate delivery and response loss do not create inconsistent usable challenges.

Dependencies: G20, G24, G26.
G01-012 — Production authentication configuration is incompletely validated
High · Confirmed source gap · Confidence: high

Sources: main.ts:1–27; shared/src/env.ts:1–51; IM 185–282,343–356; TenantDbService 20–39.

The shared validator is not invoked at bootstrap. Names differ: for example, DLT_SMS_PROVIDER_URL versus runtime DLT_SMS_URL; SMTP_FROM_EMAIL versus MAIL_FROM_ADDRESS. Only explicit production/staging modes select strict behavior. Database defaults and nonproduction in-memory Redis remain possible outside those exact modes.

Remediation: One validated runtime configuration per process. Reject missing/unknown environment mode, invalid runtime DB identity, missing required gateway/Redis configuration and unsafe provider transport. Permit debug/local stores only under an explicit development/test profile.

Acceptance: Production cannot boot with debug delivery, fallback database credentials or schema-only variable names that runtime ignores. Startup errors reveal no secrets.

Dependencies: G27, G28.
G01-013 — Login issues sessions before checking suspended user/organisation status
Medium · Confirmed inconsistency · Confidence: high

Sources: IC 364–389,426–476; SG 155–165.

Verification looks up the user’s name and active membership but does not check user/organisation status before returning a new session. The guard rejects that session on subsequent protected requests.

Impact: Misleading login success, unnecessary session creation and confusing recovery. This is not a demonstrated suspension bypass.

Remediation: Verify account, organisation and membership eligibility inside the session-issuance transaction. Return a stable non-enumerating account-unavailable response and audit it.

Acceptance: Suspended/deleted identities receive no usable session or successful login presentation; concurrent suspension has a defined outcome.

Dependencies: G03, G26.
G01-014 — Session rotation, timeout and compromise recovery are incomplete
Medium · Confirmed requirements gap / recommended improvement · Confidence: high

Sources: IC 426–469,602–610,623–643; session schema 115–129; organisation role update 492–527.

The implementation uses fixed 30-day expiry rather than the documented idle timeout. Role and org changes do not rotate the session token. There is no demonstrated logout-all, device-session inventory or lost-destination recovery workflow.

Remediation: Define absolute/idle lifetime, recent-authentication requirements and revocation semantics. Add activity/authentication timestamps and credential generation; rotate credentials for sensitive transitions. Implement audited recovery and device/session revocation.

Acceptance: Idle and absolute expiry differ deliberately; revoked sessions cannot revive after reactivation; recovery does not depend solely on possession of the lost destination or on an unaudited support override.

Dependencies: G03, G23, G26, G27.
G01-015 — Authentication security events are incomplete
Medium · Confirmed source gap · Confidence: high

Sources: IC 448–459; PS authentication methods; SG; exception filter 65–77; security requirements 193–204.

Internal session creation is logged, but failed OTP attempts, rate limits, guest authentication outcomes, session rejection and logout do not have a consistent durable security-event path.

Remediation: Define structured event types with principal/grant/session references, outcome, reason, trusted request metadata and a pseudonymous destination key. Exclude OTPs, raw tokens, cookies, authorization headers and invitation URLs. Bound logging under abuse.

Acceptance: Success, failure, cooldown, revocation and recovery can be reconstructed without exposing secrets; event-store failure follows a documented availability policy.

Dependencies: G27, G26.
G01-016 — Runtime authentication DTOs and canonicalization are incomplete
Medium · Confirmed source gap · Confidence: high

Sources: IC 47–54,197–211,362–393; PC 183–190; PS 139–240.

Inline TypeScript types do not validate runtime request types. Several fields call string methods without type checks. Internal and guest contact normalization differ; grant expiry lacks a clearly bounded policy. Challenge input accepts legacy identity aliases and arbitrary challenge strings.

Remediation: Explicit runtime DTO/schema validation, bounded lengths, canonical email/phone rules, strict six-digit code and UUID challenge inputs, validated signup fields, bounded grant expiry and clear legacy deprecation. Do not normalize email provider-specific dots/plus aliases indiscriminately.

Acceptance: Malformed objects/arrays/numbers yield stable 400/422 responses, not internal errors; canonical identity uniqueness is consistent across request, invitation and login.

Dependencies: G04, G23, G26.
G01-017 — Login return destination is unvalidated
Medium · Suspected defect requiring browser verification · Confidence: high for unchecked input

Sources: Login page 45–46,102–104.

The next query value reaches router.push without an application allowlist. External, protocol-relative or script-like values need verification against the actual framework/runtime.

Remediation: Accept only normalized same-origin application paths; reject schemes, protocol-relative paths, control characters and recursive login destinations. Prefer a server-issued navigation intent.

Acceptance: Malicious destination variants cannot cause external navigation or script execution; legitimate deep links work. No XSS execution is claimed from static inspection alone.

Dependencies: G23, G27.
G01-018 — Some authentication tests do not test the implementation they claim to cover
Medium · Confirmed test-quality gap / missing verification · Confidence: high

Sources: test/modules/auth-iam.spec.ts; guest-session-boundaries.spec.ts; web/e2e/critical-flows.spec.ts.

Examples include asserting a local object has an MFA secret or two constant organisation IDs differ. These cannot establish MFA enforcement or session rotation. Browser coverage depends on a demo identity and preview-code behavior.

Remediation: Replace specification-shaped examples with production-service, database and HTTP contract tests. Retain useful existing replay tests, but add real multi-instance Redis/database and production-mode browser coverage.

Acceptance: Removing a real authentication control causes the corresponding test to fail; tests cannot pass by exercising only a standalone example.

Dependencies: G28.
G01-019 — Privileged MFA/step-up policy is not implemented
High · Confirmed security-specification gap · Confidence: high

Sources: Security specification 121,293; schema 77–78,122; IC session issuance and SG.

MFA fields exist, but no active enrollment, verification or enforcement path was found. The product requirements describe MFA as later/optional, while the security specification requires it for privileged production access.

Remediation: Resolve the specification conflict explicitly. Implement the approved privileged MFA policy and recent-authentication/step-up checks for sensitive actions. Encrypt factor secrets appropriately and design recovery before enforcement.

Acceptance: An owner/admin cannot bypass an enabled MFA policy through ordinary OTP, a remembered session or alternate login path. Enrollment, factor loss, reset and recovery are audited.

This is an assessment against repository requirements, not a legal conclusion about statutory MFA obligations.

Dependencies: G02, G12, G27.
G01-020 — Documented onboarding, invitation acceptance and fallback authentication are incomplete
Medium · Confirmed feature/contract gap · Confidence: high

Sources: IC 390–420; organisation service 424–463; API specification 153–173; IM magic-link helper.

Unknown identities create a new organisation during verification. Invitation creation exists, but an authenticated invitation-consumption flow was not found. Documented magic-link request/consume and automatic SMS-to-verified-email fallback are not implemented by merely telling the user to try email.

Remediation: Separate login from explicit registration. Implement invitation acceptance bound to the authenticated verified identity, invitation status, expiry and intended organisation; consume it atomically. Either implement magic links securely or remove unsupported promises. Never redirect recovery to an unverified contact.

Acceptance: An invited employee joins the intended organisation once; forwarded invitations cannot be claimed by another identity; returning login does not silently create a company; failed SMS recovery follows an actually verified alternative.

Dependencies: G03, G04, G20, G23.
G01-021 — Authentication privacy and caching controls lack deployment evidence
Low · Missing verification / hardening recommendation · Confidence: medium

Sources: IC session responses; PC guest routes; main.ts; Next rewrites; service worker.

No comprehensive authentication-specific Cache-Control, referrer-policy and proxy/access-log redaction contract was established. Guest tokens occur in URL paths. The service worker correctly avoids /api/ caching, but that does not establish proxy/browser/analytics privacy.

Remediation: Apply no-store to sensitive auth/session responses; define guest-page referrer policy and log redaction; avoid third-party resources receiving invitation URLs; cap token inputs and set deployment HTTPS/HSTS policy.

Acceptance: Browser, reverse proxy, analytics and error tracking do not retain raw tokens/OTPs or cache identity responses across users.

Dependencies: G23, G27, G28.

———
E. Required code changes
ID	Priority	File / function	Problem	Exact required change	Verification
001	P0	PS createGuestGrant; sensitive guest consumers	Issuer-controlled party authority	Approved external principal/contact/delegation reference	Self-issued contact cannot sign as client
002	P0	PS verifyGuestOtp; SG actor construction	Issuer reused as guest user	Separate principal and issuer; update audit types	Distinct guest attribution
003	P0	IC/PC verification; bootstrap	Session establishment not browser-bound	Pre-auth transaction, origin/content-type policy	Cross-site login denied
004	P1	Header/modal logout	Unconfirmed revocation	One shared logout implementation; remove dormant unsafe path	Every control honors server failure
005	P0	API client/layout/guest startup	Stale tab/tenant state	Session generation, broadcast, cancellation and rebootstrap	Two-tab transition tests
006	P1	IC bootstrap API; API client	Lost CSRF material	Same-origin CSRF restoration/rotation contract	Cookie-only browser recovery
007	P0	OTP request/verify services	Incomplete abuse limits	Distributed identifier/IP/grant/global limits	Multi-instance budget enforcement
008	P1	OTP digest/verification	Offline-searchable codes	Versioned keyed MAC outside challenge store	Store-disclosure resistance
009	P1	IC verifyOtp	Redis/DB outcome split	Transactional proof claim and durable result	Failure injection
010	P1	PS request/verify OTP	Multiple valid generations	Atomic generation supersession	Old-code rejection
011	P1	PS request OTP, gateway adapters	Network delivery under lock	Durable attempt state; delivery outside transaction	Slow/ambiguous provider tests
012	P0	IM, main, shared env, DB provider	Unsafe/mismatched runtime configuration	Validate one configuration before listen	Production boot rejection matrix
013	P1	IC verifyOtp	Session issued to ineligible account	Status checks within issuance transaction	Suspension race
014	P1	Session service, org switching/role changes	Incomplete lifecycle/recovery	Rotation, idle/absolute expiry, logout-all and recovery	Stolen/revoked session tests
015	P1	Authentication operations/filter	Missing security history	Structured, redacted auth event service	Reconstruct outcomes safely
016	P1	Auth/guest DTOs	Runtime validation mismatch	Shared explicit validated contracts	Malformed-input matrix
017	P1	Login navigation	Unchecked next URL	Same-origin path allowlist	Browser malicious destinations
018	P1	Authentication test suites	Tests do not prove controls	Implementation-bound negative tests	Deliberate control removal fails tests
019	P0	Identity/session/MFA module	Privileged assurance absent	Enforced enrollment and step-up policy	Alternate-path bypass rejection
020	P1	Identity/org invitation APIs	Incomplete onboarding/recovery	Explicit registration and identity-bound invite consumption	Intended-organisation join
021	P2	Auth responses/proxy/web headers	Privacy configuration unverified	No-store, referrer/log policies	Browser/proxy inspection


———
F. Database changes
Additive migrations are necessary. Do not edit applied migrations.
1. External principals
   - Separate external principal identity from internal user and invitation issuer.
   - Bind approved contacts/delegations to party and organisation.
   - Record approval/verification state, revision, revocation and provenance.
2. Session subject
   - Explicit subject type and subject reference.
   - Preserve issuer separately.
   - Add authenticated_at, activity/idle-expiry information, absolute expiry, authentication strength and credential generation as required by the chosen policy.
   - Add integrity constraints preventing contradictory member/guest subject combinations.
3. Guest challenge generation
   - Add a generation/contact-revision relationship and superseded state.
   - Include keyed-digest version.
   - Index grant/purpose/generation and expiry lookups.
   - Constrain state transitions and single-use consumption.
4. Authentication outcome durability
   - Persist a single-use login transaction/result if Redis remains separate from session storage.
   - Define crash recovery rather than recreating consumed OTPs.
5. Grant/session constraints
   - Add appropriate grant relationships; current session/challenge grant columns are not sufficient provenance constraints.
   - Use composite tenant relationships where necessary.
   - Validate active contact/delegation at use time, not only insertion.
6. Cleanup
   - Expire/revoke sessions and challenges with indexed bounded batches.
   - Separate short-lived authentication data from retained security history.
   - Exclude raw secrets from audit tables.
7. Migration/backfill
   - Do not infer historical external identity from sessions.user_id: it currently names the issuer.
   - Revoke and require reauthentication for sessions whose principal cannot be established.
   - Existing guest grants may require contact/delegation reapproval.
   - Support a staged deployment where old and new applications cannot misinterpret subject types.
8. Onboarding
   - Preserve canonical identity uniqueness.
   - Serialize concurrent registration/invitation consumption and convert conflicts to recoverable outcomes.
The ORM schema, SQL migrations and shared actor types must change together.

———
G. API and frontend changes
API contracts
Introduce or formalize:
- A browser-bound pre-authentication transaction.
- Strict challenge-ID verification with a published legacy migration policy.
- A session-bootstrap response containing:
  - Subject type and ID.
  - Active organisation.
  - Guest grant/party where applicable.
  - Session generation.
  - Authentication strength and relevant expiry.
  - Safe CSRF restoration material.
- A rotating switch-org response; current implementation returns JSON/200 while documentation describes 204.
- Device-session list/revoke and logout-all operations.
- Identity-bound invitation acceptance.
- Explicit registration versus returning login.
- Audited factor/contact recovery.
- Stable errors: invalid proof, unavailable account, expired session, missing/invalid CSRF, throttled and temporarily unavailable dependencies.
Do not return raw browser session credentials in production JSON.
Frontend consequences
- Remove production persona shortcuts from the active contractor layout and login screen.
- The 123456 fallback is not a proven backend bypass; remove it because it is an inappropriate automatic guess and broken production switch workflow.
- Replace quick-switch with a genuine login/verification interaction.
- Restore session context before enabling mutations or draining uploads.
- Treat middleware’s cookie-presence check as navigation convenience only.
- Synchronize login/logout/org changes across tabs.
- Display unverified/loading identity rather than a hardcoded PM persona.
- Validate next.
- Preserve clear errors for delivery failure, cooldown and account suspension.
- Do not silently reload after failed logout.
- Keep pending uploads paused when identity changes; G22 owns their detailed fencing.
———
H. Security verification plan
All tests below are proposed, not executed.

Environment codes:
- U: Unit tests; deterministic doubles are sufficient.
- D: Disposable PostgreSQL with restricted runtime role.
- R: Actual Redis; at least two API instances for distributed cases.
- H: Real HTTP application with actual guards, cookies and CSRF.
- B: Browser against the real web/API.
- P: Provider contract fixture plus separate provider sandbox acceptance.
Each row specifies setup/input, action and expected security property.
Test	Setup and action	Expected result / property	Environment
OTP randomness	Generate many challenges through production generator	Correct format, no fixed/debug code; cryptographic source used	U
Hash binding	Same code across different challenges/purposes/contacts	Digests differ; substitutions rejected	U
Internal replay	Submit one valid challenge twice	One authentication result only	R+D+H
Concurrent verification	Submit valid proof simultaneously to two instances	One consume/outcome; no duplicate onboarding	R+D+H
Identifier substitution	Challenge A with identifier B	A cannot authenticate B	R+D+H
Resend	Issue A, issue B, verify A	A rejected, B valid	R/D+H
Expiry	Verify immediately before/after expiry, including lock waits	Documented boundary; no expired proof accepted	R+D
Bad-code attempts	Five failures across instances, then valid code	Attempt budget enforced; failures persist	R/D+H
Guest cooldown	Reach failed-attempt threshold	Cooldown persists and is not bypassed by resend	D+H
Request budgets	Change identifiers/grants while retaining source IP	IP/global budget still enforced	R+H
Enumeration	Compare existing, absent and suspended identifiers	No unnecessary pre-proof existence disclosure	H
Malformed input	Arrays, numbers, huge strings, invalid UUID/code	Stable validation errors; no internal exception	U+H
Delivery rejection	Provider rejects or returns malformed success	No false delivery assertion; budgets retained	P+D/R
Delivery timeout	Provider accepts then response is lost	Ambiguous state handled; safe retry	P+D/R
DB failure after OTP	Fail before/during/after session commit	Recoverable single outcome, no unsafe proof restoration	D+R+H
New-user race	Two valid registration operations for same identity	One user/identity; recoverable conflict	D+R
Session token	Inspect issued and stored representations	High-entropy random token; digest only in DB	D+H
Missing/forged token	Empty, random, malformed and oversized credentials	Denied; bounded work	H
Cookie policy	Production-mode member/guest login	Secure, HttpOnly, deliberate SameSite/path/lifetime	B+H
Session fixation	Supply an existing token during login	Fresh credential issued; prior identity not adopted	H
Logout reuse	Logout, replay original token	Denied after successful revocation	D+H
Logout failure	DB outage or invalid CSRF	UI does not claim confirmed logout	B+H
Logout-all	Several device sessions, revoke all	All selected credentials fail	D+H
Suspension	Suspend user/member/org during active session	New requests denied; no later revival of revoked sessions	D+H
Guest revocation	Revoke grant during session use	Next request denied; sensitive action obeys defined commit boundary	D+H
Wrong grant/project	Session A requests resource in B	Denied before sensitive work	D+H
Guest actor	Two contacts invited by one employee	Distinct principal/audit attribution	D+H
Self-issued authority	Contractor supplies own destination for client party	Cannot acquire independent signatory authority	D+H+P
Contact change	Change contact between request, verify and sign	Old proof/delegation cannot silently transfer	D+H
Login CSRF	Cross-site form and fetch using attacker proof	Victim cookie cannot be replaced	B+H
Mutation CSRF	Missing/wrong/other-session token	No state change	H
Origin/CORS	Allowed, hostile and null origins through proxy	Explicit documented behavior; no credential leakage	B+H
CSRF restoration	Clear browser storage, retain valid cookie	Safe recovery, or explicit reauthentication	B+H
Two-tab login	Change user/guest session in tab A, act in B	B invalidates old context and pending actions	B
Two-tab org switch	A changes org while B edits old-org form	Stale operation cannot silently target new org	B+D+H
Browser expiry	Expire cookie/session during editing	Clear reauthentication state; drafts safely partitioned	B
Malicious next	Schemes, //host, encoded and control-character paths	No external/script navigation	B
Production personas	Build/start using production configuration	No persona auto-login/debug proof; normal OTP entry works	B
MFA policy	Owner/admin uses each login/session path	Required MFA cannot be bypassed	D+H+B
Recovery	Lost factor/destination and compromised session	Audited, abuse-resistant recovery and revocation	D+H+B
Invitation acceptance	Correct identity, wrong identity, expired/revoked/replayed invite	Only intended identity joins once	D+H+B
Auth events	Exercise failures/success/revocation	Useful history without secrets	D+H
Response privacy	Inspect browser/proxy logs/cache	No tokens in telemetry or shared cache	B+deployment
Redis outage	Fail/disconnect shared store	No local fallback or rate-limit bypass in production	R+H
DB outage	Fail session lookup/issuance	No success-shaped fallback; stable retryable failure	D+H
Restart	Restart instances during proof/session processing	Shared state and durable outcomes remain correct	R+D+H
Key rotation	Rotate OTP/MFA secrets with active challenges	Defined compatibility; no accidental blanket acceptance	U+R+D
Cleanup	Expire large numbers of sessions/challenges	Bounded cleanup; active proofs unaffected	D
Route inventory	Enumerate registered routes and public exceptions	Every protected entry point has the expected authentication control	H


Provider mocks are sufficient to test state transitions. They are not sufficient to establish that real SMS/email configuration delivers correctly.

———
I. Concurrency and resilience plan
Race/failure	Required invariant and implementation
Two internal verifies	Atomic proof claim plus one durable session outcome
Internal resend versus verify	Generation ordering defines one winner; stale generation cannot revive
Guest resend versus verify	Lock grant/generation consistently; supersede old challenges
Guest grant revocation	Serialize sensitive authentication/attestation with revocation or validate a revocation generation at commit
User suspension versus issuance	Status eligibility checked in issuance transaction; session cannot be returned as active after a winning suspension
Membership removal versus switch-org	Lock/version membership and session; recheck active target membership at update
Two concurrent org switches	Require expected session generation; one stale transition fails
DB commit followed by response loss	Retry resolves durable outcome; do not blindly create a second login
Provider timeout after acceptance	Preserve ambiguous delivery status and dedupe attempts
Redis outage	Fail closed; avoid unbounded client queuing; return a bounded retryable response
Multi-tab credential change	Broadcast generation change; discard old CSRF/context and abort work
Cleanup versus verification	Atomic status/expiry predicate; use appropriate wall-clock checks after lock waits
Role change versus sensitive action	Re-evaluate current authority and authentication strength at the protected transition
API restart	No in-memory production challenge or limit authority
Pool exhaustion	Provider calls occur outside long-held auth transactions; bound concurrency/timeouts


Revocation cannot retroactively undo a transaction that has already committed. The product must define and test its authentication and sensitive-action linearization boundaries.

———
J. Cross-group dependency register
Group	Required contract	Current risk	Required integration test
G02 Authorization	Consume one trusted, typed principal context	Several request identity representations; authentication strength absent	Forged body/header roles cannot change effective actor
G03 Organisations	Session org must correspond to current active membership	Switching/offboarding races; missing invitation consumption	Remove member while switching/login completes
G04 External parties	Approved contact/delegation establishes party relationship	Grant issuer controls OTP destination	Self-issued client contact cannot gain authority
G12 Attestations	Bind external principal and recent proof to exact evidence revision	Guest OTP treated as sufficient party authority	Correct party, wrong contact/revision denied
G15 Recipient acceptance	Recipient principal/delegation matches submission and package	Party ID alone does not establish representation	Contractor-minted client guest cannot accept
G20 Delivery	Persist honest delivery outcomes without losing challenge/budget integrity	Network call inside guest transaction	Accepted-but-timeout provider response
G22 Offline/mobile	Each asynchronous action bound to auth generation and actor	Stale partition after cookie change	Account switch during multipart upload
G23 Frontend	Session bootstrap and cross-tab state are authoritative	Demo shortcuts, stale CSRF and duplicate logout code	Browser transition matrix
G26 Database	Atomic proofs, subject constraints and durable outcomes	Redis/SQL split; issuer-as-subject model	Crash, uniqueness and rollback tests
G27 Security/observability	Validated config, trusted proxy/origin, redacted events	Missing boot validation and complete auth history	Production boot and telemetry checks
G28 Deployment/testing	HTTPS/proxy/secrets and real environment evidence	Source cannot establish deployed controls	Staging auth/recovery/restore acceptance


These are interface handoffs, not exhaustive audits of those groups.

———
K. Prioritized implementation roadmap
P0 — Establish trustworthy identity and browser sessions
1. Resolve external principal/contact/delegation ownership: 001–002.
2. Validate production configuration before accepting requests: 012.
3. Establish browser-bound login and origin policy: 003.
4. Add distributed abuse limits: 007.
5. Implement authentication generation and cross-tab invalidation: 005.
6. Resolve and enforce privileged MFA policy: 019.
These precede a production rollout because later permissions and attestations depend on their truth.
P1 — Make authentication reliable and recoverable
1. Strict shared request/response contracts: 016.
2. Durable proof/session outcome and guest generation semantics: 009–011.
3. OTP keyed protection: 008.
4. CSRF restoration and consolidated logout: 004,006.
5. Eligibility, expiry, rotation and recovery: 013–014.
6. Structured authentication audit: 015.
7. Safe login navigation and explicit onboarding/invitation flow: 017,020.
8. Implementation-bound regression suite: 018, developed with each change.
P2 — Deployment/privacy hardening
Complete 021, provider sandbox acceptance, cleanup capacity testing, operational runbooks and long-term authentication maintenance.

———
L. Exact implementation handoff
Each task includes its required implementation and completion evidence; none is authorized for execution by this assignment.
Task	Files and current defect	Implementation and constraints	Tests / acceptance / dependencies
AUTH-01	PS, SG, schema, actor/audit types; issuer is guest subject	Implement external principal/delegation model; preserve issuer provenance; additive migration; reauthenticate ambiguous legacy sessions	Close 001–002; coordinate G04/G12/G15/G26
AUTH-02	IC, PC, main; login has no initiating-browser binding	Pre-auth nonce/transaction, strict origins/content types, challenge binding; preserve legitimate invitation navigation	Close 003; cross-site browser matrix, G23/G27
AUTH-03	IC/PS rate limits; only identifier/grant limits	Shared distributed limiter with IP/contact/grant/global budgets, bounded retries, trusted proxy policy	Close 007; two-instance and outage tests
AUTH-04	IC Redis Lua and PS challenge SQL; differing proof lifecycles	Versioned keyed challenge digests, generation supersession and durable claim/outcome protocol; no reusable OTP restoration	Close 008–011; real Redis/PG crash and race tests
AUTH-05	IM, env, database provider, main	One parsed configuration; explicit environment; reject insecure production defaults; provider-specific validation	Close 012; production startup rejection matrix
AUTH-06	IC, SG, session schema, org member transitions	Eligibility-before-issuance, idle/absolute policy, rotation, revoke-all, recent-auth strength, audited recovery	Close 013–014; G03/G26/G27
AUTH-07	New/extended MFA services and session policy	Reconcile specifications; enforce privileged MFA/step-up and recovery without leaking factor secrets	Close 019; no alternate-path bypass
AUTH-08	api-client, contractor/guest layouts, logout components	One auth state manager; CSRF bootstrap; cross-tab generation; abort stale requests; pause offline work	Close 004–006; G22/G23 browser tests
AUTH-09	Login page, modal, auth DTOs/shared schemas	Remove production persona guessing, validate return paths and all runtime fields; explicit login/signup contracts	Close 016–017; production browser and malformed-input tests
AUTH-10	Identity/org invitation controllers/services	Verified identity-bound single-use invitation consumption; explicit account creation; implemented or withdrawn magic-link promises	Close 020; forwarded/replayed invite and recovery tests
AUTH-11	Authentication services, guard, error filter, telemetry	Redacted security-event vocabulary; bounded audit writes and documented failure policy	Close 015/021; no credential leakage
AUTH-12	Existing API/unit/browser suites	Replace illustrative assertions; add matrix in H; route inventory and real restricted-role fixtures	Close 018; negative control-removal checks; G28


Agent completion rule: Link each finding to implementation, migration, focused negative test, intended positive flow, concurrency evidence and exact tested SHA. Do not mark a finding resolved merely because related code exists.

———
M. Audit coverage and limitations
What was done
- Verified current GitHub main SHA and PR merge states.
- Read applicable AGENTS.md.
- Traced active internal OTP issuance/verification through Redis and PostgreSQL.
- Traced guest token lookup, OTP request/verification, cookie issuance and grant revocation.
- Inspected session/CSRF verification and downstream actor construction.
- Inspected browser login, guest authentication, logout and account-switch implementations.
- Examined authentication tables, relevant migrations, declared configuration and operational interfaces.
- Reviewed relevant existing audit material and selected authentication tests.
- Performed a second source pass for contradictory protections and unreachable/dead-code assumptions.
Counter-evidence incorporated
- No duplicate active AuthController was found in the current module wiring.
- Internal verification does not trust a conflicting supplied identifier after successful challenge verification.
- Incorrect guest-code attempt rollback is not re-reported: the service returns a failure value, commits it, then throws.
- Production 123456 backend acceptance is not asserted.
- JavaScript cannot clear the HttpOnly cookie, but that does not make the functioning backend logout defective.
- Cookie presence in Next middleware is not treated as proof of API authentication.
- The guard’s initial R-OWNER variable is overwritten in both successful member and guest branches; it is not evidence of an owner escalation.
- Missing magic-link routes are a contract/feature gap, not a password-reset exploit.
- Missing MFA is assessed against repository policy; no statutory claim is made.
What was not established
- Runtime exploitability of login CSRF or malicious return destinations.
- Production reachability of the alternate header/modal implementations.
- Exact deployed CORS, TLS, proxy, logging and secret-management behavior.
- Complete live registered-route behavior.
- Real SMS/email delivery, distributed Redis behavior or PostgreSQL race outcomes.
- Current production data quality or historical external-principal authenticity.
- Every assertion in every historical test/report.
- Operational production readiness.
Some large read outputs were truncated; conclusions rely on targeted follow-up reads of the cited sensitive sections, not an assertion that every repository file was fully inspected.

No files were created or edited for this assignment. Existing untracked review files were preserved. No tests or application processes were executed.

———
N. Final G01 release-gate checklist
All implementation and operational gates remain unchecked because this assignment is analysis-only.
- [ ] External guests have distinct, independently attributable principals.
- [ ] Sensitive party authority cannot be minted solely by choosing an OTP destination.
- [ ] Internal and guest login are protected against login CSRF.
- [ ] OTPs use cryptographic randomness and secret-protected challenge digests.
- [ ] Challenge purpose, destination, generation and expiry are enforced.
- [ ] Resends invalidate earlier usable guest proofs.
- [ ] Concurrent verification produces one durable authentication outcome.
- [ ] Failed attempts and cooldowns persist across instances and failures.
- [ ] IP/contact/grant/global abuse limits and provider budgets are enforced.
- [ ] Delivery failure and ambiguity do not erase budgets or create false success.
- [ ] Session creation verifies account, organisation and membership eligibility.
- [ ] Secure cookie behavior is demonstrated through the real proxy.
- [ ] CSRF material can be restored safely.
- [ ] All reachable logout controls confirm server-side revocation.
- [ ] Logout-all and compromised-session recovery work.
- [ ] Idle/absolute expiry and rotation follow an explicit policy.
- [ ] Role, membership and organisation changes invalidate stale authority.
- [ ] Guest revocation and sensitive-action races have tested commit boundaries.
- [ ] Browser tabs cannot retain actionable stale actor/tenant context.
- [ ] Offline work pauses and rebinds safely after identity changes.
- [ ] Production persona/debug authentication behavior is removed or isolated.
- [ ] Return destinations and runtime authentication inputs are validated.
- [ ] Privileged MFA/step-up and factor recovery meet the approved policy.
- [ ] Invitations are consumed once by the intended verified identity.
- [ ] Unsupported authentication/recovery promises are implemented or withdrawn.
- [ ] Production configuration fails safely before serving traffic.
- [ ] Authentication security events are complete, useful and redacted.
- [ ] Authentication tables, constraints, migrations and legacy-session handling are verified.
- [ ] Unit, database, HTTP, browser, multi-instance and resilience tests pass on the release SHA.
- [ ] Real delivery-provider and staging operational evidence is reviewed independently.
G01 disposition: remediation and verification required. The architecture contains worthwhile controls, but the current source does not justify unrestricted production authentication sign-off.
