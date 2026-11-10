# TradeCloseout coding instructions

## Repository and workflow

- The canonical branch is `main`. `master` is historical; do not base new work on it.
- Inspect the current code and exact commit before relying on dated audit reports. Many findings in historical reports have already been fixed.
- Implement application changes on a feature branch and open a pull request. A passing test suite alone is not merge approval: review security, tenant isolation, HVAC domain correctness, migrations, regressions and CI on the exact proposed head. Follow the user's explicit merge authorization.
- Preserve unrelated changes. Never replace missing engineering evidence with fabricated files or sample success, bypass scanner failures, or weaken permissions to make tests pass.

## Monorepo

- `apps/web`: Next.js UI, normally port 3002.
- `apps/api`: NestJS API, normally port 3001.
- `apps/worker`: queues, scanning, PDF generation and scheduled work.
- `packages/db`: PostgreSQL schema, append-only migrations and tenant transactions.
- `packages/shared`: permissions, validation and domain primitives.
- `packages/pdf-engine`: PDF inspection and output generation.

Use Node 22 and the package-manager version in root package.json (currently pnpm 12.4.1). Install with `pnpm install --frozen-lockfile`; do not regenerate the lockfile just to set up the environment.

## Validation

- Type checking: `pnpm typecheck`.
- Production build: `pnpm build`.
- Full workspace regressions: `pnpm test`.
- Negative security/RLS checks: `pnpm test:security`.
- Role permissions: `pnpm test:rbac`.
- Application browser tests: `pnpm test:e2e`, only with the actual web/API and required isolated fixtures running. Root tests run the archive-verifier browser project, not this complete application journey.

Tests need PostgreSQL 16, Redis, qpdf, unzip and Playwright Chromium/system libraries. The migration administrator must be able to create/drop disposable test databases and create the test roles. Runtime queries must use the restricted `tc_app` role. See `.github/workflows/deploy.yml` and `packages/db/test/helpers/disposable-database.ts` for current contracts.

Use only environment-local disposable services and test credentials for automated checks. Do not copy laptop `.env`, `.aws`, `.codex` authentication files, production databases, payment keys or customer data into a cloud environment. Real provider acceptance is separate from the programmable storage/scanner fixtures in tests.

## Domain invariants

- Tenant-bound transactions and composite project/asset scope are mandatory.
- Requirements need a real explicit mapping and reviewed baseline; no one-item fake HVAC template or silent DT-001 classification.
- Evidence is an immutable verified object/version plus applicable review/qualification, not a status string.
- Material obligation changes invalidate affected exceptions and acceptance as appropriate.
- All baseline writers must observe project lifecycle policy under the shared project lock. Closed projects require formal reopening.
- Full closure requires current readiness and the correct accepted package/scope/required recipients. Partial acceptance is not automatically full closure.
- Do not infer warranty events from administrative closure or claim disabled payment/signing integrations work.

Report exact commands, results, source SHA and limitations. Distinguish source changes, passing fixture tests, real integration acceptance and production deployment.

## Agent collaboration and review rules

- Follow `docs/engineering/agent-collaboration.md` for PR handoffs and group acceptance.
  Keep original finding IDs; distinguish static findings, reproduced defects, CI
  evidence, independent review and external release acceptance.
- Review authentication/tenant transitions for connection cleanup, current authority
  under the transaction lock and runtime input validation. Reject malformed data
  before database use; preserve restricted roles and immutable evidence.
- Require tests to exercise the claimed control. Debug authentication, mocked
  providers and queue predicates cannot certify production MFA, delivery or real
  interrupted-upload behavior. Missing external evidence remains blocked.
- The coding agent proposes fixes and evidence; it cannot approve itself, change
  review policy to pass, auto-merge or declare production acceptance.
