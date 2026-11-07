# HVAC plan implementation verification — latest working tree

Review date: 2026-11-06. Compared current code against all 32 XP work packages and N01–N32 findings in the HVAC excellence plan/re-audit. This report supplements those historical documents; it does not overwrite their baseline or mark the full backlog complete.

## Conclusion

The model implemented a meaningful **remediation slice**, not the full HVAC product programme. Several narrow bugs are fixed, other changes only address part of their finding, and most new domain workflows remain absent or incomplete. No XP package is certified fully complete by this review: package acceptance includes cross-service, operational or customer evidence beyond the inspected patches. This is not a claim of zero progress.

This pass changes documentation only. Database tests use disposable databases; the OTP probe uses isolated temporary Redis records and creates no sessions. No customer migration, production deployment or provider messages were performed.

## Checks actually executed

- `pnpm typecheck`: passed.
- Root `pnpm test`: passed all six packages.
- API: **23 suites / 161 tests** passed (previous baseline: 22 / 151).
- Shared: **4 suites / 44 tests** passed.
- DB: **9 behavioral subtests** passed, 10 Node tests including parent; includes the new canonical tenant-alias check.
- Worker: **12 behavioral subtests** passed, 13 Node tests including parent; includes a bounded stream case and registry classification assertions.
- Browser: **6 archive-verifier cases** passed. The separately configured application browser project is not included.
- PDF: existing **3 scripted checks** passed.
- Separately exercised the **updated controller's actual Lua** against isolated records representing concurrent reissues: the obsolete generation returned OK and the current generation returned OK. No sessions were created; see V01.

The new remediation suite uses real Redis for OTP and mostly mocks other dependencies. Its mocked identity pool returns rows lacking real user_id/org_id fields, and the run logs show userId undefined. Therefore a passing test here proves selected controller/Redis behavior, not successful identity/session creation against the actual schema. The journey still uses direct services/protocol fixtures and manually updates scan status. Neither suite proves a full HTTP/browser/BullMQ/real ClamAV/S3 production path.

## Confirmed progress

| Change | Current evidence | Limit |
|---|---|---|
| Sequential mixed-alias OTP replay | Aliases now reference one authoritative record and successful consume removes aliases; new Redis-backed tests pass. | Reissue remains non-atomic; plaintext OTP introduced; V01. |
| Production loopback | SMS/mail adapters exclude staging/production and add request deadlines. | No real provider acceptance/callback lifecycle demonstrated. |
| Correct rate-limit status | HttpException now returns actual 429. | Wire-level Retry-After and all budget/cooldown cases remain. |
| API DB URL | TenantDbService accepts APP_DATABASE_URL. | Required production config and startup/runtime role readiness not established. |
| Versioned archive URL | API reads artifact key/version/bucket and signer accepts bucket; export GET/list now require export.data. | Guessed unversioned fallback and absent verified storage-row check remain; V06. |
| Notification creation authority | POST now requires notification.manage. | Caller still supplies arbitrary event/payload; typed domain reminder commands remain. |
| Notification recipient filter | Other users' explicitly addressed IN_APP messages are no longer included merely because of channel. | Null-recipient broadcasts still have no explicit audience/project-membership contract. |
| Revalidation parent | Controller passes URL asset ID and SQL binds asset_id. Document-wide approved-pointer clearing removed. | Expected version unused, technical authority and scope-aware readiness remain; V04. |
| Defect closure | Requires same-tenant READY object; checks update rowCount and already-closed status. | Same-project qualified remedy and independent verification remain; V07. |
| Commercial read models | Contract and requirement pre-aggregation; exact paise digest and zero-percent handling. | Contract aggregation includes superseded contracts; V08. |
| Outbox classification | Registry and unknown-event rejection added. | Registry omits 20 literal emit() types; V02. No durable execution/reconciliation model. |
| Scan download bounds | 100 MB/expected-size stream cap and 60-second pipeline deadline. | Invalid numeric ceilings, full validation/parser/temp-budget and process recovery remain; V09. |
| Worker executable | Start points to dist/apps/worker/src/main.js. | Clean image startup/target architecture and supervision still need deployment evidence. |
| Restore checks | URL parsing, null audit hashes, broader tenant table inventory and enforced RTO added. | No object restore, RPO proof or snapshot-consistent live-count comparison; metadata checks are not storage recovery. |
| Tenant alias validation | Forward migration 0016 replaces seven dual-alias policies with current_app_org_id(). | Full effective-policy inventory/bootstrap/global behavior and all migration baselines still require verification. |

