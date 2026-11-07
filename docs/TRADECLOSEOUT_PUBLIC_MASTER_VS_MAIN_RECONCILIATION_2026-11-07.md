# Pasted public-master review versus current main — 2026-11-07

## Resolution — 2026-11-08

GitHub's default branch was changed to **main** with the repository owner's authorization. Both GitHub repository metadata and `git ls-remote --symref` were checked afterward: remote HEAD points to `refs/heads/main`, at application commit `2b1cf2c76727d711576fec6ce83fb6d1ce69d941`. The older master branch was preserved at `714ac6cf471f4c217e9150e200da401d4b4bf3ec`; no history was rewritten. CI already targets main. New audits should identify the exact commit and use main; explicit old master URLs still show historical code.

The sections below preserve the investigation as recorded before that settings change. Their statements that master is the default describe the earlier state, not the current repository configuration.

## Version identity verified directly

`git ls-remote --symref https://github.com/omniscient2002/tradecloseout.git HEAD refs/heads/main refs/heads/master` returned:

```
ref: refs/heads/master HEAD
714ac6cf471f4c217e9150e200da401d4b4bf3ec HEAD
2b1cf2c76727d711576fec6ce83fb6d1ce69d941 refs/heads/main
714ac6cf471f4c217e9150e200da401d4b4bf3ec refs/heads/master
```

The local branch is `main`, HEAD `2b1cf2c76727d711576fec6ce83fb6d1ce69d941`, with a clean working tree at inspection start. Public main already contains the newer implementation. Public master is older and remains GitHub's default. This is not merely an unpushed-local-fix problem. Read-only remote inspection was performed; neither remote branch nor repository settings was changed.

The old master identity module was independently inspected with `git show 714ac6c:apps/api/src/modules/identity/identity.module.ts`: its SMS method returns delivered=true without a provider, and its email implementation is empty. This confirms that at least that prominent pasted finding genuinely describes the old code. This pass did not reproduce every exploit claimed against master.

## Current main dispositions

| Pasted finding | Current main source result |
|---|---|
| Unconditional OTP delivery stub | Replaced by HTTP gateway calls; staging/production cannot use the test/development loopback. Provider acknowledgement semantics, real delivery acceptance and fail-fast production configuration remain separate work. |
| Request-controlled review override bypass | DecisionDto no longer exposes isOverride; self-approval is rejected; generic override returns Gone. Runtime schema coverage still needs the broader review's acceptance. |
| Logout wrong session column and swallowed failure | Uses token_hash and awaits the revocation query without a catch that suppresses it. Full logout/token-reuse HTTP acceptance was not newly executed here. |
| Completion declares READY without scanning | Completion locks the version, finalizes storage, moves to PROCESSING and emits scan work. Worker checks current immutable receipt and transitions to READY. |
| Scanner connection refusal accepted as clean | Socket errors carry scanUnavailable, and verification throws SCAN_UNAVAILABLE. A false infected flag alone is not the resulting readiness decision. |
| Fabricated PDF when original missing | Stream fetches pinned storage bytes; there is no synthetic replacement generation in this route. |
| Secondary auth identifier substitution | The cited auth module is absent. Current identity verification takes the successful identifier from challenge verification. This is a source disposition, not a fresh full A-to-B login exploit test. |
| Duplicate auth controllers | Current AppModule registers IdentityModule; the cited separate AuthModule/AuthController is absent from source. |
| Unsigned fabricated S3 URLs | DocumentsModule registers S3StorageService; it uses AWS SDK presigning and immutable provider versions. |
| Completing twice increments quota twice | Completion handles already PROCESSING/READY versions; quota accounting occurs on the guarded worker READY transition. Broader quota/delete/restore races remain subject to tests. |
| Razorpay accepts unverified events | Public handler checks configured secret/signature and ultimately returns unavailable even after HMAC success. Full raw-body verification and durable payment ingestion remain unimplemented; do not call payments complete. |
| CI wrong branch and pnpm version | pnpm is now 12.4.1 in both manifest/workflow. Branch mismatch remains: workflow watches main, repository default is master. |
| OTP code application logging | No console/logger calls found in current identity source. Gateway request bodies necessarily contain OTPs and require secret-safe provider logging. |
| Raw session token returned in JSON | Omitted in staging/production; still returned in development/test. A blanket statement that production returns it is inaccurate for main. |
| Invoice validation/calculation divergence | Still relevant: separate invoice command implementations, inline input contracts and provider-capability behavior require the earlier billing remediation. |

Sources inspected: identity module/controller, AppModule, review service/DTO/controller, documents service/module/storage adapter, worker main/file processor, billing handler/controller and deploy workflow. Findings are source-level unless the checks below establish more. No fresh real-provider delivery/payment acceptance was run.

## Targeted regressions

Executed against main:

```
pnpm --filter @tradecloseout/api exec jest --runInBand \
  test/phase0-evidence-integrity-remediation.spec.ts \
  test/review-authority-boundaries.spec.ts \
  test/modules/auth-iam.spec.ts \
  test/modules/documents-reviews.spec.ts
```

**Result: 4 suites passed, 41 tests passed.** These include service/mock regression coverage and a scanner-outage fixture. They are not a new full HTTP/provider acceptance certification of every row above. No complete root suite was rerun for this reconciliation.

## Next action

Choose one canonical protected release branch and align repository default, PR target, CI, deployment source and documentation. Because the newer source already exists on public main, changing GitHub's default to main is a plausible option; if master remains canonical, integrate reviewed main changes through the normal PR process instead. Verify branch protection and passing checks on the chosen exact commit. This review does not authorize an automatic merge, force push or settings change.

Request subsequent reviews by immutable commit SHA, not “current source” or date alone. The broader production and PDF/viewer reports describe earlier working-tree snapshots; commit 2b1cf2c contains further changes, so their individual findings need rechecking before being called current. This reconciliation neither closes all those findings nor reopens fixed historical cases.
