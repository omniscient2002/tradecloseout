# HVAC implementation follow-up — 2026-11-06

## Verdict and scope

More of the previous findings are repaired, and a new commissioning API/migration is implemented. **The full plan is still incomplete.** This pass also reproduces production SQL failures and invalid commissioning records despite a green test suite.

This is a follow-up to [the previous verification](TRADECLOSEOUT_HVAC_IMPLEMENTATION_VERIFICATION_2026-11-06.md), [the implementation plan](TRADECLOSEOUT_HVAC_EXCELLENCE_AGENT_PLAN.md), and its N01–N32 re-audit. It focuses on changed code, V01–V09, and the newly added XP16–XP18 foundation. It does not recertify every unchanged finding or replace the historical reports. Source fingerprints and executed results are in [the evidence file](TRADECLOSEOUT_HVAC_IMPLEMENTATION_FOLLOWUP_EVIDENCE_2026-11-06.json).

Application code was not changed during this review. Database probes used newly created disposable databases with synthetic records and the restricted `tc_app` runtime role for service calls. No customer records, deployments, payment processing or external messages were changed.

## Verification executed

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed |
| Root `pnpm test` | Passed, exit 0 |
| API | 24 suites / 177 tests passed; previous pass was 23 / 161 |
| Shared | 4 suites / 44 tests passed |
| Database | 9 behavioral subtests passed, 10 including parent |
| Worker | 12 behavioral subtests passed, 13 including parent |
| Browser | 6 archive-verifier tests passed; the application browser project is not included |
| PDF | 3 existing scripted checks passed |
| Producer/registry inventory | All 30 distinct literal `emit({ eventType: '...' })` types found in API source are in the 67-entry registry |
| Actual revalidation SQL against migrated database | Failed with PostgreSQL `42703`; changing only the uploader column then failed with `0A000` |
| Actual commissioning service against migrated database | Empty inspection persisted as PASSED; wrong-project and foreign-tenant assets accepted for inspection and seasonal schedule |
| TAB service with controlled SQL dependency | Mixed CFM/GPM readings accepted as COMPLETED; this calculation probe did not use real database persistence |

The registry inventory covers literal producers, not arbitrary runtime event construction. The worker test titled “covers 100%” checks a manually maintained list, so it will not automatically detect a future unregistered producer.

## Previous V01–V09: current disposition

“Scoped repair” closes the specific previous defect in inspected code; it does not certify its entire XP package or operating gate.

| Finding | Current disposition |
|---|---|
| V01 OTP supersession/plaintext | Scoped repair. Issuance is one Redis Lua operation; verification checks the active generation and consumes aliases conditionally. Salted hash storage replaces `otpCode`. New Redis-backed tests include a retained obsolete record. Full actual-schema sessions, provider acceptance and concurrency/failure matrix remain outside this proof. |
| V02 missing registry producers | Scoped repair of the missing literal registrations. Registry includes the previous missing events and new commissioning events. Version numbers/descriptions are not runtime payload schemas; durable execution receipts, reconciliation and intended downstream effects remain XP05 work. |
| V03 false payment acknowledgement | Scoped containment repair. Even a matching configured signature now returns 503 instead of claiming processing. Raw HTTP byte verification, durable provider inbox and reconciliation are still unimplemented. |
| V04 revalidation | Still open, with a newly introduced runtime regression: F01 below. The expected-version check also has no backing schema version. |
| V05 recipient authority | Partial. Recipient locking, terminal-decision rejection, an ACTIVE guest-grant check and party comparison were added. Exact grant scope, member authority and aggregate acceptance remain incomplete: F05. |
| V06 archive artifact identity | Partial. Missing key/version now rejects and the guessed unversioned fallback is removed. The storage-row check is optional and does not compare immutable identities: F06. |
| V07 defect remedy/verification | Partial. New remedy command, row locking/version predicates, assignee independence check and some project checks are present. Transition and evidence binding still permit bypasses: F07. |
| V08 historical contract aggregation | Scoped repair: dashboard CTE now filters ACTIVE contracts. Full effective variation/commercial-basis acceptance remains separate. |
| V09 invalid byte ceiling | Scoped repair: constructor rejects non-finite, non-positive and non-safe-integer ceilings; worker tests exercise invalid values and overflow. Full persisted receipt/payload/resource recovery controls remain separate. |

## Findings requiring implementation

### F01 — High: evidence revalidation cannot execute, and concurrency is ineffective

Source: [assets.service.ts](../apps/api/src/modules/assets/assets.service.ts:484), `revalidateEvidence`.

The current SQL selects `dv.created_by`; `document_versions` has `uploaded_by`. Executing the exact source query against a freshly migrated disposable database returned:

```text
42703 column dv.created_by does not exist
```

Changing just that column to `dv.uploaded_by` returned a second error:

```text
0A000 FOR UPDATE cannot be applied to the nullable side of an outer join
```

