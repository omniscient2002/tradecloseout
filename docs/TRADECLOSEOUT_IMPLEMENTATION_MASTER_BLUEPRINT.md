# Implementation master blueprint for Luna or Gemini 3.8 Flash

## Execution mandate and document authority

This is the principal architect's design handoff. No application code was written by this research mission. The coding agent must preserve pre-existing user changes, inspect the actual working tree and implement the selected release scope in small reviewable increments. Do not translate every roadmap opportunity into an MVP requirement. No deployment approval is implied.

Read in this order:

1. [Executive audit](TRADECLOSEOUT_EXECUTIVE_AUDIT.md): verdict, product focus and release limits.
2. [Finding register](TRADECLOSEOUT_FINDING_REGISTER.md): authoritative defect IDs, evidence and acceptance tests.
3. [Technical audit](TRADECLOSEOUT_COMPLETE_TECHNICAL_AUDIT.md): current architecture, traces, historical revalidation and coverage limits.
4. [Target architecture](TRADECLOSEOUT_TARGET_ARCHITECTURE.md): authoritative domain/entity/state/policy design.
5. [UX redesign](TRADECLOSEOUT_UX_UI_REDESIGN.md): authoritative screens, interactions, status language and visual tokens.
6. This document: API contracts, command sequencing, migration/release approach.
7. [Task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md): individually executable work and tests.
8. [Production readiness](TRADECLOSEOUT_PRODUCTION_READINESS.md) and [roadmap](TRADECLOSEOUT_FINAL_ROADMAP.md): go/no-go evidence and selected release scope.
9. [Domain research](TRADECLOSEOUT_DOMAIN_AND_MARKET_RESEARCH.md), [opportunities](TRADECLOSEOUT_PRODUCT_OPPORTUNITIES.md) and [decisions/unknowns](TRADECLOSEOUT_DECISIONS_AND_UNKNOWNS.md): researched rationale and validation limits.

These twelve new reports supersede incompatible design recommendations in prior reports for the proposed transformation. They do not erase historical facts or authorise rewriting deployed evidence. If architecture and an old test disagree, update the test to the new invariant after demonstrating the defect; never preserve unsafe document-wide approval just to pass a regression suite.

## Product contract

TradeCloseout lets a contractor prove the documentary and operational readiness of a specific contracted scope. It records source obligation, responsibility, exact evidence version, verification, reviewer authority, unresolved conditions, immutable issued package and acceptance. These are independent facts. Files are not approvals; approvals are not automatically requirement satisfaction; generation is not handover acceptance; documentary readiness is not payment certification or cash receipt.

The MVP must let a PM/DC import and issue one baseline, assign requirement owners and due dates, register equipment identity, request supplier evidence, receive verified originals/revisions, run explicit review, record a real external response with proof, understand blockers, export a real frozen dossier and track required recipient decisions. Portfolio inbox, basic search and milestone documentary readiness complete the usable loop. Basic milestone links may initially be read-only lists backed by the canonical assessment and package model; retention tranche accounting is deferred.

## API conventions and compatibility

Base path /api/v1. Request bodies are strict validated DTOs; reject unknown fields on authority-bearing commands rather than allowing a hidden isOverride. UUIDs checked before DB calls; string lengths and enum sets bounded. Business revision codes trimmed/normalized for uniqueness while original label preserved. Arrays deduplicated before validation, max 100 targets. Dates are ISO calendar dates; timestamps include timezone. Integers above safe JS range use decimal strings; money integer paise strings, quantities/readings decimal strings plus unit. Do not expose provider storage keys to guests.

Authenticated cookies use CSRF header for unsafe methods. Each mutation carries Idempotency-Key; existing-resource updates carry If-Match referencing rowVersion. Principal/tenant never accepted from request body. Error payload contains status, stable code, title, safe detail, requestId and fieldErrors when relevant. Never return raw SQL or provider credentials. Use 400 malformed/unknown payload, 401 unauthenticated, 403 permitted-to-see but action denied, 404 outside resource scope, 409 business/key conflict, 412 stale version, 413 limits, 422 incomplete business prerequisites, 428 missing concurrency precondition, 429 throttled with Retry-After, 503 unavailable dependency. Create 201, completed command 200/204, queued job 202. Every response claiming state includes rowVersion where applicable.

GET collections return items, nextCursor, hasMore; pageSize default50/max100; stable sort plus ID tie-break. Counts reflect same permission scope. Job responses return receiptId, entityId, state and status URL. JSON schemas/typed contracts are shared between API and web; no generic any cast may replace validation.

Legacy routes must delegate to the same application command, with request/response translation documented and contract tests. Do not keep both a strict new route and unsafe legacy route. Alias deprecation lasts one pilot compatibility window; removal only after caller inventory and migration. Direct service calls use the same policy and state guards.

## Descriptive API contracts

Paths below are target contracts, not claims that all currently exist. Existing names may remain as delegating aliases; inspect actual owning controller. Permission checks are applied after resource resolution. Repeated field definitions inherit the common conventions above.

