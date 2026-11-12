# TradeCloseout G01 — engineering consolidation and remaining release gates

**Status: DRAFT / NO-GO.** This is not an assertion of production readiness. All source controls must pass CI on the **exact latest candidate SHA**; green CI does not close real-contact, provider, browser, infrastructure or legal-evidence gates.

## Final source-pass remediation (2026-11-10)

| Area | Implementation | Negative proof |
|---|---|---|
| G01-001 project signatory approval | Migrations 0028 and **0029** check live project/party binding under explicit tenant RLS context during reviewer approval and project reassignment. 0029 corrects the previously false-negative project trigger caused by absent RLS tenant context. | `g01-independent-party-approval-db.spec.ts` checks unrelated party denial, two-person approval, rejection of reassignment with active approval, and success after grant revocation. CI failed on 0028 and passed after 0029; later commits must pass independently. |
| G01-001 immutable review decisions | **0030** rejects edits/deletions of reviewer attestations and blocks archiving the active counterparty until live approved grants are explicitly revoked. | Restricted DB negative test attempts UPDATE/DELETE of review ledger and early party archive. |
| G01-001 consultant review binding | `review.decide` joins `inspection.witness` and `package.accept` under `INDEPENDENT_PARTY_AUTHORITY_REQUIRED` for guests. | Unverified consultant guest with nominal `review.decide` capability gets 403; genuinely approved project-scoped guest can continue to authorization checks. |
| G01-019 MFA bypass surface | Replaced prefix-wide exemption for `/api/v1/auth/*` with an explicit pre-MFA route allowlist including enrollment, recovery, basic identity, logout and emergency device revocation. New authenticated auth endpoints default to requiring privileged MFA. | Negative security test rejects previously unlisted auth-prefixed reads while retaining minimal required pre-MFA navigation. |
| G01-003 origin verification | Production `PUBLIC_APP_URL`, if configured, must be a bare HTTPS origin; authentication-origin comparison rejects insecure alternate origins even when misconfigured. | Startup and origin negative tests cover HTTP alternate origins and paths. |

**Note on migration history:** do not edit or rewrite a migration already applied in staging; use additive migrations 0029 and 0030. Run the full migration ledger from scratch *and* exercise upgrades from the preceding schema; keep checksums and rollback/restore evidence.

## Implementation continuation — reviewer operations, delivery commit and concurrent session revocation

- **Reviewer gateway:** `apps/api/src/modules/identity/external-review-operations.ts`, `apps/api/scripts/approve-external-authority.ts`, `pnpm --filter @tradecloseout/api review:external`. Requires three independent evidence attestations, specifically verified CA TLS, distinct named PostgreSQL reviewer credentials and restricted privileges. Performs one short, audited database approval transaction. No application API credentials or reviewer secrets are shared. This is an operator tool, not automated legal validation.
- **Invitation delivery:** additive migration `0031_g01_invitation_delivery_pending.sql` adds `DELIVERY_PENDING`. Provider-submitted invitation links cannot be redeemed until the send call succeeds and a conditional database promotion to `PENDING` commits. A crashed sender or uncertain timeout leaves a token non-usable; a newer invitation supersedes previous pending/active attempts. Role changes, offboarding and ownership transfer revoke delivery-pending invitations too. Promotion rechecks issuer membership/role. **Migration deliberately revokes pre-existing unexpired `PENDING` invitations** whose delivery cannot be attested under the new protocol; reissue affected invites after rollout.
- **Concurrent privilege revocation:** `SessionCsrfGuard` passes authenticated session ID and auth generation into `userContext`. `withTenantTransaction` takes a `FOR SHARE` lock on the current nonrevoked, unexpired session generation for the whole mutation, serializing member demotion, owner transfer, MFA rotation, logout, device revocation and org switches with API writes. Stale generation gets deterministic `AUTH_CONTEXT_CHANGED` (HTTP 409), not a misleading 500. Controlled internal contexts without HTTP sessions retain existing behavior; this does not replace auditing every write path for authenticated-context use.
- **Negative proof:** Added `g01-reviewer-operations.spec.ts`, `g01-auth-session-transaction-fence-db.spec.ts`, negative filter mapping, and simulated slow/superseded invitation delivery plus mid-flight issuer demotion. Exact final SHA CI verification remains mandatory.

### Deployment-specific verification of the new delivery state

