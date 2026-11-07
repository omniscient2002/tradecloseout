# Executive audit

TradeCloseout has a credible product thesis and useful implementation foundations, but the current working tree is **not ready for real customer contractual evidence or an unrestricted customer pilot**. Permit synthetic demonstrations only until the trust gates in the production report pass. This is a source-based release assessment, not a penetration-test certificate.

The defensible product is a contractor-owned obligation and evidence ledger: who owes what, for which equipment or work scope, which exact evidence revision was accepted, who currently owes a response, and what still blocks a handover or commercial milestone. A generic file repository cannot answer these questions reliably. TradeCloseout should coexist with the main contractor's collaboration system and the contractor's accounting software.

## Current strengths

The repository already separates web, NestJS API, worker and shared/database/PDF packages. It includes tenant transaction wrappers, forced RLS migrations, composite keys in much of the original schema, opaque session tokens, CSRF checks, two independent document status dimensions, outbox events, equipment identity history, supplier obligations, review comments, package snapshots and negative security tests. Preserve these investments where their actual behaviour matches their intent.

Recent uncommitted changes have improved completion to PROCESSING, the default antivirus failure mode, missing-original handling and explicit idempotency metadata. Do not revert them to match older reports.

## Principal blockers

| Trust claim | Current evidence | Required outcome |
|---|---|---|
| Only intended external actor can act | OTP-required session exchange can accept arbitrary PIN; grant context disappears before service checks (TC-F001–003) | Challenge proof and resource-level grant enforcement |
| Logout ends access | Wrong server column plus no browser API call (TC-F004–005) | Immediate server revocation and actor-cache cleanup |
| Approved means authorised and verified | Stamp-back bypass and multiple decision paths (TC-F006–008) | One constrained review command |
| Uploaded means real immutable bytes verified | Missing storage-to-worker bridge, synthetic multipart and unscoped worker writes (TC-F009–013) | Real provider lifecycle and atomic scan attestations |
| Requirement satisfied means correct version accepted | Document-wide updates and weak readiness join (TC-F014–015) | Version-pinned assessments and deterministic evidence rules |
| Ready dossier or verified signature is truthful | Artifact-free READY and metadata-only verification (TC-F011,016,024–025) | Artifact/digest and independently verified trust states |

## MVP recommendation

Serve a contractor PM and document controller on a real HVAC project with scoped site contributors and a restricted supplier upload inbox. Include controlled checklist import, responsibility and deadlines, equipment identification, original evidence and revisions, internal review plus recorded external response, version-aware satisfaction, ball-in-court inbox, reproducible handover export, and milestone evidence readiness. Keep contractual acceptance distinct from internal preparation.

Defer native commissioning forms, broader procurement controls, extensive DLP, retention accounting, AI, e-invoicing, legally asserted digital signatures and general workflow builders. These must not delay repairing the evidence chain. Commercial readiness reports prerequisites and recorded payment follow-up; it does not certify entitlement or guarantee payment.

## Engineering and commercial judgement

Retain a modular monolith plus worker. Consolidate duplicate policy/review/upload implementations before adding domains. A large schema and many screens do not demonstrate operational completeness. The real adoption test is whether one document controller can import a contractor's current spreadsheet, issue bounded supplier requests, resolve returned comments and export a defensible package without parallel evidence bookkeeping.

Price and willingness to pay remain hypotheses. Run paid discovery with small and medium specialist contractors before fixing a tariff; measure preparation time, return cycles, missing OEM documents, response aging and export completeness. Do not claim market size, competitor unaffordability or retention recovery uplift without observed data.

## Validation and report navigation

API, web and worker TypeScript checks passed with no emit and incremental writes disabled. Four selected local Jest suites passed: 45 tests. These are predominantly mock/policy tests, not proof of real PostgreSQL RLS, S3 multipart, ClamAV, provider delivery or complete browser-to-dossier flow. No migrations, seeds, live simulations, deployments or destructive drills were run.

Start implementation with [master blueprint](TRADECLOSEOUT_IMPLEMENTATION_MASTER_BLUEPRINT.md), execute [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md), track [finding register](TRADECLOSEOUT_FINDING_REGISTER.md), and gate releases using [production readiness](TRADECLOSEOUT_PRODUCTION_READINESS.md). Research, UX, architecture, opportunities, decisions and roadmap are linked from the blueprint. All recommendations are design proposals authorised for documentation, not approval to deploy or change application code.