| Operation / target path | Request | Response / behaviour | Authority and state |
|---|---|---|---|
| Request challenge POST /auth/otp/request | identifier, optional authorised fallback | 201 opaque challengeId, maskedTarget, deliveryState, expiresAt | Public throttled; actual delivery through adapter |
| Verify challenge POST /auth/otp/verify | challengeId, code, optional validated signup profile | 201 session cookie, csrfToken, principal/activeOrg summary | Atomic consume, verified identity only |
| Logout POST /auth/logout | CSRF and current session | 204 after revocation | No mutating GET; cookie cleared |
| Switch org POST /auth/switch-org | targetOrgId and expected session revision | 200 new actor summary/CSRF | Active member only; no guest switch |
| Guest verify/session POST /guest/:token/otp/verify | matching challengeId/code | Cookie plus CSRF, bounded grant summary | No generic PIN acceptance; grant active/verified |
| Baseline preview POST /projects/:projectId/requirement-imports | uploaded source version, column mapping, mode | 202 preview receipt or 201 bounded draft; rowErrors and proposed delta on GET | Checklist authority; no published requirement changes |
| Baseline commit POST /requirement-imports/:id/commit | expected baseline version, accepted row decisions | 201 issued revision, impact assessment work items | PM/delegated baseline authority |
| Requirements GET /projects/:projectId/requirements | cursor, phase/scope/owner/milestone/status filters | One row per requirement revision, slots/assessment/pending action | Scoped read, commercial projection separate |
| Link evidence POST /requirements/:id/evidence-links | documentVersionId, evidenceRole, optional assetIdentityRevisionId, expected version | 201 proposed edge; never automatic satisfaction | Assigned evidence contributor; all IDs same project |
| Upload intent POST /projects/:projectId/documents/upload-intents | existing documentId optional, filename, mimeType, sizeBytes, checksumSha256, revisionCode, issue/expiry dates, target requirement/asset IDs | 201 document/version/intent IDs, part plan, required headers, expiry | Scoped upload; lock revision allocation |
| Refresh parts POST /upload-intents/:id/refresh | eligible missing part numbers | 200 real signed URLs and expiry | Same principal/grant and active intent |
| Complete upload POST /upload-intents/:id/complete | ordered partNumber/etag, expected intent version | 202 PROCESSING and receipt | Provider completion verified; immutable version pinned |
| Abort upload POST /upload-intents/:id/abort | expected intent version, optional reason | 200 ABORTED receipt | Pending only; cannot destroy accepted original |
| Processing GET /document-versions/:id/processing | none | state, attempt, retryability, reason, observed metadata when permitted | Scoped original visibility; no unsafe download |
| Download GET /document-versions/:id/download-url | original/preview purpose | short expiry and URL or blocked error | document.download, READY and grant scope |
| Submit review POST /requirements/:id/review-cycles | exact version/edge IDs, reviewer plan revision, expected requirement version | 201 cycle and active stage/work item | READY evidence and required slots; reviewer assignment explicit |
| Decide POST /review-stages/:id/decisions | exact version, decision, comment, expected version; optional authorised exceptionId | 201 immutable decision, next-stage/assessment receipt | Stage assignee; separation of duties |
| Record external response POST /transmittal-items/:id/external-responses | authority party/person, decision, date/precision, reference, proofVersionId, expected item version | 201 recorded response and pending/final review result | External-response recorder, not impersonated signatory |
| Exception POST /requirements/:id/exceptions | type, reason, exact rule/revision, source proof, effective interval | 201 proposed exception | Separate authority and required countersign before effective |
| Readiness GET /projects/:projectId/readiness | scope/purpose, optional evaluation date | baseline, evaluatedAt/date, per-requirement reasons, blockers/warnings, stage readiness | Same deterministic evaluator as package snapshot |
| Build package POST /projects/:projectId/packages | purpose, scope, baseline version, proposed evaluation date, justified exclusions; draft flag | 202 QUEUED, manifestId/packageId/receipt | Final blocks unmet mandatory slots; incomplete draft clearly labelled |
| Package GET /packages/:id | none | frozen manifest, build result, artifact digest/page map when ready | Scoped package read |
| Issue submission POST /projects/:projectId/submissions | READY packageId, named recipients/required flag/authority scope, cover note | 201 issued submission and delivery receipts | Package submitter, required recipient count >=1 |
| Recipient decision POST /submission-recipients/:id/decisions | accept/accept-exceptions/reject, comment, exceptions, optional proof, expected version | 201 recipient response and aggregate state | Named recipient or authorised proof recorder |
| Archive POST /projects/:projectId/archive-exports | scope/purpose and snapshot selection | 202 build receipt, later original bundle/digest | export.data plus each included resource permission |
| Work Inbox GET /work-items | mine/team/waiting, project/due/state cursor filters | derived work items and pending actor/action | Scoped read; notification read cannot complete action |
| Equipment identity POST /assets/:id/identity-revisions | changeType, effective date, new identity fields, reason, expected version | 201 revision and impact/revalidation items | Assigned equipment manager |
| Commercial readiness GET /projects/:projectId/commercial-readiness | milestone and evaluation date | prerequisites separate from bill/certification/receipt state | Explicit commercial field grant |
| AI assistance POST /document-versions/:id/assistance-runs | operation, source/version and opt-in context | 202 advisory receipt; proposals cited on GET | No authority transitions or monetary writes |

