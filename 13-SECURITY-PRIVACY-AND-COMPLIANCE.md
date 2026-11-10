# 13 — Security, Privacy and Compliance

**Status:** Draft v0.2 — security design, not legal advice
**Change history:** v0.2 applies AUD-006, AUD-B-06, AUD-S-15/16/17/30/31/32/34/35/39/41/42.
**Rule:** security controls are non-negotiable MVP scope; legal claims require professional review.
**Related:** `05` permissions, `08` data, `09` architecture, `12` edge cases, `15` operations

---

## 1. Security objectives

1. **Tenant isolation:** no customer can access another customer's data.
2. **Evidence integrity:** documents, approvals and audit records cannot be silently altered.
3. **Least privilege:** users, guests and staff see only what they need.
4. **Confidentiality in transit and at rest.**
5. **Recoverability:** data can be restored within defined RPO/RTO.
6. **Accountability:** security-relevant actions are attributable.
7. **Availability:** reasonable protection against abuse and accidental loss.

## 2. Legal and regulatory posture

> **Not legal advice.** Live verification was not possible during drafting. Engage Indian counsel and a CA before launch. This section states the intended posture and the items to confirm.

### 2.1 Instruments to assess

| Area | Instrument | Relevance | Status |
|---|---|---|---|
| Personal data | Digital Personal Data Protection Act, 2023 (DPDP Act) and rules as notified | Notice, consent/legitimate uses, data-principal rights, breach reporting, data-fiduciary duties | VO — verify commencement/rules |
| Electronic records/signatures | Information Technology Act, 2000; e-sign provisions | Electronic records, e-signatures, intermediary/liability | VO |
| Sensitive personal data | SPDI Rules, 2011 (IT Act) | May apply to residual sensitive data until displaced; minimise collection | VO — counsel view |
| Cyber incidents | CERT-In directions (2022) | Incident reporting timelines, log retention, clock sync | VO — verify current |
| Tax records | GST law; Income Tax Act | Invoice retention, audit records | VO — CA review |
| Contracts | Indian Contract Act, 1872; Arbitration Act, 1996 | Enforceability, limitation, dispute evidence | VO |
| Sectoral | Fire NOC, electrical, labour, environment | Customer's obligations, not ours; do not claim compliance | VO — project-specific |
| Payments | RBI payment aggregator directions; PCI DSS | Use licensed PA; never store card data | VO |

### 2.2 What TradeCloseout does **not** claim

- It does not make a customer statutorily compliant.
- It does not certify a document as legally valid.
- It does not replace a consultant, chartered engineer, safety officer or legal advisor.
- It does not guarantee acceptance by a client or authority.
- It is not ISO 27001 certified or SOC 2 attested at launch unless separately achieved.

### 2.3 Privacy roles — proposed position for counsel review

- **Proposed position (`AUD-B-06`), to be confirmed by Indian counsel before reliance:** for **customer project data**, the customer is expected to be the data fiduciary and TradeCloseout a data processor; for **account, billing and marketing data**, TradeCloseout is expected to be the data fiduciary.
- A Data Processing Agreement (DPA) must reflect whatever split counsel confirms. Until then the specification asserts neither role as fact.
- Sub-processors must be listed and bound by equivalent terms.

## 3. Data classification

| Class | Examples | Handling |
|---|---|---|
| **Public** | Marketing pages, plan prices | No restriction |
| **Internal** | Product metrics, non-identifying configs | Staff only |
| **Confidential** | Contracts, BOQs, drawings, test reports, O&M manuals, client names, project pricing | Tenant-scoped; no public links; encrypted; audited downloads |
| **Restricted** | Personal contact data, invoices with GSTIN/PAN, BMS/software credentials, incident reports, signed acceptance | Strict need-to-know; extra audit; no email body; retention limits |
| **Secret** | Passwords, API keys, session tokens, signing keys | Never in documents/logs; secret manager; rotation |

