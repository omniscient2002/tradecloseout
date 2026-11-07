# Remaining real gaps — implementation recheck, 2026-11-06

## Conclusion

Several previous defects are now repaired. **There are still reproducible functional gaps in the current code.** The findings below distinguish actual behavior reproduced through services against migrated PostgreSQL from capabilities that are still missing by source inspection.

This follows [the prior review](TRADECLOSEOUT_HVAC_IMPLEMENTATION_FOLLOWUP_2026-11-06.md). It reviews the changed implementation and adjacent paths; it is not a fresh certification of all 32 work packages. No application code was changed by this review. Database probes used synthetic fixtures in an automatically removed disposable database and the restricted application role. No customer data or external messages were changed.

## Checks and fixes that deserve credit

- `pnpm typecheck`: passed.
- Root `pnpm test`: passed, exit 0. API: **24 suites / 178 tests**; shared: **4 suites / 44 tests**; database: **9 subtests**, 10 including parent; worker: **12 subtests**, 13 including parent; browser: **6 archive tests**; PDF: **3 scripted checks**.
- The added real PostgreSQL integration test now exercises selected F01–F07 invariants. It is materially stronger than the earlier mocks, although it does not cover all negative cases below.
- Revalidation's invalid uploader column and outer-join locking were corrected. Migration 0018 adds `row_version`, and updates increment it. Stale explicit versions are rejected.
- Migration 0018 adds composite asset foreign keys for the commissioning tables; inspection and seasonal commands also resolve assets under the exact tenant/project. The previous wrong-asset reference gap is addressed.
- Empty inspection checklists and invalid item results now reject; all-NA outcomes remain PENDING; the database default is PENDING.
- TAB rejects mixed units and validates AIR_SIDE/WATER_SIDE units. This fixes the previously reproduced CFM/GPM mixture.
- Submission decisions now aggregate recipients, and guest grants are checked against the target project as well as party. The previously missing basic two-required-recipient consensus is tested.
- Archive object IDs are mandatory and present-but-mismatched attributes reject. Remaining missing-attribute behavior is G03.
- Defect commands now require expected versions, closure requires RECTIFIED, and remedy submitters cannot self-close. Unresolved HIGH/CRITICAL defects remain commercial blockers in IN_PROGRESS/RECTIFIED states. Migration 0019 records remedy performer/time.

The full suite passing does not invalidate the separate negative-case results below. The suite's new integration case tests selected happy paths and denials; these probes exercise different states.

## Reproduced gaps, in implementation priority order

### G01 — High: equipment passport fails on the actual schema

Source: [assets.service.ts](../apps/api/src/modules/assets/assets.service.ts:936), `getEquipmentPassport`.

**Actual result:** calling the service for a valid synthetic asset returned PostgreSQL `42703: column er.verified_by does not exist`.

The evidence-revalidation projection also selects `er.reason`, `er.notes`, `er.uploader_user_id` and `er.verified_at`, which do not match the migrated table. The persisted fields include `revalidation_notes`, `reviewed_by`, and `reviewed_at`; uploader identity and revision reason require appropriate joins if the response needs them. Adding `scope_key` in 0018 did not repair the rest of this projection.

**User impact:** the equipment passport fails even for a valid asset. Its existing test mocks SQL and therefore cannot catch this schema mismatch.

**Implement:** align every projection field/join with the migrated schema and add a real-database passport test covering empty and populated history, revalidation, procurement and defects. Check the complete response, not just the first query that currently fails.

### G02 — High: readiness says ready, but package creation rejects the unchanged project

Sources: [readiness query](../apps/api/src/modules/handover/handover.service.ts:73), [package transaction recheck](../apps/api/src/modules/handover/handover.service.ts:187).

**Fixture:** assets A and B share a manual version; A has a pending revalidation; the mandatory requirement belongs to B and is otherwise satisfied. No data changes between the calls.

**Actual results:** `evaluateProjectReadiness` returns `readyWithoutOverride: true`, zero missing mandatory requirements. `requestHandoverPackageGeneration` then throws `READINESS_CHANGED`.

The main readiness and later package selection queries include asset scoping. The transaction's blocker query still excludes a document version for *any* pending/mismatched project revalidation. It therefore disagrees with the corrected readiness query.

