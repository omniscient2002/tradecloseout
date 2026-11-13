# PH2-NEW-015 — specification document scope and admission

Baseline after completing the contract fix: `e5bdac3233aded0e9da02946b964799642e25cec`. Original batch baseline: `495dd76f1ef73ad2bad433ddce9153700cfa79f2`. Parent PH2-G05-002/005 IDs and independent acceptance states remain unchanged.

## Reproduced defects and correction

The baseline specification command ignored unsupported fields, permitted control characters, and reread caller-owned data after checking a document. The database had no foreign key on `specification_refs.document_id`. Actual restricted tc_app SQL accepted a document from another project. A coordinated command test checked a valid document, changed the original DTO while its transaction remained open, and persisted a foreign tenant document ID with the changed reference/title/division. This is a reproduced command/SQL mechanism; it does not establish an externally exploitable HTTP body-mutation path or bypass existing authenticated-session guards.

The command now validates the project UUID and snapshots only declared data fields before SQL, without calling request accessors. It rejects unsupported/malformed envelopes and control characters with 422, retains existing text bounds, and normalizes optional division whitespace to NULL. The same admitted document ID is checked and persisted. Existing lifecycle lock, current same-tenant/project nondeleted document check and transactional business history remain in force.

Append-only migration `0054_specification_document_scope.sql` adds and validates a composite foreign key `(org_id,project_id,document_id)` to `documents(org_id,project_id,id)`. Nullable metadata-only references remain valid. The migration grants no privileges, invents no replacement identity, deletes no records and rewrites no history. Invalid historical links cause validation and the migration ledger entry to roll back; those databases require explicit reconciliation before retry. Lock/statement timeouts are transaction-local. The ORM schema now includes the existing reference columns and the same composite document relationship. Referenced documents are not given cascading deletion semantics.

A specification reference remains metadata. It does not establish a verified immutable object/version, engineering classification, approved specification, checklist baseline or reviewed evidence. Tests seed only explicitly synthetic document metadata with no storage/version/approval records, and do not claim HVAC or provider acceptance.

## Reproduction and targeted verification

- Before correction, the specification boundary suite had 11 failed / 7 passed cases. The corrected database fixture run had 2 failed cases (direct SQL scope and checked-document persistence); the migration test was intentionally filtered out before the migration existed. An earlier probe failed on lowercase synthetic project codes; that fixture was corrected to the existing uppercase rule, with no production validation weakened. The corrected baseline is the reproduction evidence.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-specification-admission.spec.ts test/phase2-contract-admission.spec.ts`: 41 passed across 2 suites after both fixes.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-specification-scope-db.spec.ts test/phase2-contract-admission-db.spec.ts test/phase2-project-money-variations-db.spec.ts`: 6 passed across 3 suites.
- The specification DB suite verifies rejected native INSERTs for wrong-project and foreign-tenant document IDs, admitted document/text identity across a controlled post-check pause, nullable metadata references, denied deleted/foreign/project-mismatched documents, static lifecycle denials and audit-failure rollback.
- The real 0053→0054 upgrade test seeds an inconsistent historical link, observes validation failure, verifies unchanged row content and absence of the rolled-back constraint/ledger entry, explicitly corrects only the synthetic fixture, then verifies validated migration, preserved NULL references and repeat-run ledger stability. The migration does not perform that fixture correction.
- `pnpm typecheck`: passed on the changed implementation, schema and tests.

Node 22.23.5/pnpm 12.4.1 and only existing environment-local PostgreSQL 16 at 127.0.0.1:55441, Redis at 127.0.0.1:56379 and real qpdf were used. Runtime remains restricted tc_app; migration administration is separate. Dependencies were reused and the lockfile is unchanged. Test counts overlap broader regressions and must not be summed. Logs, raw/stored log hashes and exact changed-source hashes are under `evidence/commercial-records-20261113/`; stored text normalizes terminal whitespace only.

Independent review must assess compatibility for clients sending previously ignored fields and migration reconciliation for existing invalid references. Large real-data migration/load acceptance, real application browser journeys, exact-head remote CI and engineering/provider acceptance are not supplied by these fixtures. Root browser tests cover archive/auth storage only; no `pnpm test:e2e` application acceptance is claimed. The stacked PR targets the Phase2 integration branch while application/group CI trigger only for main. Original independent closure counts remain unchanged. No merge, deployment, self-approval or production acceptance is claimed.

## Integrated verification checkpoint

- `pnpm build`: passed all 6 tasks (3 unchanged tasks cached; DB/API/worker rebuilt).
- `pnpm db:migrate`: applied 0054 successfully to the isolated fixture only.
- `pnpm test:security`: 15 passed; `pnpm test:rbac`: 8 passed.
- `git diff --check`: passed; exact changed implementation, schema, migration and test hashes match `source-hashes.json`.

- Final `pnpm test`: passed in one complete invocation — **691 API tests across 101 suites**, **33 worker**, **91 shared**, **13 database**, **10 archive/auth-storage browser tests**, and PDF checks. See `workspace.txt`. Counts overlap targeted/security/RBAC runs and must not be summed.

The completed contract fix is committed as `e5bdac3233aded0e9da02946b964799642e25cec`; the next commit contains the completed specification fix and this final integrated evidence. This is local implementation/fixture verification, not independent audit closure, real integration acceptance or production deployment.