**Sensitive business documents** (confidential/restricted): contracts and commercial terms, BOQs and rates, client correspondence, employee/supplier contact lists, credentials handed over at completion, warranty claims, incident reports, signed certificates with signatures.

### 3.1 Data minimisation

- Collect: name, business email, mobile, role, organisation details.
- Do **not** collect: Aadhaar, PAN of individuals, date of birth, home address, biometrics, caste/religion, bank details (payment handled by gateway), ID document images.
- PAN/GSTIN collected only for the **organisation's billing profile** where required, not for individual users.
- Free-text fields warn against entering personal data unnecessarily.

## 4. Threat model (STRIDE + abuse)

| Threat | Example | Controls |
|---|---|---|
| **Spoofing** | Credential stuffing, OTP brute force, stolen magic link | Rate limits, OTP attempt caps, single-use tokens, device/session binding, optional MFA for admins (V2) |
| **Tampering** | Altering an approved PDF or audit row | Immutable versions, object versioning, hash chain, DB permissions, no customer update/delete on audit |
| **Repudiation** | "I never approved that" | Signed-in decisions, timestamps, IP/UA, audit, optional e-sign (V2) |
| **Information disclosure** | Cross-tenant IDOR, leaked signed URL, misconfigured bucket | RLS, composite FKs, 404s, short-lived URLs, private buckets, CSP, tests |
| **Denial of service** | Upload flood, expensive PDF jobs | Rate limits, quotas, queue backpressure, per-org concurrency, WAF |
| **Elevation of privilege** | Guest becomes admin, supplier sees all docs | Capability grants, scope checks, deny-by-default, permission tests |
| **Insider** | Staff reads customer content | No default access, break-glass with notification/audit, least privilege |
| **Supply chain** | Compromised dependency/container | Lockfiles, scanning, minimal images, pinned versions, SBOM |
| **Malware** | Infected PDF/DOCX | ClamAV, content sniffing, no execution, download as attachment, sandboxed conversion |
| **SSRF** | Webhook URL hits internal metadata | Allow-list/HTTPS, block private IPs, no arbitrary fetch |
| **PDF bomb / zip bomb** | Merge exhausts memory | Page/size limits, per-job memory caps, timeouts, compression ratio checks |
| **Credential leakage** | Secrets in repo/logs | Secret scanning, env vars, redaction, rotation |
| **Abuse** | Spam supplier links, harassment | Rate limits, CAPTCHA, revocation, reporting |

## 5. Tenant isolation

### 5.1 Layers (MVP = ✅, V1 = ◐)

1. ✅ **Session-derived tenant.** `sessions.active_org_id` is the only authoritative tenant; a path or body `orgId` that disagrees returns `404` (`AUD-014`).
2. ✅ **Application checks.** Every repository method requires `org_id` **and** `project_id`; object loads use `(org_id, project_id, id)`. Access goes through a repository layer that injects both from the request context; direct SQL outside the layer is prohibited and enforced by lint (`AUD-S-03`).
3. ✅ **Composite foreign keys.** `(org_id, id)` and `(org_id, project_id, id)` prevent cross-tenant and cross-project links at the database level.
4. ✅ **PostgreSQL RLS & Non-Owner Role (`RT-005`).** `app.current_org` set transaction-locally; policies enforced on every tenant table with `ALTER TABLE ... FORCE ROW LEVEL SECURITY;`. Runtime queries execute under dedicated role `tc_app` (`NOBYPASSRLS`), separate from the migration owner `tc_migrator`, ensuring table owners cannot silently bypass RLS policies at runtime. If `app.current_org` is unset, the policy yields zero rows (fail closed).
5. ✅ **Storage isolation.** Keys prefixed by org; signed URLs issued only after authorisation; bucket private.
6. ◐ **Cache isolation.** Keys include org and permission scope (V1 — no shared cache in MVP).
7. ◐ **Search isolation.** Index queries always filter by org (V1 — no search index in MVP).
8. ✅ **Background jobs.** Carry org and re-validate before writes.
9. ✅ **Generated documents.** Templates and data scoped to org; no shared temp files.
10. ✅ **Testing.** Automated cross-tenant and cross-project tests for every resource.