## Highest-priority incomplete or newly introduced issues

### V01 — High: OTP reissue is non-atomic and introduces plaintext codes

Evidence: [identity.controller.ts](../apps/api/src/modules/identity/identity.controller.ts), issuance around lines 80–94; verification around 190–268.

The original sequential alias duplication was repaired. However issuance reads the old alias, deletes records and writes the new record/pointers through separate Redis commands. Two overlapping requests can both read the old alias and leave both newly issued records alive. Verification accepts a direct challenge record without checking that the current recipient pointer still targets its generation. An older successful verification also deletes whichever alias currently exists, without a generation comparison.

**Probe executed:** extracted the current `rawResult` Lua from source; seeded two unique challenge IDs for one unique test recipient with the alias pointing at the newer ID. Consuming the older direct ID returned `{status:'OK'}`; consuming the newer direct ID also returned OK. This is a reproduction of the acceptance boundary for a state attainable by overlapping issuance, not a created session or live account exploit.

The new payload also stores `otpCode: otp` and Lua compares plaintext directly. This is a regression from hash-only challenge storage.

Required next change: one atomic issuance/supersession operation and one generation-bound consume/attempt budget. Resolve aliases to the same record, reject obsolete generations and explicit wrong challenge bindings, remove aliases only if they still reference the consumed generation, and retain hash-only secret storage. Add barrier-controlled concurrent request/verify/reissue cases and actual-schema session assertions. Do not revert the working sequential replay protection.

### V02 — High: event registry is incomplete for events the application actually emits

Evidence: [event-registry.ts](../apps/worker/src/event-registry.ts), [main.ts](../apps/worker/src/main.ts:430), literal `emit({ eventType: ... })` calls across API services.

Source comparison found **20 emitted types not registered**, including PROJECT_CREATED, PROJECT_ACTIVATED, PROJECT_CLOSED, ASSET_IDENTITY_REVISED, DEFECT_RAISED, PROJECT_ARCHIVE_MANIFEST_CREATED and SUBMISSION_DISPATCHED. Registry contains DEFECT_CREATED while the application emits DEFECT_RAISED. These events now take the unknown-event failure path, increment attempts and eventually remain undispatched after the poller's retry ceiling. The new test only checks a few registry entries and an invented UNKNOWN_EVENT; it does not test producer/consumer compatibility.

Required next change: inventory every actual producer, define its versioned payload schema and executable/informational semantics, register intended handling and test a real emitted event through dispatch. Do not mark all events informational merely to silence failures; some must trigger notification or workflow effects. Add a coverage test that fails on any unregistered emitted type and an operator-visible terminal/reconciliation state.

### V03 — High: payment webhook remains falsely acknowledged when configured

Evidence: [billing.service.ts](../apps/api/src/modules/billing/billing.service.ts:185), billing controller and API bootstrap.

Unconfigured endpoint now fails safely and invalid signature tests pass. With a matching signature, it still returns PROCESSED_IDEMPOTENTLY without persisting a provider event, deduplicating it or performing/reconciling processing. Signature calculation uses JSON.stringify(parsed payload) rather than exact HTTP raw bytes. Real valid provider requests can fail due to formatting; repeated accepted events have no durable receipt. The new tests cover only absent configuration and invalid signatures.

Required next change: keep the endpoint unavailable even with a secret until raw-body verification and durable processing exist, or finish both atomically with account/amount/currency checks and provider event inbox. Add valid-signature duplicate/concurrent delivery and whitespace/key-format cases through real HTTP. Do not treat the presence of a secret as implementation readiness.

### V04 — High: revalidation and evidence coverage remain incomplete

Evidence: [assets.controller.ts](../apps/api/src/modules/assets/assets.controller.ts:98), [assets.service.ts](../apps/api/src/modules/assets/assets.service.ts:472), [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:69).

