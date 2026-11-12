# Phase 3 Pass 01 — PH3-G08-002 asset-scope isolation evidence

**Disposition:** PARTIAL / VERIFY — NOT independently CLOSED. **Priority:** P0. **PR:** #22 (draft, unmerged). **Audit:** `docs/audits/remaining-phases-2026-11-12/phase3/G08.md` at `f51a90894589091ddeaeaeefea14f86473479568`. No production certification or external provider activation.

## Risk and implementation

The original runtime observation R43 showed an out-of-scope Site user could retire an asset despite a scoped list response. This branch previously added scope checks on several asset service paths, but left live permission downgrades relying on an earlier route guard and fetched unrestricted candidate/list rows before in-process filtering.

- `apps/api/src/modules/assets/asset-scope.ts`: `assetScopeSqlPredicate()` validates stored scope, binds asset UUID allowlist, category and UTC creation-date range to parameterized PostgreSQL predicates. Empty allowlists remain empty; SQL identifiers are fixed.
- `apps/api/src/modules/assets/assets.service.ts`: a live ACTIVE org and project membership and **current role permission** (`asset.read` or `asset.manage`) are checked inside the same tenant transaction as the protected read/mutation, under row share locks. Role downgrades are not satisfied by old session roles. Owner/admin privileges still require a live org membership.
- Asset list, matching candidates and import-preview tag lookups use the bounded SQL predicate before projection; list/match keep an in-process defensive scope assertion. Creating in asset-ID-only scope and reading preflight tags with read-only rights fail closed. Ordinary mutations, history, passport and revalidation routes retain per-target scope checks.
- Equipment passport's linked requirements cannot expose an unrelated asset's requirement merely because a document is linked to both assets; only this asset's requirements and project-level requirements can flow through shared-document links.
- No external S3, scanner, signature, mail or identity service is configured or used.

## Added/extended regression coverage

1. `apps/api/test/phase3-asset-scope.spec.ts`: invalid scope, ID/category/date/read-only predicate, bound SQL values, out-of-scope retirement, simulated hidden rows, restricted PostgreSQL real membership and two assets, narrowing after prior read, live R-SITE to R-REVIEWER downgrade, update/delete/revalidation/import denials.
2. Deterministic transaction interleaving with a real PostgreSQL app role: pause the mutation inside its tenant transaction immediately before reading project scope, change the membership from another connection, resume and prove the previously allowed asset cannot retire.
3. `apps/api/test/phase3-asset-http-scope.spec.ts`: actual Nest HTTP routes against disposable PostgreSQL, with a deliberately pre-authorized stale guard context; list/export/match, get/history/passport, patch/delete/revalidate, import preview, scope revocation, READ_ONLY and role downgrade. Guard is deliberately stubbed so **this is not a complete G01/G02 live-auth acceptance**.

## Verification and independent release gates

- CI: inspect `verify-and-test` and `group-register` on the **exact latest branch head**; previously failed interim runs at `a72b6f28`, `0b68898c`, `7a10c781` had a test-only TypeScript binding assertion error, subsequently amended. Those failures are not a passing evidence record.
- Remaining verification: exact-head CI, real authenticated request path (CSRF/session/RBAC guard, aliases), cross-process role/revocation and reader/writer concurrency, multi-tenant and date/category scope matrix, independent security reviewer, integrated Phase 1/2 authorization baseline, Phase 4/5 overlapping pathways, restricted data-export audit. These are not implicitly closed by local testing.
- Required decision fields for PH3-G08-002: implementation SHA, exact integrated SHA, mandatory positive/negative/race and actual HTTP results, independent reviewer and signed disposition. **Status stays PARTIAL / VERIFY until these fields have actual acceptance evidence.**

## Scope discipline

This pass does not purport to close G08-001 or G08-003–008, or any provider/domain gate. Any newly found defects must be tracked rather than described as zero-risk.