### 5.2 Anti-enumeration

- Out-of-scope resources return `404`, not `403`.
- IDs are UUIDv7, not sequential.
- Guest endpoints do not reveal project counts or other parties.
- Login responses do not reveal whether an email exists (except where UX requires; prefer neutral messaging).

## 6. Authentication and session security

| Control | Requirement |
|---|---|
| OTP | 6 digits, CSPRNG, 5-minute expiry, max 5 attempts, single-use, hashed at rest |
| Magic link (future, not implemented for member login) | Proposed only: ≥128-bit token, 15-minute expiry, single-use and identifier-bound **if implemented in a future separately reviewed feature**. No current `/auth/magic-link/request` or `/auth/magic-link/consume` endpoint exists; organisation invitation links are a separate identity-verified claim flow, not login magic links. |
| Session | **Opaque random token (≥256 bits), hashed at rest in `sessions`, looked up on every request — not a JWT.** HttpOnly, Secure, SameSite=Lax, 30-day idle expiry, rotation on privilege change. `sessions.active_org_id` is server-side state (`AUD-S-15`, `AUD-014`). |
| CSRF | Token required for unsafe cookie-authenticated requests |
| Revocation | On logout, role change, member removal, identity change; propagate ≤60 s. **Session rows are not cached** (`AUD-S-17`); any future cache must carry a revocation filter. |
| Rate limiting | Per identifier, IP and device; CAPTCHA after failures |
| Enumeration | Neutral responses; no account existence disclosure |
| Admin | MFA required before production access; separate identity provider if possible |
| Guest | Scoped session; short-lived; OTP where review/acceptance is involved |

**Implemented authentication in this release:** member login is an OTP challenge bound to its identifier and challenge ID. Guest login uses the grant's designated verified email or phone; no automatic SMS-to-email fallback, magic-link login or alternative-contact recovery is implemented. A provider timeout/ambiguous result does not authorize a fallback or an unverified recipient. The magic-link table entry is a future design requirement, **not a deployed security control**.

### 6.1 Bounded authentication-denial telemetry (G01-R3)

Rejected authentication is **always rejected** regardless of monitoring availability. Successful MFA enrollment, factor verification, recovery use, device revocation and other security-critical committed operations retain their existing unsampled transactional events. Denied MFA, recovery, enrollment-start and session/CSRF attempts use an independent, best-effort audit write **after the rejected transaction rolls back**; they never log submitted OTP/TOTP/backup codes, tokens, raw IP addresses or request headers.

The implementation reserves event capacity atomically in the existing PostgreSQL `auth_request_budgets` table using database-time one-minute windows. All API replicas share the same restricted `tc_app` ledger and conditional UPSERTs. Caps are per event type and validated reason: unauthenticated/session denials **10 per source / 60 global per minute**; MFA denials **20 per actor / 120 global per minute**; already-throttled MFA denials **1 per actor / 30 global per minute**. A source is the verified actor ID when known, otherwise the trusted network address. Source and global reservation plus append-only event insertion share one SQL statement; a denied admission never appends an event. The source and event digests use keyed HMAC in production. Sampling is **not** an authentication rate limiter and must not relax the independent OTP/MFA abuse budgets. Under an overloaded local database pool, optional denial-audit work is sampled out once there is already a queued checkout, preventing high-volume telemetry requests from building an unbounded pending pool queue. This local admission control is only a load-shedding safeguard; cross-replica persisted event caps are still enforced by the atomic PostgreSQL budget.

