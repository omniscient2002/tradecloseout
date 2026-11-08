# TradeCloseout production-readiness audit — source-pinned register

- **As-of date:** 2026-11-08 (Asia/Kolkata)
- **Repository:** https://github.com/omniscient2002/tradecloseout
- **Audited main SHA:** `2449d52f5a6f9ed266b98f1c9526a8d29320ba6e`
- **PR #2:** https://github.com/omniscient2002/tradecloseout/pull/2 — `7d80d16325864f5bc4fc1eb2f872d6ff02013462`, **draft/open/unmerged**
- **Main CI:** https://github.com/omniscient2002/tradecloseout/actions/runs/42425867209 — success; **PR #2 CI:** https://github.com/omniscient2002/tradecloseout/actions/runs/42422412722 — success.
- **Decision:** NO-GO for external production charging or formal closeout/recipient acceptance.

## Scope, methodology and limitations

Connected GitHub plugin review of current repository metadata, complete tree (380 tracked blobs), current CI history and PR #2 metadata/patch. Targeted end-to-end manual source tracing of handover/closeout/readiness, parties/guest auth, permissions, warranty/defects, review, checkout/webhook, imports and RLS, notifications/worker/PDF/archives, web offline flows and Terraform. Every API source file (68), web app source file (45) and worker/shared/db/pdf TypeScript file (30) was retrieved for broad automated text-pattern inspection; 21 SQL migrations were scanned for lifecycle triggers and RLS. Detailed human review was focused on high-risk flows; **this is not a formal proof that every branch of every file is safe**. The audit did **not** execute a fresh local PostgreSQL, browser, S3, ClamAV or payment-provider test suite. Passing GitHub CI is reported as external evidence only. A source-confirmed gap is **not** a runtime exploit reproduction unless stated. Severity is release priority; verify findings with the listed executable tests before asserting exploitability.

## Findings

### TC-A01 — Critical: Supplier-upload guests can request full dossier downloads