The URL asset binding is fixed. Controller advertises expectedRowVersion, but the service DTO/SQL does not consume it. There is no compare-and-set, current identity-generation check or separate qualified verifier authority. Readiness still excludes a shared document version for every obligation if any pending/mismatched revalidation exists for that version in the project; removing global pointer clearing alone does not solve shared coverage.

Required next change: asset + identity revision + requirement revision/slot + immutable evidence qualification, append-only verifier disposition and mandatory expected version. Test two assets sharing a generic manual: replacing A blocks A's affected coverage without invalidating correct B coverage. Keep self/unauthorized verification denied.

### V05 — High: submission project matching does not establish recipient authority

Evidence: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:425).

Wrong project IDs now fail. The same command still updates a body-selected recipient by party/id without establishing that the actual actor/grant is that recipient or has explicitly delegated authority. There is no expected-version decision receipt or immutable decision correction workflow. The new test covers project mismatch only.

Required next change: resolve frozen recipient from session/grant and actual submission, distinguish an authorized recorded external response from direct recipient acceptance, recheck revocation and serialize conflicting decisions. Add wrong-recipient/same-project, unrelated grant and direct service cases, not only foreign-project cases.

### V06 — Medium/high: archive signing keeps an unsafe compatibility fallback

Evidence: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:1181).

A completed row with artifact metadata signs the correct key/version, which is genuine progress. Missing artifact metadata still falls back to the old guessed key and signs without a version. The service does not resolve artifact.objectId to a verified same-tenant READY storage row or compare its checksum/size/version against the export. The success test supplies only mocked export metadata and therefore cannot prove actual downloadable bytes or reject a corrupted receipt.

Required next change: require verified immutable artifact identity, resolve it from storage records and return a defined unavailable/integrity failure for legacy/corrupt rows. Add compiled archive → actual API URL → independently hashed download, missing metadata and mismatched receipt cases.

### V07 — High workflow gap: READY evidence from another project can close a defect

Evidence: [warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts:136).

The new evidence check is scoped to organisation only. It does not establish association to the defect's project/asset/remedy or technical qualification. Closure still combines remedy submission and verification; expected version and independent verifier remain absent. The new negative test returns no qualifying rows and cannot prove correct project association.

Required next change: load/lock defect and qualified remedy proof under composite scope; distinct remedy-submitted versus verified-closed commands, meaningful affected-row and concurrency checks. Test same tenant/other project, wrong asset, stale closure and unauthorized verifier.

### V08 — Medium: dashboard contract aggregation counts historical contracts

Evidence: [organisations.service.ts](../apps/api/src/modules/organisations/organisations.service.ts:83).

Pre-aggregation fixes requirement × contract multiplication. Its contract_summary CTE sums every contract without filtering ACTIVE versus SUPERSEDED or using a defined current contract revision. Therefore an original contract plus its superseding replacement can both contribute to displayed value and retention exposure. Existing precision test does not exercise this query or a genuine zero-retention fixture.

Required next change: define the effective contract/variation basis and aggregate only that source. Add real database tests for active+superseded versions, equal-valued contracts, partial scopes, zero retention and large values.

### V09 — Medium: bounded stream assumes a valid numeric ceiling

Evidence: [bounded-stream.ts](../apps/worker/src/queues/bounded-stream.ts:6), [main.ts](../apps/worker/src/main.ts:173).

The new transform rejects oversized normal inputs. If expectedSizeBytes is a truthy nonnumeric value, Math.min(Number(value), cap) becomes NaN and totalBytes > NaN never rejects. The helper constructor does not reject non-finite/negative/fractional ceilings. This is a malformed internal-event risk, not a demonstrated external upload bypass; the normal producer currently falls back to the default cap when size is absent.

Required next change: validate finite positive safe-integer source limits and payload schemas before storage retrieval; bind expected size to the persisted provider receipt. Test NaN, Infinity, zero, negative values, short/long streams and transfer deadline as well as a valid overflow.

## N01–N32 finding status

“Scoped repair” means the named defect was repaired in inspected code, not that its entire XP package or production gate is complete.