Event-store queries have a **750 ms query timeout** and **1,000 ms overall wait cap**, including queued pool checkout. Telemetry exceptions and expired waits cannot authorize an authentication request; the original access-denial exception is preserved. Database failure produces only the fixed `AUTH_SECURITY_EVENT_PERSISTENCE_FAILURE` diagnostic, limited to **one per minute per API replica**. During a database outage no reliable shared coordination is possible; for a fixed fleet of N replicas at most N such diagnostic lines per minute are emitted. There is no guarantee of durable denial evidence while the event store is unavailable—operations must alert on this diagnostic, investigate database connectivity and restore collection. Persistent sampling reservations are independently expired/cleaned up under the existing scheduler. Authentication event retention, capacity monitoring and production alert validation remain external release gates.

No passwords in MVP. If passwords are added later: Argon2id, breach checks, reset tokens, MFA.

## 7. Authorisation

See `05`. Additional security rules:

- Deny by default; explicit grants only.
- Permission checks on every endpoint, including reads of derived data.
- Object-level and field-level visibility for guests (e.g., hide internal comments and pricing).
- Separation of duties: upload vs approve; generate vs submit; billing vs project content.
- Admin override requires reason and creates a distinct audit event.
- Permission changes trigger session re-evaluation and audit.

## 8. File security

### 8.1 Upload controls

| Control | Rule |
|---|---|
| Allowed types | PDF, JPEG, PNG, WebP, DOCX, XLSX, DWG, ZIP only |
| Content validation | Magic-byte sniffing; reject mismatched extension/MIME |
| Size | 100 MB/file default; 1 GB/package; configurable within hard ceiling |
| Filename | Sanitised; original preserved escaped; storage key uses UUID |
| Checksum | SHA-256 computed server-side; duplicate detection |
| Malware | ClamAV scan before `READY`; fail closed if scanner unavailable |
| PDF checks | qpdf validation; encryption detection; page count; no JavaScript execution |
| Office checks | Macros-enabled formats rejected; conversion in isolated container |
| ZIP | Nested file limits; no execution; extract only for package manifest if needed |
| Images | Re-encode **both** the stored original (org setting, default on) and the preview to strip EXIF including GPS (`AUD-S-09`). Site photographs frequently carry project coordinates; the fact is recorded in `checks_json`. |
| Quarantine | Infected files inaccessible; ops investigation; notify |

### 8.2 Output escaping and generated documents

**`AUD-006` / `D-037` — mandatory.**

1. Every user-controlled value is HTML-escaped **and** attribute-escaped before it enters a template used for PDF generation. There are **no raw-HTML fields**.
2. The template pipeline fails closed if an unescaped placeholder is detected.
3. **Strict SVG Upload Ban (`RT-006`):** SVG uploads are prohibited across all endpoints (logos, submittals, attachments). Allowed branding formats are strictly restricted to `image/png`, `image/jpeg`, and `image/webp`. This eliminates XML External Entity (XXE), SSRF, and Local File Inclusion (LFI) via `<foreignObject>` or `xlink:href` in PDF rendering engines.
4. **Pure-Node PDF Generation in MVP (`RT-025`):** In MVP, cover pages and table of contents indices are rendered using pure Node.js (`pdfmake`/`pdf-lib`) without a headless browser container, completely removing Gotenberg attack surfaces and container memory overhead.
4. Post-processing strips PDF JavaScript, embedded files and external actions; the output is verified to contain no active content.
5. Filenames rendered into the index are escaped and truncated.
6. A security test generates a package with a payload in every user-controlled field and asserts the PDF contains literal escaped text and no active content.

### 8.3 Download controls

- Downloads are issued via `API-088 (GET /document-versions/{id}/download)` which authenticates the user's session against the database, verifies org/project/resource permissions, and issues a 120-second single-use redirect to S3 (or CloudFront signed cookies with user-session binding). This eliminates claims of native S3 SigV4 user-binding while providing strict, auditable session verification (`RT-033`).
- `Content-Disposition: attachment` for originals; `X-Content-Type-Options: nosniff`.
- Preview served from a separate origin/subdomain with strict CSP and no cookies. **SVG and HTML are never rendered inline**; previews are produced server-side as PNG/WebP or with a sandboxed viewer that disables script and external fetches (`AUD-S-08`).
- Download is permission-checked and audited; bulk downloads rate-limited.
- Watermarking is **not** in MVP (proposed V1 for client-facing packages).
- No public bucket, no guessable keys, no long-lived links.

