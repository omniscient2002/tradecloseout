# Production acceptance and owner decisions

**Current decision: NO_GO.** This file states what must be achieved. No production readiness or independent approval is granted by the audit.

## Decisions to settle before implementation is accepted

| Decision | Accountable owner | Required recorded outcome |
|---|---|---|
| Exact MVP and supported feature flags | Product + engineering | Requirement IDs with MVP/V1/V2 applicability; disabled later scope; no misleading UI promises |
| Post-handover records | Product + HVAC + contract owner | Append-only defects/claims/deferred tests versus baseline changes requiring formal reopening; how new issues affect accepted history |
| Engineering evidence and technical procedures | Independent qualified HVAC reviewer | Reviewed catalogues/packs, five real checklist mappings, asset rules, test design/procedures/tolerances and genuine witness expectations |
| Counterparty authority and attestation | Security + customer/legal owner | Independent representative verification, current grants, exact content/consent, revocation/correction and privacy policy |
| Finance, warranty and tax | Accountable finance/legal + OEM/contract owner | Current jurisdiction/date rules, invoice/IRP applicability, TDS/Form16A, settlement, genuine coverage events and informational retention boundaries |
| Storage/PDF/archive trust | Security + storage/records owner | Real version/checksum semantics, scanning, active-content removal, originals/derivatives, archive authenticity anchors and legal holds |
| Browser/mobile support | Product + accessibility + field users | Supported devices, connected MVP/transient-loss contract, local retention and explicit draft recovery, accessibility acceptance |
| Deployment and recovery | Operations + security | Immutable release pipeline, role separation, rollback, RPO/RTO, physical object restore and tested incident containment |

## Evidence required on the same immutable candidate

| Gate | Acceptance evidence | Current state |
|---|---|---|
| All applicable audit work | Canonical IDs from Phases1–5 dispositioned; each fix with meaningful regression and independent review; formal product approval for genuine exclusions | OPEN |
| Security/isolation | Restricted-role DB/RLS and current-authority tests for member/guest/operator; cross-tenant/project/asset negatives; no self-approved review/forged witnesses | OPEN |
| Verified evidence | Real object provider version/checksum/observed bytes, actual scanner clean/quarantine, interrupted multipart transfers and unchanged original digests | BLOCKED_EXTERNAL |
| Review and scope | Concurrent terminal decisions, uploader independence, expiry/revalidation and shared readiness; controlled baseline changes/closure race | OPEN |
| Complete business browser journey | Real web/API/DB/worker setup→evidence→independent review→package→genuine counterparty response→closure; rejected/error/recovery branches | OPEN |
| Technical/warranty/finance | Qualified domain reviewers, approved real examples, genuine OEM/contract coverage, sandbox payment/IRP/TDS receipts and reconciled exact money | BLOCKED_EXTERNAL |
| Generated deliverables | Representative multilingual/mixed-format real evidence, safe PDF/paired ZIP, exact selected versions, provenance, archive tamper/replacement/trust tests | BLOCKED_EXTERNAL |
| Delivery and notification | Actual configured email/SMS sender/template, receipts/fallback and unsubscribe/preferences as applicable; secret-free bounded replay/dead letters | BLOCKED_EXTERNAL |
| Offline/transient-loss | Supported devices with actual API/provider, process/network interruption, stale-context negatives, quota/memory budget and explicit legitimate recovery | BLOCKED_EXTERNAL |
| Accessibility/usability | Core keyboard/screen-reader/mobile/zoom journeys plus automated checks and accountable human acceptance | BLOCKED_EXTERNAL |
| Deployment/rollback | Validated staging plan, pinned promoted images/config, actual rollout smoke, failed migration/partial rollout and rollback rehearsal | BLOCKED_EXTERNAL |
| Backup/restore | Actual DB PITR plus versioned-object/key recovery, consistent checkpoint and audit continuity; measured RPO≤15min DB/≤1h objects and RTO≤4h | BLOCKED_EXTERNAL |
| Operations/capacity | Production-like scale/soak, p95 budgets, noisy-neighbour bounds, queue/disk/pool limits, alert receipts, tested runbooks and on-call owner | BLOCKED_EXTERNAL |
| Final independent decision | Product/security/HVAC/finance/ops reviewers accept the exact source/artifacts/config and remaining risk; controlled rollout and monitoring | BLOCKED_EXTERNAL |

## Acceptance record template

For every gate attach: candidate SHA; artifact/image digests; migration head; environment and safe test-data provenance; supported feature flags; command/scenario; expected and observed result; immutable logs/provider receipts; reviewer name/date; linked issue/finding IDs; exceptions and their accountable approval; rollback/containment evidence. Use separate evidence for fixture mechanics and genuine provider/domain acceptance. Keep original customer data and credentials out of the repository.

## Positive controls to preserve

- Current member/guest authority fences, restricted database runtime and existing negative security/RBAC tests.
- Asset update lifecycle locks and uploader-independent revalidation checks.
- Dedicated authenticated witness path, external-party acceptance checks and internal-actor denial; fix creation bypass without weakening those controls.
- Closed/unconfigured baseline and unsupported SVG denials; all-NA inspections stay pending.
- Disabled crypto APIs return 410 with no fake verification; invoice generation/payment execution flags remain gated.
- Archive session advisory lock, pinned source versions, strict read-back and explicit rejection of literal null provider versions.
- Offline actor/session-generation isolation, original Blob retention until verification and no service-worker caching of API/presigned responses.

The coding agent proposes fixes and evidence. It does not approve itself, merge application changes, deploy production, send customer messages or charge providers as part of this audit. Production readiness is an independently evidenced release decision after the implemented changes, not a guarantee that every future defect is impossible.
