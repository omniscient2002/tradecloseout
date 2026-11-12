# PhasePilot Phase 01 — Security & Platform Foundations

**Status: implementation in progress; NO-GO; no deployment or merge.**
**Base:** main at `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`.
**Audit input:** PR #15 head `c605263891bcc0976b4af7429f74a59b6c573757`, specifically `docs/audits/phase1-2026-11-12/findings.json`, G26/G01/G02/G27/G24 reports and evidence manifests.
**Read-only comparisons:** PRs #5 (G01), #12 (stacked G01/G02) and #16 (broad stacked candidate; `36c8efb94ce2ed77ef016ef58ad44d494bfc6e84` inspected). None was reused, changed or merged. Their local assertions and historical green CI are **not** proof for this head. The reserved PhasePilot branch starts from main to avoid inheriting unreviewed, unmerged unrelated dependencies.

## Group-by-group gap inventory and acceptance map

These 49 **original findings remain OPEN for independent closure**, even where a specific candidate code repair is present. The entries below represent audit observations rechecked against main and selected candidate sources; items not directly inspected/run are **unverified** rather than asserted to still reproduce at this phase head.

| Group | Finding IDs and state at this head | Acceptance criteria / required remaining work |
|---|---|---|
| **G26** | **001:** targeted additive child RLS, DML ACL and mutation/trigger migration + negative/positive PG tests; **002:** typed BIGINT SQL and focused PG test. **003–011:** not closed; older candidate fixes are only read-only references. | Verify uniqueness, composite FKs, tenant-bound transaction access, rollback on failure, concurrent writes, fresh/upgrade migration checksums, unprivileged child direct queries, all current/future partitions, drift of 33 ORM tables, owner invariant, transaction timeout/poisoned connection, aliases, trusted chain order, operator inventory, restore/PITR, roles. |
| **G01** | **001–007:** unimplemented on this clean main-derived branch. Historic G01 changes exist only in unmerged PRs #5/#12/#16. | Enroll/login/OTP expiration and replay, rate limits, MFA setup/recovery and step-up, current and retired encryption keys, session renewal/revocation, password reset and anti-enumeration, real provider plus proxy/browser acceptance, immutable and redacted security audit. |
| **G02** | **001–009:** unimplemented on this clean main-derived branch. Prior fixes from stacked candidates are not imported. | Default-deny command authorization, strict scopes, project/org isolation on read/write/list/export, guest and bulk review operations, cross-project and revoked-member negative tests, project lifecycle and route coverage. |
| **G27** | **001:** audit child access/immutability candidate shares G26-001. **002–010:** unimplemented here. | Independently anchored append-only head/count; genesis/tail/hash integrity, security envelope and nested redaction, error/health hygiene, threat models, security headers, metrics/SLO/alerts, vulnerability scanning, OS sandbox, incident/key/IAM/legal controls. |
| **G24** | **007:** quota arithmetic candidate shares G26-002. **001–006,008–012:** unimplemented here. | Leases with fencing, tenant-fair owner digests, outbox claim/ack/retry/DLQ, bounded provider idempotency, recovery, job visibility, graceful drain, due scheduling, multi-node crashes and real vendor acceptance. |

### Detailed original-ID disposition

- **G26:** PH1-G26-001 candidate partial (physical partition access); PH1-G26-002 candidate partial (typed arithmetic); PH1-G26-003 ORM drift pending; PH1-G26-004 live command authority pending; PH1-G26-005 owner/membership invariants pending; PH1-G26-006 rollback/timeout pending; PH1-G26-007 alias handling pending; PH1-G26-008 audit sequence ordering pending; PH1-G26-009 migration production conversion pending; PH1-G26-010 backup/restore contract blocked on infrastructure; PH1-G26-011 resource budgets/privileges blocked on deployment verification.
- **G01:** PH1-G01-001 MFA plaintext receipt pending; PH1-G01-002 encryption key retirement pending; PH1-G01-003 MFA proposal expiry pending; PH1-G01-004 current session eligibility pending; PH1-G01-005 real delivery/recovery acceptance blocked; PH1-G01-006 browser/proxy/multi-node acceptance blocked; PH1-G01-007 incident/retention acceptance blocked.
- **G02:** PH1-G02-001 document scope pending; PH1-G02-002 bulk decision membership pending; PH1-G02-003 malformed scope pending; PH1-G02-004 role-policy contract awaiting decision; PH1-G02-005 explicit route resource lookup pending; PH1-G02-006 guest relationship/scope pending; PH1-G02-007 full candidate regression must be reproduced for this head; PH1-G02-008 command matrix pending; PH1-G02-009 project lifecycle write gate pending.
- **G27:** PH1-G27-001 shares G26-001 candidate; PH1-G27-002 verified genesis/head pending; PH1-G27-003 nested redaction pending; PH1-G27-004 trusted actor envelope pending; PH1-G27-005 public error/health pending; PH1-G27-006 business event coverage pending; PH1-G27-007 browser headers pending; PH1-G27-008 metrics/alerting blocked on monitoring; PH1-G27-009 converter sandbox blocked on runtime; PH1-G27-010 human/IAM/KMS/incident legal blocked.
- **G24:** PH1-G24-001 leases pending; PH1-G24-002 scoped owner digests pending; PH1-G24-003 DLQ/recovery pending; PH1-G24-004 no Redis under DB lock pending; PH1-G24-005 notification retries pending; PH1-G24-006 scheduler overlap pending; PH1-G24-007 shares G26-002 candidate; PH1-G24-008 expired idempotency reconciliation pending; PH1-G24-009 queue resource/event checks pending; PH1-G24-010 shutdown drain pending; PH1-G24-011 chain readiness pending; PH1-G24-012 deployed scale/vendor acceptance blocked.

