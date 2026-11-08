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
