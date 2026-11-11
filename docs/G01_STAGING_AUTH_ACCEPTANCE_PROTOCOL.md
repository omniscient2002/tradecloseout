# G01 identity/authentication: staging acceptance protocol

**Release decision: BLOCKED until all 21 G01 findings have independent sign-off.**
This protocol is executable by a reviewer with a disposable **non-customer** staging database, at least two API instances, a genuine Redis cluster, a production-mode Next app, and sandbox SMS/email credentials. It cannot be satisfied with mocks alone. Run against the exact candidate SHA and preserve timestamped logs with secrets redacted.

## Prerequisites and evidence

- Capture API / web / worker Git SHA, migration ledger/checksums, container image digests, runtime-role verification, Node version, deployed proxy/TLS policy and environment owner.
- Confirm `NODE_ENV=staging`; set a restricted `APP_DATABASE_URL`, real `REDIS_URL`, HTTPS `FRONTEND_URL`, gateway URLs/keys, `AUTH_OTP_HMAC_KEY`, `AUTH_CSRF_KEY`, a 32-byte base64 `AUTH_MFA_ENCRYPTION_KEY`, and explicit `AUTH_TRUSTED_PROXY_CIDRS`.
- All test contacts, customer organisations and external counterparty records must be sandbox-controlled, with no actual client signatories or personal OTPs in logs.
- Run migrations using the separately privileged migrator; never grant app role superuser/BYPASSRLS/DDL access.
- Treat `independent_authority_verified_at` as **forbidden to self-assert**. Do not manually set it to make the test pass.

## Acceptance matrix (record PASS/FAIL, SHA, executor and evidence ID per row)

| Gate | Independent procedure | Pass condition |
|---|---|---|
| G01-001 authority | Contractor invites client party pointing to its own mailbox; performs valid OTP; attempts witness signoff + recipient acceptance | Both denied, no event claiming authenticated client authority; separately approved real client delegation must also work before sign-off |
| G01-002 guest actor | One issuer invites two independent external contacts; both authenticate; inspect /auth/me, action actor and audit | Distinct guest principal IDs, issuer preserved only as provenance, no issuer-as-guest name or audit |
| G01-003 login CSRF | Cross-site HTML form, fetch and navigation with valid attacker OTP; test missing/spoofed Origin, Fetch Metadata and preauth cookie | Victim cookie cannot be replaced; legitimate same-origin and direct guest-link OTP succeeds |
| G01-004 logout | Call every reachable logout control with healthy API, then with denied CSRF, database outage and timeout | Successful logout revokes original token; failed request does **not** display success or silently clear identity |
| G01-005 cross-tab | Open 2 tabs; switch member/guest, user and org in tab A while B holds an editor and queued offline files | B never silently submits under new actor/org, invalidates stale UI and pauses offline uploads; explicit reconfirmation |
| G01-006 CSRF bootstrap | Delete sessionStorage while keeping valid HttpOnly cookie; make read and then guarded write | Secure bootstrap restores correct CSRF+auth generation; untrusted origin cannot read token; old legacy session requires reauth |
| G01-007 budgets | Send requests through two API nodes from same and different IPs, contacts and grants; fail Redis and attempt replay | Identifier/IP/grant/global budgets act atomically; no proxy-header bypass and no loss of counters on failure |
| G01-008 OTP secrecy | Inspect PostgreSQL, Redis and logs after issuing internal and guest codes | Neither store contains plaintext OTP nor offline-enumerable digest; wrong purpose/contact/challenge rejected |
| G01-009 atomicity | Force DB failure before/after identity creation and session insertion; race two verifies; simulate response drop | One durable session outcome; no burned valid proof on rolled-back transaction; no duplicate active login from a replay |
| G01-010 guest resend | Send code A, resend B, verify A, race B and another resend | Old A always denied; one winning generation and one session from B |
| G01-011 delivery | Sandbox provider: explicit rejection, slow response, accepted-with-lost-response, duplicate callback and retry | No long-held DB lock; PENDING/AMBIGUOUS not accepted as SENT; counters retained; recovery/reconciliation documented |
| G01-012 startup | Remove each production-required variable, give mismatched DB role, HTTP gateway, invalid MFA key, wildcard proxy and debug flag | Service refuses to listen and prints non-secret diagnostic; API and worker use correct identities |
| G01-013 eligibility | Suspend user, org and membership before/during session issuance; interleave role changes | No successful usable login to suspended or deleted account; existing session denied on next request |
| G01-014 session lifecycle | Exercise idle 30d, absolute 90d, switch-org credential rotation, revoke-all, multiple devices and factor recovery | Expired/revoked tokens do not revive; switching does not retain earlier MFA state; compromised sessions revoked |
| G01-015 security events | Trigger all success/failure/rate-limit/guest/revocation/MFA/recovery outcomes and inspect event ledger | Each has durable, appropriate actor/outcome and redacted metadata; no tokens, OTP or raw invitation URL |
| G01-016 validation | Fuzz runtime bodies with nulls, arrays, objects, excessive lengths, invalid UUID/challenge/OTP, expiry and mixed contact inputs | Stable 4xx; no internal exception, tenant crossing or inconsistent contact canonicalisation |
| G01-017 return URLs | Try `//evil`, backslash, control chars, encoded slashes, double encoding, traversal, login recursion and valid deep links | Redirects only to allowed contractor paths, never foreign/script targets |
| G01-018 test credibility | Disable a real guard/consume/OTP binding in throwaway branch and run corresponding negative test | The test goes red; exercise actual HTTP, Redis, restricted PG and browser not just mocks |
| G01-019 privileged MFA | Owner/admin OTP login, enroll, TOTP verify, replay code, backup recovery, reset, role switch; try every privileged read/write pre/post factor | No owner/admin privileged data before MFA; replay denied; reset needs fresh proof and revokes sessions; recovery codes single-use |
| G01-020 invited member | Invite intended verified email, forward invitation to another email, revoke/expire, concurrently accept twice, invite existing user | Only intended identity can claim one time; no silent company creation; provider delivery and support recovery work |
| G01-021 privacy | Inspect browser caches, Next proxy, service worker, reverse proxy, telemetry, referer headers and incident logs | No auth response shared caching, no invitation token leakage, no OTP/token in telemetry; HTTPS/HSTS verified |

