# Phase 1 implementation difficulty and ten-fix pass

Baseline: PR #19 at `dd21bdbaa8096c3f5e15b51e0e8bd7e96d319bf5`, a main-based unmerged candidate. Feature branch: `fix/phase1-easy-fixes-20261112`. Provider/service setup remains deferred. This branch is an integrated candidate containing the #19 baseline plus this pass; it does not approve the baseline or close the 49 original findings.

## Difficulty criteria

- **Easy:** a local, explicit contract with a small change and deterministic positive/negative tests. Usually hours to a day. Existing scoped repairs may need verification only.
- **Medium:** several routes/services, a shared policy/schema or substantial integration fixtures. Usually multiple focused passes.
- **Hard:** distributed ownership/recovery, cross-cutting tenant/domain invariants, migration compatibility, sandboxing or unresolved operational/policy contracts. Plan and review in stages.

These are relative engineering estimates, not promises. External prerequisites are tracked separately; unknown provider/IAM/legal/production evidence is not solved by a code estimate. The overall 49-row rating describes the **whole remaining requirement**. A medium/hard row can contain an easy slice implemented here. Four Easy rows below already had scoped repairs at the baseline; they are not counted as new fixes.

## Ten bounded implementations

| Pass ID | Original finding | Implemented correction | Evidence / remaining boundary |
|---|---|---|---|
| E01 | PH1-G27-003/005 | Establish one UUID correlation ID before authentication; discard invalid original input; reuse it in guard/filter/header/logs. | Real middleware/guard/filter canaries and safe UUID correlation; not universal telemetry certification. |
| E02 | PH1-G01-003 | Strict proposal UUID and code validation before MFA budget/SQL; cancel and confirm validate again in store. | Malformed shapes never reach DB; existing real PG enrollment/recovery remains required. |
| E03 | PH1-G02-005 | PermissionGuard denies absent permission policy. | Missing-metadata denial before pool checkout and explicit-policy positive; universal route inventory remains. |
| E04 | PH1-G02-005 | Reject malformed UUID resource route parameters before session/resource queries. | Guard tests for malformed scalar/array/null; token/key segments and explicit current-org alias retain separate contracts. Body-ID and full route matrices remain. |
| E05 | PH1-G02-004 | Load the actual org document-controller download flag and prohibit guests inheriting it. | Positive/negative/guest guard tests; full A/Y/S policy and service alignment remain open. |
| E06 | PH1-G24-005 | Require safe gateway URL/transport, reject credential URLs and redirects, cap ACK at 4 KiB and require exact notification acceptance. | Redirect HTTP fixture, bounded-stream and malformed/mismatched ACK tests; no real provider acceptance. Claim/retry/fairness/delivery ledger remains hard work. |
| E07 | PH1-G24-008 | Preserve unresolved claims after handler failure or non-success; never infer rollback from an error. | Real PG domain commit followed by injected lost acknowledgement cannot re-execute on same key. Fail-closed change can leave failed commands pending; operator reconciliation remains hard and is not claimed implemented. |
| E08 | PH1-G24-011 | Fail production/staging startup when required qpdf probe fails, before queues start. | Missing/present dependency tests with fixed diagnostics; full worker dependency/readiness contract remains. |
| E09 | PH1-G26-006 | Scheduler connections are destroyed after BEGIN/COMMIT uncertainty or failed rollback; primary errors survive. | 18 failure-injection cases across six scheduler families. Manual main/processor transactions, server budgets, cancellation and classified retries remain. |
| E10 | PH1-G26-003 | Remove three nonexistent ORM columns and correct the migrated org download column name. | Actual migrated PostgreSQL select-all queries for organisations/org_profiles; complete schema/type/constraint parity remains medium. No migrations or historical checksums changed. |

The proposed review-read permission switch was excluded after inspecting its services: widening access before implementing row/guest scope could expose review data. That requires the broader G02 work. It is not counted among these ten.

## All 49 findings

4 Easy (existing scoped repairs), 22 Medium, 23 Hard. None is marked RELEASE_ACCEPTED by this pass.