### 8.4 Package and PDF safety

- Parse PDFs with a memory/time limit; reject absurd page counts.
- Merge only validated PDFs; convert Office in a sandboxed container with no network.
- Generated PDFs contain no active content, no external links except explicit ones.
- Manifest checksums allow integrity verification.
- Generated files stored under the org prefix and never shared across orgs.

## 9. Encryption and key management

| Layer | Control |
|---|---|
| Transit | TLS 1.2+ (prefer 1.3), HSTS, secure ciphers |
| Database | Encryption at rest (provider-managed KMS) |
| Object storage | SSE with provider-managed keys; bucket private; versioning |
| Backups | Encrypted, access-controlled, tested restore |
| Secrets | Secret manager/env, never in git; rotation on incident |
| Tokens | Hashed at rest (OTP, sessions, invitations, API keys) |
| Sensitive fields | Consider column encryption for contact data if threat model requires |

No custom cryptography. No encryption keys stored alongside data.

## 10. Audit logging

- Append-only, customer-immutable.
- Two streams (`AUD-S-30`): `audit_events` (business) and `security_events` (auth/access), with different retention (business = project life + 8 years; security = ≥180 days).
- Fields: `org_id`, `project_id`, `actor_type`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `request_id`, `prev_hash`, `hash`, `created_at`.
- **Redaction (`AUD-S-31`):** a field-level redaction list is applied before writing `before_json`/`after_json`; tokens, hashes, OTPs, file contents and personal identifiers are never written to diffs.
- **Failed authentication is audited** (`AUD-S-32`) into `security_events` (OTP failures, rate-limit hits, guest-link failures).
- Covered actions: auth, membership, role/permission changes, config changes, snapshot changes, uploads, downloads, metadata edits, reviews, waivers, overrides, package generation, submissions, deletions, exports, admin actions, denials.
- Tamper evidence: per-row hash chain (`prev_hash`, `hash`) or append-only storage with periodic digest; verify job.
- Retention: project life + 8 years default; billing 8 years; security logs 180 days minimum (CERT-In).
- Access: owner/admin/auditor; platform staff only via break-glass.
- No sensitive content in `before/after` (e.g., no tokens, no full document text).
- Logs are not used for marketing or profiling.

## 11. Secrets and production access

- Secrets in a managed secret store or encrypted environment; never in code, images or logs.
- Separate credentials per environment.
- Production access via SSO + MFA, least privilege, time-bound.
- Break-glass: reason, approval (where possible), session recording, customer notification for content access.
- No direct production database access from laptops; use a bastion/query tool with audit.
- Offboarding revokes access within 24 hours.
- Rotate database, storage, email, payment and signing secrets at least annually and after incidents.

## 12. Rate limiting and abuse prevention

- Per IP, identifier, user, org and token.
- Auth endpoints stricter; progressive delays; CAPTCHA.
- Upload intents limited per user and org.
- Package generation concurrency capped per org.
- Guest links rate-limited and revocable.
- Webhook endpoints signature-verified and replay-protected.
- Blocklists for abusive IPs at the edge.
- Alert on spikes in 401/403/404/429 and quarantine events.

## 13. Privacy by design

| Principle | Implementation |
|---|---|
| Lawful purpose | Project documentation, collaboration, handover; billing; support |
| Notice | Clear privacy notice at signup and in-app |
| Consent | For marketing and optional integrations; not bundled with core service |
| Minimisation | No identity documents or sensitive personal data |
| Accuracy | Users can correct profile; org admins can correct business data |
| Retention | Defined schedule; legal hold support |
| Access/correction/deletion | DSR workflow with identity verification |
| Portability | Export in open formats |
| Security | Controls in this document |
| Accountability | DPA, subprocessor list, incident records |
| Children | Service not directed at children; no knowing collection |
| Cookies | Only essential + privacy-respecting analytics; consent where required |

