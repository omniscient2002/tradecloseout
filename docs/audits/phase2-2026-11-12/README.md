# Phase 2 — Organisation & Project Setup: production-readiness audit

**Decision: NO_GO.** This source-pinned audit identifies **58 consolidated required-work items** across the five groups in the user's order. Each item states the defect or missing workflow, source, correction and meaningful acceptance checks. These are audit items, not 58 independently reproduced exploits. Code defects, workflow gaps and external release gates are labelled separately. Cross-group entries may share one correction; the total counts group work items, not unique vulnerabilities.

| Order | Group | Report | Required-work items | Decision |
|---|---|---|---:|---|
| 6 | G20 | [Email, SMS and notification delivery](G20.md) | 12 | NO_GO |
| 7 | G18 | [Subscriptions, entitlements and seat limits](G18.md) | 10 | NO_GO |
| 8 | G03 | [Organisation management, teams and ownership](G03.md) | 12 | NO_GO |
| 9 | G05 | [Project creation, teams and lifecycle](G05.md) | 12 | NO_GO |
| 10 | G06 | [Configuration, trade packs and templates](G06.md) | 12 | NO_GO |

Assessed 2026-11-12 Asia/Calcutta; executed 2026-11-11 UTC. Source snapshots:

- Canonical `main`: `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. This remains the repository baseline, not the audited proposed repair state.
- Primary shared foundation candidate: [PR16](https://github.com/omniscient2002/tradecloseout/pull/16), `e1b2d9506f2f5d1cbd853a91cade58f8bab3cee4`. Used for G20/G18/G05/G06 and the shared G03 state.
- Separate G03 partial-repair candidate: [PR13](https://github.com/omniscient2002/tradecloseout/pull/13), `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08`. Compared and independently probed; **not merged with PR16** and not represented as integrated behavior.
- Prior work: [Phase1 audit PR15](https://github.com/omniscient2002/tradecloseout/pull/15), [main-snapshot G03 audit PR14](https://github.com/omniscient2002/tradecloseout/pull/14), and [canonical 23-ID G03 audit PR11](https://github.com/omniscient2002/tradecloseout/pull/11). This phase credits proposed repairs and does not repeat a stale finding as if it remained on every branch. G01/G02 are not separately audited again.

## Main blockers

1. G20 accepts prohibited message content, exposes unscoped broadcasts, lacks reliable business-delivery reconciliation/backoff and does not complete required reminder/preferences workflows.
2. G18 reports limits that differ from enforcement: no/cancelled subscriptions can activate projects, seats can exceed limits, zero storage allows intents, pending bytes are unreserved and package limits are hardcoded.
3. G03 repairs are divergent. The repaired branch still permits reassignment to commit after concurrent project closure, leaves policy/operational handoff gaps and does not complete onboarding, organisation administration or ownership/deletion workflows.
4. G05 lacks complete lifecycle transitions, admits ineligible project members, allows commercial/reference writes to closed projects, ignores reopen versions and has a project-list/search DTO mismatch.
5. G06 permits locked-item weakening, resolves a different shape from its consumer, lacks real configuration-version/installation lineage and approved active-change control, and contains document-type drift in actual companion rules.

## Evidence and verification

| Check | Exact candidate | Result |
|---|---|---|
| Frozen dependency install | PR16 | Passed without lockfile changes |
| `pnpm typecheck` | PR16 | Passed |
| `pnpm build` | PR16 | Passed |
| Clean `pnpm test`, before audit harnesses | PR16 | Passed: API 382/62 suites; shared 71/5; DB 13; worker 24; archive/auth-storage browser 10; PDF inspection/front matter/compilation checks passed |
| `pnpm test:security` | PR16 | 15 passed / 3 suites |
| `pnpm test:rbac` | PR16 | 8 passed / 1 suite |
| Independent shared observation harness | PR16 | 33 completed observations; includes successful controls and reproduced defects |
| Independent G03 observation harness | PR13 only | 11 completed observations; includes proposed-fix positives, closure race and PAST_DUE seat bypass |
| Local recheck of the two failing G03 suites | PR13 only | 2 failed / 11 passed (13 tests); ownership transfer is intentionally disabled, offboarding now requires current actor authority |
| G03 input-boundary suite | PR13 only | 5 passed |
| `pnpm typecheck` | PR13 only | Passed |
| Remote exact-head application CI | PR16 | [Success](https://github.com/omniscient2002/tradecloseout/actions/runs/43105998545) |
| Remote exact-head application CI | PR13 | [Failure](https://github.com/omniscient2002/tradecloseout/actions/runs/42991530966): 2 API tests failed / 347 passed; downstream security/RBAC/application browser steps skipped |
| Integrated PR13+PR16 candidate, full Phase2 browser journeys, real providers | No such accepted head/evidence | Not established |

The clean workspace suite was run before adding any independent harness. The observation harness is **not a passing-fixes test suite**: passing means it reproduced the recorded behavior, including defects. 44 observations do not mean 44 defects. Synthetic fixtures intentionally test authorization/quota/configuration mechanics; they are not an approved HVAC pack, customer evidence, delivered message, real login acceptance or payment settlement. The local browser subset is archive/auth-storage, not the complete application setup/lifecycle journey. Remote CI success is CI evidence, not release acceptance.

Detailed artifacts: [evidence and replay instructions](evidence/README.md), [shared results](evidence/probe-results.json), [G03 results](evidence/g03-results.json), [source hashes](evidence/source-manifest.json), [remote CI metadata](evidence/ci.json), and [machine-readable required-work register](findings.json).

## G03 finding identity and proposed fixes

All **23 original G03 IDs** are reconciled once in [G03.md](G03.md#reconciliation-of-all-23-original-g03-ids) and [JSON](evidence/g03-reconciliation.json). The canonical register is unchanged. Candidate-local proposed fixes, partial fixes, safe disabled features and remaining gaps have different dispositions. The 38 findings in PR14 were a separate main-snapshot inventory and are not replacements for the original 23 IDs.

PR13 positives include functioning dashboard, partial profile update/clearing, restricted metadata audit, validation, self-replacement denial and invitation business events. Two-party ownership is safely disabled, not implemented. Seat enforcement works for the tested ACTIVE plan but fails open for PAST_DUE. Reassignment rejects an already closed project yet still races closure. These distinctions must survive implementation handoff.

## Implementation sequence

1. Integrate current Phase1/G03 fixes on one feature candidate; preserve authority/tenant/audit controls and resolve its failing regressions without weakening them.
2. Define the authoritative entitlement, operation-aware suspension and project lifecycle/lock contracts. Repair seats/storage/project/package usage with atomic, idempotent reservations and reconciliation.
3. Fix G06 canonical schema, immutable version/pack lineage, reviewed catalogue mappings and approved active-change applicator before adding richer setup flows.
4. Repair project/team/commercial writers and their typed web/API contracts, then complete configuration/onboarding/organisation administration journeys.
5. Complete safe event-to-recipient notification producers, templates, retry/receipt scheduling and real delivery adapters.
6. On the final integrated head, run the group acceptance matrices, exact-head CI, full real application browser/concurrency tests and independent domain/provider/operational review.

The product phase labels remain authoritative. MVP blockers are distinguished from V1/V2 additions in each report. Existing exposed V1 paths still need safe behavior; deferred functionality must be honestly unavailable. No approval policy or release scope is changed by this audit.

## Exit criteria

A production claim requires corrected code/workflows for the approved release scope, exact-head passing CI, independently reviewed tenant/authority/concurrency controls, real application journeys, reviewed HVAC mappings and genuine provider/operational/retention acceptance. Keep external gates blocked until their evidence exists. Preserve migration immutability, real scanned/versioned evidence, accepted-package closure checks and read/export retention.

This publication changes documentation/evidence only. It does not fix application code, merge, approve, deploy, send production messages or authorize destructive deletion. No finite audit can guarantee every possible defect has been found. The owner retains merge and deployment authority.