For releases upgrading from older migrations, confirm that existing pending invitations are revoked intentionally; reissue them only after verified provider submission. Confirm no UI, job, or API treats `DELIVERY_PENDING` as redeemable. Test state transitions under application crash between INSERT and provider submission, provider acceptance followed by HTTP timeout, provider acceptance followed by database outage, email replay, two concurrent reissues, and issuer offboarding while the network request is in flight. Ensure operator monitoring alerts on long-lived `DELIVERY_PENDING` rows and that a scheduled cleanup expires them.

## Implementation continuation — independent offline decisions and emergency recovery

- **Migration 0032 — external document evidence decisions:** Internal `recordExternalApproval` no longer treats a contractor-selected PDF, purported signatory or claimed party as sufficient evidence of approval. A separate append-only, forced-RLS reviewer ledger requires two named individual platform reviewers to verify the exact stored proof object's SHA-256, target document revision, designated counterparty and independently obtained decision evidence. API runtime can call only `has_verified_external_document_approval` for a boolean; reviewer login roles cannot directly manipulate ledger rows. A legacy external decision helper is fail-closed in production. Reviewer commands: `review:external-document`; real DB and CLI negative tests cover disjoint reviewers and changed party.
- **Migration 0033 — security-operator incident response:** Individual reviewers can independently revoke an approved sensitive guest grant (including existing live guest sessions), and independently revoke the ability to use an attested document approval proof in subsequent offline approval recordings. Two append-only forced-RLS revocation ledgers preserve reviewer and incident reference. Operator command: `review:revoke-external`. Revoked document attestations cannot be reused by the normal API; operations must separately dispute/review any document **already approved** before emergency revocation.
- **Provider acknowledgement:** Mail/SMS adapter now requires a bounded JSON acknowledgement with explicit `accepted: true`; HTTP 200/202/204 or an ambiguous response alone does not grant a usable OTP or invitation. The real HTTP negative suite asserts rejection of explicit declines, empty 204 responses and unsafe provider redirects. The transport contract is not end-user delivery receipt; real provider callbacks and retry reconciliation remain to be integrated.
- **Transaction fence:** Both tenant mutation wrappers lock the live, generation-bound session and tests attempt revocation while an authenticated write holds a database lock. Audit any controller/service that manually manages database transactions to ensure it implements equivalent authenticated session generation/permission freshness.

The implementation remains deliberately fail-closed in environments lacking the dedicated platform reviewer service and provider contracts. These source changes are not a substitute for actual independent legal authority verification and production multi-instance acceptance.

## Worker invitation reconciliation (G01-020)

The leader/period-locked hourly worker now calls `TradeCloseoutScheduler.cleanupStaleInvitations()`. With explicit per-tenant RLS scope and bounded `FOR UPDATE SKIP LOCKED` batches it revokes `DELIVERY_PENDING` invitations abandoned longer than 15 minutes and marks elapsed `PENDING` or `DELIVERY_PENDING` invitations `EXPIRED`. It never promotes an unacknowledged delivery to a redeemable credential, and it preserves pending authorisation of other tenants. Isolated PostgreSQL/Redis worker integration tests check stale, expired, fresh and foreign-tenant invitations plus idempotent reruns.

## Emergency revocation of previously approved documents (migration 0034)

The first implementation of independent attestation revocation prevented future recording but did not invalidate a document approval already recorded. Additive migration `0034` closes this readiness loophole: a named platform reviewer invoking `revoke_external_document_approval` writes immutable revocation evidence and, in the same tenant-scoped transaction, clears `documents.current_approved_version_id` and moves an affected current approved `document_versions.review_status` to `CHANGES_REQUESTED` with updated row versions. This prevents future handover readiness from trusting a disputed current approval. The SQL integration test exercises a previously approved revision and verifies it is invalidated after trusted reviewer revocation. Original previously distributed archives, signatures and customer notices remain incident-response obligations; they cannot be retroactively changed in an immutable archive without a separately authorised process.

## 21-finding disposition: source status is NOT release acceptance