### 13.1 Data subject requests

**Owner and SLA (`AUD-S-35`):** the org's designated privacy contact (default: the Owner) owns inbound DSRs relating to that org's project data; TradeCloseout support owns DSRs for account and billing data. Acknowledge within 3 business days; complete within 30 days or the period required by applicable law, whichever is shorter.

1. Receive request via support/email.
2. Verify identity and authority (customer admin confirmation).
3. Check legal hold and contractual retention.
4. Fulfil access/export/correction/deletion where legally permitted.
5. Record in `deletion_requests`/DSR log; respond within the period required by applicable law.
6. If data belongs to a customer's project, route to the customer as data fiduciary unless TradeCloseout is the fiduciary.

### 13.2 Consent capture

WhatsApp, SMS and marketing communications require a recorded opt-in (`AUD-S-34`) captured at signup or in notification preferences, with a clear opt-out. Transactional OTP and security notices are exempt.

### 13.3 Marketing

- Separate opt-in; easy unsubscribe.
- No use of project content or document names in marketing.
- No customer logos without written permission.

## 14. Retention and deletion

| Data | Default retention | Basis |
|---|---|---|
| Project documents/audit | Closure + 8 years | Contract disputes, tax/audit practice; configurable |
| Generated packages | Closure + 3 years | Storage cost vs utility |
| Billing/invoices | 8 years | Tax |
| Account data | Life of account + 90 days | Service |
| Notifications/logs | 90 days operational; security events & personal data processing logs 365 days (RT-027) | Operations / CERT-In / DPDP Rules 2025 (notified 13 Nov 2025) |
| Sessions | 30 days | Security |
| Soft-deleted items | 30 days | Recovery |
| Backups | 35 days | Recovery |
| Marketing leads | 24 months after last contact | Privacy |

Deletion:

- Soft delete → grace → hard purge (files + rows) with audit tombstone.
- Legal hold blocks purge.
- Backup copies expire naturally; document this in the privacy notice.
- Customer can request early deletion subject to contract and law.
- Deletion is verified by a job and reported.

**Privileged Account Security (`RT-027`):** Per DPDP Rules 2025 guidance for data fiduciaries handling commercial and employee records, Multi-Factor Authentication (MFA / dual-channel verification) is mandatory in MVP for all `Owner` and `Admin` roles.

## 15. Backup, continuity and disaster recovery

| Item | Target |
|---|---|
| DB RPO | ≤15 minutes (PITR) |
| Object storage RPO | ≤1 hour (versioning/replication) |
| RTO | ≤4 hours |
| Backup encryption | Yes |
| Restore test | Quarterly; documented |
| Cross-region copy | V1 optional |
| Retention | 35 days daily; monthly for 12 months (proposed) |

Runbooks: DB failover, restore, storage outage, queue backlog, compromised credential, tenant isolation incident, payment reconciliation.

## 16. Incident response

### 16.1 Severity

| Severity | Definition | Response |
|---|---|---|
| SEV-1 | Confirmed cross-tenant access, data loss, widespread outage | Immediate, all hands, customer/legal notification |
| SEV-2 | Single-tenant exposure, malware, significant degraded service | 1 hour |
| SEV-3 | Limited issue, no data impact | 1 business day |
| SEV-4 | Minor | Normal support |

### 16.2 Named roles (`AUD-S-39`)

For a solo-founder operation three roles must be assigned before launch; they may be held by one person with a documented deputy.

| Role | Responsibility |
|---|---|
| Incident commander | Containment decisions, external communication approval |
| Technical lead | Investigation, forensics, remediation |
| Counsel / comms liaison | Legal notification, customer messaging, regulatory reporting |

### 16.3 Steps

