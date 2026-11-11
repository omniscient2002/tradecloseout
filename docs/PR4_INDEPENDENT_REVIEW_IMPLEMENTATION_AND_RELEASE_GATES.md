# PR4 — evidence integrity and review gates (2026-11-08)

**RELEASE STATUS: BLOCKED / NOT PRODUCTION GRADE.** This is a bounded remediation batch, not a certification that the independent review is complete. It is intentionally a draft stacked on unmerged PR #2.

## Source of truth and missing report

Requested independent review: `docs/TRADECLOSEOUT_PR2_PR3_INDEPENDENT_REVIEW_2026-11-08.md`. That file was **not present on main, PR #2, PR #3 or available attached/library files** when this branch was created. Do **not** claim this PR satisfies every criterion in that unseen report. Compare this branch against it when the report becomes available. The concrete source for this batch is the user's supplied review summary, the [PR3 28-finding audit](https://github.com/omniscient2002/tradecloseout/pull/3), and current PR #2 code.

## What this branch changes

| Review item | Code changes | Negative evidence added | Merge/release status |
|---|---|---|---|
| Supplier dossier access (TC-A01) | All five package and dossier GET routes now demand `package.download`, not `document.read` | Permission guard supplier 403 and metadata test | Verify real HTTP session, all routes, storage URLs, other roles |
| Witness identity (TC-A02) | Only an OTP guest grant with `inspection.witness` + exact project/party + assigned inspection can assert a signed witness; internal contractors record unverified attendance at different endpoint | PostgreSQL internal self-sign denied, wrong party denied, valid party + duplicate sign | Verify legal representative identity/consent/authorisation and real OTP journey |
| External acceptance (TC-A03) | Guest-only active, unexpired, party-bound `package.accept`; rejects invalid decisions; impossible for internal PM to mark other party accepted | PostgreSQL internal/wrong-party/positive recipient decision | Verify real guest OTP/session, jurisdictionally valid acceptance and expiry/revoke races |
| RA bill versus full dossier (TC-A04) | New `0022` purpose migration; full handover/RA bill tagged on generation, legacy RA packs backfilled, latest dossier/submission/closure limited to full; closure verifies current requirement manifest coverage | PostgreSQL accepted RA bill cannot close | Backfill historical exceptions and prove complete generated full PDFs, concurrency |
| CLOSED mutations (TC-A05) | asset create, edit, retire, evidence revalidation share project row lock with close operation; reject CLOSED/purged/inactive lifecycle | PostgreSQL all four writes after CLOSED | Concurrent close vs write race; bulk/non-atomic import and other domains still need review |
| False delivery (TC-A08) | On submission, recipients remain `PENDING_DELIVERY`; event is `SUBMISSION_PREPARED`; no `DISPATCHED` claim | PostgreSQL recipient pending until actual delivery | **Real verified delivery worker/provider receipt NOT implemented**; dispatch/ack journey remains blocked |
| Billing UI fabrication | Show unknown subscription/plan/price/limits/tax/invoice fields as unavailable; API errors do not masquerade as blank success | Code review required; UI coverage still needed | Real GST, tax, subscription and invoices must be validated |
| DB fixture drift | Disposable DB setup rejects mismatched migrator/runtime hosts/ports/names and legacy DB_PORT/DB_HOST/DB_NAME before creating DB | Test requires mismatch to reject before fixture callback | Audit all older fixture helpers and CI runner env |
| Automated charging / tax | Invoice creation and Rule46 issuance default **disabled** unless `ENABLE_TAX_INVOICE_ISSUANCE=true`; webhook still durable intake only (PR #2); warranty/defect endpoints require domain permissions | Requires real sandbox acceptance before enabling | Billing reconciliation, tax/legal signoff, idempotent invoice numbers, payment refunds and provider mapping are NOT DONE |

## Mandatory validation before merge

- [ ] GitHub checks on **this exact commit**: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:security`, and dedicated DB migration validation; inspect Jest failures and iterate.
- [ ] All old tests updated to use authenticated guest principal when asserting external acceptance; contractor witness attendance must not expect signed identity.
- [ ] Migration `0022` applied to populated PG16 baseline; historical RA bill backfill is correct, no new table policy violation, latest package selection is deterministic; rollback and deploy order verified.
- [ ] Real app HTTP security: supplier upload guest 403 for all package/dossier endpoints; authorized recipients/consultants succeed with correct tenant/project.
- [ ] Reject unassigned/mismatched/expired/revoked witness grants and wrong-party recipient grant, even when a user supplies arbitrary JSON party names/IDs. Verify OTP/session and CSRF.
- [ ] Complete checklist, approved evidence and client-reviewed **full** dossier acceptance; narrow RA bill cannot satisfy closeout; accepted full dossier still downloadable via real S3.
- [ ] Race-test close transaction against create/edit/retire/import assets, evidence revalidation and concurrent checklist updates.
- [ ] Genuine mail/SMS outbox and provider receipts before moving from `PENDING_DELIVERY` to `SENT`; report delivery, bounce, retry, dead-letter and audit.
- [ ] Browser coverage for contractor onboarding → checklist → asset → upload → scanner → reviewer → handover → recipient → download → close/reopen (not two demo-login tests).
- [ ] End-to-end real S3 version-pinned object and ClamAV outage, worker restart, long upload, backup PITR restoration and deployment rollback/recovery.
- [ ] Billing release owner explicitly rejects automatic charging until reconciliation and payment state machine are implemented; accountant/lawyer approve correct Indian GST/TDS/e-invoice handling and invoice uniqueness.

## Unresolved register (do not silently close)

The independent review's complete document is unavailable; every finding absent from this PR remains OPEN or UNVERIFIED. At minimum: all PR3 `TC-A06` through `TC-A28` not specifically addressed above; live payment reconciliation, verified delivery integration, browser HVAC journey, object storage/scanner integration, deploy/backup restoration, tax compliance, external signatory proof and multi-instance robustness. The P0 controls in this PR also require CI plus independent abuse testing and should not be treated as fixed merely because code was changed.

**Definition of done for the overall product, not for this batch:** each finding linked to a tested change or explicit formal risk decision; all P0/high release gates demonstrated on staging with real services and evidence from independent reviewers. Do not merge this draft as if it were permission to launch.
