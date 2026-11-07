# TradeCloseout — Product Simplification

**Status:** Second-pass analysis only; no application source changes  
**Date:** 4 November 2026  
**Principle:** Remove unsafe duplication and unnecessary administration before adding new lifecycle capabilities

## 1. The central simplification challenge

TradeCloseout currently risks two kinds of overengineering at once:

1. **Unsafe breadth:** simulated integrations, multiple competing review/supplier paths and demo behaviour create the appearance of a large product without dependable core workflows.
2. **Conceptual breadth:** adding BOQ, procurement, RFIs, inspections, commercial and archives as separate full modules would recreate the ERP that earlier strategy correctly rejected.

The remedy is not simply “fewer features.” It is **one coherent obligation/evidence/authority model**, optional complexity by contract type, and external systems for generic accounting/CAD/communication.

## 2. Remove or quarantine immediately

These are removal/quarantine recommendations, not actions taken in this mission.

| Candidate | Why remove/quarantine | Replacement |
|---|---|---|
| Generated “certified” PDF when original is missing (`documents.service.ts`) | Fabricates evidence confidence | Explicit storage-unavailable/not-found response and incident telemetry |
| Client-controlled EICAR/sample virus decision | Not malware detection | Real server-side AV and structural verification only |
| Client-declared DSC/certificate success | Unverified metadata is not a valid signature | Remove from production until real provider/CMS/certificate verification exists |
| No-op SMS/email providers that report success | Users cannot authenticate | Explicit development provider outside production; real production adapter/failure |
| Unsigned S3-shaped upload/download URLs | Not usable or secure storage | Real constrained adapter or disable storage workflows |
| Production persona switcher and hardcoded Deccan identity/KPIs | Demo can be mistaken for live tenant state | Authenticated org/user and authorised data only; separate demo environment |
| Local-only upload, waiver, approval success messages | Contractual operation did not happen | Server-persisted result + refetch + request ID |
| `perfect-10-patches.ts` cross-domain patch bucket | Obscures ownership and duplicates invariants | Domain-owned services and regression tests |
| Static “production verified,” O(1), zero-race/zero-data-loss claims | Unmeasured and misleading | Evidence-based release notes and measured operating limits |

Do not remove existing historical records with these features. Mark unverified/synthetic evidence for reconciliation without deleting it.

## 3. Consolidate competing implementations

### 3.1 Reviews and approvals

**Current duplication:** `ReviewsService`, `review-decision.service.ts`, external approval methods and transmittal stamp-back each implement different checks and state updates.

**Simplification:**

- One `ReviewDecisionService` for in-app, external and bulk decisions.
- Input methods differ; invariants do not: verified file, exact version, current submission, role/scope, self-approval, authority, comments/evidence, row version.
- One state mutation path writes review + satisfaction + audit/outbox in one transaction.
- Transmittal stamp-back becomes an external decision input referencing an exact hop/version, not a second approval engine.

### 3.2 Supplier and guest access

**Current duplication:** `PartiesService` and `SupplierGuestService` create different grants, capabilities and scope semantics.

**Simplification:**

- One grant type/lifecycle and token exchange.
- One grant-bound session/actor and CSRF policy.
- One scoped upload service for staff and guests with scope checked every operation.
- Supplier upload always enters screening; it never becomes satisfaction directly.
- OTP/PIN is a policy choice, not two incompatible product flows.

### 3.3 Tenant transactions and permissions

- Keep one transaction wrapper with tenant RLS, audit and outbox rather than alternating wrappers with inconsistent context.
- Keep one canonical permission matrix, not separate old/new role maps.
- Evaluate application permission and contractual authority separately, not through ever-growing role checks.
- Do not simplify away RLS, composite FKs, project scope or guest checks.

### 3.4 Status vocabulary

Persist fewer canonical states:

- File: pending/uploading/processing/ready/quarantined/failed/archived.
- Review: not submitted/in review/approved/changes requested/rejected/withdrawn/superseded.
- Requirement work: open/assigned/ready/in review/changes required/closed/superseded.
- Package/submission and commercial states as defined in target model.

Derive `MISSING`, `OVERDUE`, `EXPIRING`, `APPROVED_EXTERNAL`, `HANDED_OVER`, `EXECUTED_AT_RISK` where appropriate. Remove `UNDER_REVIEW` vs `IN_REVIEW` and `ACCEPT` vs `ACCEPTED` duplication through versioned migration, not a new alias layer forever.

## 4. Simplify the database rather than multiply it

