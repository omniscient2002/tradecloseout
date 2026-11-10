# G01 acceptance gate

Tracking: https://github.com/omniscient2002/tradecloseout/issues/6
Implementation: https://github.com/omniscient2002/tradecloseout/pull/5

**NO-GO.** Original G01-001 through G01-021 and additional G01-R1 through G01-R7
are recorded individually in findings.json. Original source controls may be
implemented while external acceptance remains blocked. The current register makes
no fabricated verification or production acceptance claims.

## Immediate source tasks

The five supplemental tasks below now have **independent scoped source acceptance**
at `4f8a7bb183e892ee4626d9116c00a34dc097f76c`. They are retained as the original
task/verification record. See [the independent acceptance](independent-review-4f8a7bb.md)
and raw evidence for what was actually checked. This does not close the original
21 findings, certify production behavior or authorize merging the application PR.

1. R1: Reject missing session cookie before acquiring the org-switch PG client;
   guarantee release on every post-acquisition failure. Prove repeated valid
   bearer-only requests cannot exhaust the pool and normal switching still rotates.
2. R2: Validate targetOrgId as a string UUID at runtime. HTTP singleton arrays,
   objects, numbers and invalid strings must return stable 4xx before database use.
3. R3: Persist bounded, redacted MFA/recovery/session-denial events with reason and
   trusted request metadata. Verify denied authentication rollback preserves events
   while never retaining OTPs, raw tokens, invitation URLs or provider secrets.
4. R4: Give the worker explicit runtime mode/config and actual restricted-role
   validation; missing/unsafe production configuration must fail before scheduled work.
5. R5: Implement supported magic-link/verified fallback recovery or explicitly
   remove unsupported authentication promises from the current API/security contract.

Each task starts with reproduction against the latest head. Static findings may
be disputed with concrete evidence. The source report is preserved alongside this file.

## New source tasks from independent b45f0b5 review

R1–R5 scoped acceptance is preserved. [The b45f0b5 re-review](independent-review-b45f0b5.md)
reproduced two additional defects with raw evidence in `docs/evidence/g01-recheck-b45f0b5/`:

6. R6 (P2): make MFA session/user/recovery locking consistent; deterministic real-PG
   start/confirm overlap currently aborts with `40P01`. Keep revocation fencing and atomicity.
7. R7 (P2): use canonical safe request IDs in the exception filter as well as the
   guard. Credential-shaped ASCII headers currently reach auth logs and error responses.

The original 21-row candidate matrix also acknowledges unfinished delivery receipt/retry
reconciliation, lost-all-factor recovery, route/event inventories and complete validation
and resilience acceptance. These engineering tasks are distinct from missing real provider,
legal authority, staging TLS/S3, IAM and monitoring evidence. No original row is release-closed.

## Engineering evidence

Require exact head/base/merge SHAs and runtime versions; typecheck/build/workspace,
negative security/RLS and RBAC results; applied migration ledger with fresh and
upgrade-path evidence; relevant real HTTP and application-browser regressions.
Separate the test-only debug-OTP browser path from strict production/staging API
OTP issuance, MFA enforcement, HTTPS cookies and recovery.

CI associated with baseline 0b1523e passed as reported in the independent review.
That is historical fixture/integration evidence, not fresh verification of a later head.

## External release evidence (still blocked)

- Independently obtained legal signatory/contact/delegation evidence, separately
  authenticated reviewer IAM, legitimate guest approval and issuer self-approval negatives.
- Deployed HTTPS/proxy/browser MFA, guest/invited-member login, storage loss,
  account/tenant switching, offline IndexedDB and interrupted multipart upload fencing.
- Real SMS/email sandbox acknowledgement, receipt, accepted-but-timeout, duplicate,
  bounce, resend and reconciliation. A programmable fixture is not provider acceptance.
- At least two actual API instances with shared PG/Redis and commit abort, crash,
  response-loss, replay and rate-budget/proxy-spoofing tests.
- Credential/key rotation, lost-destination/factor/device recovery, monitoring,
  immutable history, privacy/cache/access-log/analytics inspection and restore rehearsal.
- Independent evidence review and explicit user acceptance of every original row
  at the final release SHA. Dependencies in stacked PRs #2–#4 remain independently reviewable.

No release gate is waived by a successful code review, JSON validator or green CI.
