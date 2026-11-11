# Concrete remediation order

The phase order establishes ownership; integrity dependencies determine implementation sequencing. These are proposed work packages, not completion claims. Preserve canonical PH1/PH2/original G03 IDs and link shared fixes instead of creating replacement bugs.

1. **Reconcile one application branch.** Bring approved foundation and G03 fixes together; preserve migrations and engineering invariants. Revalidate original Phase1/2 items on that head, particularly the notification changes in migration0045. Never equate app CI with independent approval.
2. **Stop forged, contradictory or mutable evidence.** Fix PH3-G12-001 (caller-minted witness metadata), PH3-G11-001 (first terminal decision), PH3-G08-002 (hidden-asset retirement), PH3-G10-002 and PH4-G14-004 (null provider versions), PH4-G25-001/002 (actual PDF action sanitation), and PH5-G28-001 (incident containment). These P0 paths need independent review before any release.
3. **Establish one qualified-evidence/lifecycle contract.** G07/G09/G10/G11/G14 share version, object, expiry, current reviewer and project-lock predicates. Fix latest-pointer rewind, delete/restore SQL, lifecycle fences, no-status-only qualification, required recipient consent and material-change invalidation. Preserve legitimate append-only post-handover work under an approved policy.
4. **Repair transactional and distributed commands.** G08 atomic import must use one client/transaction. G21 assignment/versioning and G14 per-attempt worker leases need atomic outcomes, durable audit/outbox, safe retries and old-owner fencing. Reconcile queue claims with G24 once; do not hold database locks over unbounded provider I/O.
5. **Complete MVP setup, evidence and external workflows.** Resolve Phase2 configuration/entitlements/organisation dependencies, then requirement/asset ownership, typed metadata/revision management, party delegation, submission/response, defect and warranty records. Distinguish later-phase features and explicitly disabled capabilities.
6. **Connect genuine technical and financial facts.** G13 native entries require approved procedures/design/tolerances and reviewed evidence, not a caller PASS. G16 needs OEM/contract-supported dates; G19 needs genuine invoice/provider/TDS reconciliation and honest informational retention. Obtain accountable domain decisions before configuring facts.
7. **Complete browser and recovery journeys.** G23 handles typed API contracts, role/action visibility, search/reporting/export correctness, accessible errors and actual complete business flows. G22 fixes expired URLs, drain coordination, status reconciliation and explicit same-actor draft recovery while preserving authentication fences and original bytes.
8. **Prove deployment and operation.** G28 supplies validated staging infrastructure, an actual promotion/rollback pipeline, real physical backup restore/PITR with RPO/RTO, load/soak/alert/runbook evidence and least-privilege administration. CI must exercise corrected invariants and true business journeys.
9. **Release only the final integrated artifacts.** Freeze SHA, migrations, image digests and config; finish the acceptance matrix and independent review. Keep unsupported provider/signature/invoice/offline capabilities disabled. A documentation merge is not production approval.

## Owner boundaries and shared corrections

| Shared contract | Primary implementer | Required reviewers / dependents |
|---|---|---|
| Tenant/current authority and resource scopes | G02 / G26 | G04,G08,G09,G13,G17,G21,G23 |
| Versioned verified bytes and retention | G10 / G09 | G11,G12,G14,G16,G17,G19,G25,G27 |
| Qualification/readiness | G07 / G11 | G05,G08,G13,G14,G15,G19,G21 |
| Project/baseline lifecycle | G05 / G06 | G07,G08,G09,G10,G13,G14,G15,G17 |
| Independent party authority/consent | G04 / G12 | G11,G13,G15,G17 |
| Distributed job ownership/retries | G24 / G26 | G10,G14,G20,G22,G25,G28 |
| Immutable generated artifacts and receipts | G25 / G14 | G10,G12,G15,G27,G28 |
| Runtime/UI contracts and recovery | G23 / G22 | All implemented user-facing groups |
| Production operations/release | G28 / G27 | All 28 groups and independent owners |

## Mandatory completion record per item

Record the canonical ID, implementation commit and exact integrated SHA; describe the corrected invariant and affected routes/workers; attach meaningful positive/negative/concurrency regression evidence and any real provider/domain receipt; name independent reviewer and approval date; link operational recovery and UI evidence. A passing old test, a mock status, a changed label or the coding agent’s own approval cannot close a release gate.