| Area | Consolidation decision | Historical safeguard |
|---|---|---|
| `document_requirements` vs `requirement_evidence` | New exact-version model is authoritative; old table only discovery/backfill | Preserve old rows and source uncertainty; no auto-invented approvals |
| `document_assets` | Retain for finding documents by equipment, not satisfaction | Avoid duplicate equipment/evidence logic |
| Project contract value in columns and `settings_json` | One contract baseline owns commercial values; project has summary projection only | Migrate values with source precedence report |
| Organisation/profile self-approval and doc-controller settings | One settings source with version/provenance | Map legacy settings explicitly |
| Requirements scope string and future scopes | Formal scope links become authoritative; keep original source key for trace | Backfill known project/assets, unresolved queue otherwise |
| Reviewer subject types | Real user/party/contact/authority subject, no `ROLE` or random UUID placeholders | Do not fabricate missing authority |
| Submission recipient IDs and decisions | One recipient identifier and canonical decision values | Migrate flat recipients into initial transmittal hop |
| Defect severity/timestamps/location | One domain schema consistent with service | Backfill `MINOR` only with explicit mapping, never silently lose severity |
| RA `handover_packages` vs technical handover packages | Package `type`: `HANDOVER | RA_EVIDENCE | TRANSMITTAL | ARCHIVE`, shared items/artefacts | Keep IDs and existing status history |
| Drizzle declarations vs SQL migrations | SQL migrations define deployed schema; generate/check types against it | Clean + upgraded schema contract CI |
| General domain events vs every business table | Keep domain-specific current tables; append-only events for history/projections | Do not replace relational data with EAV/event-only store |

### Explicitly avoid new duplication

- Do not create a separate `obligations` table parallel to `requirements`; extend requirements with sources/dependencies.
- Do not create BOQ lines for projects that only need document closeout.
- Do not create assets for metres of duct/pipe; use system/location quantity scopes.
- Do not add a warranty row per every part by default; add coverages only when terms differ.
- Do not store original text, OCR text, cleaned text, thumbnail and several PDF copies under one permanent retention class.
- Do not turn every meeting/chat into a correspondence entity; only decisions/instructions with operational impact.

## 5. Simplify screens and user work

### 5.1 Company experience

**Consolidate:** four role-specific dashboard presentations → one Work Inbox + one portfolio exception view + one management digest.

- Same authorised data, different default filters by role.
- Owner sees waivers/commercial, QC sees reviews, site sees captures, procurement sees suppliers.
- No separate static `Site Dashboard`, `QC Station`, `Owner Workspace` and `PM Command Center` implementations.

### 5.2 Project experience

Keep distinct tasks, but merge duplicate technical implementations:

- Requirements and checklist are one workspace; “customiser/import/change requests” are views/actions within a single configuration centre.
- Equipment register and equipment passport are list and detail of one record, not two models.
- Document centre is discovery; requirement detail is action. Do not merge them into a huge form.
- Review queue and version workbench are queue and detail of one decision flow.
- Handover, RA evidence and transmittal use one package builder with type/layout, not different compilers.
- Defects/warranty/service are one aftercare workspace with equipment context, not disconnected billing and warranty modules.
- Project activity is one chronological view, not separate per-entity history implementations that disagree.

### 5.3 External experience

One guest shell with purpose-specific projection:

- `SUPPLIER_UPLOAD`
- `CONSULTANT_REVIEW`
- `CLIENT_ACCEPTANCE`

All use the same grant verification, expired/revoked/offline/error states and external-status receipt. Do not create a full supplier dashboard or generic social collaboration portal.

## 6. Defer or integrate externally

| Capability | Decision | Reason |
|---|---|---|
| Full accounting, RA invoicing/tax/ERP reconciliation | INTEGRATE | TradeCloseout stores technical eligibility and event evidence; accounting system owns statutory books |
| Complete Aconex/Procore/Autodesk CDE | INTEGRATE/EXPORT | Subcontractor needs private preparation and returned-decision capture, not another mandatory CDE |
| Full Bluebeam/CAD/BIM markup and model coordination | INTEGRATE | Focus on evidence/version context and basic comments/compare |
| Native iOS/Android | DEFER | Prove PWA/offline/device needs first |
| WhatsApp Business API | DEFER | Deep links/manual share until measured message volume/economics justify provider |
| Real DSC/e-sign | INTEGRATE LATER | Use actual trusted signing provider if customers demand it |
| IRP/GSP e-invoice and complex subscription billing | DEFER/CA REVIEW | Do not let platform billing distract from evidence product; use simplest compliant collection first |
| Office/DWG general conversion | DEFER | Preserve originals and support PDF/image; conversion only for measured demand with sandboxing |
| OCR/LLM everything | DO NOT BUILD | Deterministic high-value extraction first; opt-in labelled use cases later |
| Predictive supplier/consultant scoring | DO NOT BUILD | Small biased data and waiting-reason confounding; use factual intervals |
| General PM scheduler/resource planner | DO NOT BUILD | Only upstream closeout and instrument/witness dependencies |
| General correspondence/chat | DO NOT BUILD | RFI/instruction/decision records only; email remains transport |
| Preventive-maintenance CMMS | DO NOT BUILD | Warranty/service-resolution and DLP only |
| Event-sourced everything/graph DB/data lake | DO NOT BUILD | Relational current state + targeted read models suffice |
| Native custom workflow designer | DEFER | Canonical internal states + external wording maps cover most needs |