Use `FOR UPDATE OF er` when retaining this LEFT JOIN. This is a real query failure, independent of fixture contents.

The migrated `evidence_revalidations` table also has **no `row_version` column**. The new comparison only executes when `existing.row_version != null`, so it silently skips for real rows. The update does not increment a version. Mocking a row with `row_version` cannot validate this contract.

Implement: correct the uploader column and locking target; introduce a forward migration and matching schema for mandatory expected-version comparison/increment, or a properly defined immutable disposition mechanism. Enforce verifier authority and current identity/requirement revision, and scope revalidation coverage to the affected asset/slot. Readiness still excludes a shared document version across all project coverage when any associated revalidation remains pending/mismatched.

Acceptance: real database success, uploader denial, missing/stale precondition rejection, two concurrent conflicting dispositions, wrong asset/revision rejection, and two assets sharing a manual where changing A does not invalidate B.

### F02 — High: inspection and seasonal records can reference another tenant's asset

Sources: [commissioning.service.ts](../apps/api/src/modules/commissioning/commissioning.service.ts:230), [migration 0017](../packages/db/migrations/0017_hvac_commissioning_tab_and_inspections.sql:43).

`recordQualityInspection` and `createSeasonalSchedule` do not resolve `assetId` under the requested organisation/project. Migration 0017 supplies only a scalar `assets(id)` foreign key. Tenant RLS checks the new row's `org_id`, which does not enforce the referenced asset's ownership.

**Reproduced with the real service, migrated database and restricted runtime role:** an actor in tenant A/project A0 successfully created both record types referencing A1's asset, then tenant B's asset. Results were PASSED inspections and SCHEDULED seasonal records. This proves cross-scope reference corruption; it is not a claim of a separately demonstrated foreign-data download.

Implement: resolve all asset references under `(org_id, project_id, id)` and add matching composite foreign keys in a forward migration for all three commissioning tables. TAB already performs an application lookup; retain it and add the database constraint. Update the schema declarations alongside migrations.

Acceptance: both API/service and direct runtime SQL reject same-tenant/wrong-project and foreign-tenant references. Correct-scope creation succeeds. Test null asset separately where project-level records are allowed.

### F03 — High: an empty inspection is recorded as PASSED

Source: [commissioning.service.ts](../apps/api/src/modules/commissioning/commissioning.service.ts:242).

`checklistItems || []` and “no FAIL means PASSED” accept an empty checklist. **Reproduced and persisted through the actual service/database.** Unknown result strings also have no runtime DTO enum validation at this boundary; TypeScript interfaces are erased. Database JSONB does not validate item shape. The database default outcome is PASSED too.

Implement: validated runtime DTOs with bounds and allowed results; a revisioned procedure defining mandatory items; unresolved/missing items retain PENDING or reject acceptance. Define NA applicability and required witness/prerequisite conditions explicitly. Use a non-passing database default. Passing measurements must not bypass review/acceptance authority.

Acceptance: empty/omitted checklist, unknown results, missing mandatory items, all-NA checklist and missing witness cannot produce an accepted pass. Include real persistence and HTTP validation tests, plus a valid fully completed run.

### F04 — High correctness gap: TAB completion lacks a valid measurement/design contract

Source: [commissioning.service.ts](../apps/api/src/modules/commissioning/commissioning.service.ts:65).

The service defaults tolerance to 10%, permits the caller to supply up to 50%, and stores no approved source/revision for that choice. The plan explicitly requires source-defined tolerances and deferral when the applicable basis is unknown. The service sums readings without unit compatibility/conversion or a defined system hierarchy. A controlled direct-service probe with one CFM and one GPM reading under AIR_SIDE returned COMPLETED and a combined total of 200.

It also compares rounded deviations, uses binary floating point, has no required terminal inventory, and does not validate positive actual flow/finite numbers fully. A system can be called completed without demonstrating that all required terminals were measured or instruments were calibrated at test time.

Implement: approved procedure/design/tolerance revisions, dimension-aware units and conversions, decimal precision/formula versions, complete system/branch/terminal scope, and instrument-at-test trace. Keep measurement compliance distinct from witnessed/reviewed acceptance. Reject incompatible units and defer when design basis or applicable tolerance is absent.

Acceptance: mixed dimensions, conversion vectors, missing terminals, invalid/non-finite values, boundary rounding, failed/retest history, missing design/tolerance source and expired calibration. Have an HVAC engineer review the actual procedure and report.

### F05 — High: recipient decisions still lack complete actor binding and aggregation

Source: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:462).

The command checks an ACTIVE guest grant and compares its party, but does not bind that grant's project or frozen submission/recipient scope. A same-party grant for another project/scope is not rejected here. Member actors have no equivalent recipient/delegation check. The HTTP session guard does check guest expiry; that does not supply the missing decision-specific authority or direct-command enforcement. Although the party comparison is conditional, the fresh schema makes `guest_grants.party_id` NOT NULL, so this report does not claim a reachable null-party bypass.

