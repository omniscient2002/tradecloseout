# Phase 3 Pass 03 — PH3-G11-001: single terminal review decision

**Status: PARTIAL / VERIFY — not independently CLOSED or production-certified.** Priority P0. Draft PR #22: `phasepilot/production-v1-phase-03`. Original finding: `docs/audits/remaining-phases-2026-11-12/phase3/G11.md` at audit commit `f51a90894589091ddeaeaeefea14f86473479568`. Reported R38: reviewer A APPROVE followed by reviewer B REJECT against the same version; both previously succeeded, leaving a contradictory document pointer.

## Engineering changes

1. `apps/api/src/modules/reviews/reviews.service.ts`: a review command first resolves an assignment without a lock solely to identify the common document version. It then acquires **document_versions FOR UPDATE before reviews FOR UPDATE**, re-checks the current assignment/actor, state, binding and version under lock, and refuses any terminal or non-submitted state. The version row is the unique serialization point across sibling stages, version aliases and external approval. No review row is locked before the version, avoiding the sibling-cancellation deadlock.
2. One successful terminal decision cancels all other `PENDING`/`IN_REVIEW` review assignments for that version, across stage keys, with a durable row-version bump and cancellation provenance. `APPROVED`, `REJECTED`, `CHANGES_REQUESTED`, `SUPERSEDED` and `WITHDRAWN` versions cannot be re-decided. The current-approved pointer cannot be decided again even if historical review_status is inconsistent.
3. Version submission now requires `NOT_SUBMITTED` under a real version row lock; submission cannot revive a terminal document version or silently recreate an actionable assignment after settlement. This preserves the existing explicit submission transition.
4. Internal approval updates the pointer and linked requirements as before; rejection or changes-requested now transitions still-in-review linked requirements to the corresponding outcome (without downgrading an independently APPROVED obligation), inside the same transaction and audit event.
5. `recordExternalApproval` uses the same terminal-state and pointer guards. Its accepted external result also cancels active internal assignments and atomically records linked requirement status plus an external-approval audit event with immutable references, without representing independent external identity evidence as verified.
6. `apps/api/src/modules/reviews/review-decision.service.ts` legacy helper no longer allows an EXTERNAL bypass from terminal/withdrawn/unsubmitted states and settles residual active assignments before committing. The generic arbitrary-review override remains deliberately disabled by existing code.

## Regression changes

- `apps/api/test/phase3-review-first-wins.spec.ts`: restricted PostgreSQL 16, two distinct assigned reviewers and stage keys, third-party uploader, verified stored bytes, live checklist requirement. Tests serial APPROVE → REJECT reversal, simultaneous APPROVE vs REJECT and APPROVE vs REQUEST_CHANGES with exactly one winner, sibling CANCELLED states and version increments, no duplicate review audit, pointer consistency, requirement outcome, rejection-first finality, no resubmission/alias revival. Legacy external helper and direct external route reject all terminal statuses without writes.
- Pre-existing mock suites updated to reflect the **real review state machine** rather than granting a decision to an unsubmitted or fabricated DRAFT version: `review-authority-boundaries.spec.ts`, `production-reaudit-remediation.spec.ts`, `phase0-evidence-integrity-remediation.spec.ts`, and `contractor-user-journey.spec.ts`. The contractor integration fixture now marks the version IN_REVIEW when creating its reviewer assignments; authorization enforcement remains unchanged.
- Earlier exact-head CI attempt `aad0aae402c39f84a1cd9574fc9685337cfb5c2c` failed three legacy fixture assertions; **new real-PG first-wins regression suite itself passed**. Do not count earlier failing commits as evidence of release quality.
- **Exact-head CI:** review the workflow results for the final SHA; no CI status is presumed by this document.

## Independent acceptance and remaining gates

PH3-G11-001 stays `PARTIAL_VERIFY` until exact-head full CI, independent reviewer acceptance, authenticated HTTP routes and aliases with real G01/G02 permission checks, integration with Phase 1/2 authority and Phase 4/5 review consumers, interprocess fault-injection/commit ambiguity cases, provider/domain approval acceptance and consistency across all stage configurations. Tests of the first-wins implementation do not certify the full review lifecycle (G11-002..008) or externally supplied identity.

Production signing, delivery, provider configuration, deployment, merge and full production certification are explicitly excluded. Advanced multistage override approval requires a separately reviewed lifecycle and cannot silently revive a terminal version.