| Finding | Current assessment |
|---|---|
| N01 | Prior red tests repaired; current full suite passes. Full HTTP/worker/browser boundary still incomplete. |
| N02 | Sequential mixed-alias replay repaired; concurrent reissue remains reproducible and plaintext codes introduced: V01. |
| N03 | Production loopback exclusion/deadline added; provider lifecycle/acceptance proof partial. |
| N04 | Correct stored artifact parameters used when present; unversioned fallback and receipt validation remain: V06. |
| N05 | Unconfigured/invalid-signature containment added; configured successful path still incomplete: V03. |
| N06 | Scoped repair: actual 429 exception. Wire-level contract/Retry-After still needs proof. |
| N07 | Scoped repair: API consumes APP_DATABASE_URL; production config/role validation remains. |
| N08 | Unchanged: guard still uses separate permission evaluator/path inference; full resource/state policy absent. |
| N09 | Explicit private recipient leak repaired; null-recipient broadcasts/project audiences partial. |
| N10 | Scoped repair: POST requires notification.manage; arbitrary payload/domain-command design unfinished. |
| N11 | Project mismatch repaired; actor-to-recipient authority and concurrency unfinished: V05. |
| N12 | Unchanged heuristic projection, nested metadata, timestamp handling and Reflector bootstrap issues. |
| N13 | Asset URL binding repaired; expected version/identity generation/verification authority unfinished: V04. |
| N14 | Global pointer clearing removed; readiness's version-wide revalidation exclusion remains: V04. |
| N15 | Unchanged document-wide approval/qualification limitation. |
| N16 | Unchanged separate business/receipt transactions and unknown-outcome handling. |
| N17 | Unchanged nested transaction ownership in review wrappers. |
| N18 | Registry added, but producer coverage incomplete: V02. Durable dispatch/reconciliation absent. |
| N19 | Stream cap/deadline added; validation, temp/parser budgets and full recovery partial: V09. |
| N20 | Same-tenant READY proof and row-count checks added; project/remedy/verifier binding partial: V07. |
| N21 | Precision/zero handling and pre-aggregation improved; historical contract inclusion remains: V08. |
| N22 | Inline/erased request types, optional preconditions and route-contract coverage largely unchanged. |
| N23 | Scoped repair: worker start path corrected; actual clean deployment smoke still required. |
| N24 | Unchanged DB-only health, no full readiness and raw caught error message. |
| N25 | URL/null-hash/catalog/RTO repairs added; actual object restore/snapshot consistency/RPO unproved. |
| N26 | Process-kill/Redis-loss/resource recovery acceptance not implemented as specified. |
| N27 | Existing import foundation; staged preview/baseline/commit semantics absent. |
| N28 | Large page/services and dormant demonstration definitions remain. |
| N29 | Legacy draft helper remains; full cross-tab/actor offline browser matrix absent. |
| N30 | Migration 0016 and function test added; seven targeted policy definitions updated. Full bootstrap/effective-policy acceptance not established. |
| N31 | Archive GET/list narrowed to export.data and response fields narrowed; direct-service policy and verified artifact checks incomplete. |
| N32 | No new demonstrated deployment, HA/load/alerts/recovery/customer operating evidence. |

## All 32 XP work packages

Status assesses the package's full requested outcome and acceptance, not whether its name appears in a comment.