The command also sets submission/package ACCEPTED directly from this one recipient's ACCEPT instead of aggregating all required frozen recipient decisions. Row locking improves serialization but does not establish the correct aggregate result.

Implement: require the party binding and revalidate the grant's exact project/submission/recipient scope and validity, distinguish delegated recorded responses from recipient decisions, and derive aggregate status from all required recipients under the same transaction. Require an expected version or equivalent durable decision contract.

Acceptance: same-party grant for another project/submission, unrelated/revoked grant, unauthorized member, same-project wrong recipient, concurrent decisions, and two required recipients where the first acceptance cannot accept the entire submission.

### F06 — Medium/high: archive receipt can bypass or disagree with storage verification

Source: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:1227).

`artifact.objectId` remains optional. Omitting it bypasses storage verification. When present, the selected checksum/version are never compared to the artifact/export. The signing call still trusts key/version/bucket from JSON independently of the selected READY row.

Implement: require one authoritative same-tenant artifact identity and compare bucket/key/provider version, digest and observed size against the completed export. Sign the validated stored identity. Reject missing/mismatched legacy receipts explicitly.

Acceptance: missing object ID, READY object with mismatched key/version/digest/size, foreign object ID, and actual archive → API signed URL → downloaded-byte digest. The existing mock returns only `{ id, status: 'READY' }`; that does not prove identity matching.

### F07 — High: defect verification can still bypass the remedy lifecycle

Source: [warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts:277).

The close command only rejects CLOSED; it does not require RECTIFIED or verify the evidence previously submitted for the remedy. An OPEN defect can therefore still be closed directly. Assignee comparison does not establish that the actual remedy submitter/performer is a different qualified verifier.

Evidence validation rejects a known other-project-only link or some object-key patterns, but accepts a READY object with no project link and no `/projects/` marker. String matching on storage keys is not positive project/asset/remedy qualification. Expected versions remain optional.

Additionally, commercial readiness counts critical defects only with status OPEN. IN_PROGRESS and RECTIFIED critical defects disappear from that blocker although they are not verified closed. The newly added remedy command makes this path particularly relevant.

Implement: positive composite remedy/evidence scope and qualification; persist submitter/performer and an immutable verification decision; require the valid predecessor state, independent qualified verifier and mandatory version. Count every unresolved blocking defect state in commercial readiness according to explicit waiver policy.

Acceptance: OPEN → CLOSED denied; same performer/unassigned self-verification denied; unlinked/wrong asset proof denied; stale versions denied; CRITICAL IN_PROGRESS/RECTIFIED continues to block; properly verified closure releases the defined blocker.

## What the new XP16–XP18 implementation actually covers

The commissioning module is registered in `AppModule`; migration 0017 creates three RLS-protected tables; APIs record/list TAB sheets, record inspections, append witness data and create/list seasonal schedules. The new domain suite tests four commissioning scenarios with mocked SQL dependencies. This is useful implementation progress.

It is still a partial foundation for all three packages. Missing acceptance includes revisioned procedures/prerequisites/hold points, instrument calibration at actual test time, immutable corrections/retests, qualified witness identity and authority, source tolerances, generated immutable review evidence, and mobile/offline conflict behavior. Witness signing currently accepts caller-supplied party/representative/role with ordinary `document.upload` permission. Seasonal scheduling has no perform/defer/waive/return-visit command, responsible-party contract or functional-controls sequence/trend workflow. No web caller for the new commissioning routes was found in this pass.

Do not mark XP16, XP17 or XP18 complete from table names, comments or these mocked positive tests. Other unchanged XP/N findings retain the previous report's open/partial status; this follow-up supplies no new production deployment or customer acceptance evidence.

## Next implementation order for the agent

1. **F01:** fix both actual SQL errors and implement real revalidation concurrency. Run against migrated PostgreSQL before updating completion claims.
2. **F02/F03:** add forward schema constraints, asset resolution and validated inspection inputs/non-passing state rules. Preserve migration history; do not edit an already applied 0017 to conceal schema drift.
3. **F05/F06/F07:** close recipient authority/aggregation, archive identity and defect lifecycle/readiness gaps with negative real-database tests.
4. **F04:** agree the source procedure/design/unit contract, then implement calculations and acceptance transitions. Do not widen the current arithmetic into more equipment types before those contracts exist.
5. Finish XP16–XP18 through independently reviewable workflow slices, then connect actual UI, evidence qualification and handover readiness. Keep their full acceptance criteria visible.
6. Continue the original XP critical path: canonical policy/projection, atomic durable commands, bounded file processing, durable outbox/recovery, scoped evidence qualification and full user journeys. Green unit tests do not replace process-crash, storage/scanner, provider, browser, restore or customer workflow proof.

For each slice, record exact changes, migration behavior, negative cases, executed checks and the remaining package acceptance. Keep the working fixes above intact.
