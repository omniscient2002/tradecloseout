# Remaining production-readiness audits — Phases 3–5

**Decision: NO_GO for production.** This bundle identifies concrete corrections, incomplete workflows and required real-world acceptance; it does not implement fixes or approve a release.

**18 groups · 135 work items · 7 P0 · 126 P1 · 2 P2.** Types: 77 code defects, 36 workflow gaps, 3 control gaps and 19 external release gates. Counts include related group responsibilities and are not unique root-cause totals.

Application source: [`36c8efb94ce2ed77ef016ef58ad44d494bfc6e84`](https://github.com/omniscient2002/tradecloseout/commit/36c8efb94ce2ed77ef016ef58ad44d494bfc6e84) (PR16). Documentation base: `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. Separate G03 proposal: `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08` (PR13), not integrated or certified here. Execution date: **2026-11-11 UTC**; the directory label continues the existing 2026-11-12 audit naming convention.

[Implementation order](FIX-ORDER.md) · [Production acceptance and owner decisions](PRODUCTION-ACCEPTANCE.md) · [Machine-readable findings](findings.json) · [All-phase references](all-phases-index.json) · [Evidence, methods and replay](evidence/README.md).


## Group reports

| Order | Group | Phase | Work items |
|---|---|---|---:|
| 11 | [G07 — Checklists, requirements and waivers](phase3/G07.md) | 3 | 7 |
| 12 | [G08 — Assets, equipment and system relationships](phase3/G08.md) | 3 | 8 |
| 13 | [G10 — Secure uploads, scanning and file storage](phase3/G10.md) | 3 | 8 |
| 14 | [G09 — Document management, revisions and metadata](phase3/G09.md) | 3 | 7 |
| 15 | [G04 — External-party access and guest workflows](phase3/G04.md) | 3 | 7 |
| 16 | [G21 — Workflow orchestration and responsibility tracking](phase3/G21.md) | 3 | 7 |
| 17 | [G11 — Reviews, approvals and separation of duties](phase3/G11.md) | 3 | 8 |
| 18 | [G12 — Signatures, attestations and verification](phase3/G12.md) | 3 | 6 |
| 19 | [G13 — HVAC inspections, testing and commissioning](phase4/G13.md) | 4 | 7 |
| 20 | [G17 — Defects, rectifications and closure](phase4/G17.md) | 4 | 7 |
| 21 | [G25 — PDF generation, archives and evidence verification](phase4/G25.md) | 4 | 8 |
| 22 | [G14 — Handover package generation](phase4/G14.md) | 4 | 8 |
| 23 | [G15 — Customer submission, response and acceptance](phase4/G15.md) | 4 | 8 |
| 24 | [G16 — Warranty tracking and management](phase4/G16.md) | 4 | 6 |
| 25 | [G19 — Billing, payments, retention and tax](phase4/G19.md) | 4 | 8 |
| 26 | [G23 — Complete frontend journeys, accessibility and UX](phase5/G23.md) | 5 | 8 |
| 27 | [G22 — Offline data capture, mobile synchronization and recovery](phase5/G22.md) | 5 | 8 |
| 28 | [G28 — Deployment, backups, CI/CD, E2E tests and release verification](phase5/G28.md) | 5 | 9 |

P0 marks release-critical authorization/evidence/containment failures; P1 marks required pre-release correction or acceptance for the selected scope; P2 marks conditional later-feature hardening. These are audit priorities, not CVSS scores. SOURCE_CONFIRMED is static inspection; TARGETED_RUNTIME_OBSERVATION is an exercised path with the documented fixture boundaries; EXTERNAL_NOT_PROVIDED remains blocked.

## Highest-priority integrity corrections

- [PH3-G08-002](phase3/G08.md#ph3-g08-002) — Enforce asset scope on every mutation and derived view.
- [PH3-G10-002](phase3/G10.md#ph3-g10-002) — Reject mutable null-version storage receipts.
- [PH3-G11-001](phase3/G11.md#ph3-g11-001) — Make the first terminal document decision win across assignments.
- [PH3-G12-001](phase3/G12.md#ph3-g12-001) — Reject caller-minted verified witness fields at inspection creation.
- [PH4-G25-001](phase4/G25.md#ph4-g25-001) — Remove active PDF actions in the actual dossier pipeline.
- [PH4-G14-004](phase4/G14.md#ph4-g14-004) — Reject non-immutable and unqualified artifact receipts.
- [PH5-G28-001](phase5/G28.md#ph5-g28-001) — Make incident containment effective without weakening evidence constraints.

Other reproduced defects include partial commits in atomic asset import, invalid delete/restore quota SQL, stale latest-version publication, compressed-PDF object-limit bypass, expired offline URLs and duplicate concurrent replay commands. See the exact observations before extrapolating impact.

## What was verified

- Frozen install, typecheck and production build pass on the pinned application source.
- Clean workspace tests pass: API 383 tests / 63 suites; shared 71 / 5; database 13; worker 31; archive/auth-storage browser 10; PDF engine checks pass.
- Negative security checks pass (15 tests), as does the role matrix (8). Current source GitHub CI and group protocol runs report success; metadata is preserved.
- New API/worker harness records 45 named actual-source observations in one Jest test, including positive denials. New Chromium harness records two actual-module/IndexedDB observations. These 47 observations are not 47 independent bugs and not 47 complete integration tests.
- Six existing application browser contracts pass with production-built Next and real API/PG/Redis available: two live authentication flows, two pure function contracts and two browser flows using intercepted responses. OTP delivery is a fixture. Full Phase3/4 business E2E, real S3/scanner/provider acceptance and production deployment were not demonstrated.
- Published portable harnesses are replayed from the evidence directory; see replay logs and source inventory. No production database, customer evidence or live charging/sending was used.

## Existing Phases 1–2 and source drift

Preserve [Phase1 PR15](https://github.com/omniscient2002/tradecloseout/pull/15) / [49 original items](https://github.com/omniscient2002/tradecloseout/blob/c605263891bcc0976b4af7429f74a59b6c573757/docs/audits/phase1-2026-11-12/README.md) and [Phase2 PR17](https://github.com/omniscient2002/tradecloseout/pull/17) / [58 original items](https://github.com/omniscient2002/tradecloseout/blob/470ea86728021b3fd8a715e5704cb1c890154a43/docs/audits/phase2-2026-11-12/README.md). G01 and G02 are not duplicated. The all-phase index references **242 group work items** across 28 groups; overlap means this is not 242 unique defects.
Prior audits have different source SHAs. Do not carry a stale reproduction forward as a current fact. PR16 now changes notification producer/delivery/dispatch/scheduler code and adds migration0045 relative to the Phase2 source; claim/retry/deduplication fixes need independent revalidation under their original PH1/PH2 IDs. No old item is silently closed here. [Source drift and reconciliation](evidence/prior-source-drift.json) records changed files and prior IDs.
Original G03 findings and their existing reconciliation remain authoritative; PH2 G03 responsibilities do not redefine the original canonical IDs. No canonical group register, review status, main branch or application source is modified by this audit.

## Scope and interpretation

The user’s five-phase map defines group ownership. Specifications distinguish MVP, V1 and V2: full offline work is explicitly outside MVP; cryptographic provider signing is V2; advanced workflow stages and customer-content break-glass are later scope unless separately approved. Safe 410/denial is a positive control. Implemented queued uploads, attestations and exported claims still require reliable behavior if shipped.
Closed baseline changes require formal reopening. New post-handover warranty defects and approved deferred/seasonal tests may be legitimate; a documented append-only post-close policy must distinguish them from rewriting accepted evidence.
No finite audit can promise every possible future bug. Calling a release production ready requires the corrections, scope decisions and independent real-world gates in the acceptance file, all on one final integrated candidate. This report never substitutes synthetic READY/APPROVED records for real qualification.