1. **Detect** (monitoring, report, audit alert).
2. **Contain** (revoke sessions/keys, isolate tenant, disable feature).
3. **Preserve evidence** (logs, snapshots, access records).
4. **Assess scope** (who/what/when; tenant impact).
5. **Eradicate and recover** (patch, restore, rotate).
6. **Notify** per legal requirements and contractual obligations: Statutory mandatory reporting to CERT-In within **6 hours** of incident detection per CERT-In Directions 2022 (No. 20(3)/2022-CERT-In, RT-013); notification to affected customers and the Data Protection Board without undue delay per DPDP Rules 2025.
7. **Post-incident review** within 5 business days; actions with owners.
8. **Update tests/runbooks.**

### 16.4 Notification principles

- Factual, no speculation.
- State what happened, what data, what we did, what customers should do.
- Single point of contact.
- Do not notify third parties beyond legal/customer obligations without consent.

## 17. Secure development and operations

| Control | Requirement |
|---|---|
| Code review | All changes reviewed (solo dev: self-review checklist + CI) |
| SAST | CI on every PR |
| Dependency scan | CI + weekly |
| Secret scan | Pre-commit + CI |
| Container scan | On build |
| DAST | Before launch and quarterly |
| Pen test | Before first paid invoice; annually |
| Threat model | Updated for new features handling files/auth/payments |
| Migrations | Reviewed, reversible where possible, tested on restore |
| Feature flags | Risky features gated |
| Environment parity | Staging mirrors production |
| Logging | Structured, PII-scrubbed, request IDs; stored strictly within Indian jurisdiction (RT-013) |
| Time synchronization | System NTP daemon synchronized with NPL (time.nplindia.org) and NIC (samay1.nic.in); alert if drift > 1,000 ms per CERT-In Directions (RT-013) |
| Access review | Quarterly |
| Vendor review | Before adding a subprocessor |

## 18. Subprocessors (initial list)

| Subprocessor | Purpose | Region | Notes |
|---|---|---|---|
| Cloud provider (AWS ap-south-1 or equivalent) | Compute, DB, storage | India | Primary |
| Email provider (SES/Postmark) | Transactional email | Verify | DPA |
| WhatsApp provider | Notifications (V1) | Verify | DPA, opt-in |
| Razorpay | Payments | India | PCI scope reduced |
| Error tracking (Sentry) | Diagnostics | Verify | PII scrubbing |
| Observability | Logs/metrics | Verify | No document content |

Publish a current list; notify customers of material changes; provide a DPA.

## 19. Compliance mapping (to confirm)

| Requirement | Control | Evidence |
|---|---|---|
| DPDP notice/consent | Signup notice, settings | Policy, UI |
| Data-principal rights | DSR workflow | Records |
| Breach reporting | Incident runbook | Logs, notices |
| CERT-In logs | 180-day security logs, NTP | Config |
| GST invoice retention | 8-year billing records | DB/export |
| Contract records | Document retention | Policy |
| Payment security | Hosted checkout, no card storage | SAQ A |
| Access control | RBAC/RLS | Tests |
| Audit | Append-only events | Audit export |

## 20. Security acceptance criteria

- Cross-tenant test suite passes for every resource.
- No public storage bucket; signed URLs expire ≤15 minutes and are bound to the requesting user.
- Generated PDFs contain no active content and all user values are escaped (payload and fuzz tests pass).
- Malware upload is quarantined in tests.
- Self-approval blocked; override audited.
- Session revocation effective ≤60 seconds.
- Backup restore verified **before the first paid invoice**.
- Pre-launch incident tabletop completed (`AUD-S-41`).
- Pen test critical/high findings resolved before paid launch.
- No secrets in repository history.
- Privacy notice, terms and DPA reviewed by counsel.

## 21. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial security/privacy/compliance design |
| 0.2 | 2026-10-31 | Remediation: mandatory output escaping + PDF sanitisation + Gotenberg sandbox (AUD-006); fiduciary role marked proposed for counsel (AUD-B-06); session type and active-org binding; signed-URL binding; SVG/HTML preview policy; EXIF stripping; audit/security log separation + redaction + failed-auth logging; DSR owner and SLA; consent capture; named incident roles; pre-launch tabletop |
