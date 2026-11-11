# G01 external acceptance: authorised execution playbook (NO-GO until evidence exists)

**Scope:** original G01-001–021 at the final exact PR #5 SHA. This is a procedure, not a claim that anything below was executed. It does not authorize production access, account recovery, secret extraction, migration rollout, merge or deployment. Keep PR #5 draft. Use only a purpose-built staging environment with disposable data, legitimate reviewed test recipients and separately stored secrets.

## 0. Evidence and permissions prerequisite checklist

- **Release owner / SRE:** authorise one isolated HTTPS staging URL, real trusted reverse-proxy CIDRs, WAF/traffic controls, two independently running API pods, worker, PostgreSQL 16 with FORCED RLS, shared Redis, disposable S3-compatible object store, service identities and a one-click rollback/restore. Provide domain or environment ID and a read-only reference to manifests, **not passwords or access keys in a chat/PR**.
- **SMS/mail provider owner:** provision genuine provider *sandbox* accounts, approved DLT template/sender where relevant, and a verified callback/receipt contract with stable provider message IDs and signature verification. Set credential URLs and secrets only through staging secret injection. The existing `accepted:true` adapter acknowledgement is NOT proof of delivery; callback correlation/retry reconciliation must be implemented and independently reviewed before it can pass G01-011.
- **Identity/security owner:** nominate TWO independently accountable named signatory reviewers with separate auth/MFA and PostgreSQL reviewer-only roles, explicit delegation scopes and screened issuer conflicts. Each reviewer collects contact, signatory and legal delegation proof from independent, non-contractor-controlled channels. Never infer legal authority from a contractor-uploaded PDF or a guest grant alone.
- **Customer support + IAM owner:** approve a lost-device / lost-destination / lost-all-MFA-factor recovery protocol. Current fresh-proof MFA reset cannot authenticate someone with no factor or backup code; never bypass it with a magic link or invented alternate phone/email.
- **Security operations owner:** provision a monitored, protected and retention-bound SIEM destination; evidence store with immutable/WORM retention; incident redaction and independent read access. Approve a secret/key rotation rehearsal and a response-loss/DB failure supervisor.
- **Independent reviewer:** inspect the **actual final SHA**, completed evidence items, failure traces, migration history/restore and the effective integration merge of stacked PRs #2–#4. Only this independent authority may decide REVIEW_VERIFIED; owner separately authorizes RELEASE_ACCEPTED and merge/deploy.

## 1. Safe disposable baseline / command set

From the checked-out **exact PR head** with Node 22 and pinned pnpm 12.4.1:

```bash
node --version
pnpm --version
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
# With real locally running disposable API/Next/PG16/Redis:
E2E_LIVE_AUTH=true pnpm --filter @tradecloseout/web exec playwright test --project=application --grep E2E-G01
```

Use only `APP_DATABASE_URL` for restricted `tc_app` runtime, `MIGRATOR_DATABASE_URL` for migrations, and distinct `G01_REVIEWER_DATABASE_URL` for named external-party reviewer commands. The disposable-db tests create random temporary databases and drop them. Never connect these commands to production or change actual customer records. The CI smoke for `NODE_ENV=production` uses **fixture URLs that cannot deliver email or SMS**: it establishes strict startup/security paths, not live provider acceptance.

Check both **fresh schema** and an actual **upgrade snapshot** with all prior migrations applied, retaining ledger checksums. The proposed 0036/0037 quarantine is intentionally destructive to *live approved pointer state* and must not be deployed before the impact inventory and rollback rehearsal in section 2.

## 2. G01-001: external principal and historical approval migration

**Responsible:** platform security/IAM, legal signatory verification officer, migration SRE, independent reviewer.

1. Record organisation/project/party IDs and current assigned client/consultant/M.C. independently from the contractor. Perform independent evidence verification and separate signer authentication (actual verified phone/email OTP via real provider); do not assume an issuer-chosen destination is a legitimate signatory.
2. **On an isolated upgraded database snapshot only**, record the baseline of current external-review approvals without exposing names, evidence or tokens. Run the following read-only upper-bound inventory before applying 0036/0037:

```sql
SELECT COUNT(DISTINCT (d.org_id,d.id)) AS current_external_approval_documents
  FROM documents d
  JOIN reviews r ON r.org_id=d.org_id
   AND r.project_id=d.project_id
   AND r.document_version_id=d.current_approved_version_id
 WHERE r.method='EXTERNAL' AND r.status='APPROVED'
   AND r.decision='APPROVE';
```

This is an **upper bound**, not proof that all matches are unverified. Migration 0036 defines forced-RLS append-only quarantine records and the tenant-specific procedure. Migration 0037 iterates organisation IDs, explicitly sets the tenant-RLS context, and quarantines any current external approval missing a valid two-person proof. It retains historical review rows and verified storage objects but changes unverified current versions to `CHANGES_REQUESTED` and clears their current approved pointer. Every affected project may lose readiness. Preserve the signed pre/post **counts**, migration checksums, RLS role and restore test logs. Do not remove quarantine records or restore the approved pointer directly.