**Implement:** use one shared, authoritative scoped qualification definition in readiness, transaction recheck, package evidence selection, passport and commercial projections. Include current identity/requirement revision semantics; do not copy a fix into only one of several SQL predicates.

**Acceptance:** B can generate with A's unrelated affected coverage pending; A remains blocked where required. Also test a real concurrent evidence change so legitimate rechecks continue to reject.

### G03 — High integrity gap: missing archive storage facts bypass verification

Source: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:1274), `getArchiveExport`.

**Fixture:** a valid READY storage row has checksum and declared size but NULL `provider_version_id` and NULL `observed_size_bytes`, which the database currently permits. The export artifact claims a provider version and matching declared size.

**Actual result:** the API service accepts it and calls the captured signer with `versionId: null`. The missing observed size is replaced by the declared size.

The new comparisons are conditional on truthy fields, so an absent provider version skips the mismatch check. This is an invalid/legacy-record acceptance gap, not proof that every newly generated archive has missing metadata. The signer was captured locally; no external S3 request or downloaded-byte validation occurred in this probe.

**Implement:** require nonempty authoritative key/bucket/provider version, valid checksum and observed size before signing. Require observed size to match declared size and the completed artifact's size. Check required export digest/receipt consistency explicitly; missing facts must reject rather than bypass comparisons or fall back to declarations.

**Acceptance:** missing provider version, missing observed size, mismatched sizes/digest/version, corrupt receipt and foreign object all reject. Keep the working positive/mismatch tests. Complete a real archive → signed API URL → independently hashed download test separately.

### G04 — High business behavior gap: optional recipients can block or veto acceptance

Source: [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts:540), recipient aggregation.

**Fixture:** one required approver and one optional observer (`is_required_approver = false`).

**Actual results:** after the required recipient accepts, the aggregate stays SUBMITTED while the optional observer is pending. An optional observer's rejection then changes the aggregate to REJECTED.

The query does not select `is_required_approver`; the calculations include every recipient. This is distinct from the repaired two-required-approver case, which now passes.

**Implement:** define aggregate decision rules over the frozen required-approver set. Preserve optional acknowledgements/comments separately. Define what zero required approvers, required exceptions and corrected decisions mean, and keep event/package status transitions consistent.

**Acceptance:** required acceptance is not blocked by an optional observer; an optional rejection does not acquire required veto authority. Exercise mixed required/optional recipients and concurrent conflicting decisions.

### G05 — High evidence gap: generic project documents can still remedy and close asset defects

Source: [warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts:186), remedy and closure validation.

**Actual results:** a generic manual, linked to the project but with no asset association, was accepted as remedy evidence for an asset-specific CRITICAL defect. An independent verifier then closed that defect with a *different* version of the manual whose review status was NOT_SUBMITTED. The defect moved OPEN → RECTIFIED → CLOSED through the actual commands.

The project association check is stronger now, but the asset check only rejects when `linked_asset_id` is present and different. A missing association passes. The scalar `LIMIT 1` asset lookup also does not model multiple asset coverage. Closure does not bind its input to the evidence submitted for the particular remedy or require a defined correction/verification evidence relationship.

**Implement:** positively qualify evidence for the defect, affected asset and remedy revision. Require exact matching or an explicit, audited verifier-evidence relationship. Model multiple asset associations deliberately. Separate file READY from technical suitability. Retain the newly working predecessor/version/independent-performer checks.

**Acceptance:** generic manual, absent/wrong asset association, unrelated replacement object, nonqualifying revision and multi-asset ambiguity reject. The correct remedy and its independent verification succeed.

### G06 — Medium: revalidation still accepts commands without a concurrency precondition

Source: [assets.service.ts](../apps/api/src/modules/assets/assets.service.ts:508).

**Actual result:** `revalidateEvidence(..., { status: 'CONFIRMED' })` succeeds without `expectedRowVersion` and increments the row to version 2.

The SQL/version infrastructure is now real, and explicit stale versions reject. However the client precondition remains optional, so it cannot stop a stale caller that omits the version from overwriting the latest disposition. Row locking serializes writes; it does not establish which revision the caller reviewed.

