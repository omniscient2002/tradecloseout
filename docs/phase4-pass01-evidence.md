# Phase 4 · Pass 01 — post-close defect lifecycle and current authority
Date: 2026-11-12
Track: PH4-G17-003 and PH4-G17-004
Source: [30-pass plan](./phase4-production-closure-pass-plan.md)
Working draft: [PR #23](https://github.com/omniscient2002/tradecloseout/pull/23)

## Prior accepted foundation retained
- Separate CLOSEOUT vs AFTERCARE contexts, accepted-package FK, real PostgreSQL constraints, nonmandatory aftercare reporting and project-row serialization for creation.
- Guest supplier party/asset scoping and independent verifier self-denial.
- Existing immutable remedy-version qualification, current approved document binding and outbox/audit receipt.

## New code in this pass
1. Both remedy and independent defect closure now lock the project **before** locking the defect, matching create/closeout lock order. CLOSEOUT mutations require ACTIVE or HANDOVER. AFTERCARE mutations require CLOSED, a closure anchor and the **same current ACCEPTED full-handover package** as recorded on the aftercare case; no accepted package or project state is modified.
2. The legacy `/defects/:id/{remedy,close}` URLs now resolve the actual tenant-owned defect project in PermissionGuard before RBAC. The service independently resolves its exact project when the scoped route ID is absent and rejects inconsistent project IDs.
3. Guest supplier remedy requires live unexpired SUPPLIER_CONTRIBUTOR grant, active party, explicit `defect.manage` capability, matching assigned party, asset IDs and categories, and a writable scope. Revoked/read-only/archived/wrong party fail closed.
4. Internal member remedy requires the currently assigned user if assigned. Unassigned Site/QC contributors cannot seize work; PM/owner can handle unassigned triage. MEMBER asset/category/date/read-only restrictions are checked at the mutation boundary.
5. Internal independent verification requires authorized QC/PM/owner/admin role and retains no-self-verification by assignee/remedy performer.
6. List queries now enforce supplier party and asset/category restrictions and member asset/category/date restrictions; Site/subcontractor lists are further narrowed to user assignment. Distinct aftercare counts remain visible but do not mutate accepted closeout or create false retention eligibility.

## Test additions and replay required
- `apps/api/test/phase4-pass1-defect-lifecycle-authority.spec.ts`: postclose/terminal negatives, project-first lock order, approved aftercare remedy, changed dossier, assignee mismatch, narrowed resource/date/read-only, QC/PM role and unscoped service route.
- `apps/api/test/phase4-pass1-defect-route-guard.spec.ts`: exact project resolution for standalone defect-ID HTTP alias.
- `apps/api/test/phase4-defect-supplier-scope.spec.ts`: live party/capability, read-only, wrong category, revoked grant, exact scoped listing.
- `apps/api/test/phase4-aftercare-db.spec.ts`: independent real PostgreSQL transaction where project closure holds the row lock before a racing mandatory defect creation, plus retained aftercare constraints.
- Adapted historical mocks to reflect project-first locking and qualified verifier authority.
- **Exact latest-head CI**: not established until the pipeline completes and its final commit SHA is recorded. Older passes cannot certify this patch.

## Important remaining acceptance gates — NOT CLOSED
- Actual multi-process customer browser/HTTP sessions for every role, revoked membership, current assignee/party/delegation and all aliases; current unit guards + SQL tests are insufficient for independent G17-004 acceptance.
- Controlled assignment, rejection, revision, waiver and reopen flows from Pass 02; explicit identity delegation and aftercare customer notice policy; compare provider-authoritative repair decisions with real evidence (G17-007 external).
- Synthetic acceptance package records prove only referential behavior, **not** actual customer consent, OEM approval, HVAC configuration or provider delivery.
- Retain original G17-003/004 status **PARTIAL / VERIFY**. No independent reviewer has signed these two rows against this pass's integrated candidate.

## Exit decision
WIP / NO-GO until full exact-head CI, real transaction concurrency & HTTP scope matrix and independent reviewer evidence. Do not merge or deploy.