**Domain:** Authorization / confidentiality. **Evidence:** [handover.controller.ts:71-89](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.controller.ts#L71-L89); [parties.service.ts:34-45](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/parties/parties.service.ts#L34-L45); [handover.service.ts:765-804](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L765-L804).

**Observation:** A project guest granted document.read but not package.download can reach the version-pinned project package URL because the endpoint checks document.read, not package.download. This exceeds supplier upload scope within the granted project.

**Remediation:** Require package.download on package artifact/list/detail routes; add explicit package/distribution authorization and grant-level document-visibility filtering; extend tests to PR #2 dossier endpoint.

**Required negative/acceptance test:** Create SUPPLIER_UPLOAD guest for Project A with document.read only; GET a READY dossier URL for A must return 403; client/MC guest with package.download succeeds.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A02 — Critical: Internal uploader can mark a witness as authenticated for arbitrary party

**Domain:** Evidence / attestation. **Evidence:** [commissioning.controller.ts:48-58](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/commissioning/commissioning.controller.ts#L48-L58); [commissioning.service.ts:385-463](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/commissioning/commissioning.service.ts#L385-L463).

**Observation:** The witness handler only verifies supplied partyId exists in org, then sets isVerified=true, AUTHENTICATED_ATTESTATION and signedByUserId=calling user. No proof the caller represents that party or witnessed the inspection. Runtime request bodies can include partyId despite controller TypeScript DTO omitting it.

**Remediation:** Separate attendance recorded by employee from independent attestation; bind authenticated external principal to an appointed party, exact inspection revision and one-time challenge, then cryptographically or auditably countersign.

**Required negative/acceptance test:** Uploader submits partyId of unrelated client/consultant; must be rejected or recorded UNVERIFIED, never authenticated.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A03 — Critical: Internal package acceptor can decide on behalf of any recipient party

**Domain:** Recipient acceptance / closure. **Evidence:** [handover.service.ts:341-460](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L341-L460); [permissions.ts:32-41](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/packages/shared/src/permissions.ts#L32-L41); [projects.service.ts:365-425](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L365-L425).

**Observation:** Only guest actors are tied to matching grant_party_id. For authenticated internal project users holding package.accept (including PM), recipient record selection does not prove authority to speak for the selected external party; those decisions feed ACCEPTED package and project-close conditions.

**Remediation:** Require verifiable recipient identity/delegation for self-acceptance; distinguish internal recording of externally signed proof, requiring verification, review/audit, and original evidence from true recipient acceptance.

**Required negative/acceptance test:** PM attempts acceptance for an external client party without delegation; deny. Client credential/grant for matching party accepts; other parties denied.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A04 — Critical: Partial RA-bill annexure uses same full-handover package state and can be accepted for close

**Domain:** Project acceptance / artifact scope. **Evidence:** [handover.service.ts:545-705](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L545-L705); [handover.service.ts:850-910](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L850-L910); [projects.service.ts:367-422](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L367-L422).

**Observation:** Milestone-filtered RA pack is persisted in handover_packages with no distinct purpose discriminant; createSubmission accepts latest READY regardless of full vs partial; closeProject checks accepted latest package and live readiness but does not compare accepted package manifest coverage to all current contractual requirements. Conditional on readiness becoming complete, partial artifact can satisfy final-package predicate.

**Remediation:** Introduce immutable package_purpose FULL_HANDOVER/RA_BILL, scope fingerprint, coverage manifest, server-side purpose checks in submit/accept/close, and scope-specific recipient requirements.

**Required negative/acceptance test:** All project obligations ready; generate narrow RA pack as latest, get recipients to accept; attempt CLOSE must reject unless full-hand-over package accepted.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A05 — High: Assets mutate after CLOSED and race closure

**Domain:** Lifecycle / concurrency. **Evidence:** [assets.service.ts:43-118](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/assets/assets.service.ts#L43-L118); [assets.service.ts:150-185](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/assets/assets.service.ts#L150-L185); [assets.service.ts:233-258](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/assets/assets.service.ts#L233-L258); [checklists.service.ts:44-70](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/checklists/checklists.service.ts#L44-L70).

**Observation:** Checklist writer locks the project and rejects CLOSED; asset create, update, retire flows do not enforce project state or share closure project lock. A closed dossier can therefore differ from the later asset register without formal reopen.

**Remediation:** Centralize project lifecycle lock + mutation policy for all project-bound writers. Explicitly permit only designated post-close warranty/defect aftercare under amendment records.

**Required negative/acceptance test:** CLOSED project: create asset, edit serial, retire asset all reject or generate formal postclose amendment; parallel close versus edit serialized.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A06 — High: Any evidence uploader can create warranty events that change asset coverage

**Domain:** Authorization / warranty. **Evidence:** [billing.controller.ts:81-100](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/billing.controller.ts#L81-L100); [warranty-and-billing.service.ts:20-122](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/warranty-and-billing.service.ts#L20-L122).

**Observation:** Endpoint uses document.upload rather than warranty.manage. It accepts optional evidenceObjectId without verifying proof, and non-conflicting REGISTRATION/CONFIRMATION or EXTENSION updates real asset warranty dates.

**Remediation:** Require warranty.manage plus approved verified OEM registration/proof bound to asset and authorized contracting party; maintain original event chronology and adjudication for disputes.

**Required negative/acceptance test:** R-SITE or supplier document uploader sends aligned-basis EXTENSION with omitted proof; no date change allowed, 403/422.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A07 — High: Defect closure and remedy authorized by document.upload instead of independent defect authority

**Domain:** Authorization / defects. **Evidence:** [billing.controller.ts:123-174](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/billing.controller.ts#L123-L174); [warranty-and-billing.service.ts:275-418](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/warranty-and-billing.service.ts#L275-L418).

**Observation:** Defect creation, remedy and closure routes require document.upload, not defect.manage. Service has evidence and separation-of-duties checks, but domain authority is not enforced for all callers.

**Remediation:** Require defect.manage plus separate defect.verifier or project QC appointed authority for closure; prevent supplier/field uploader signing independent verification.

**Required negative/acceptance test:** R-DOC user with document.upload but without defect.manage must be denied closing defect; authorized independent QC verifies READY proof.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A08 — High: Submission says SENT/DISPATCHED without actual delivery

**Domain:** Customer communications. **Evidence:** [handover.service.ts:869-908](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L869-L908); [main.ts:433-462](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/main.ts#L433-L462); [notifications.service.ts:21-65](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/notifications/notifications.service.ts#L21-L65).

**Observation:** submission_recipients.status is immediately SENT and SUBMISSION_DISPATCHED emitted as an informational outbox event. Worker only logs informational events; no recipient notification/provider dispatch is established by this workflow.

**Remediation:** Separate CREATED, DELIVERY_QUEUED, SENT/DELIVERED/FAILED; queue outbox delivery for each recipient with verified routing and provider acknowledgements, retries and receipts.

**Required negative/acceptance test:** Submit package with real recipient in isolated provider fake; it remains QUEUED until acknowledged; failed provider never appears SENT.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A09 — High: Accepted handover PDF download rejected on main

**Domain:** Artifact usability. **Evidence:** [handover.service.ts:765-799](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L765-L799); [handover.service.ts:499-528](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L499-L528).

**Observation:** Download handler only permits package.status=READY, but acceptance updates package.status=ACCEPTED. The same immutable PDF becomes inaccessible after acceptance.

**Remediation:** Allow valid accepted/submitted states with unchanged verified object checks; PR #2 proposes this but is unmerged. Preserve exact package scope.

**Required negative/acceptance test:** Generate, accept, then download and verify SHA256/version; expected 200/signed URL not conflict.

**Verification status:** Confirmed on main; patch proposed in unmerged PR #2.

### TC-A10 — High: Razorpay callback is explicitly disabled for fulfillment

**Domain:** Billing / payments. **Evidence:** [billing.service.ts:183-217](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/billing.service.ts#L183-L217).

**Observation:** Main verifies signature but returns 503 processing unavailable. PR #2 adds durable signed receipt inbox but explicitly leaves subscriptions, invoices and entitlements unreconciled.

**Remediation:** Implement trusted provider-reference reconciliation with idempotent ledger and account mapping; financial review and sandbox payments/refunds/out-of-order events before production charging.

**Required negative/acceptance test:** Valid webhook persisted, duplicate idempotent, invalid HMAC denied; reconcile payment into one authorized invoice/subscription transaction.

**Verification status:** Main disabled; PR #2 partially implements inbox only.

### TC-A11 — High: Environment schema incompatible with services and not applied at boot

**Domain:** Runtime configuration. **Evidence:** [env.ts:1-51](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/packages/shared/src/env.ts#L1-L51); [s3-storage.service.ts:20-36](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/documents/s3-storage.service.ts#L20-L36); [handover-package.processor.ts:257-263](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/queues/handover-package.processor.ts#L257-L263); [tenant-db.service.ts:20-43](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/database/tenant-db.service.ts#L20-L43).

**Observation:** Shared validator defines S3_PRIVATE_BUCKET, S3_ACCESS_KEY_ID and DLT_SMS_PROVIDER_URL while runtime expects S3_BUCKET, S3_ACCESS_KEY and DLT_SMS_URL. Main/worker do not call the declared validator; fallback database credentials still exist.

**Remediation:** Unify one validated env schema and mappings; fail closed on every required production dependency and secret; runtime health checks for storage, scanner, Redis, email.

**Required negative/acceptance test:** Start prod-mode with schema-only variable names or absent app DB; process must fail boot with useful sanitized configuration error.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A12 — High: CI workflow does not deploy a real product or run live browser acceptance

**Domain:** Deployment / operations. **Evidence:** [deploy.yml:1-93](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/.github/workflows/deploy.yml#L1-L93); [playwright.config.ts:1-16](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/playwright.config.ts#L1-L16); [package.json:1-17](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/package.json#L1-L17).

**Observation:** Named CI/CD job builds/tests with PostgreSQL and Redis but has no staging deployment, live e2e, app provisioning, rollback, backup restore, or release smoke. Web root test selects archive-browser, not the live application project.

**Remediation:** Add immutable images, staging environment with API/web/worker/ClamAV/S3, pnpm test:e2e, signed artifact promotion, rollback drill, monitored SLO and database/storage recovery.

**Required negative/acceptance test:** From clean CI, deploy to staging, run OTP/upload/scan/review/package/accept/close across roles; inject provider failures and restore backup.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A13 — High: External approval can cite unrelated verified project file as proof

**Domain:** Review authority. **Evidence:** [reviews.service.ts:836-1003](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/reviews/reviews.service.ts#L836-L1003).

**Observation:** An assigned externalPartyId and any verified READY document version in the same project can satisfy proofVersionId/evidenceObjectId; there is no demonstrated requirement that proof is an authentic acceptance document for this approver/decision/version.

**Remediation:** Constrain proof type, exact target version and external signatory/delegation; require human external-proof review, immutable record and two-person verification where needed.

**Required negative/acceptance test:** Upload unrelated READY drawing/report as proof for external approval; reject even though object integrity is sound.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A14 — High: NOT_APPLICABLE waiver countersign sets WAIVED regardless of requested type

**Domain:** Domain workflow. **Evidence:** [checklists.controller.ts:98-120](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/checklists/checklists.controller.ts#L98-L120); [checklists.service.ts:654-762](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/checklists/checklists.service.ts#L654-L762).

**Observation:** Public requestWaiver creates PENDING_SECOND_APPROVAL for NOT_APPLICABLE; countersignWaiver does not branch on waiver.type and always changes requirement.status to WAIVED. It also lacks closed-project mutation lock.

**Remediation:** Carry type through verified second-authority workflow, bind to current semantic requirement revision, enforce lifecycle lock, and distinguish optional NA vs mandatory waiver policy.

**Required negative/acceptance test:** Request NOT_APPLICABLE then countersign: final waiver/requirement statuses align; after close request denied.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A15 — High: Invoice logic assumes tax/exemption and uses race-prone invoice number

**Domain:** Commercial / tax. **Evidence:** [billing.service.ts:82-133](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/billing.service.ts#L82-L133).

**Observation:** Main computes 18% GST regardless of recorded configuration, ignores computed isInterState branch, uses count plus random suffix for invoice numbers, and prints a hard-coded e-invoice exemption claim. These cannot be called legally or operationally production ready.

**Remediation:** Ledger-backed tenant tax policy and validated buyer/place of supply; issued invoice counter with serialized unique sequence; statutory signoff and reversal/credit note workflow; avoid unverified legal assertions.

**Required negative/acceptance test:** Interstate vs intrastate, exempt/taxable customer cases, 100 concurrent invoices, e-invoice eligibility and numbering tests; CA signoff.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A16 — High: Hard-coded catalog tiers and quotas not linked to verified subscription

**Domain:** Billing / entitlements. **Evidence:** [billing.service.ts:16-57](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/billing/billing.service.ts#L16-L57); [projects.service.ts:928-950](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L928-L950); [handover.service.ts:120-158](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L120-L158).

**Observation:** Current public plans are hard-coded amounts; main has quota fallbacks and a fixed package quota rather than one canonical live entitlement model. PR #2 replaces plan catalog but does not complete reconciliation.

**Remediation:** Introduce one subscription+plan+usage policy service; explicit trial/no-subscription; atomic quotas and effective date; handle suspension/grace periods.

**Required negative/acceptance test:** Plan price, package usage, active-project count, trial expiry and payment failure enforced consistently across API and UI.

**Verification status:** Public-plan catalog patch proposed in unmerged PR #2.

### TC-A17 — High: Command mutation can commit before durable response receipt is persisted

**Domain:** Reliability / idempotency. **Evidence:** [idempotency.interceptor.ts:92-181](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/common/interceptors/idempotency.interceptor.ts#L92-L181).

**Observation:** Interceptor claims key, then business transaction may commit, then asynchronously persists response receipt in distinct transaction. Crash in that window leaves response_status=0 with no generic authoritative reconciliation. Avoid retrying blindly.

**Remediation:** Transactional domain command outcomes, receipt-linked operation IDs, recovery/status lookup endpoint and crash injection; idempotent state machine per external side effect.

**Required negative/acceptance test:** Kill process after business commit before response receipt; retry same key must resolve exactly one durable outcome rather than indefinitely REQUEST_IN_PROGRESS.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A18 — High: Offline uploads have incomplete lease, URL refresh, and account-transition protection

**Domain:** Offline field workflow. **Evidence:** [offline-upload-queue.ts:137-343](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/src/lib/offline-upload-queue.ts#L137-L343).

**Observation:** IndexedDB persists file blobs, upload intent and multipart URLs; no demonstrated exclusive multi-tab queue lease or guaranteed expiry refresh; actor partition is checked at loop start rather than after every await. Critical in shared/mobile field use.

**Remediation:** Web Lock or equivalent lease, actor recheck at each network boundary, refresh expired signed part URLs, reconciliation of PROCESSING state, wipe/export policy for shared devices.

**Required negative/acceptance test:** Network loss, expired presigned URLs, two browser tabs, switch org during multipart, repeated drain, browser restart, logout with queued files.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A19 — High: Several public decision routes allow missing If-Match revision

**Domain:** Reviews / optimistic concurrency. **Evidence:** [reviews.controller.ts:45-128](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/reviews/reviews.controller.ts#L45-L128); [reviews.service.ts:550-608](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/reviews/reviews.service.ts#L550-L608).

**Observation:** Controller falls back to optional dto.expectedRowVersion; the decideReview service only enforces row version when supplied. A stale reviewer may decide after intervening changes not reflected in their screen.

**Remediation:** Require If-Match on all review mutation aliases and on relevant underlying obligation/evidence revision; consolidate decision policy implementation.

**Required negative/acceptance test:** Open review at row_version N, another actor edits target, submit decision without/with stale header: 428/412, no effects.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A20 — Medium: Close/reopen revision preconditions are not enforced end-to-end

**Domain:** Project lifecycle API. **Evidence:** [projects.controller.ts:88-110](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.controller.ts#L88-L110); [projects.service.ts:315-340](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L315-L340); [projects.service.ts:456-508](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L456-L508).

**Observation:** closeProject controller passes expectedRowVersion=undefined; reopenProject receives an expected version but does not compare it to row_version. Project transitions are locked, which helps, but user-client staleness is not detected.

**Remediation:** Require If-Match/expectedRowVersion and same revision in transition SQL, reject stale edits; test closure and reopen from stale tabs.

**Required negative/acceptance test:** Close from stale project view and reopen wrong version must fail without state transition.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A21 — Medium: Dot in permitted asset tag interpreted as regex wildcard

**Domain:** Asset / matching. **Evidence:** [validators.ts:53-59](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/packages/shared/src/validators.ts#L53-L59); [assets.service.ts:1069-1123](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/assets/assets.service.ts#L1069-L1123).

**Observation:** AssetTagSchema permits dot; candidate matching builds RegExp from unescaped upperTag. Tag AHU.1 produces high-confidence match for AHU-1 despite different identifier.

**Remediation:** Escape all regex metacharacters or use exact boundary-aware string comparison; normalize once and test case-insensitive namespace.

**Required negative/acceptance test:** Tags AHU.1, AHU-1 and AHU_1 must not cross-match as EXACT_TAG.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A22 — Medium: Demo personas and hard-coded OTP fallback remain in customer-facing UI

**Domain:** Web / onboarding. **Evidence:** [page.tsx:8-57](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/src/app/(public)/login/page.tsx#L8-L57); [login-switch-user-modal.tsx:88-116](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/src/components/modals/login-switch-user-modal.tsx#L88-L116); [layout.tsx:103-119](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/src/app/(contractor)/layout.tsx#L103-L119).

**Observation:** Public login presents seeded names, identifiers and fake tenant data. Persona switcher automatically verifies debug OTP or literal 123456; normal production OTP path will fail.

**Remediation:** Isolate demo UX to explicit internal test environment, remove seeded identities and shortcuts from production bundle, use legitimate email/SMS entry.

**Required negative/acceptance test:** Production build renders no personas or debug OTP; real OTP verification succeeds from normal UX.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A23 — Medium: Several visible features intentionally throw 410 Gone

**Domain:** Domain scope. **Evidence:** [documents.service.ts:1106-1142](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/documents/documents.service.ts#L1106-L1142); [documents.service.ts:1350-1371](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/documents/documents.service.ts#L1350-L1371); [digital-signature.service.ts:31-122](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/signatures/digital-signature.service.ts#L31-L122); [handover.service.ts:911-927](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/handover/handover.service.ts#L911-L927).

**Observation:** Bulk import, transmittal stamp-back, local digital signing, and main dossier/pdf route are disabled instead of finished. PR #2 proposes a verified dossier redirect but not the other features.

**Remediation:** Clearly remove/disable corresponding UI claims or implement each with real provider acceptance, evidence integrity and predictable errors.

**Required negative/acceptance test:** Feature matrix: every visible button has working route or transparent disabled state with no fake success.

**Verification status:** Dossier route patch proposed in unmerged PR #2; others remain deferred.

### TC-A24 — Medium: Public health is DB-only and can disclose raw dependency errors

**Domain:** Monitoring / readiness. **Evidence:** [health.controller.ts:1-42](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/health/health.controller.ts#L1-L42).

**Observation:** GET /health executes SELECT 1 and reports static version. It does not verify Redis, worker heartbeat, scanner or storage and may expose internal exception message.

**Remediation:** Separate liveness/readiness checks with safe external errors; validate critical dependencies and worker event lag; instrument logs, traces, queue dead letters and alerts.

**Required negative/acceptance test:** Kill Redis, scanner and worker independently; readiness must fail or expose degraded appropriate internal status.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A25 — Medium: Archive verifier explicitly does not authenticate issuer

**Domain:** Evidence authenticity. **Evidence:** [archive-verifier.ts:1-59](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/queues/archive-verifier.ts#L1-L59); [portable-archive.processor.ts:20-151](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/queues/portable-archive.processor.ts#L20-L151).

**Observation:** Portable archives have strong hash/size checks but the included HTML verifier explains digest consistency alone cannot prove signer/issuer authenticity or whole-archive replacement. Avoid representing it as a signed regulatory receipt.

**Remediation:** Provide separately anchored signed manifest receipt and public-key verification when authenticity is a contract requirement.

**Required negative/acceptance test:** Tamper with archive and regenerate manifest+verifier; offline verifier may pass, trusted separate signed receipt must fail.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A26 — Medium: Outbox and queued messages can require manual recovery after bounded failures

**Domain:** Worker / operations. **Evidence:** [main.ts:414-471](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/main.ts#L414-L471); [scheduler.ts:410-468](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/worker/src/scheduler.ts#L410-L468).

**Observation:** Outbox jobs stop automatically attempting after 5 failed dispatches; notification dispatcher reconsiders eligible QUEUED rows but lacks visible persisted error attempts/next retry or operator resolution path in reviewed functions.

**Remediation:** Dead-letter and operator re-drive with failure metadata; exponential schedule, alerting, stable provider idempotency and tenant-balanced dispatch; do not claim success on enqueue only.

**Required negative/acceptance test:** Poison event and unavailable gateway; later healthy events still process; expired failures visible and safely re-driveable.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A27 — Medium: Raw test fixtures and seed tooling need production isolation

**Domain:** Data / governance. **Evidence:** [seed-real-portfolio.ts:61-110](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/packages/db/src/seed-real-portfolio.ts#L61-L110); [seed-vayuputra-story.ts:865-882](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/packages/db/src/seed-vayuputra-story.ts#L865-L882); [page.tsx:5-38](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/web/src/app/(public)/login/page.tsx#L5-L38).

**Observation:** Rich demo companies, credentials, plans and tenant data are in scripts and referenced in the login UI; seed scripts can create/update active users, identities and subscription state if run against a live DB.

**Remediation:** Make seed tooling refuse production DB, separate test-only credentials and use isolated disposable environments; forbid seed in release IAM/pipeline.

**Required negative/acceptance test:** NODE_ENV=production seed command refuses without touching data, even when DATABASE_URL points to a production-format DSN.

**Verification status:** Confirmed by source; runtime reproduction pending.

### TC-A28 — Medium: Checklist/asset/project mutation flows lack unified immutable revision trail

**Domain:** Product consistency. **Evidence:** [projects.service.ts:704-793](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/projects/projects.service.ts#L704-L793); [assets.service.ts:233-429](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/assets/assets.service.ts#L233-L429); [checklists.service.ts:118-392](https://github.com/omniscient2002/tradecloseout/blob/2449d52f5a6f9ed266b98f1c9526a8d29320ba6e/apps/api/src/modules/checklists/checklists.service.ts#L118-L392).

**Observation:** Checklist snapshot revisions are detailed, but asset PATCH does not require expected row version; contracts/variations may be created as directly approved. The complete commercial/asset history may diverge from accepted package source metadata.

**Remediation:** Unify event/audit receipts, expected versions and independently authorized approval transitions; check signed document/evidence binding after changes.

**Required negative/acceptance test:** Parallel asset edits result in one 412; contract variation requires appropriate approval; accepted evidence scope changes invalidate package or require amendment.

**Verification status:** Confirmed by source; runtime reproduction pending.

## Previously repaired or positive controls

- Latest merged checklist flows now take a shared project lock before reading and applying the baseline, reject empty invented checklists, and supersede waivers for substantive requirement changes. Do not re-report the PR #1 defects as unfixed on main.
- Project close reads current readiness in its transaction and requires acceptance by all required recipients on latest version and current snapshot. This reduces stale-acceptance bugs, but **does not** distinguish RA bill purpose or prove recipient identity.
- Worker PDF and archive paths verify object metadata, immutable storage versions, byte sizes and SHA-256 before exposing READY results. These are valuable controls, not a substitute for authorization or recipient acceptance.
- Seasonal schedule controller now exposes update routes and service rejects performed/completed without nonempty results, correcting an earlier historical report; structured engineering-quality validation of results remains advisable.
- PR #2 adds approved-template consumption, webhook receipts, accepted dossier downloads and plan-row pricing. These are **not on main**, and PR #2 explicitly does **not** fulfill paid subscriptions.

## Prioritized release sequence

1. **Authorization and legal-evidence integrity:** Fix A01–A04, A06–A08 and A13 before any real client/supplier use. Add real recipient/guest negative tests at HTTP and PostgreSQL boundaries.
2. **Lifecycle and deterministic closure:** Fix A05, A09, A14, A19–A20 and A28. Prove all checklist, asset, warranty, contract and package writers honor close/reopen and concurrent amendments.
3. **Payment/commercial truth:** Ship only truthful manual pilot billing unless A10, A15–A16 are implemented, audited and sandbox-verified. PR #2 ledger receipt alone is not charging readiness.
4. **Operational resilience:** Fix A11–A12, A17–A18 and A24–A27. Enforce production config, isolated staging E2E, real storage/scanner/delivery tests, recovery/restore tests, dead-letter handling and observability.
5. **UX and scope parity:** Fix A21–A23 plus every visible unfinished action. Keep demo/seeding isolated; publish an honest enabled-features matrix.

### Mandatory go-live acceptance evidence

- Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:security`, `pnpm test:rbac`, database migration drift/rollback dry-run, and **`pnpm test:e2e` against a running isolated application**.
- Execute the high-risk negative tests described for every Critical/High finding against restricted `tc_app` and real HTTP, not mocks alone.
- Validate ClamAV fail-closed behavior, S3 versioning / signed download, 100+ MB multipart resume, worker crash replay, object checksum mismatch, PDF malicious objects / zip bombs and resource budgets.
- Test actual SMS/email provider acknowledgement and duplicate-proof webhook settlement in provider sandbox; require two-party proof for final handover acceptance.
- Perform staging install, rollout/rollback, backup/PITR restore and region outage exercises with alerting and a documented runbook.

**No report can certify 'zero issues'. Go live only after Critical/High findings are closed with evidence and residual risks are explicitly accepted.**
