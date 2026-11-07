# TradeCloseout Codex Cloud environment setup

This file is setup guidance for the cloud environment's setup conversation. It does not itself create or publish a hosted environment.

Repository: `omniscient2002/tradecloseout`. Base branch: `main`.
Suggested environment name: `tradecloseout-dev`.
Access: private to the owner unless deliberately shared.

## Prompt for the environment setup conversation

```text
Prepare and test a reusable development environment for omniscient2002/tradecloseout
from main. Read AGENTS.md and .github/workflows/deploy.yml first.

Use Node 22 and pnpm 12.4.1. Install dependencies with the frozen lockfile. Include
PostgreSQL 16, Redis, qpdf, unzip and Playwright Chromium with its system dependencies.
Use only local disposable test services, never my laptop or production services.

Match the CI test contract with local-only test credentials:
MIGRATOR_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tradecloseout
APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:5432/tradecloseout
REDIS_URL=redis://127.0.0.1:6379
TZ=Asia/Kolkata
NODE_ENV=test

Those are disposable development credentials, not production secrets. Provision a
fresh environment-local PostgreSQL instance/database. Ensure the administrator can
create/drop the random databases and roles used by the tests. Apply migrations to the
environment-local database; never point these commands at an external customer database.
The runtime role must remain non-superuser and NOBYPASSRLS. Inspect the current migration
and test helper code rather than weakening database security to resolve setup errors.

Record an idempotent install script and startup instructions/skill for local services.
Verify services are ready and survive the environment's supported new-task startup
behavior. Include package-manager domains and cdn.sheetjs.com for the locked SheetJS
download. Allow additional tool/download domains only when the actual install needs them.
No real SMS, mail, S3, payment or production credentials are needed for the existing
fixture regression suite.

Run pnpm typecheck, pnpm build, pnpm test, pnpm test:security and pnpm test:rbac.
Record actual results and any unverified integration. Do not call the environment fully
validated if only typecheck passes. Do not change application code, manifests, lockfile,
or tests merely to conceal an environment failure; report necessary code changes as a
separate task.

The root suite includes archive-browser and service integration fixtures. It does not
establish the full application browser journey or real-provider production acceptance.
To run the application separately, use development mode for local-only services,
API port 3001, web port 3002 and API_URL=http://127.0.0.1:3001. Use explicit isolated
application fixtures; do not treat a missing production provider as successful delivery.

Do not deploy, create paid infrastructure, charge payments, or push directly to main.
Once setup and checks are complete, show the configuration/results so I can publish the
environment. Coding tasks should use feature branches and reviewed PRs.
```

## Owner steps

In Codex on the web/desktop, create a Cloud environment, connect GitHub if prompted,
select this repository and start setup. Use the prompt above to refine the setup.
Review its actual test report and publish the environment when ready. Environment
creation and publication require the account UI; the local `codex cloud` CLI can list
tasks and submit work to a known environment ID but does not expose creation commands.

After publication, reopen the same cloud task on the Pixel to continue it. Cloud work
has its own checkout/services and does not automatically share this laptop terminal or
uncommitted files. Use the environment ID to connect local task submission when available.

Official setup reference: https://learn.chatgpt.com/docs/environments/cloud-environments