| Finding | Source status | Still required |
|---|---|---|
| 001 Independent external client/consultant authority | Two reviewer DB workflow plus approved project-party/lifecycle enforcement implemented; operational trust still missing | Out-of-band independently obtained legal signatory/delegation evidence, individual IAM reviewer credentials and real browser approvals |
| 002 Issuer/guest identity separation | Separate principal and migration invalidation implemented | Cross-system audit identity and deployed tenant/guest testing |
| 003 Login CSRF | Origin, first-factor intent, HTTPS restrictions | Real proxy, cross-site form/deep-link/browser matrix |
| 004 Logout correctness | Server revocation and UI correction | All logout controls, timeout/failure and browser verification |
| 005 Cross-tab state switching | Auth generation, browser epoch and offline queue fencing | Real two-tab network interruption, tenant switch and mid-upload checks |
| 006 CSRF bootstrap | Same-origin cookie bootstrap | Storage-loss and cross-origin browser tests |
| 007 OTP budgets/proxy | Shared PG budgets with restricted proxy config | Real two-node reverse-proxy and saturation tests |
| 008 OTP secrecy | Production HMAC protection | Secret rotation, telemetry and key-compromise rehearsal |
| 009 Atomic OTP consumption | Production PG challenge and session transaction | DB crash, response-loss, replay injection across two API instances |
| 010 Guest resend | Superseded generation invalidation | Two-node provider races and retries |
| 011 Provider state | Pending/Sent/Ambiguous fail-closed state | True delivery/receipt callbacks, timeout recovery and reconciliation |
| 012 Startup validation | API fail-fast config and role checks | Actual staging TLS, secrets, worker parity, rotation/rollback |
| 013 Suspended user eligibility | Active account and membership checks | Concurrent suspension/login HTTP tests |
| 014 Session lifecycle | Idle/absolute expiry, MFA/session rotation, revoke-one/all, membership transitions | Multi-device takeover, privilege-switch and device recovery drills |
| 015 Security history | Protected redacted auth event table | Complete critical-event matrix, monitoring/alerts and legal retention |
| 016 Runtime input validation | Selected auth/guest DTO checks | Full HTTP body/header/path fuzz/canonicalization matrix |
| 017 Safe return URL | Route allowlist | Encoded redirect and proxy/browser negative matrix |
| 018 Credible tests | PG tests, unit negatives, CI application browser smoke tests | Production-mode API + browser, real providers, two-node chaos tests |
| 019 Owner/admin MFA | Encrypted TOTP, replay-safe verification, recovery, explicit bypass routes | Privileged endpoint inventory, lost factor process, enrolled multi-device staging browser |
| 020 Invitations/onboarding | Intended-identity single-use claim, explicit signup | Real provider invitations, forwarded-link/recovery and account-support policy |
| 021 Privacy | No-store/referrer, redacted logs, OTP data controls | Inspect deployed gateway, browser, cache, worker, access logs, telemetry |

## Extra regressions already tracked

G01-X01 malformed signup profile; X02/X03 superseded provider success; X04 failed requests extending idle session; X05 raw Redis identity exposure; X06 mutable guest grant identity; X07 secret-bearing provider exception logging. All remain subject to deployed verification, not merely source assertions.

## Remaining work outside this repository-edit pass (cannot be truthfully marked complete without external systems)

1. **Independent party authority:** establish two individually authenticated human reviewers who verify legal identity, client/consultant delegation and issuer-independent contact against independently obtained evidence. Provision external IAM, TLS, dedicated DB roles, noneditable evidence storage and approver audit.
2. **Provider integrations:** sandbox SMS and email sends, accepted-but-timeout, queue recovery, duplicate receipts, resend, idempotency, bounce and reconciliation. Do not count HTTP 2xx from a delivery adapter as a confirmed end-user receipt.
3. **Multi-instance chaos:** at least two API workers, real PostgreSQL and Redis, forced DB commit abort, token replay, dropped HTTP response and concurrent OTP attempts.
4. **Real browser:** actual HTTPS deployed API and production-built Next (not test-only debug-OTP API), owner/admin MFA, invited member login, guest login, session deletion/switch, two tabs and IndexedDB upload context change during multipart upload.
5. **Privacy and operations:** production reverse-proxy config, CSP/referrer/cache, telemetry redaction, secret rotation, incident recovery, review retention, logs, monitoring, backups and restore/rollback rehearsal.
6. **Independent authorization and security reviewer:** complete and sign all 21 G01 rows, negative endpoint inventory, full role matrix, migration/reviewer privilege audit and exact SHA approval.

## Required release decision

**NO-GO until** the current final SHA's required jobs are green, all critical/high vulnerabilities are closed in source *and* the relevant live acceptance evidence is attached and independently reviewed. Keep PR #5 draft; it also includes stacked unmerged PR #2–#4 changes, so inspect and integrate those dependencies in order. No auto-merge and no claiming production readiness from an isolated CI pass.
