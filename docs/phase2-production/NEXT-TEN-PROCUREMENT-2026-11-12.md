# Phase 2 — next ten procurement command controls

Baseline: `89d0e869836b8e1b1dc04cadcd1dd95e40519125`. This batch addresses ten related mechanisms in the Phase2 supplier/closeout collection workflow. These adjacent purchase-order defects are grouped as PH2-NEW-009, with stable sub-IDs C01–C10. They are not ten newly closed original audit rows. Related historical themes include PA13 request contracts, PA16 transactional history, G02 current authority/composite scope and PH2-G05-005 lifecycle locking; those broader findings are not declared accepted.

| ID | Confirmed baseline mechanism | Candidate correction |
|---|---|---|
| C01 | Empty orders can be persisted as ISSUED; malformed headers call trim or reach SQL without a runtime contract | Validate a bounded, detached allowlisted request with a nonempty order number, supplier UUID and1–100 lines before acquiring a connection |
| C02 | Zero/negative quantities are accepted by the integer column; duplicate/malformed line identities reach database errors | Require unique positive PostgreSQL integer line numbers and positive integer quantities; preserve omitted quantity default1 |
| C03 | `amount || null` loses explicit zero; unsafe JS numbers can lose paise precision | Accept exact decimal integer strings or safe integers within nonnegative BIGINT range; preserve zero versus unknown NULL |
| C04 | Calendar values go directly to date casts and contradictory promised/order dates are accepted | Reject malformed/impossible dates and explicit reversed ordering; compare implicit order date with database CURRENT_DATE under transaction |
| C05 | Supplier FK identifies a party without enforcing active tenant supplier eligibility | Lock and require an undeleted ACTIVE same-tenant SUPPLIER/SUPPLIER_OEM party |
| C06 | Asset FK alone does not establish the line's project/category/current status | Require the exact tenant/project/asset/category tuple, ACTIVE status and no deletion before any order write; mixed invalid lines reject atomically |
| C07 | Missing/empty obligation stage silently becomes FAT; schedule identity/count/date values are unchecked | Require explicit DT-code syntax and a stage from the existing procurement vocabulary, bounded schedules, nonduplicated document/stage pairs and valid due dates; do not infer engineering classification |
| C08 | Creation does not itself lock/check lifecycle and can add obligations after HANDOVER/closure | Bind project write authority and lock the project; allow only unpurged DRAFT/ACTIVE scopes |
| C09 | Command service trusts the outer route for internal issuance capability | Reject guest issuance, load live active user/membership/project role under locks and evaluate existing party.manage policy; do not widen restrictive member scopes |
| C10 | Order/line/schedule creation has no transactional business audit/outbox evidence | Use the shared tenant transaction to commit an attributable informational PROCUREMENT_ORDER_ISSUED event and audit row with the order, or roll back every effect |

C09 is service defense and current-authority enforcement, not a claim that the prior HTTP party.manage guard permitted supplier purchase-order creation. Owners/admins retain their existing organisation-wide authority. Other issuers require current project membership. Resource-restricted project members fail with PROCUREMENT_MEMBER_SCOPE_UNSUPPORTED: a reviewed resource-scoped PO issuance model is still absent, and this batch does not pretend that workflow is complete.

C07 validates explicit syntax/stage identity, not whether the engineering choice is correct or approved. It does not reconcile the HVAC catalogue, infer any document mapping, create requirements or satisfy an obligation. New supplier obligations remain PENDING, with no claimed engineering acceptance. The existing procurement stage vocabulary comes from migration0007; it is not a newly invented HVAC policy.

## Verification scope and provenance

A baseline pre-transaction probe failed all25 cases before source edits. It establishes missing request/service admission controls; it is not25 distinct defects or a full HTTP exploitation claim. Supplier/asset/lifecycle/history defects are also confirmed by inspection of the exact baseline writer and constraints. A new actual PostgreSQL regression exercises the fixed controls under restricted tc_app in a random disposable database. All commercial rows, labels and obligations are explicitly synthetic test mechanics, not sample success or HVAC evidence.

The real database regression verifies unknown/null, zero and >MAX_SAFE_INTEGER exact amounts; legitimate issuance; client-only/archived/deleted/foreign suppliers; mixed valid/wrong-project/retired/deleted assets and category mismatch; deadline ordering against database time; stale-owner demotion; unsupported narrow member scope; HANDOVER/CLOSED/SUSPENDED/CANCELLED/ARCHIVED denial; and attributable audit/outbox identities. A synthetic audit-insert failure rolls back order, lines, schedule, outbox and audit together. Two actual connections observe the project lock, commit closure ahead of issuance and verify rejection with unchanged table counts. This is a database concurrency test, not full distributed HTTP acceptance.

The worker regression proves that the registered informational event is durably acknowledged without queue/provider execution. Dispatch acknowledgement is not supplier delivery. The earlier SQL-shape fixture was updated with valid UUIDs, explicit live-owner responses and the actual shared transaction adapter; it remains labelled a SQL fixture and does not certify security. The real database regression exercises the controls themselves.

Technical admission ceilings:128KiB JSON plus the shared20-level/2000-node budget,100 lines,100 obligations per line and500 aggregate obligations. Independent budgets can impose a lower effective limit. They are resource ceilings, not product quotas or approved engineering template sizes. No migration, permission relaxation, scanner bypass, provider activation or acceptance policy change was made.

Initial fixture failures were corrected against the real schema (project-code format, separate UUID/text bind positions and required added_by provenance). Optional values are omitted to model actual JSON rather than including JavaScript undefined. The concurrency observation was corrected to observe the earlier shared project-authority lock rather than only the service's subsequent query. These failed experiments do not count as passing evidence.

Node22.23.5/pnpm12.4.1, isolated PostgreSQL16 on127.0.0.1:55432, Redis on127.0.0.1:56379 and the previously signature-verified real qpdf12.3.2 binary were used. Runtime remained tc_app with its compliant local-only credential. No customer data, real provider account or production database was used.

Commands, logs and exact changed-source hashes are under `evidence/next-ten-20261112/`. Canonical finding statuses and independent closure counts remain unchanged. Full root-workspace/application-browser acceptance, independent review, exact-head CI and external provider/HVAC/policy approvals remain outstanding. The existing draft PR is stacked on the Phase2 integration branch, which the main-only CI trigger does not test automatically.

## Completed local checkpoint — 13 November 2026

- `pnpm --filter @tradecloseout/api test`: **557 passed across89 suites** in one complete invocation, including the actual production-mode two-API/worker HTTP regression against its own TLS gateway fixture.
- `pnpm --filter @tradecloseout/worker test`: **33 passed**, including actual database outbox acknowledgement of the informational procurement event with zero provider/queue calls.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-procurement-db.spec.ts test/phase2-procurement-boundaries.spec.ts test/discovery-lifecycle-foundations.spec.ts`:37 passed across3 suites. This overlaps the full API result and is not added to it.
- `pnpm typecheck`: passed. `pnpm build`:6 tasks passed (4 unchanged tasks cached; API and worker rebuilt).
- `pnpm test:security`:15 passed. `pnpm test:rbac`:8 passed. These overlap the full API result and are not added to it.
- `git diff --check`: passed.

All application tests ran with the local fixture services described above. The API/worker commands inherited the temporary real qpdf launcher and Node22 toolchain. No provider delivery, completed financial obligation, reviewed HVAC mapping or production deployment is inferred from these results. The batch began on12 November and completed on13 November; original filename/record IDs retain the start date.