## 7. Simplify automation and AI

### Build deterministically

- Exact hashes and duplicate candidates.
- Alias/serial candidate matching with human confirmation.
- Dependency-based missing attachments and equipment identity mismatches.
- Expiry/calibration/range/unit rules.
- Lead-time/actor interval calculations.
- Coded rejection and supplier follow-up lists.
- Draft transmittal/index and archive verification.

### Avoid unless separately justified

- Contract legal interpretation or “compliance guaranteed.”
- AI-generated supplier scores or approval predictions.
- AI-created equipment/BOQ links without confirmation.
- AI-authored external approval, variation amount, RA value or warranty entitlement.
- Unlabelled document-to-structured-test conversion at scale.
- Confidential document processing by default third-party APIs.

This removes substantial privacy, evaluation and per-document cost without giving up most administrative savings.

## 8. Simplify operations and storage

### Storage classes

1. **Original evidence:** immutable, retention/legal-hold governed.
2. **Accepted artefacts:** immutable issued package/manifest with same or explicitly reconciled obligation.
3. **Derived working files:** preview/thumbnail/OCR/compiler temp, reproducible and shorter-lived.
4. **Aborted/orphaned uploads:** expire through measured lifecycle rules.
5. **Archive exports:** self-verifying, versioned and customer-downloadable.

Do not deduplicate physical objects across tenants by hash alone. Within a tenant, deduplication must respect legal ownership, access and deletion policy.

### Worker simplification

- One queue/event envelope and idempotent consumer pattern.
- Keep qpdf for bounded merging but profile all pdf-lib whole-file operations; no O(1) claim by assertion.
- Keep ClamAV, but no “offline means clean” fallback.
- No extra Office conversion stack unless customer evidence requires it.
- Clean up abandoned multipart and temporary compilation files deterministically.

### Test simplification

- Replace tests of locally reimplemented helper rules with tests of actual production service paths.
- A review test must call the same controller/service the browser uses.
- A virus test must prove real server scan gating, not `content.includes('EICAR')` in test code.
- A concurrency test must use actual concurrent DB transactions, not a boolean mock lock.
- A package test must inspect real PDF/ZIP/manifest and recipient decision, not just returned count.
- Keep meaningful RLS/RBAC/integration tests; do not remove them to make the suite smaller.

## 9. Resolve conflicts in earlier and new recommendations

| Tension | Resolution |
|---|---|
| One primary approved document per requirement vs quantity/commercial reality | Keep simple satisfaction for document requirements; add separate quantity acceptance for contracts that need it, not a universal many-document aggregate |
| HVAC focus vs broader lifecycle | HVAC remains market boundary; obligation/procurement/quantity concepts are trade-neutral but enabled selectively |
| Offline compression vs original evidence | Original stays immutable; compressed preview is a rendition, with user/policy choice for original capture |
| Work Inbox vs RFI/transmittal correspondence | Inbox remains action queue; RFI/hops supply current holder/action rather than creating a second inbox |
| Event-sourced history vs simple modular monolith | Relational current state + append-only events + read models; no replay requirement |
| Portable archive vs recurring hosted revenue | Portable export increases trust and offers a lower-cost continuity option; live coordination/new projects drive subscription value |
| Supplier intelligence vs fair performance measurement | Use factual cycle/waiting intervals and source context, never opaque scoring |
| BOQ detail vs simple onboarding | Enable quantity model only for item-rate/quantity-driven customers; others see document/equipment workflow only |
| Security controls vs UX simplicity | Hide complexity but never remove scope, verification or authority; task-first screens show only next valid action |
| Rich future model vs small team | Implement only vertical slices proven by customer artefacts, not all proposed tables at once |

## 10. Simplified target product shape

```text
1. Access & authority
2. Obligations & configuration
3. Equipment & execution
4. Evidence & verification
5. Reviews & decisions
6. Handover & custody
7. Warranty & commercial continuity
8. Platform reliability, archive & export
```

Every new capability must belong to one of these domains and answer a real contractor obligation. If a feature belongs to accounting, inventory, scheduling, CMMS, CAD/BIM or generic chat, integrate externally rather than grow another application module.

## 11. Simplification acceptance criteria

- One production path exists for each business decision and upload flow.
- No two sources of truth define current approved evidence, project contract, permission or external status.
- Users can complete core work without encountering BOQ, advanced Cx or commercial entities unless their contract requires them.
- No production demo behaviour, fake provider or unverified signature remains.
- New original evidence is not multiplied into unlimited permanent derivatives.
- Data can be exported and independently verified without application availability.
- The feature set is smaller in operational responsibility, even as obligation provenance becomes richer.
