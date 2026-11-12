# Phase 2 — ten small repairs in one batch

Baseline: `369a132f694322da0b9f7a1a82b38277159c35b4`, on the existing Phase2 feature branch. These are ten concrete engineering corrections, not ten independently closed canonical audit rows. Several correct different mechanisms within one broad original finding. Main, migrations, permissions and external acceptance gates are unchanged.

| Batch ID | Original audit relationship | Confirmed behavior before repair | Candidate behavior |
|---|---|---|---|
| B01 | PH2-G05-002 | Project controller wrapper drops supplied startDate, bypassing canonical date-order validation and persistence | Forward startDate to the existing validator/writer |
| B02 | PH2-G05-006 | Closure accepts impossible/free-text dates into its event facts or silently defaults empty/null values | Reject supplied invalid calendar dates before SQL; retain optional-date behavior |
| B03 | PH2-G05-002 | Project rename accepts control characters that creation rejects | Apply the same name control-character restriction on PATCH |
| B04 | PH2-G05-002 | Project creation/PATCH can select archived/deleted parties; PATCH does not explicitly enforce active tenant ownership | Lock and require a current active, undeleted, same-tenant party before linking |
| B05 | PH2-G05-002/005 | A new variation can reference a SUPERSEDED parent contract | Require an ACTIVE parent in the exact tenant/project under lock; preserve FK isolation |
| B06 | PH2-G05-002 | Variation scope is serialized without depth/node/byte/type budgets | Validate and detach bounded JSON before acquiring a connection; reject malformed or oversized scope |
| B07 | PH2-G20-001/006 | Null envelopes throw TypeError; SYSTEM channel values reach SQL without enum validation; deep/cyclic/non-JSON payloads reach recursive canonicalization | Validate envelope/channel/urgency and bounded JSON before transaction/canonicalization |
| B08 | PH2-G03-002 | Historical org_profiles.allow_self_approval can disagree with the authoritative organisation policy returned to consumers | Read the canonical policy; an explicit false update synchronizes both columns. Enabling self-approval was already blocked and remains blocked |
| B09 | PH2-G03-002 | Branding accepts READY/scanned rows without provider-version identity or exact observed size | Require a pinned provider version, matching observed size and SHA-256 identity before linking |
| B10 | PH2-G03-002 adjacent tenant boundary | Profile controller and compatibility writer ignore the supplied organisation target and can mutate the active tenant under a mismatched target when invoked directly | Route through a service target check; reject mismatched organisations before SQL while retaining current alias |

B10 is a reproduced controller/service boundary defect, not a claim that the global HTTP guards were bypassed. B05 cross-project IDs were already constrained by composite FKs; the new active-parent fence supplies a deliberate domain rejection without weakening those constraints. B09 tests storage metadata eligibility, not actual branding rendering, real bytes, scanner operation or provider acceptance.

## Evidence and regression scope

The initial draft pre-database probe ran against baseline source before edits:14 failures and1 passing malformed-array rejection. One failure was an incorrect expected self-approval error code; inspection established that enabling self-approval was already prohibited, and the final assertion preserves that existing code. That assertion is not evidence of a new defect. The other13 failures reproduce input/wrapper mechanisms, not13 separate fixes and not every database defect. The remaining relationship/policy/branding findings are source-confirmed at baseline; actual fixed-path disposable PostgreSQL tests exercise their positive/negative controls. The final boundary suite adds safe nested-JSON, accessor, sparse-array and non-JSON coverage.

The actual PostgreSQL regression uses restricted tc_app queries in a newly created random disposable database. It verifies date persistence/date-order rejection; active versus archived/deleted/foreign counterparties; ACTIVE versus SUPERSEDED/wrong-project variation parents; unchanged variation count after denial; legacy conflicting policy reads and explicit disable synchronization; unpinned versus pinned branding metadata; and wrong-target rejection without a version change. Fixtures are clearly synthetic and confer no engineering/provider approval.

JSON admission uses a20-level nesting limit,2000-node budget, cumulative text-byte checks, and final serialized-byte checks (4096 bytes for notifications,32768 for variation scope). These are technical resource limits, not new billing/HVAC policy. Accessors are never invoked, cycles/nonfinite numbers/BigInt/unsupported objects/sparse arrays reject, and accepted values are detached before persistence.

Validation commands, results and exact changed-source hashes are recorded with logs under `evidence/easy-ten-20261112/`. Node22.23.5/pnpm12.4.1 and the existing isolated PostgreSQL16 fixture service on127.0.0.1:55432 were used. No customer data, real provider credentials or production database was accessed.

Independent review, exact-head CI, full application browser acceptance and real providers remain pending. The stacked draft PR targets the existing Phase2 integration branch; the current main-only application CI trigger does not run for that base. No merge, deployment, self-approval or production acceptance is requested or claimed.

## Validation results

- `pnpm typecheck`: passed on the final source.
- `pnpm build`:6 tasks passed;5 unchanged tasks cached and API rebuilt.
- Ten affected regression suites:51 tests passed before the added bounded-JSON matrix; final boundary-only rerun:16 passed. Counts overlap and are not summed.
- `pnpm test:security`:15 passed; `pnpm test:rbac`:8 passed.
- `pnpm --filter @tradecloseout/api test`:530 passed,1 production-mode HTTP startup failure across87 suites. The first full invocation omitted REDIS_URL; a configuration-only rerun then rejected the fixture's short password. After providing isolated Redis and a compliant tc_app credential, the same test reached its real worker, which correctly rejected absent qpdf. These are failed runs and are retained as such, not passing evidence.

System qpdf installation required an unavailable sudo password. The official Arch qpdf12.3.2-2 package was instead downloaded into/tmp, verified against the installed Arch keyring (RSA fingerprint ADC8A1FCC15E01D45310419E94657AB20F2A092B), and extracted without changing system files. A temporary launcher invokes the real binary with its bundled library. No scanner, runtime-role, authentication or dependency guard was bypassed. The final HTTP rerun uses this binary, Redis on127.0.0.1:56379 and the same isolated PostgreSQL16 container with a restricted tc_app role and a compliant local-only credential.

Commands that need fixture sockets were run with sandbox escalation; all services and credentials are disposable/local. The initial TypeScript draft assertion and fixture setup failures are documented rather than hidden. Full root-workspace/browser/provider acceptance and independent review remain separate from the API batch checks.

Final production-mode HTTP rerun: **1 test passed** in28.32 seconds. Therefore every one of the531 API tests passed across the full invocation and the configuration-corrected single-suite rerun. This is not represented as a single clean full-suite invocation. No application source changed between those runs. The strict HTTP test uses its own local TLS message gateway; it does not certify any real provider.