3. After a positive independent identity/legal check, use separate individually authenticated reviewer sessions for both reviewer operations:

```bash
# From a dedicated restricted reviewer workstation with a verified PG TLS CA:
pnpm --filter @tradecloseout/api review:external -- \
  --org "$ORG_UUID" --grant "$GRANT_UUID" \
  --sha256 "$INDEPENDENT_LEGAL_EVIDENCE_SHA256" --case "$OPAQUE_CASE_REF" \
  --attest-independent-source --attest-legal-delegation --attest-destination

# Separately attest the actual external decision proof and exact document:
pnpm --filter @tradecloseout/api review:external-document -- \
  --org "$ORG_UUID" --version "$DOCUMENT_VERSION_UUID" \
  --proof "$PROOF_VERSION_UUID" --party "$VERIFIED_PARTY_UUID" \
  --sha256 "$STORED_PROOF_SHA256" --case "$OPAQUE_CASE_REF" \
  --attest-independent-source --attest-document-decision --attest-counterparty
```

Each independent reviewer executes their own authorized command. Confirm first reviewer alone is insufficient; the same person/DB identity cannot provide both approvals; a mismatched party/document/version/digest is rejected; issuer, app, worker and migrator cannot sign. For a disputed verified decision, use `review:revoke-external` under incident authorisation; confirm sessions/reviewer proof/revoked current document are invalidated.

**Artifact:** `G01-001-reviewer-iam-redacted.json`, `G01-001-delegation-proof-digests.json`, `G01-001-legacy-migration-before-after.csv`, `G01-001-issuer-self-approval-denied.trace`. Keep raw legal evidence in the protected authority system, never PR attachments or provider logs.

## 3. G01-003/005/006/014/016/017/018/019/020/021: actual HTTPS browser acceptance

**Responsible:** staging SRE, browser QA, security review, test-owner; run Chrome and at least one alternate real browser profile, including mobile as applicable.

1. Verify TLS certificate and HSTS, configured public HTTPS origin, cookie `Secure`/`HttpOnly`/`SameSite`, no shared caching, no token-bearing Referer, trust proxy narrowed to tested CIDRs, no debug OTP or demo persona, and request provenance. Capture redacted HTTP headers and security logs.
2. Internal member with **real provider-delivered** challenge ID + code: verify passwordless login, same-origin browser auth intent, cross-site form/fetch/navigation rejection and drop-response retry. Owner/admin must **not** access privileged reads or writes before TOTP step-up; verify fresh TOTP, replay rejection and recovery code one-use. Test a factor reset using a **fresh proof**, which revokes all devices.
3. In tab A and tab B, switch member/org, log out, and revoke an individual/all devices while the second tab has an in-flight mutation. Confirm every old cookie, CSRF and auth generation is invalid. Clear sessionStorage while retaining a valid HttpOnly cookie, exercise `/auth/session/bootstrap`, confirm foreign origins cannot read it. Try stale, legacy and expired sessions.
4. For G01-005/G22, create a real IndexedDB offline draft, upload first S3 multipart part, interrupt network, switch actor/org, then resume with existing presigned URLs and delayed scanner callbacks. Confirm no further PUT, completion or progress poll commits under a new actor and old drafts remain `BLOCKED_SCOPE` until explicitly resolved. Fixture predicates alone do not pass.
5. Use negative runtime payloads: arrays/objects/null/numbers/oversized Unicode for body, header and URL path; unverified alternate email/phone; invalid grant expiry, stale invitation and forwarded link; encoded, double-encoded, protocol-relative, control and foreign return URLs. Expect controlled 4xx and no tenant effect or dangerous redirect.
6. Test **every** reachable logout control with server failure and timeout; never show success or clear local identity while backend revocation remains unconfirmed. Browser trace must include old-token denial following successful logout.
7. For privacy, inspect Next proxy/CDN, service worker, HAR, CSP, network logs, Sentry/analytics, browser caches and S3/access logs for raw OTP, token, invitation URL and cross-actor cached identity. HMAC pseudonyms are permitted where policy allows; never ship real secrets in traces.

**Artifacts:** production-mode Playwright trace ZIP, sanitized HAR, CORS/HSTS/cookie/CSP header snapshot, screenshots of negative step-up, failed logout, multi-tab actor switch, blocked multipart PUT, revoked-cookie replay and contact-mismatch denial. Redact private identifiers.

## 4. G01-007/009/010/011/013: provider + actual multi-node resilience

**Responsible:** application SRE, provider technical owner, database security and independent QA.