New staged quality/aftercare/commercial commands follow task T17–T19 contracts and entity/state tables. Before enabling each, write strict DTO/schema contract and role-based API tests covering fields in its task. Physical controller location belongs to that domain, not an all-purpose billing controller.

## Core command algorithms, expressed as implementation instructions

**Upload:** authenticate/resolve scope → validate all target IDs/grant → reserve revision under document lock and receipt → create provider session through staged intent → upload real parts → complete/inspect provider object → commit immutable identity and PROCESSING/outbox → worker downloads pinned bytes, checks observed metadata/AV/format → fenced READY/quarantine/failure transaction → UI reconciles receipt. Provider operation success followed by DB failure must reconcile by intent/provider ID; never create duplicate versions or trust client checksum alone.

**Review:** resolve exact submitted item and active stage → lock document/version/stage → re-read state and expected row version → verify file attestation and authority → validate external proof where applicable → append decision → advance required stage only when all required responses complete → emit assessment event. No direct requirement approval update. Rejection/change requires meaningful explanation; approved-with-notes remains conditional according to evidence rule.

**Satisfaction:** choose exact requirement and rule revisions → gather qualified evidence edges, each pinned to version and identity → verify required roles/count/validity/companion conditions → include valid exception/applicability decisions → record deterministic assessment/reason/input set → update current projection. Recompute on expiry, replacement, amendment or withdrawal; never rewrite issued package history.

**Package:** validate authority and final-versus-draft purpose → obtain stable project baseline and current requirement inputs in snapshot transaction → evaluate inside same snapshot → freeze manifest and omissions/waivers → reserve sequence and outbox/receipt → build from manifest IDs only → verify every original digest → create front matter based on actual pagination → upload artifact and verify stored digest → fenced READY. Never use current/latest pointers in compiler. Non-PDFs stay available as original attachments with labelled optional renditions.

**Submission:** issue one frozen READY package to required named authorities → persist submission and delivery intents → deliver independently → record each recipient's scoped response → lock parent and recompute all required responses. Any required rejection means rejected; all responses with any exceptions means accepted-with-exceptions; all unqualified accepts means accepted; missing response remains issued/pending. Optional recipients do not block. An acknowledgment/download is not an acceptance decision.

## UI implementation and design-system rollout

Use UX document as screen contract. First extract reusable typography/colour/space/status tokens and accessible controls without changing domain semantics. Then implement S04 evidence states and S06 review authority, S08 artifact builder, and S01–S03/S10 navigation/inbox/search. Fold existing modals into shared domain forms, not copy-and-paste new screens. Check active import inventory: UploadSheet and SupplierGuestView definitions have no active callers found by current source search, so classify them as legacy/demo and remove or isolate after confirming build references; do not describe their fabricated success as a proven active production route.

Persist table filters in URLs, server pagination, async operation receipts and field errors. Product status text is explicit: Uploaded/processing, File verified, Review approved, Requirement satisfied, Package ready, Submission accepted. A single green generic Completed badge is not permitted across these aggregates. Capability checks hide inaccessible actions while server remains authoritative. Review/acceptance confirm exact version and scope in the final action surface.

## Migration and testing playbook

Do not run migrations against an unknown configured database. Inventory ledger and backup first, create disposable environment, replay each deployed baseline, validate composite relationships and record ambiguous legacy approvals. Add new structures, dual-read, compare, backfill provable relationships, and mark others needs reassessment. Do not claim source history is immutable while editing applied migrations. Keep original file/version IDs and external decision dates.

Test by invariant: tenant/project/grant boundaries; exact-version satisfaction; real storage lifecycle; scan failure/late replacement; canonical review/exception authority; immutable package artifact; idempotent crash recovery; recipient aggregation; whole-project restore. Include real PostgreSQL connections, actual S3-compatible provider and real scanner fixtures. Existing 45 passing mock/policy tests remain useful but some enshrine unsafe document-wide approval and must change. No numeric score or simulation using direct helpers replaces active HTTP/worker coverage.

## Implementation order and completion record

Immediate containment can disable guest session exchange, stamp-back and public signature assurances before their replacements are complete. Then T01 → T02 → T03; T04/T05 and T06 can progress as dependency graph permits; T07 → T08 → T09. T10 runs after T03. T11–T14 are required for real pilot even though their taxonomy is P2. MVP subset of T15–T16 provides inbox/baseline/equipment/supplier usability. T17–T19 are staged domain extensions; T20 is a measured discovery/evaluation programme.

Every implementation handoff must list changed files, preserved user changes, migration names/checksums, actual provider/tool prerequisites, obsolete paths removed, test evidence, rollout flags and remaining limitations. Release only against production-readiness gates. The research reports themselves do not approve implementation deployment.