| Package | Status | Main evidence / work still required |
|---|---|---|
| XP00 Baseline/journey | Partial | Green suites; no complete actual HTTP/browser/queue journey or comprehensive route inventory. |
| XP01 Identity | Partial | Alias pointers, 429, production-loopback exclusion; V01 and real provider/session cases remain. |
| XP02 Policy/projection | Partial | Narrow permission/parent fixes; canonical resolver, state/recipient authority and nested DTO contracts absent. |
| XP03 Durable commands/contracts | Partial | Existing interceptor and DB URL repair; no atomic command ledger/unit of work or broad runtime DTO migration. |
| XP04 Bounded files | Partial | Versioned sources, stream cap/deadline; no real storage/scanner acceptance or complete resource/reconciliation controls. |
| XP05 Outbox/recovery | Partial | Registry and queues; V02, durable execution receipts, reconciliation/dead-letter/process crashes remain. |
| XP06 Messaging | Partial | Gateway seam and authority improvements; provider attempts/callbacks/backoff/recipient lifecycle incomplete. |
| XP07 Qualified coverage | Partial foundations | Version-based readiness/revalidation; no complete requirement-revision/slot/identity coverage kernel. |
| XP08 Canonical review | Partial | Working assignment/review logic; duplicated paths/nested transactions and exact comment closure remain. |
| XP09 Dossiers/archive/recipients | Partial | Real artifacts, offline verifier, versioned signing path; V05/V06 and complete acceptance loop remain. |
| XP10 Production/recovery | Partial | Worker path and restore checks improved; real readiness/clean deploy/object restore evidence absent. |
| XP11 Controlled onboarding import | Partial foundations | Checklist/asset imports; no pinned import draft/impact/commit workflow. |
| XP12 Inbox/search/workspaces | Partial foundations | Dashboard/project views; no complete work-item/search/saved-view backend and domain routes. |
| XP13 Equipment spine | Partial | Asset history/passport backend and asset-bound revalidation; type/unit/system/QR/coverage workflow incomplete. |
| XP14 Supplier return loop | Partial | Scoped guests/requests/upload; full stages/returns/reminders/mobile acceptance incomplete. |
| XP15 Material trace | Partial schema | Procurement lines/obligations; no complete MAR → delivery/MIR → installed-unit allocation workflow. |
| XP16 Native quality | Not found as specified | No native revisioned inspection/test-run/readings/instrument/witness module located. |
| XP17 Air/water TAB | Not found as specified | No native design/measured balancing iterations/formula/instrument report workflow located. |
| XP18 Controls/seasonal testing | Not found as specified | No native sequence/run/deferred-seasonal acceptance workflow located. |
| XP19 Decisions/waiting | Partial foundations | Reviews/transmittals; full factual waiting ledger and exact response/closure workflow absent. |
| XP20 Client/FM handover | Partial | Packages/recipient records; full scope/training/spares/FM/validated information export incomplete. |
| XP21 Aftercare/DLP | Partial | Warranty/defects remain in billing; separate contractual clocks/service/verified closure incomplete. |
| XP22 Commercial evidence | Partial | RA pack/readiness; no full milestone/tranche/application/certification/payment-receipt ledger. |
| XP23 Portfolio insight | Partial foundations | Dashboard counts; denominator-defined cycle/waiting/supplier outcome analytics absent. |
| XP24 Connectors | Partial foundations | Generic provider/storage interfaces; permissioned email/WhatsApp/accounting/platform workflows not complete. |
| XP25 Assistive AI | Not found as specified | No proposal/citation/disposition/holdout/spend-controlled AI module located. |
| XP26 Mobile/offline/accessibility | Partial | Existing queue/PWA; no full cross-tab/draft/conflict/localized accessible route workflow and evidence. |
| XP27 Release/fault/load gates | Partial | Better regression lanes; real application/provider/process/restore/load/security gates absent. |
| XP28 Contractor validation | No evidence supplied | Customer discovery, shadowing, permissioned real fixtures and uncoached trials not established by repo code. |
| XP29 Support/adoption | No complete workflow found | No demonstrated scoped operations/support/onboarding/adoption console and customer outcomes. |
| XP30 Governance/rule packs | Partial foundations | RLS/retention-related schema; approved customer retention/engineering pack/licensing/restore evidence absent. |
| XP31 Maintainability/contracts | Partial | Shared helpers/tests added; large services/pages, broad any/inline DTOs and scattered policies remain. |

## What the next implementation pass should do

1. Fix V01 atomically, remove plaintext OTP and test real-schema login plus concurrent generations.
2. Complete producer/consumer event compatibility V02 and add a coverage test for every emitted type.
3. Contain the configured webhook until raw-body/durable processing is complete (V03).
4. Finish recipient/verifier/coverage authority V04/V05/V07, including expected versions and independent actors.
5. Remove archive fallback and validate the actual storage receipt before signing V06.
6. Fix effective-contract aggregation and invalid stream ceilings V08/V09.
7. Continue the existing XP03/XP07/XP10/XP27 work: transactional outcomes, qualification kernel, actual operating recovery and full application acceptance.
8. Then deliver the daily contractor and native HVAC packages in their original dependency order. Do not mark them complete because the remediation suite is green.

No production-readiness or best-in-segment gate is established by these code changes alone. The full ambition remains the target; this verification distinguishes genuine progress from the remaining implementation and evidence.