1. Deploy exactly the independently authorized staging build into **two separate API processes/pods** using one shared PG16 and Redis instance, with a separate reverse proxy. Demonstrate two independent node IDs/PIDs in traces; two client Pool objects in one Jest VM are NOT two APIs. Run simultaneous per-IP/contact/grant/global limits and spoofed forwarded headers; force loss of Redis and failed DB budget storage and verify fail-closed authentication.
2. With a **real sandbox provider**, run accepted, explicitly rejected, transport timeout, accepted-but-client-response-lost, duplicate signed callback, bounce and delayed provider response. Persist provider message IDs, link receipt/callback to the exact challenge/delivery generation and test idempotent reconciliation. **Current implementation does not yet provide an independently verified provider receipt callback/reconciliation contract; this is an engineering and provider integration blocker.** Never treat a mere `accepted:true` submission acknowledgement as end-user delivery.
3. Trigger simultaneous internal OTP verify and guest resend/verify on different API processes. Kill one process immediately before DB COMMIT, immediately after COMMIT but before HTTP response, and during provider-send acknowledgement. Replay the same proof and validate exactly one durable session/membership and no resurrection of consumed/superseded challenges.
4. Suspend the user, deactivate the organisation, demote/remove membership and revoke the external grant while requests are in flight. Any post-revocation mutation must fail or serialize and must never silently restore authority.
5. Correlate redacted events, request IDs, database transaction IDs, provider message IDs and failure-injection timestamps. No staging database restart/drill should affect customer data.

**Artifacts:** `G01-007-013-two-node-inventory.json`, `G01-007-budget-race.json`, `G01-009-010-crash-replay.json`, `G01-011-provider-receipts-redacted.json`, and full incident/retry traces.

## 5. G01-008/012/014/015: secrets, recovery and operations

**Responsible:** SRE/KMS, IAM support, security operations.

- Rotate `AUTH_OTP_HMAC_KEY` in isolated staging only after disabling fresh issuance and draining or deliberately invalidating the outstanding OTP challenges (five-minute TTL); document that old outstanding proofs may require reissue, and verify old digests are never accepted under the new key. Rotate MFA encryption key with the already supported bounded previous-key window, review maximum overlap and recovery-code handling. Do not insert old keys into GitHub logs, browser storage or chat.
- Verify strict NODE_ENV=production API and worker fail-fast with missing vars/privileged roles and HTTPS/CA constraints, using named deployment manifests, not only tests. Test failed boot and rollback to a previous reviewed image. Run the approved database restore of a disposable snapshot and confirm migration ledger checksums.
- Define a **separate reviewed human recovery flow** when all MFA codes/devices/verified contacts are lost; no currently implemented auto bypass can be treated as safe recovery. Require independent verified identity, approval separation, notifications/cooldown, all-session revocation and signed case audit. Until implemented/verified, leave G01-014/019/020 open for this scenario.
- Reconstruct complete critical and sampled-denial events through protected retention without raw OTP, bearer, invite or provider payloads. Exercise SIEM alerts for attack spikes, rate-limited event-volume, storage failure diagnostic (capped per replica), suspicious device change, external reviewer approval/revocation and pending invitation cleanup.
- Confirm retention expiry and incident review are not inferred from an append-only table alone. Record restore time, signing identity, observed failed-start code, redacted event counts, notification and alerts.

**Artifacts:** `G01-008-key-rotation.json`, `G01-012-startup-rollback.log`, `G01-014-019-account-recovery-case-redacted.json`, `G01-015-siem-redacted-samples.json`, `G01-021-privacy-audit-checklist.json`.

## 6. Release and dependency control (unexecuted)

**GitHub ancestry / exact dependency:** PR #2 head `7d80d163` is an ancestor of PR #4 head `ecc4be6a` (32 commits ahead, none behind), and PR #4 is an ancestor of PR #5 (compare status ahead; current PR #5 head has additional commits). PR #3 head `f6740339` diverges from PR #5 and affects only three audit-doc paths with no file overlap. All are currently open/unmerged; #2's 11 changed paths and #4's 31 paths are already part of the cumulative PR #5 file history. The independent-reviewable, **not preauthorized** landing plan is #2 → #4 → #5, with #3 reviewed and landed separately as independent documentation. Do not cherry-pick 0021/0022 migrations or partially reapply #4 authority changes. After any authorized merge, inspect new effective base/diff and rerun full CI/RLS/migration/browser evidence on that merge tree before independent sign-off. Owner alone authorizes each merge and deployment.

**Formal result is BLOCKED_EXTERNAL** for every missing executed action above. The implementer only posts `REVIEW_READY G01 <exact-SHA>` with evidence; independent reviewer then examines it. Only owner authorizes merge and deployment, and no row becomes RELEASE_ACCEPTED from a green CI run.