| Original finding | Whole remaining requirement | Easy slice in this pass | Remaining acceptance from the re-audit |
|---|---|---|---|
| PH1-G26-001 | Easy | — | Runtime partition isolation repaired, including future/attached children and legacy upgrade. Preserve per-ID reviewer decision and deployed alternate-role review. |
| PH1-G26-002 | Hard | — | Complete immutable-object accounting, duplicate/failure/delete/restore and stuck-object reconciliation across all writers. |
| PH1-G26-003 | Medium | E10 | ORM unchanged from main. Examples still define absent `allow_generic_review`, `default_timezone/default_locale`; reconcile actual schema/ORM and automate fresh/upgrade equivalence. Do not repeat the old 33-table count as a new measurement. |
| PH1-G26-004 | Hard | — | Account/org/session/token/MFA fence improved. Project-member/scope gap reproduced on assets; inventory all entry points/system exceptions. |
| PH1-G26-005 | Hard | — | Exactly-one eligible owner and member/assignee constraints need integrated concurrent proof. Other Phase 2 PRs are not current-tree acceptance. |
| PH1-G26-006 | Medium | E09 | BEGIN/COMMIT/ROLLBACK disposal and budgets improved in general wrappers. Manual worker transactions still release after swallowed rollback failures; no universal classified whole-command retry/cancellation contract. |
| PH1-G26-007 | Medium | — | Uniform canonical tenant aliases/policies/functions and conflicting-alias negatives across all tenant tables remain. |
| PH1-G26-008 | Easy | — | Trusted sequence, protected registry, legacy reconciliation and concurrency repaired in exercised cases. External audit anchoring is separate G27 work. |
| PH1-G26-009 | Medium | — | Upgrade preflight/impact and compatibility tooling still needed; actual production data inventory/operator rollout deferred. |
| PH1-G26-010 | Hard | — | Reproducible DB/object/key recovery tooling and drills remain; deployed PITR/RPO/RTO acceptance deferred. |
| PH1-G26-011 | Medium | — | Automated role/function/TLS/pool-budget negatives remain; deployed IAM/network/capacity acceptance deferred. |
| PH1-G01-001 | Medium | — | Actual MFA/identity controllers exclude generic receipts; serialized credential detection improved. Dedicated lost-response recovery and historical plaintext receipt handling remain. |
| PH1-G01-002 | Easy | — | Current-key-first v1/v2 factor handling and key retirement tests pass. Safe re-encryption coverage, retirement metrics/runbook and operational drill remain separate. |
| PH1-G01-003 | Medium | E02 | Session-generation-bound ten-minute proposals, encrypted factors, one-use recovery, replay checks and rotation pass actual PG/direct-controller tests. Input UUID validation/cancel edges, concurrency/lost-response HTTP/browser matrix remain. |
| PH1-G01-004 | Hard | — | Session authority improved; user/member/project exception inventory, multi-process real HTTP and suspended-org recovery remain. Guard currently rejects inactive org before escape routes. |
| PH1-G01-005 | Hard | — | Delivery outcome/receipt correlation and supervised recovery still need code/policy. Real SMS/mail/authority receipts deferred. |
| PH1-G01-006 | Hard | — | Build actual multi-instance HTTP and browser/proxy test harness; current filter/direct-controller tests do not suffice. Deployed HTTPS acceptance deferred. |
| PH1-G01-007 | Medium | — | Redacted event/retention/incident code inventory and failure behavior remain; actual SIEM/IAM/privacy acceptance deferred. |
| PH1-G02-001 | Hard | — | Selected document scope checks pass. Asset and batch-link/indirect paths remain; complete list/count/read/write/export scope matrix. |
| PH1-G02-002 | Medium | — | Live review authority now resolved per transaction; complete APPROVE/REJECT/changes/mixed-project/alias matrix with verified evidence and real routes. |
| PH1-G02-003 | Medium | — | Shared versioned scope/legacy reconciliation absent across all families; read-only/asset restriction bypass reproduced. |
| PH1-G02-004 | Medium | E05 | Dual permission evaluators remain; current guard checks project membership only for S in non-guests. Resolve A/Y/S, org-wide toggle (still hardcoded false in guard), auditor/read-only and reviewer behavior. |
| PH1-G02-005 | Medium | E03/E04 | String-based route heuristics remain, as does no-permission-metadata allow. Typed resource resolvers, pre-SQL runtime UUID validation and parent-child matching required. |
| PH1-G02-006 | Hard | — | Some document guest queries are narrower; #19 does not inherit all old G02 repairs. Execute original G02 supplier intake/grant/roster/relationship/alias cases; real delegated authority deferred. |
| PH1-G02-007 | Medium | — | Current typecheck/build/365 API tests green. Old scenarios from the stacked G02 branch are not all thereby exercised; preserve full original 17-case acceptance. |
| PH1-G02-008 | Hard | — | Enforce current project authority on every command; actual two-process guard/remove/write and system-context inventory. |
| PH1-G02-009 | Hard | — | Universal project-first lifecycle gate for baseline writers, aliases, bulk and schedulers. |
| PH1-G27-001 | Hard | — | Runtime partition bypass repaired. Independent checkpoint/export/restore protocol still needs implementation plus external immutable anchor acceptance. |
| PH1-G27-002 | Hard | — | Genesis/order/content/internal registry head repaired. Hash still omits IP/user-agent/sequence; global/null-org events omitted; versioned metadata and external checkpoint compatibility remain. |
| PH1-G27-003 | Medium | E01 | Recursive field/value redaction improved; enforce canaries across direct audit writers, receipts, errors, correlation, queues and exports. |
| PH1-G27-004 | Easy | — | Versioned immutable envelope, reserved-field rejection and authoritative dispatch implemented. Eleven producer/parser/redaction tests pass; real PG/BullMQ provenance tests observed in CI, not rerun locally. Every consumer/direct queue boundary remains separate G24-009 work. |
| PH1-G27-005 | Medium | E01 | General raw error/health redaction improved. Canonical correlation and all HTTP/worker/provider 4xx/5xx surfaces still need checks. |
| PH1-G27-006 | Medium | — | Shared command/outcome/event/notification inventory; actual critical-event consumers. Informational outbox events still just log then acknowledge. |
| PH1-G27-007 | Medium | — | Basic API headers and page framing/cache policy implemented. Full reviewed CSP/cache/document behavior/browser tests remain; deployed HTTPS/HSTS/proxy acceptance deferred. |
| PH1-G27-008 | Medium | — | Console classification is not actionable metrics/traces/SLO instrumentation; bounded labels, ingestion-failure tests and alert fixtures remain. Actual backend/on-call delivery deferred. |
| PH1-G27-009 | Hard | — | OS parser/converter resource/network isolation, decoded complexity/temp bounds and test fixtures needed. Real scanner/storage acceptance deferred; cannot defer sandbox code. |
| PH1-G27-010 | Hard | — | Named human IAM/legal/key/incident acceptance deferred; fail-closed configuration and independently reviewed recovery/runbook contracts still required. |
| PH1-G24-001 | Hard | — | Renew/cancel and durable per-effect fencing; real Redis/process fault drills. |
| PH1-G24-002 | Medium | — | Owner lookup now tenant-scoped with exactly-one check and per-tenant failure handling. Current-owner locking, transfer/suspension/race and recipient reconciliation acceptance remain. |
| PH1-G24-003 | Hard | — | Durable dead letters/replay/terminal reconciliation for every queue; fifth outbox failures still stranded. |
| PH1-G24-004 | Hard | — | Short claim/dispatch/ack protocol, no Redis I/O under business DB locks, SQL failure isolation. |
| PH1-G24-005 | Hard | E06 | Notification claim/retry/dead-letter/receipt state machine and provider safety fixtures now; actual provider receipts later. |
| PH1-G24-006 | Medium | — | Per-task non-overlap/failure separation repaired locally. Durable catch-up and tenant progress still needed; missed Monday is not recovered by a Monday-only condition. |
| PH1-G24-007 | Hard | — | Deterministic quota SQL error repaired and worker has version/status fencing. End-to-end duplicate/crash scan-to-final-state/accounting and stuck-state recovery acceptance remain. |
| PH1-G24-008 | Hard | E07 | Durable UNKNOWN/business-outcome reconciliation; no claim deletion after uncertain commit, no permanent unresolved command. |
| PH1-G24-009 | Hard | — | V1 outbox admission improved. Queue consumers still trust direct job data; format converter reads/writes caller paths without owned-root validation or resource provenance. |
| PH1-G24-010 | Medium | — | Tracked scheduler/poller drain added. No built-in deadline/cancellation; async terminal-failure listeners not all tracked. SIGTERM/commit/enqueue/provider recovery tests remain. |
| PH1-G24-011 | Medium | E08 | Current worker dependency check merely warns when qpdf is absent; full enabled-capability readiness and fail-closed startup missing. Live provider probes deferred, capability/configuration tests possible now. |
| PH1-G24-012 | Hard | — | Fair admission/resource/retry budgets and programmable load/failure tests remain; production vendor throughput/durability/SLO acceptance deferred. |

## Validation and limitations

See `phase1-ten-fixes-evidence-2026-11-12.md` for final source SHA, commands, results and CI. Per-ID independent acceptance and user merge authority remain unchanged.
