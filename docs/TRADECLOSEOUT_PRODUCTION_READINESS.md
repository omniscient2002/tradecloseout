# Production readiness and release gates

**Verdict: no real-customer release approval.** Current code contains direct guest-auth and approval trust defects plus incomplete storage and worker orchestration. Repository configuration and passing selected tests do not establish deployment safety. Canonical evidence: finding register TC-F001–030.

## Threat model and control evidence

| Boundary | Abuse/failure | Required control | Evidence needed |
|---|---|---|---|
| Browser to auth | OTP pumping, parallel consume, logout replay | Per-identity/IP/recipient limits; atomic challenge consume; secure cookie; CSRF; immediate revocation | Real multi-request tests and provider sandbox receipts |
| Member to project | Same-tenant ID guessing | Resolve project on every resource route; explicit scoped permission | Real HTTP matrix across two tenants, two projects and role sets |
| Guest to tenant | Grant bypass, scope extension and forwarding | Grant-bound principal, challenge proof, immutable request context, all-ID scope checks and allowlist DTOs | Arbitrary PIN rejected; revoked grant denies existing session immediately |
| Upload to trusted evidence | Missing/replaced/mismatched/malicious bytes | Real multipart, provider object version, observed hash/size/MIME, quarantined scan and bounded parsing | Full browser-to-worker test and late PUT/duplicate completion adversarial tests |
| Review to contractual assertion | Forged override, wrong authority, stale evidence | One command with stage assignment, proof, expected revision and append-only decision | Negative tests across all aliases, bulk and stamp-back |
| DB to worker | Lost/duplicate/foreign work | Tenant transaction, outbox receipt, lease/fencing and replay | Kill worker at each commit boundary; lose Redis and recover |
| Package to recipient | READY without bytes or false acceptance | Frozen manifest, stored artifact digest, named acceptance authority | Independent downloader validates all object hashes and package mapping |
| Public verifier | Signature metadata mistaken for cryptographic validation | Explicit levels of verification, no trust claim from hash alone | Fabricated input never returns cryptographic-valid |
| Operations to customer data | Secret leakage, unsafe migrations, missing backup objects | Workload identities, secrets manager, immutable migrations and tested recovery | Actual environment inspection and isolated restored project |

Audit logging must include tenant, project, principal type/ID, grant ID, command, source version IDs, decision authority, occurred/recorded timestamps and correlation ID. Redact raw OTPs, bearer tokens, guest URLs, signed URLs and provider credentials. App role cannot modify prior audit events; chain verification alone cannot stop an operator rewriting the entire chain, so anchor digest checkpoints externally with restricted write permissions. Define evidence retention by contract plus legal hold rather than indefinite retention by default.

## Pilot gate: all required

1. T01–T10 trust work complete; alternate approval paths removed or delegated; no fabricated READY, upload success or signature-valid claims remain.
2. T11 real authentication delivery and T12 actor-partitioned recoverable upload UX work on contractor mobile hardware.
3. T13 disposable integration suite covers DB RLS, storage multipart, scanner and package artifact; all negative isolation tests pass under runtime role, never only a superuser.
4. T14 isolated restore demonstrates a full approved evidence chain and one complete dossier; TLS/private storage, restricted credentials, error reporting and on-call contact established.
5. Contract-specific pilot baseline reviewed with PM/document controller; explicit authority and retention policies recorded. Internal readiness report labelled as readiness, not acceptance or payment certification.
6. No unresolved Critical or High trust defect. Narrow feature disabling is acceptable only when all routes, jobs and screens for that capability are disabled and the pilot contract clearly excludes it. A mock provider or a hidden broken button is not an acceptable workaround.

## General production gate

Add repeated customer workflow evidence, full role/API/browser checks, regression coverage for migration upgrades, provider failure drills, load and resource-budget tests, security review, complete infrastructure/runbooks, recovery targets measured against the service commitment, and privacy/contractual operating process. Critical security bugs and data-integrity regressions stop release. Conditional domain features remain unavailable until their own acceptance criteria pass; general production does not require every future P3/P4 feature.

## Reliability and observability specification

Track API error/latency by route without sensitive path tokens; request and worker trace IDs; DB pool saturation, deadlocks and transaction duration; oldest outbox age, retry/dead-letter counts, job lag, lease expiry, scan time and signature DB age; orphaned object/version references; READY artifact existence; delivery failures; failed login and grant-scope denials; backup freshness and restore evidence date. Do not label every job failure as an API outage.

Proposed pilot alerts: outbox oldest age over 5 minutes for 10 minutes, processing job older than 15 minutes, scanner unavailable over 5 minutes, any integrity mismatch, any tenant-boundary violation, backup older than 24 hours, and repeated provider delivery failures. Tune with real workload. Critical trust alerts page operator immediately; queued backlog shows visible degraded status to users. Dashboard readiness is stale whenever authoritative evaluation cannot finish; never default to green.

Keep liveness independent of downstream availability. Readiness checks API DB/schema compatibility, object-storage adapter and required auth backend; worker reports scanner/processing capability separately. Redis outage blocks new OTPs safely and leaves committed outbox facts durable. Storage outage preserves metadata but blocks verification/download/build. Database outage cannot produce approved decisions. No fallback to in-memory identity or simulated success in production/staging.

Deployment must pin Node/package manager, frozen lockfile, process images and worker tool versions; use separate staging/production credentials, DBs and buckets, non-root constrained parsers, limited network access, no production seeds and explicit migration ownership. Validate dependency advisories from current lockfile before release; no vulnerability count is asserted in this audit. Secret files were not printed; baseline hashing is not a secret scan or git-history audit.

## Verification status

Executed: no-emit TypeScript API/web/worker checks passed; four selected Jest suites passed, 45 tests. Not executed: migration application, seeds, live simulation, real RLS/concurrency suite, provider integration, storage/antivirus flow, browser automation, load, dependency advisory refresh, deployed IAM/TLS inspection, or recovery drills. Reasons: these require disposable environments or external configuration not established in this documentation-only task. Existing restore script was inspected and found insufficient (TC-F027).

## India operations and privacy

CERT-In directions specify reporting covered incidents within six hours, retaining ICT logs for 180 days within India and clock synchronisation requirements. Assign an incident contact, retain evidence and maintain a decision log; applicable scope must be confirmed for the operating entity. These are separate from customer-contract notification promises. [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf).

DPDP Rules 2025 have been notified with staged commencement; do not repeat a universal immediate-enforcement claim from old reports. Maintain notices, role/purpose inventory, processor contracts, access/deletion requests, minimisation and legal-hold procedures; counsel should map the operative provisions and dates for launch. This audit did not complete a provision-by-provision legal applicability review. [MeitY official rules hub](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025).

## Release evidence package and ownership

Engineering lead signs exact-commit test and migration evidence; security owner signs isolation and evidence-integrity tests; operations owner signs actual deployment, backup and alert drills; product owner signs role workflows and contract-specific acceptance labels. Store date, environment, runtime DB role, tool versions, test artifacts and unresolved exceptions. No numeric readiness score substitutes for the gate. Recheck every material source change after this audit.
