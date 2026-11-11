# Phase 1 — Security & Platform Foundations

**Release decision: NO_GO.** One consolidated audit per requested group, in the
owner's order. Existing G01/G02 work was reconciled once against current source;
their canonical finding IDs and acceptance policy were not overwritten.

| Order | Group | Scope | Open Phase 1 items | Audit |
|---|---|---|---|---|
| 1 | G26 | Database schema, constraints, migrations and transactions | 11 | [G26 report](G26.md) |
| 2 | G01 | Authentication, OTP, MFA and session security | 7 | [G01 report](G01.md) |
| 3 | G02 | RBAC, permissions and resource isolation | 9 | [G02 report](G02.md) |
| 4 | G27 | Security controls, audit integrity and observability | 10 | [G27 report](G27.md) |
| 5 | G24 | Background workers, queues, retries and scheduling | 12 | [G24 report](G24.md) |

The 49 entries distinguish reproduced defects, source-confirmed changes and
operational acceptance gates. Some are deliberately shared dependencies rather
than 49 independent vulnerabilities. No finite review proves all possible bugs absent.

## Source selection and current status

- Main `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`: build and workspace tests passed locally, but this lacks
  substantial unmerged G01/G02 corrective code.
- G01 PR #5 `863e6e0c56ad4a92af2580fbcbfc179832056b2d`: existing authentication candidate.
- Primary assessment: G02 PR #12 `9ed91a9e96c77c9eff967f6c845d18c38fb62ac6`, which stacks on the G01 candidate.
  Its typecheck/build/API regressions fail; successful older G01 CI is not evidence
  that this later combined release passes. Preserve stack ancestry when integrating.
- Source manifest verifies 199 inspected application-source/migration files against
  candidate Git blobs. Prior G02 docs are in PR #10; G03 candidate audit/partial
  implementation are PR #11/#13, separate from this Phase 1 scope.
- Earlier G03 main-snapshot audit was pushed in [PR #14](https://github.com/omniscient2002/tradecloseout/pull/14).
  Its snapshot lives outside canonical group registers to avoid conflicting IDs.

## Fix order and shared ownership

1. **G26/G27 audit boundary:** remove direct partition bypass; protect the ledger
   and add independent head/count/metadata verification. P01-P05 prove current gaps.
2. **G01/G27 secret handling:** remove plaintext MFA response capture and repair
   current-key operation across previous-key expiry. P19-P21 prove those mechanisms.
3. **G02/G26 current authority:** close document scope/read-only and projectless
   bulk review gaps; revalidate live account/member/org state. P13-P14/P22-P24.
4. **G26/G24 state correctness:** fix quota SQL and reconcile blocked scan outcomes;
   align schema/ORM and preserve migration/tenant/owner invariants. P06/P25.
5. **Integration baseline:** resolve type/fixture/contract regressions with valid
   reviewed fixtures. No casting away errors, weakened constraints, deleted tests
   or mocked success may stand in for the claimed controls.
6. **G24/G27 operations:** fenced leases, short claims, durable retries/dead-letter,
   idempotency outcome reconciliation, graceful shutdown, real readiness and alerts.
7. **Release evidence:** all original G01/G02 obligations, actual providers/HTTPS/
   two-node failure tests, human IAM/legal authority, restore/load/incident drills
   and independent exact-head review. User retains merge/deploy authority.

## Reviewable handoff

Start from each report's observation, required correction and acceptance scenario.
Preserve original G01-001..021 and G02-001..017; new IDs use PH1-Gxx-NNN. The
[machine-readable register](findings.json) has all 49 OPEN items. [Evidence](evidence/README.md)
records commands, observations, source hashes and limitations. The reports list
specific per-group production gates and a full reconciliation table for G01/G02.

The implementation agent must reply per ID with exact fix SHA, meaningful positive/
negative/concurrency/crash evidence and remaining external blockers. Independent
review decides verification; neither this audit nor its reproductions self-approve
the implementation, change coordinator policy, merge or certify a release.