**Implement:** require a version or a defined immutable decision contract; return a clear precondition error when omitted. Update callers/work items to carry the actual version and keep qualified-verifier/current-identity checks explicit. The revalidation work-item query currently hardcodes entity version 1 rather than returning `er.row_version`.

**Acceptance:** missing/stale version, concurrent conflicting decisions and decision against an obsolete asset identity reject. A current authorized disposition succeeds with its next version.

### G07 — Medium correctness/domain gap: TAB can pass a value outside its stated raw tolerance

Source: [commissioning.service.ts](../apps/api/src/modules/commissioning/commissioning.service.ts:65).

**Actual fixture/result:** design flow 100, measured flow 89.996, no supplied tolerance. Raw deviation is approximately 10.004%; the service rounds it to 10%, applies default 10% tolerance and persists COMPLETED.

The code has no approved procedure/formula revision specifying whether rounding before comparison is permitted. It still defaults to 10% and lets the caller select up to 15% without a recorded source tolerance/design basis. A standards name in an error string does not supply that traceability. This report makes no claim about what any particular standard's actual limit should be.

**Implement:** bind design, tolerance, unit/precision and rounding policy to an approved procedure/version. Compare using that defined policy and store both raw and display values. Defer an acceptance outcome when the basis is unknown. Complete instrument-at-test, required-terminal completeness and balancing/retest history.

**Acceptance:** independently checked boundary vectors, missing source/design, missing terminals, calibration-at-test and repeat/retest cases. Retain mixed-unit rejection. Engineer review remains a separate acceptance requirement.

## Authority and workflow implementation still incomplete

These are concrete missing command/model capabilities found in source, distinct from the reproduced bugs above:

- **Exact recipient grant authority:** the decision command checks ACTIVE/project/party, but does not read a grant's `scope_json` or resolve an explicit frozen submission-recipient binding. A direct-service probe with a narrower illustrative `submissionIds` scope still accepted a decision outside that list. Since the current grant creator does not establish a typed `submissionIds` contract, this is evidence that the finer authority model is absent, not a claim that a documented supported scope format was bypassed. Define and enforce the exact scope/delegation contract, including member-recorded external responses. HTTP permission/session gates are not certified bypassed by this direct-service probe.
- **Witness authority:** witness-sign uses ordinary `document.upload` permission and accepts caller-supplied party/representative/role strings. There is no resolved witness/delegation authority or required-witness acceptance transition. The stored actual signing user is useful audit information but does not validate the claimed party role.
- **Commissioning lifecycle:** there are create/list seasonal schedules but no perform/defer/waive/return-visit commands; native inspections lack revisioned procedures, prerequisite/hold/release transitions, instrument/calibration-at-test and immutable corrections/retests. No web callers for the new commissioning routes were found. These XP16–XP18 packages remain partial.
- **Payment ingestion:** safely unavailable even with matching configured signature. Raw-byte verification, durable provider inbox and reconciliation remain absent. This is safe containment, not working payment processing.
- **Schema maintenance:** the schema declarations still omit the new commissioning tables and the new revalidation/remedy columns. Align them with the migrations; successful TypeScript compilation cannot validate raw SQL names, as G01 demonstrates.

The broader unchanged gaps in the original production re-audit are not certified closed here. Full application browser journeys, real storage/scanner/provider boundaries, durable command/outbox crash recovery and operational/customer acceptance remain separate evidence requirements.

## Agent implementation order

1. G01: restore the passport and add a populated real-database test.
2. G02: unify scoped qualification and verify readiness → actual generation end to end.
3. G03: reject incomplete authoritative archive metadata before signing.
4. G04/G05: repair required-recipient aggregation and defect-specific evidence qualification.
5. G06: enforce the client version and propagate actual versions to actions/work items.
6. G07: implement the approved measurement/rounding basis, then complete witness/commissioning lifecycle slices.

For each change, add the exact negative fixture above and a positive case against migrated PostgreSQL. Keep HTTP/browser permission behavior as a separate acceptance check where authority is involved. Preserve historical migrations and the working fixes already verified.

The [evidence file](TRADECLOSEOUT_REAL_GAPS_RECHECK_EVIDENCE_2026-11-06.json) records probe outputs and current source fingerprints.
