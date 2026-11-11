# G02 — Authorization, roles, resource scope and external visibility

Assessment date: 2026-11-11. Decision: **NO-GO for G02 acceptance.** Application fixes were not implemented as part of this assessment.

The reviewed application source is `863e6e0c56ad4a92af2580fbcbfc179832056b2d` (G01 candidate, draft PR #5). The shared repository checkout is `main` at `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. These are different source lines: the findings below apply to the named candidate, not automatically to main or a future merge. The candidate checkout was clean during the final probe. Revalidate affected assertions after rebasing or changing the head.

This is a **fresh assessment**, not a recovered earlier G02 output. `G02-001`–`G02-017` are the initial stable IDs for this register. They must not be conflated with numbered sections in older readiness reports. Every finding is OPEN. Runtime observations support 001–016; 017 is a source-confirmed legitimate-workflow gap. Those evidence labels do not imply independent approval, full production reproduction or release acceptance. The assessing agent also implemented the preceding G01 changes; this report is not independent acceptance of those changes.

## Scope and evidence

Primary contract: `05-ACTORS-AND-PERMISSIONS.md`, especially §§3.2, 4, 5, 6, 7, 9 and 10; user AGENTS.md; and current-main `docs/engineering/agent-collaboration.md`. Preserve immutable evidence, current tenant/project authority, project lifecycle locks, external party authority and separation of duties.

The assessment inspected permission engines, guards, controllers, tenant transactions, project membership, guest grants, response projection, review routes, document operations and exports. It inventoried **196 registered HTTP routes**, with permission metadata on every protected business route examined by that structural check. Twelve routes have no SessionCsrfGuard; they include OTP, invitation, health, public verification and webhook entry points. Their decorator classification is not an acceptance of their independent authentication controls.

Targeted execution used Node **22.23.2**, pnpm **12.4.1**, PostgreSQL **16.15**, a restricted **tc_app** runtime (`rolsuper=false`, `rolbypassrls=false`) and environment-local Redis. The disposable database helper applied the migration ledger from the exact source, then removed its randomly created database. Actual SessionCsrfGuard/PermissionGuard, controller metadata, services, global projection and strict-production loopback HTTP routes were used. The API and its workspace dependencies were freshly built before the final run. The final evidence contains applied migration names/checksums, clean source status, exact SHA, timestamps and a reusable-pool check.

Authentication sessions, MFA flags, membership and grants were seeded **test fixtures**. They do not certify real login, MFA, independently established external authority or identity delivery. The HTTP server ran NODE_ENV=production but traffic used local HTTP, not deployed HTTPS/proxy/browser behavior. Provider destinations were nondelivering fixture URLs. No real storage upload, approved engineering document, package ZIP, SMS, email, payment, signing or external release acceptance was exercised. Minimal authorization-only requirement/snapshot rows are explicitly not an HVAC template, reviewed baseline or readiness evidence.

The route inventory is structural and the behavior probes are targeted. This is not a claim that every route, role, list, count, bulk operation, resource relationship and concurrency permutation has been exhaustively tested. The fixing agent must extend the relevant tests and investigate adjacent paths.

Evidence is under `docs/evidence/g02-audit-863e6e0/`: executed probe and inventory scripts, JSON results, console output, build output, existing RBAC suite output, route inventory, environment/command notes and SHA-256 manifests. JSON probe `COMPLETED` means an operation returned; it does not mean the security control passed. Expected rejection probes are labeled `REJECTED`.

## Finding index

| ID | Priority | Issue | Strongest evidence |
|---|---|---|---|
| G02-001 | P1 | Conflicting permission policies permit an unassigned reviewer to read another project's package metadata | HTTP + restricted DB |
| G02-002 | P1 | Internal member resource scope is ignored | Real guards/services + persisted write |
| G02-003 | P1 | Supplier requirement listing returns an unassigned requirement | HTTP 200 |
| G02-004 | P1 | Supplier batch-links evidence outside its grant | HTTP 201 + persisted link/status |
| G02-005 | P1 | Supplier issues a new grant outside its own scope | HTTP 201 + persisted new grant |
| G02-006 | P1 | Supplier accepts an unassigned pending obligation without evidence | HTTP 201 + persisted ACCEPTED/null version |
| G02-007 | P1 | External client enumerates internal member contact identifiers | HTTP 200 after projection |
| G02-008 | P1 | Nested upload-completion route accepts a version from another project | HTTP nested 201 / direct 403 |
| G02-009 | P1 | Project removal does not fence a previously authorized write | Deterministic guard/removal/write scheduling |
| G02-010 | P2 | Supported project roles are missing from the runtime capability table | HTTP 403 + source catalogue |
| G02-011 | P2 | Direct resource routes lose project-derived capabilities | HTTP nested 200 / direct 403 |
| G02-012 | P2 | Reading reviews requires decision permission | Auditor HTTP 403 |
| G02-013 | P2 | Document-controller download setting is not loaded; schema names disagree | Actual guard false / DB true |
| G02-014 | P1 | Archive creation bypasses export permission and required purpose | HTTP 201, MANIFEST_ONLY |
| G02-015 | P2 | Business authorization denials lack the specified audit path | HTTP 403, zero new security/business audit rows + source |
| G02-016 | P2 | Malformed resource IDs reach database authorization/query paths | HTTP package ID 500; project ID lookup failure |
| G02-017 | P2 | Legitimate client/consultant document-read APIs cannot serve contractor evidence | Source-confirmed; positive integration acceptance unperformed |

Priority is a proposed remediation priority, not release sign-off. P1 issues affect confidentiality, authority or integrity and block acceptance. P2 issues also remain required work for completing this register.

## Detailed findings and acceptance

### G02-001 — Reconcile runtime policy and enforce reviewer project/resource scope

**Observed:** An R-REVIEWER belongs only to Project A. GET `/api/v1/projects/<B>/packages/<package-in-B>` returns 200 and the DRAFT package row. The fixture confirms no membership in B. Runtime `hasPermission` returns package.download/Y; alternate `evaluateEffectivePermission` denies the same unassigned role with NOT_PROJECT_MEMBER.

**Source at assessed SHA:** `packages/shared/src/permissions.ts:73` and the separate specification engine later in that file; `apps/api/src/common/guards/permission.guard.ts:140`; `apps/api/src/modules/handover/handover.service.ts:781`.

**Contract and correction:** §5.2 explicitly restricts reviewers to assigned projects/requirements. §4 also contains broad Y/A entries that conflict with parts of §5.2; the two source engines disagree on scope and on ten capability-presence entries captured in inventory-summary.json. Reconcile one reviewed policy and one enforced runtime evaluation, with explicit project/resource scope. Do not blindly choose the more permissive table, rename policy to justify an observed leak or broaden every role to repair denied workflows. Resource visibility must remain narrower than a general capability.

**Required verification:** Unassigned reviewer list/detail/package metadata and artifact routes deny without existence disclosure; assigned, applicable reviewer access succeeds; other tenants remain inaccessible. Cover all org/project role combinations and capability-presence disagreements, including document.reuse and submission.recipients_manage. Resolve documented policy ambiguity through accountable review. The demonstrated exposure is package metadata; no signed download or ready artifact was tested.

### G02-002 — Enforce internal project_members.scope_json

**Observed:** An active R-SITE member has scope_json with asset A and requirement A. Actual guards allow reading asset B and the real AssetsService persists a name change to asset B in the same project.

**Source:** `apps/api/src/common/guards/session-csrf.guard.ts:359` loads pm.role only; PermissionGuard checks membership existence; `apps/api/src/modules/assets/assets.service.ts:239` and `:257` bind tenant/project but not member resource scope.

**Correction:** Define and validate the supported scope schema, carry trusted scope into authorization and enforce it in the transaction on reads, writes, lists, counts and relationships. §§3.2/5 require specific assets/categories, requirement groups, document types, read-only restrictions and auditor date boundaries as applicable. The demonstrated assetIds/requirementIds restriction must not silently become project-wide access. Unknown or malformed restrictive scopes must not widen access.

**Required verification:** Allowed asset/requirement succeeds; another asset/requirement, mixed bulk request and indirect document links deny atomically. Exercise read-only/date/type/category scopes and update/removal races. This probe used real guards/services and PostgreSQL, not an HTTP PATCH.

### G02-003 — Filter guest requirement rows before serialization

**Observed:** A SUPPLIER_UPLOAD guest granted requirement A reads A and B from GET `/projects/<A>/requirements`; HTTP 200 includes the unassigned requirement's title after global response projection.

**Source:** `apps/api/src/modules/checklists/checklists.controller.ts:24`; `apps/api/src/modules/checklists/checklists.service.ts:842`.

**Correction:** Query only currently authorized requirements, derived assets and permitted metadata. A project-bound guest is not a project-wide reader. Redacting commercial fields does not enforce row visibility.

**Required verification:** A-only supplier sees only A, including totals, pagination, filters and search; B, other suppliers and another tenant never appear. Empty scope and revoked/expired grants deny. Include upload-only and contributor profiles without making them project browsers.

### G02-004 — Authorize every batch evidence link

**Observed:** The A-only supplier links its document to requirement B through POST `/projects/<A>/documents/<doc>/batch-links`. Restricted DB inspection confirms the link and B's status becomes UPLOADED. Fresh HTTP execution returns 201 with one linked requirement.

**Source:** `apps/api/src/modules/documents/documents.controller.ts:173`; `apps/api/src/modules/documents/documents.service.ts:1213`.

**Correction:** Validate the caller's document/version ownership, current grant, each requirement/asset and all composite relationships in the same transaction. Apply lifecycle policy under the shared project lock and invalidate affected domain decisions when required. Upload permission alone does not permit arbitrary linkage.

**Required verification:** Allowed linkage succeeds; unassigned, non-owned, cross-project and cross-tenant inputs deny without partial writes. Mixed arrays, duplicate IDs, empty scope, revocation and concurrent changes retain atomicity. UPLOADED is not verified/approved evidence; no readiness claim is made by this reproduction.

### G02-005 — Separate grant issuance from supplier upload

**Observed:** The A-only supplier invokes POST `/projects/<A>/supplier-links` for B. A new guest grant includes B and records the existing guest principal as creator. HTTP returns 201. The service also assigns requirement owner_party_id while issuing the link.

**Source:** `apps/api/src/modules/parties/parties.controller.ts:71` requires document.upload; `apps/api/src/modules/parties/supplier-guest.service.ts:22`, `:44`, `:60`.

**Correction:** Require an authorized internal issuance capability and current project/party authority. If delegated issuance is deliberately supported, it must be independently defined, attenuated to the issuer's exact scope/expiry and unable to rewrite unrelated ownership. Keep OTP, principal separation, immutable provenance and existing G01 controls.

**Required verification:** Authorized contractor issuance works. Suppliers cannot mint scope B, choose another party, prolong authority or reassign obligations. Denied issuance writes no grant/assignment/outbox event. Include revocation and closed-project races. No external invitation was sent in this audit.

### G02-006 — Protect contractor intake and evidence eligibility

**Observed:** The A-only supplier accepts a PENDING obligation associated with B. POST `/projects/<A>/supplier-obligations/<id>/intake` with `{}` returns 201/ACCEPTED. The database records ACCEPTED with document_version_id null; there was no supplied/verified engineering object.

**Source:** `apps/api/src/modules/parties/parties.controller.ts:262` requires document.upload; `apps/api/src/modules/parties/parties.service.ts:967` defaults the decision to ACCEPT and updates the row.

**Correction:** Enforce the contractor intake role, separation from supplier submission, applicable state transition and exact eligible object/version plus review/qualification. Bind supplier, obligation, requirement, asset and project; apply lifecycle/locking and audit the outcome. An accepted status string cannot substitute for evidence.

**Required verification:** Supplier self-intake, unassigned/mismatched versions, null evidence, PROCESSING/quarantined/deleted versions and stale state deny. A properly authorized contractor accepts a legitimately submitted eligible version. Rejection, retries, concurrency and invalidation preserve correct status and history. Coordinate evidence semantics with the relevant document/procurement group; do not silently declare acceptance from this fixture.

### G02-007 — Stop guest enumeration of internal members

**Observed:** CLIENT_VIEW GET `/projects/<A>/members` returns internal names and identifiers such as `site@g02-fixture.example.test`, even after the actual global projection interceptor.

**Source:** `apps/api/src/modules/projects/projects.controller.ts:160`; `projects.service.ts:833` selects pm.*, name and a user_identity value; `apps/api/src/common/interceptors/visibility-projection.interceptor.ts:99` receives guestScope from req.auth although the guard places it on user/userContext; its unknown-resource fallback permits these roster keys.

**Correction:** Enforce an explicit roster-access policy and external response DTO/allowlist. Obtain trusted grant context from the actual guard contract. Unknown response shapes must not default to sensitive internal serialization. §6.2 prohibits using guest access to enumerate users.

**Required verification:** Internal authorized roster workflow remains useful; client, supplier and other external profiles cannot enumerate internal identities or unrelated contacts. Cover aliases, nested objects, unknown payloads, counts and projection context. Do not infer that every commercial-field projection has failed; the demonstrated leak is the member roster.

### G02-008 — Bind nested upload completion to the actual resource project

**Observed:** R-SITE is a member of A only. POST `/projects/<A>/document-versions/<version-in-B>/complete-upload` returns 201 and B's document/version identifiers. The direct `/document-versions/<same-version>/complete-upload` returns 403 PROJECT_ACCESS_DENIED.

**Source:** PermissionGuard `:80` trusts the supplied path project; `apps/api/src/modules/documents/documents.controller.ts:78` does not pass expected projectId to completion; `documents.service.ts:597` selects by tenant and version ID.

**Correction:** Resolve and compare the actual tenant/project/document/version tuple, authorize that tuple and preserve it throughout the transaction. Apply the same control to nested/direct upload and resource aliases. A legitimate path project must not mask a different resource project.

**Required verification:** Authorized A/A completion succeeds; A/B and foreign-tenant tuples deny identically on all aliases. Exercise PENDING completion with actual isolated object fixtures, as well as PROCESSING/replay paths. This finding reproduced metadata exposure through the PROCESSING idempotent path; pending-upload storage mutation was not tested.

### G02-009 — Recheck current project authority under the mutation lock

**Observed:** Actual session/permission guards approve an A member. Actual ProjectsService removes that member and commits. AssetsService then accepts the previously obtained context and persists a write. Membership is REMOVED; the session is not revoked. The transaction's session lock remains valid and does not test current project membership.

**Source:** `apps/api/src/modules/projects/projects.service.ts:873`; `packages/db/src/tenant-tx.ts:79`; `apps/api/src/database/tenant-db.service.ts`.

**Correction:** Serialize the current project membership/role/scope and resource authorization with the protected transaction. Define and test the authorization boundary for removal, demotion and scope narrowing. Preserve G01 session-generation fencing, restricted RLS, compatible FK lock modes and one documented lock order; do not introduce the earlier user/session/audit deadlock.

**Required verification:** A removal or demotion committed before the authoritative transaction check prevents the write. A write already inside the documented protected boundary either serializes before removal or fails consistently. Test real concurrent connections/API instances, role changes, scope changes, grant revocation, rollback and pool cleanup. Current evidence is deterministic service/guard scheduling, not a concurrent HTTP race test. Project removal need not revoke every unrelated org session if current authority is safely fenced otherwise.

### G02-010 — Complete and validate the project-role catalogue

**Observed:** A stored active project R-QC role is ignored by the runtime project table. An org R-SITE/project R-QC actor receives 403 on project reviews. The runtime table contains only R-PM, R-SITE, R-DOC, R-CONSULTANT, R-CLIENT and R-SUBCONTRACTOR.

**Source:** `packages/shared/src/permissions.ts:85`; project membership write/read paths. §5.3 explicitly supports being PM on one project and QC on another.

**Correction:** Reconcile org/project/external role names with one validated catalogue, including intended procurement, QC, safety, reviewer and auditor project roles. Reject unknown roles at runtime. Do not give an internal project assignment guest legal authority or treat QC capability as blanket commercial/drawing approval.

**Required verification:** Each approved project role contributes its intended capability only within its project and narrower resource scope. Org SITE/project QC can perform an eligible QC review but cannot decide unrelated requirements. Cover aliases, unknown/malformed roles, reviewer-role matching, assignment, self-approval and multi-project role changes. The read-route permission defect in 012 is related but does not supply the missing QC decision capability.

### G02-011 — Resolve indirect resources before evaluating project capabilities

**Observed:** An org R-SITE/project R-PM actor receives 200 on nested project review listing and 403 on GET `/reviews/<existing-assigned-review>`. This is an existing, assigned review; the project-derived role is omitted on the direct route.

**Source:** SessionCsrfGuard `:348` resolves a project role only from a project path; PermissionGuard `:65` evaluates capabilities before indirect resource resolution.

**Correction:** Establish the actual tenant/resource/project, load current project authority, then evaluate capabilities and restrictive scope. Use a consistent resolver for direct, nested and bulk paths without trusting caller org/project hints.

**Required verification:** Equivalent nested/direct routes agree for legitimate and forbidden actors. Test review, document/version, asset, requirement, package and submission aliases; forged project IDs; mixed bulk IDs; and concurrent role changes. Fixing a GET decorator alone does not repair other direct actions that depend on a project-derived capability.

### G02-012 — Require read permission for review reads

**Observed:** R-AUDITOR has review.read and lacks review.decide. GET project reviews returns 403 because list/get routes require review.decide.

**Source:** `apps/api/src/modules/reviews/reviews.controller.ts:42` and `:53`; examine comment routes separately rather than assuming a decision capability is a read/comment capability.

**Correction:** Apply review.read to reads with correct row/field visibility. Give comment/submit/decision actions their actual permissions and independent stage/party authority. Never grant decision permission just to enable reading.

**Required verification:** Scoped auditor and applicable external read workflows succeed without write/decision capability; unassigned reviewers and external parties cannot read unrelated/internal review data. Decision, self-approval, generic-review and legal-authority negatives remain enforced.

### G02-013 — Load the document-controller setting from a consistent schema

**Observed:** The real organisations.doc_controller_org_wide_download value is true, while SessionCsrfGuard produces docControllerOrgWideDownload=false. The pure helper's toggle test passes independently. Drizzle maps this property to document_controller_org_wide_download, a different name from the actual migration column.

**Source:** SessionCsrfGuard `:410`; `packages/db/src/schema.ts:66`; `packages/db/migrations/0000_complete_v021_schema_and_rls.sql:107`.

**Correction:** Reconcile the approved setting contract, migrations, ORM, guard and supported configuration path. Load it from the trusted active org and audit changes. Applied migration files are immutable; append a migration if required. The setting must widen only the intended document-download dimension, preserving external isolation, immutable object status and applicable narrower scope.

**Required verification:** Toggle false/true and cross-org switching affect actual authorized download behavior as specified, with audit. A document controller's legitimate org-wide download succeeds only when eligible; guests and other roles do not inherit it. Fresh and upgraded schema match. This audit proves configuration loading/naming failure, not a positive ready-object download.

### G02-014 — Gate archive creation with export authority

**Observed:** R-DOC has package.generate and lacks export.data. POST `/projects/<A>/archive-exports` with `{}` returns 201, exportId and status MANIFEST_ONLY. The service reads a broad project manifest and accepts absent purpose, although archive list/detail require export.data.

**Source:** `apps/api/src/modules/handover/handover.controller.ts:256`; `handover.service.ts:989`. Contract §§3.2, 4 and 9 requires export authority, recorded reason, audit, rate limit and applicable reauthentication.

**Correction:** Enforce export.data and its role/resource/reason/reauth/rate conditions on creation and all artifact paths. Preserve a separately authorized package-generation workflow. Persist a bounded validated purpose and audit the actual outcome without falsely claiming a file exists.

**Required verification:** Doc controller and guests cannot export through creation/alias/download paths. Authorized Owner/Admin succeeds with valid reason and fresh authentication; absent reason, repeated export and cross-project/tenant inputs reject as specified. Include concurrent hourly-budget checks. This was a manifest-only export; ZIP generation and S3 delivery are untested.

### G02-015 — Audit business authorization denials

**Observed:** A valid auditor's project-review denial adds zero auth_security_events and zero audit_events. PermissionGuard throws without a denial audit path. AuthenticationAuditInterceptor is limited to /auth and /guest routes, and the generic problem filter does not emit a structured business-authorization warning for these HttpExceptions.

**Source:** `apps/api/src/common/guards/permission.guard.ts`; `apps/api/src/common/interceptors/authentication-audit.interceptor.ts:12`; `apps/api/src/common/filters/problem-json.filter.ts`. §10 requires actor/resource/action/reason denial auditing.

**Correction:** Add a bounded, redacted, trusted-metadata authorization-denial path that survives transaction rollback, preserves the original denial and cannot be abused to retain secrets or exhaust resources. Distinguish authentication, capability, resource-scope and lifecycle failures.

**Required verification:** Real protected-route denials create the intended durable/operational event even after rollback, with correlation and safe identifiers; no raw session, invitation, OTP, provider secret, request body or forged metadata appears. Audit failures do not grant access. Test load and retention behavior. Zero application rows does not establish what an external gateway logs; that deployment acceptance remains separate. Cross-reference G01-015 without changing its acceptance claim.

### G02-016 — Validate IDs and collections before database use

**Observed:** GET `/api/v1/packages/not-a-uuid` returns 500 INTERNAL_ERROR. GET `/api/v1/projects/not-a-uuid/assets` returns 403 PROJECT_AUTHORITY_LOOKUP_FAILED after a database lookup instead of rejecting the malformed identifier at the boundary. Transaction/pool reuse still succeeds in the probe.

**Source:** Guard project/resource lookup paths; Handover direct package path; path parameters throughout affected controllers. Inline TypeScript types do not validate runtime requests.

**Correction:** Validate parameter UUIDs, enums, body shapes and bulk collections before any database use, including guards that run before controller pipes. Return stable controlled client errors without revealing resource existence or SQL details. Preserve canonical request-ID handling from G01 rather than accepting arbitrary client strings.

**Required verification:** Invalid strings, arrays, objects, numbers, nulls, duplicates, oversized collections and mixed invalid IDs produce controlled 4xx with no DB resource lookup/write. Valid IDs retain scope and pool cleanup; direct/nested routes agree. Cover relevant guest and member routes. Cross-reference original G01-016; this report does not mark it accepted.

### G02-017 — Restore a safe legitimate external evidence-read workflow

**Source-confirmed gap:** CLIENT_VIEW and CONSULTANT_REVIEW profiles have document.read/download but no document.upload. DocumentsService.getDocument requires the guest to have document.upload and to be the version's uploaded_by_grant_id. Download guards likewise require uploaded_by_grant_id to equal the current reader grant. ReviewsService.getVersionReviewDetail rejects every guest. A client/consultant grant cannot use these APIs to inspect contractor-uploaded evidence, even when a separate scoped read/approval contract is intended.

**Source:** `apps/api/src/modules/parties/parties.service.ts:48`; `apps/api/src/modules/documents/documents.service.ts:80`, `:165`, `:773`, `:819`, `:878`; `apps/api/src/modules/reviews/reviews.service.ts:269`.

**Correction:** Implement a reviewed reader policy per grant/profile: exact assigned requirements/documents/versions, approved/client-visible state where required, designated party and independent current authority for binding actions. Keep supplier upload ownership controls separate. Read capability must not grant upload or legal approval authority.

**Required verification:** A legitimately authorized client/consultant can inspect the exact eligible contractor version and its permitted review data. Unapproved drafts, superseded versions, another supplier/project/tenant, expired/revoked grants and missing independent authority for decisions remain blocked. No upload capability workaround. This audit did not seed a fake approved engineering document or legal delegation to manufacture a positive integration result. Positive storage/browser/external acceptance remains unperformed and must be supplied honestly with the relevant groups.

## Checks performed and boundaries that held

- `PATH=/tmp/tc-g01-node22-bin:$PATH pnpm --filter @tradecloseout/api... build`: exit 0; db/shared/pdf-engine/API built. This is a targeted API dependency build, not a new full web/worker production-build claim.
- `PATH=/tmp/tc-g01-node22-bin:$PATH pnpm test:rbac`: exit 0, 1 suite / 8 tests passed. These helper tests do not exercise the failing API workflows.
- The saved probe command completed after that fresh build. It captured 41 applied migrations, strict-production HTTP observations, restricted-role identity and successful pool reuse. Its probes intentionally record defects rather than constituting a green security suite.
- Inventory script: 196 routes; zero protected business routes missing permission metadata by its structural predicate. Metadata presence does not establish correct permission or scope enforcement.
- The tested foreign-tenant project access returned 404. The direct foreign-project upload-completion route returned 403. Admin billing.manage returned 403. These negative controls are retained; no cross-tenant break or Admin billing escalation is claimed.
- No G02 fixes, fresh full workspace/security/browser suite, new CI run, production deployment or external provider acceptance is claimed. Earlier G01 CI evidence belongs to its exact source/merge SHA and is not verification of any future G02 patch.

## Implementation and acceptance order

1. Reproduce on the actual new feature-branch head. Start from current canonical main and explicitly account for the unmerged G01 dependency; do not silently use historical master or drop G01 controls. Keep one writer for a given PR.
2. Establish a single reviewed role/capability/scope contract and trusted resource resolution (001/002/008/009/010/011). Add the tight transaction checks before relying on controller metadata.
3. Close guest confidentiality and integrity paths (003–007), export authority (014), runtime validation and denial audit (015/016). Each fix needs positive as well as negative verification.
4. Restore legitimate read and configuration paths (012/013/017) without widening suppliers, bypassing independent authority or inventing engineering evidence.
5. Add per-finding real HTTP/DB regressions, role/scope/list/count/alias/bulk cases and deterministic multi-connection races. Then run Node 22/pinned pnpm frozen install as needed, typecheck, full build, workspace tests, security/RLS tests, RBAC tests and real application E2E with the web/API/isolated fixtures running. Root archive-verifier browser checks are not the full application journey. Append migrations and show fresh/upgrade results where schema changes.
6. Provide exact base/head/merge SHAs, commands, results and limitations, mapping each stable ID to its fix and regression. A concrete evidence-backed dispute is allowed; silently deleting or renumbering a finding is not.
7. Independent review must assess the actual proposed head, CI, tenant isolation, HVAC/evidence semantics, migration safety and regressions. Real deployment/browser/provider/legal/operational gates remain separate. The coder cannot self-approve, set REVIEW_VERIFIED/RELEASE_ACCEPTED, change trusted policy to pass, auto-merge or declare production readiness.

The G02 register and acceptance checklist accompany this report. These assessment files are being published on the documentation branch `docs/g02-authorization-audit-20261111` for the coding chat to read, with a draft documentation PR against main. This publication contains no application fixes or acceptance transitions. G02 is not registered in the GitHub coordinator policy and has no separate tracking issue. The companion coder prompt is self-contained and links to this publication branch; fetch these files from that branch rather than assuming they are already on main.