## Actual changed components

- `packages/db/migrations/0021_phase1_audit_partition_boundary.sql`: forward-only correction for direct audit child table access; child ENABLE/FORCE RLS, revokes runtime child DML, parent row immutability and parent/child TRUNCATE denial. Removes *future* implicit table-wide tc_app DML grants from the tc_migrator default ACL. Follow-up migrations must explicitly grant non-audit runtime access when needed.
- `packages/db/src/tenant-tx.ts`: storage quota reconciliation now sends numeric input and returns BIGINT rather than TEXT.
- `packages/db/test/db-integration.spec.ts`: actual restricted-role audit partition denial, normal parent scoped operations, cross-tenant negative read and typed quota update/isolation regression.

**Security and architecture decisions:** Prefer unprivileged runtime access through the audit parent; a SQL owner/migrator remains privileged, so this is *not* tamper-proof storage. Revoking blanket future defaults is intentional fail-closed, but requires explicit grant review for future migrations. No blanket BYPASSRLS, grant broadening or migration checksum rewrite. Quota change fixes the SQL type error only; exactly-once object finalization and retroactive reconciliation remain unproven. Existing code and tests are retained otherwise.

## Verification and evidence

Repository commands inspected: `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:security`, `pnpm --filter @tradecloseout/db test` and `pnpm lint`.
**No local execution claimed.** This connector environment cannot reach a local PostgreSQL server or install the full repository workspace; the connector writes GitHub files but does not run the workflow locally. GitHub Actions exact-head results must be checked after the PR opens. Earlier candidate #16's green CI and audit #15's probes **do not** verify this implementation branch. Acceptance remains red/unverified until CI and independent review.

**Required focused and integrated checks:** PG16 freshly migrated/upgrade database under `tc_app`, all child and parent SQL paths including future attached partitions and current+next month insertion, migration reruns and duplicate/concurrent migration attempts, `pnpm --filter @tradecloseout/db test`, `pnpm test:security`, workspace build/typecheck/lint and full API/worker/browser/E2E. Validate direct child access by role and inherited ACLs, no parent loss, conversion arithmetic overflow and negative quantities, quota transactional rollback, idempotent duplicate READY transitions.

## Threats, operational constraints and rollback

**Threats:** direct-child RLS/immutability bypass and non-atomic file/usage status; remaining identity/authz, event-chain tampering, queue double-processing, insecure default grants. No production export/backup or secrets were accessed. Logs must not contain credentials or MFA setup material.

**Known risks:** the migration may expose an unexpected historic role/partition ACL dependency or owner-level maintenance process; verify catalog and consumer inventory before release. TRUNCATE trigger and row-trigger cloning need real PG16 confirmation. Future partition creation MUST be accompanied by the same negative tests and RLS/privilege provisioning; operator/migrator credentials bypass normal runtime limits. Dropping default DML grants can require reviewed explicit grants for newly created non-audit tables. The database type change does not prevent counter overflow; business-level exactly-once transition is not yet implemented.

**Rollback plan (non-destructive):** STOP before deployment if canary or migration test fails. The migration runner applies each file transactionally: a failed migration should roll back that migration; verify the ledger and permission catalog. For a *successfully applied* migration, do not delete/edit its ledger row or rewrite history. Prepare an independently reviewed forward compensating migration after restoring the audited access contract; do not re-grant child writes or weaken audit immutability. Restore from a verified snapshot/PITR only after explicit human approval and impact assessment. Corrected SQL can be rolled forward by follow-up code; do not reset counters without a proven object inventory.

**Human/external gates:** production PostgreSQL roles, backup/PITR restore, provider SMTP/SMS/WhatsApp acknowledgements, HTTPS reverse proxy, KMS/key rotation, two-node race drills, alert/SIEM/on-call, organization/guest legal delegation, data retention and sign-off. All currently blocked or unverified. No merge/deploy/approval authorized.

## Review checklist

- [x] Audited PR #15 head and referenced candidate PRs without changing them.
- [x] One reserved new implementation branch, no cross-phase work.
- [x] Narrow G26/G27 audit boundary and G26/G24 arithmetic changes with regression assertions.
- [ ] Actual exact-head PG16/Redis and full CI validation.
- [ ] Every original finding implemented and independently accepted.
- [ ] Production staging / external human gates.
