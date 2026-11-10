# G01 Identity & Authentication — implementation, evidence, outstanding gates

**Review status:** DRAFT / NO-GO for unrestricted production.
**Work branch:** `fix/g01-identity-authentication-hardening-20261108`, [PR #5](https://github.com/omniscient2002/tradecloseout/pull/5), stacked on [unmerged PR #4](https://github.com/omniscient2002/tradecloseout/pull/4).
**Source:** User-provided **21-finding** `TRADECLOSEOUT_G01_IDENTITY_AUTHENTICATION_AUDIT_2026-11-08.md`. This document tracks what was actually implemented; absence of runtime evidence is **not** a pass. The original audit was analysis-only and no issues were already certified.

## Finding-by-finding change and acceptance register

| Finding | Implemented work / implementation direction | Required before marking complete | Current state |
|---|---|---|---|
| G01-001 Critical — issuer-created contact becomes party authority | Guest session principal separated; `independent_authority_verified_at` and evidence reference added; sensitive `inspection.witness` and `package.accept` are **denied** unless independently approved; old grants not auto-trusted | Real independent signatory/delegation verification, provenance and non-issuer approval workflow; client/consultant legal/operational sign-off and abuse testing | **BLOCKED: fail-closed only; no independent approval workflow** |
| G01-002 High — issuer impersonated as guest subject | Guest session now uses a grant-specific external principal; issuer remains `guest_grants.created_by`; revoked old guest sessions in migration | Real PG test for identity separation and /me/audit downstream propagation; review identity across all consumers | **PATCHED, verification in progress** |
| G01-003 High — login CSRF | Explicit origin/fetch-metadata and browser-bound five-minute `tc_auth_intent` cookie with HMAC tied to OTP | Actual production browser/proxy cross-site form, redirect and guest deep-link tests | **PATCHED; browser unverified** |
| G01-004 Medium — alternate logout | Unified API logout in header/modal; never claim success if server revocation fails; removed fake browser deletion of HttpOnly cookie | Browser reachability inventory, failed logout/timeout tests; check every logout callsite | **PATCHED; route/browser verification incomplete** |
| G01-005 High — multi-tab actor/tenant mismatch | Per-session generation; generation-specific X-Auth-Generation on writes; switch-org token rotation; cross-tab storage invalidation; guest/contractor partitions cleared | Real two-tab login/switch/logout/queued-upload and in-flight-request tests, G22 offline actor-fencing | **PARTIAL — G22 integration pending** |
| G01-006 Medium — no CSRF restoration | Same-origin authenticated `/auth/session/bootstrap` re-derives CSRF from HttpOnly session and generation; client restores in memory/sessionStorage (not localStorage) | Browser storage-loss, origin isolation and old-session migration tests | **PATCHED; browser unverified** |
| G01-007 High — OTP budget bypass | PostgreSQL shared per-IP, per-contact/grant and global budgets; strict trusted-proxy CIDR configuration, production fail closed | Distributed multi-node and actual reverse proxy tests; provider budget thresholds and alerts | **PATCHED; distributed acceptance unverified** |
| G01-008 Medium — offline-searchable OTP digest | Purpose/challenge/contact-bound HMAC-SHA256 in production, external `AUTH_OTP_HMAC_KEY`; legacy SHA-1 restricted to development/test fixtures | Secret rotation, key compromise and challenge continuity tests; verify no telemetry leaks | **PATCHED; key-rotation evidence missing** |
| G01-009 Medium — Redis consumed before PG session commit | Production internal OTP challenge uses PostgreSQL row lock and transaction retained through onboarding/session creation; invalid attempts persist; Redis still used for legacy dev/test | Crash-injection at each DB boundary, response-loss behavior, two-instance verification; no uncontrolled duplicate outcomes | **PATCHED; resilience acceptance pending** |
| G01-010 Medium — guest resend permits older code | Prior unconsumed guest OTPs marked consumed on resend under grant lock; only newest SENT challenge can be used | Real PG resend/verify and concurrent multi-instance race test | **PATCHED; concurrency acceptance pending** |
| G01-011 Medium — provider called inside guest transaction | Guest challenge PENDING committed before provider call; SENT committed separately; provider uncertainty nonusable AMBIGUOUS; request budgets retained | Real SMS/mail provider sandbox with accepted-but-timeout receipt, restart, retries and reconciliation | **PARTIAL — real delivery/outbox missing** |
| G01-012 High — boot config incomplete | Validate environment, URL/HTTPS, DB identity, Redis, keys, trusted proxies; fail before API listens; no debug/outbox in prod | Real staging deployment, secret provisioning/rotation, worker/web parity, fail-fast startup matrix | **PATCHED for API; environment verification pending** |
| G01-013 Medium — suspended account receives login | Verify active user AND organisation membership in issuance transaction | Real PG suspension/login race across nodes | **PATCHED; concurrency verification pending** |
| G01-014 Medium — session lifecycle and recovery | 30-day idle, 90-day absolute; session generation; rotate cookie token on org change and MFA; revoke-all, session list, scheduled ephemeral cleanup | Device/browser login/logout-all, stolen-token recovery, role/membership revocation races; lost-factor support review | **PARTIAL — supervised recovery and browser testing pending** |
| G01-015 Medium — incomplete security history | `auth_security_events` redacted/pseudonymous table, forced RLS; internal/guest session events, invalid OTP/cooldown, MFA/revocation events | Verify every guard and provider failure path, log retention/integrity, alerting, audit completeness | **PARTIAL — remaining failure paths and monitoring** |
| G01-016 Medium — unsafe runtime inputs | Validate contact/token/challenge/OTP and guest expiry, registration identity/profile; enforce bounded UUIDs/capabilities | Full malformed body/header/path HTTP fuzz matrix, login/invite contact canonicalisation | **PARTIAL — all route DTOs not yet proven** |
| G01-017 Medium — arbitrary `next` | Strict same-origin path validation; reject //host, backslashes, control characters and recursive login paths | Playwright encoded/protocol-relative/Unicode/control redirect matrix | **PATCHED; browser tests pending** |
| G01-018 Medium — tests don't prove implementation | Added real PostgreSQL MFA, invitation, guest identity/OTP and transactional OTP tests; origin/config, TOTP and recovery-code negatives | Full non-demo internal+guest login browser suite, real Redis + two APIs, live providers and kill/restart tests | **PARTIAL — browser/multi-instance coverage missing** |
| G01-019 High — privileged MFA absent | Encrypted TOTP enrollment, replay-safe step-up, single-use recovery codes, session rotation and privileged read/write guard, standalone web MFA page | Production deployment + browser enrollment and recovered-token tests; policy/recovery owner approval; rate-limit MFA verification | **PATCHED partially; release evidence pending** |
| G01-020 Medium — onboarding/invitation/recovery promises | Explicit registration, verified identity-bound single-use invitation claim under RLS; login interface no longer promises magic-link authentication | Confirm current API docs; recovery via verified alternate destination, forwarded invites, organization boundary, real mail delivery | **PARTIAL — SMS fallback/magic-link docs and recovery policy** |
| G01-021 Low — privacy controls | No-store/no-referrer for auth/guest/MFA pages and API responses, secrets excluded from security events | Actual browser/reverse proxy/access log/analytics validation, no raw invitation URL in telemetry | **PATCHED in source; deployed controls unverified** |

## Additional remediation pass (continuation)

This pass found and corrected a **new production browser contract defect** in the login form. The backend requires a challenge UUID for production OTP verification, but the page previously forwarded only identifier and code. The login UI now retains the original `challengeId`, sends it with verification, clears it when the identifier is changed and has a Playwright browser/API contract regression. The latter runs only in the separately provisioned application Playwright project, not the archive browser job in CI.

Additional implementation:
- **G01-003/005:** Reuse a valid same-browser preauth intent cookie for concurrent challenges, rather than tab B invalidating tab A; different browsers still have different intent digests.
- **G01-004/005:** Shared logout client now broadcasts confirmed revocation and clears both CSRF and auth generation; stale tabs re-bootstrap.
- **G01-005/018:** Contractor shell no longer invents a Deccan company name, GSTIN, PM persona or PM navigation for unknown users; it renders the actual authenticated organisation from `/auth/me`.
- **G01-007:** Added real PostgreSQL concurrency test using two independent connection pools for atomic local/IP/global budget enforcement. This is database concurrency evidence, **not** a two-API-instance deployed test.
- **G01-017:** Post-authentication redirects now accept only real contractor routes, rejecting URL encodings, traversal, control characters, backslashes and external or scheme-relative origins.
- **G01-019:** MFA reset now needs a fresh, non-replayed authenticator code or unused recovery code, is rate limited, revokes **all** device sessions and clears the browser cookie. Existing 12-hour MFA session state alone is insufficient to disenroll.
- Added `docs/G01_STAGING_AUTH_ACCEPTANCE_PROTOCOL.md` for independent reviewer execution, explicit 21-finding coverage and fatal release conditions.

These changes require their **own current-SHA** CI sign-off; don't rely on the previously green CI SHA. No customer authentication, independent party-authority verification, real service-provider request, two-tab browser run or staging deployment has been executed by this repository-editing pass.

## Further regression and database hardening

- **G01-001:** Added **additive migration 0024** with a database trigger forbidding any non-migrator runtime role from inserting or updating `guest_grants.independent_authority_verified_at` / `independent_authority_evidence_ref`. New `g01-external-authority-db.spec.ts` verifies direct SQL cannot self-approve, yet ordinary grant revocation remains permitted. This **does not** implement or independently validate a trusted real counterparty approval mechanism. G01-001 remains a release blocker.
- **G01-005/006/014:** Added `g01-session-guard-db.spec.ts` against restricted PostgreSQL for CSRF, auth-generation mismatch, token revocation, and idle/absolute session expiry.
- **G01-007:** The distributed-budget test now handles disposable database teardown without unhandled PostgreSQL pool errors; this does not replace actual two-node deployment testing.
- **G01-012:** Production startup rejects malformed/embedded-secret endpoints, non-origin frontend URLs, invalid/wildcard CIDR masks and insecure database roles. A second database privilege check queries the **actual connected PostgreSQL role** and denies superuser, BYPASSRLS and migrator-role membership. Real PG acceptance is part of `g01-external-authority-db.spec.ts`.
- **G01-013/014:** Session issuance and org switching now retain membership/organisation share locks through the state transition.
- **G01-015:** Auth limiter writes pseudonymous, sampled throttling events without making telemetry availability a prerequisite for denial.

**Important:** Production-grade G01 still requires the entire 21-finding matrix and the independent authority workflow, browser, provider, Redis multi-node and deployment evidence. New source controls alone are not sign-off.

## Third source pass — newly found G01 defects and remediation

This pass found source-level defects **not reliably covered by the original 21-finding list**. They are tracked here as additional regression gates, not as evidence that the 21 issues are complete.

| Extra ID | Newly found behavior and impact | Fix / negative test | Remaining proof |
|---|---|---|---|
| G01-X01 | Malformed non-string `signupProfile.fullName` could throw `TypeError` before 422 validation during successful OTP verification | Guarded type coercion; real PG OTP test asserts 422 and the proof remains unconsumed | HTTP fuzz matrix, signup schema |
| G01-X02 | Slow guest OTP provider response could return a **successful challenge** after another request invalidated it | `requestGuestOtp` now checks committed SENT row count and raises `GUEST_OTP_CHALLENGE_SUPERSEDED`; deferred-provider concurrency test | Actual provider timeout sandbox |
| G01-X03 | The analogous internal email/SMS response race could return success for a consumed/replaced production OTP | Internal SENT transition requires a live proof; dedicated real PG/deferred-mail test, and uncertain delivery remains AMBIGUOUS | Actual delivery-provider and two-node race test |
| G01-X04 | Session idle timeout could be extended by stale-generation or invalid-CSRF requests, before authorization completed | Moved sliding activity update after authentication/CSRF/MFA/project-scope checks, protected with token hash and generation; restricted-PG regression | Browser/real proxy idle-expiry acceptance |
| G01-X05 | Production Redis stored raw OTP destinations in alias/rate/failure keys and duplicated OTP challenge contact payloads, expanding identity exposure | Production Redis retains only pseudonymous HMAC request-budget keys; PostgreSQL alone owns production OTP challenge; test checks Redis call arguments and key absence | Inspect real Redis MONITOR, logs and telemetry |
| G01-X06 | Issued external guest grants could be repointed to another contact, project, party, role or capability without changing the grant identity | Additive migration `0025_g01_guest_grant_immutable_identity.sql` forbids mutating core assertions; revoke-and-reissue required; direct app-role SQL negative tests | Independent approved external delegation process and old-grant lifecycle |
| G01-X07 | Unexpected auth provider errors could leak OTPs and invitation URLs through raw exception message/stack logging | The global problem filter now writes only redacted exception type and sanitized request ID on auth/guest routes; focused log-leak test | Deployed API/gateway/analytics access-log inspection |

**Disposition:** All new source changes are subject to latest-SHA CI and full staging/browser/provider gates. No new finding is declared production-verified merely because a test passes.

## Engineering guardrails

- PR #5 is a **draft**, not a production certification. Source changes and mocked tests cannot establish real contact authority or enforceability of external sign-off.
- **Never auto-populate** `independent_authority_verified_at` on a contractor-created guest grant; verified external signatory authority must be established using independent processes and retained evidence.
- Never weaken RLS, authorization, brute-force limits, MFA checks or OTP replay assertions solely to obtain a green CI run. When older tests use invalid fake contacts/tokens, make fixtures valid and keep negative behavior asserted.
- No merge until real acceptance results are attached to each blocking row; where relevant include exact workflow commit SHA, provider sandbox, deployment environment and reviewer names.
- The baseline includes unmerged PR #4. Rebase/retarget in coordination with PR #4 before merging; prevent accidental inclusion of its still-unreviewed changes.
- The overarching G01 acceptance checklist in the original audit remains authoritative. An implementation record is **not** a waiver.

## Final external proof still required

1. **Independent client/witness authority:** actual approval of signatory identity and documented delegation, with negative test that the contractor cannot self-approve.
2. **Real browser:** member/guest OTP, MFA enrollment/recovery, CSRF storage loss, cross-site form login, same-site redirect, two tabs, org switch, offline queue, expired/inactive identities and session revocation.
3. **Real infrastructure:** TLS reverse proxy, real Redis across multiple API instances, PG commit-failure/timeout, SMS/email sandbox (including ambiguous acceptance), distributed rate limits, monitoring and incident response.
4. **Operational:** real staging startup with missing/rotated secrets, authenticated service health, cleanup and recovery runbooks; retention and redaction evidence.
5. **Independent security review:** replay, forged contact/grant, session/tenant races, backup-factor and privileged MFA bypass across every supported route.

**G01 sign-off = NO-GO until the above are demonstrated and every 21-row closure is independently reviewed.**


## Fourth hardening pass — membership, device, browser and offline boundaries (2026-11-10)

These changes were implemented on the same draft G01 branch. **Do not infer production approval from their presence or a green test run.** A deployment SHA is acceptable only after the actual PR head passes its full CI and the operational gates below are independently accepted.

| Area / cross-group interface | Source change | Negative / positive evidence expected | Operational gate |
|---|---|---|---|
| G01-014 privilege changes (G03) | Membership role edits revoke active sessions in the affected org and clear their MFA state in the same transaction. Ownership transfer verifies an active current owner, rejects malformed/self-transfer, and revokes both former/new-owner sessions. | `g01-member-invitation-authority-db.spec.ts`: owner role cannot be minted through invitation/patch; revoked old member and owner credentials; clean transfer to active target; no unrelated session revocation. | Real multi-device role elevation/demotion, simultaneous membership removal/switch and owner handover using HTTP cookies |
| G01-015 audit trail | Each member-role change emits a durable `ORG_MEMBER_ROLE_CHANGED` domain audit/outbox record even where there are no active sessions; revoked sessions produce redacted `auth_security_events`. | SQL event count and role provenance in restricted PostgreSQL fixtures; failure injection must prove audit failure rolls back the role change. | Operations can reconstruct the permission change and login revocations with protected, access-controlled immutable history |
| G01-014 device controls | Added `POST /api/v1/auth/sessions/:sessionId/revoke` with authenticated owner-only session lookup, atomic revoke and append-only security event. Revoking current session clears the HttpOnly cookie. Restricted ledger has no unnecessary SELECT grant. | `g01-device-session-revocation-db.spec.ts`: foreign/invalid/already-revoked session denied, other devices survive, current device clears cookie, exactly two audit records. | Browser device inventory / remote revocation flows, stolen credential replay, concurrent revoke/refresh tests |
| G01-005/023 browser | Contractor layout renders no protected child workspace content until `/auth/me` succeeds and required MFA is complete; failed session verification redirects to sign-in. | `E2E-G01` Playwright: expired session cookie cannot reveal contractor navigation/content while API identity check is pending, then redirects. | Production HTTPS browser with real cookie/CSRF, MFA and two-tab login/logout/tenant switch |
| G01-005/006 × G22 offline queue | Persist queue actor, auth generation and cross-tab epoch; validate before S3 multipart PUT, upload completion and each scanner-result poll. Abort to `BLOCKED_SCOPE` on identity mismatch; never silently rebind old actor drafts to a new user. Valid cookie-only browser sessions may bootstrap securely before queue creation/drain. | `E2E-G01` queue-context matrix (actor, session generation, epoch, legacy missing fields). Integration test must change account during a multipart upload and prove no second part or completion commits under the changed credentials. | Real IndexedDB, multi-tab browser, 4G/network failure, changed account during in-flight PUT, S3 presigned URL lifetime and human reconfirmation of legacy blocked drafts |

### Required independent post-merge/pre-release verification

1. Attempt a live owner transfer with two already-authenticated devices and prove both old sessions fail; verify the resulting role and domain/security audit references.
2. Exercise `/auth/sessions`, single-device revoke, current-device revoke and logout-all against real HTTP, CSRF, MFA and restricted PostgreSQL. Reuse old bearer/cookies in a separate client and require denial.
3. Start the production-built web app and intercept a delayed `/auth/me` failure; the protected contractor children must never appear. Repeat with actual expired/suspended accounts through the production proxy.
4. Enqueue a verified guest or contractor upload with IndexedDB; switch account/organisation in another tab while S3 upload is delayed. Verify all later PUT, complete, and document status transitions use only the original authenticated principal; old drafts remain accessible for intentional recovery but cannot auto-upload to a different account.
5. Complete the independent external authority/delegation SOP, real SMS/email provider acceptance, two-node OTP/rate-limit resilience, MFA recovery and production-mode session/CSRF browser matrices. These **remain release blockers**.

**Outcome: source-hardening continuation only; G01 production sign-off remains NO-GO pending all required evidence.**


## Fifth hardening pass — independent approval project-counterparty binding (2026-11-10)

**Scope:** closes a source-level authorization inconsistency; it is not independent legal signatory verification or staging acceptance.

- Added additive migration `0028_g01_approved_guest_project_binding.sql`: platform reviewer approval now requires the grant to reference the project's *currently designated, active* client or consultant party, not just an active grant of a sensitive type.
- Approval holds database locks on the relevant project and party while checking their relationship. A project update is rejected if it changes the designated counterparty while a currently active independently approved grant for the old counterparty remains. The supported path is revoke, reassign, reissue, OTP, and fresh independent evidence approval.
- Extended `g01-independent-party-approval-db.spec.ts` with reviewer rejection of an unrelated client party, successful review after establishing the proper relationship, and refusal to reassign a project while approved authority remains active.
- Extended `G01_EXTERNAL_PARTY_AUTHORITY_OPERATIONS.md` to require this lifecycle in operator acceptance.

**Verification status:** code and regression tests committed; final-candidate CI/staging provider, browser and live counterparty-signature evidence still required. A successful prior SHA does **not** validate the new migration. PR remains **DRAFT / NO-GO**.