## CI and staging separation

CI source/unit/database tests are **necessary** but not sufficient. Review `g01-authentication-security.spec.ts`, `g01-invitation-db.spec.ts`, `g01-guest-principal-db.spec.ts`, `g01-mfa-db.spec.ts`, `g01-distributed-rate-budgets.spec.ts`, the security/RLS suite and application Playwright tests. The Playwright **application** project requires a separately running Next/API pair and fixtures; it is not equivalent to the archive-only browser check in CI.

Record independently whether (1) raw API endpoints, (2) Next proxy, and (3) production-mode browser behave identically. In particular, OTP verify **must** receive the original `challengeId`, not just identifier and code. Test the real guest path separately.

## Hard stop conditions

1. A contractor can grant themselves client/consultant authority or mark their own guest independently verified.
2. A privileged owner/admin can read or mutate protected customer data without the approved second factor.
3. Logout, revocation or tenant switch allows an old token to retain authority.
4. Missing dependencies fall back to in-memory secrets or disabled OTP limits in production/staging.
5. OTP delivery is reported as confirmed after a provider timeout or a PENDING challenge can be used.
6. A test passes using privileged PostgreSQL superuser credentials rather than the restricted runtime role.
7. A release finding is marked complete solely by a source patch, mocked test or green build.

## Required final artifacts

- Signed 21-row closure record and security reviewer decision.
- Exact validated SHA/container digest, full CI run link and production-mode browser trace references.
- Provider sandbox delivery receipts (redacted), independent authority records, multi-instance race logs and DB failure-injection results.
- Audit event samples showing actor differentiation and redaction, deployment restore and rollback runbook verification.
- Evidence of successful old-token revocation and a stopped/failed rollout rehearsal.

**Until every high/critical row and applicable environment gate passes, keep PR #5 draft and block unrestricted customer deployment.**
