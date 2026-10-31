# DELIVERABLE 6 — `TRADECLOSEOUT-AUDIT/05-SECURITY-AND-EDGE-CASE-REVIEW.md`
<a id="deliverable-6--05-security-and-edge-case-reviewmd"></a>

## 1. Security Vulnerabilities Identified in v0.2

| ID | Severity | Vulnerability | Affected Spec | Remediation |
|---|---|---|---|---|
| **RT-005** | **CRITICAL** | **PostgreSQL RLS Bypass via Table Owner Role:** App connects as table owner without `FORCE ROW LEVEL SECURITY` or `NOBYPASSRLS` role separation. | `08` §5.2, `13` §5.1 | Create `tc_app` role (`NOBYPASSRLS`) and add `FORCE ROW LEVEL SECURITY` to all tenant tables. |
| **RT-006** | **HIGH** | **Gotenberg LFI / SSRF via SVG Logos & `file://` URLs:** `WF-02` allows SVG logos; Gotenberg Chromium can read local container files (`file:///proc/self/environ`). | `06` `WF-02`, `09` §5.3, `13` §8.2 | Ban SVG logos (PNG/JPEG/WebP only); better yet, replace Gotenberg in MVP with pure-Node PDF generation (`pdfmake`/`pdf-lib`) since Office conversion is already deferred (`D-040`). |
| **RT-013** | **HIGH** | **CERT-In 6-Hour Reporting Violation:** `BR-SLA-04` specifies 72 hours; CERT-In mandates 6 hours for cyber incidents and NIC/NPL NTP sync. | `02` `BR-SLA-04`, `13` §16.3 | Split CERT-In (6h) from DPDP/Customer notification (72h); mandate `samay1.nic.in`/`time.nplindia.org` NTP and India-only log residency. |
| **RT-014** | **HIGH** | **Unauthenticated Guest OTP Flooding & Lockout:** `API-029` allows 60 req/min/token without per-grant SMS caps, and 5 wrong OTPs permanently lock a shared supplier link. | `10` §2.3, §7.3, §10 | Cap SMS OTP to 3/hour and 10/day per `grant_id`; use 15-min lockout cooldown instead of permanent lock; bind `target_phone_e164`/`target_email` on `guest_grants`. |
| **RT-027** | **MEDIUM** | **DPDP Rules 2025 Log Retention & Privileged MFA Gap:** DPDP Rules 2025 (notified Nov 2025, effective May 2027) require **1-year minimum retention** of personal data access/processing logs and **mandatory MFA on privileged accounts**. Spec retains `security_events` for only 180 days (`08` §7) and defers Admin MFA to V1 (`FR-IAM-014`). | `03` `FR-IAM-014`, `08` §7, `13` §14 | Increase `security_events` retention from 180 days to **365 days** (satisfying both CERT-In 180d and DPDP 1yr); require email+SMS dual-channel verification or TOTP MFA for `R-OWNER`/`R-ADMIN` and Platform Admins. |
| **RT-033** | **MEDIUM** | **Presigned S3 Download URL User-Binding Claim (`AUD-S-07`) Is Impossible with Direct S3 URLs:** `13` §8.3 claims: *"Signed URL, 5–15 minutes... Binding rule (`AUD-S-07`), mandatory: the signature covers `(object_key, user_id, expires_at)` and the requesting session's user must match."* **Technical reality:** Standard AWS S3 / MinIO SigV4 presigned URLs are validated by S3, which **has no knowledge of TradeCloseout's session cookie or `user_id`!** S3 cannot check `session.user_id` unless downloads are served through a **CloudFront Signed Cookie / Cloudflare Worker** that validates the session, or the TTL is kept ultra-short (e.g. 60–120 seconds) on `GET /document-versions/{id}/download-url`. | `13` §8.3, `03` `NFR-SEC-008` | Do not make a security claim that S3 SigV4 cannot enforce. Specify either: (a) 120-second single-redirect S3 presigned URLs issued by `API-088` after session check, or (b) Edge Worker HMAC validation checking a signed cookie. |
| **RT-034** | **MEDIUM** | **PDF Bomb / Decompression Bomb in `qpdf`/`pdf-lib` Worker:** `13` §4 mentions "PDF bomb / zip bomb" in the threat table, but `WF-11` and `WF-16` do not specify a maximum decompressed stream size or maximum object count per PDF before `pdf-lib` loads the PDF into V8 heap memory. | `06` `WF-11`, `09` §5.3 | Run `qpdf --check` in a child process with `ulimit -v` / cgroup memory limit (512 MB) and reject PDFs with >1,000 pages or >25,000 objects before loading into Node.js `pdf-lib`. |

---

## 2. Edge-Case & Failure Mode Gaps (`12-EDGE-CASES-AND-FAILURE-MODES.md`)

The following realistic failure scenarios are still missing or broken in `12`:

1. **`EC-DOC-28` (NEW — MEDIUM): Supplier uploads a valid PDF, then the contractor changes the Requirement's `doc_type_key` via a Change Request (`WF-20`).**
   - *Problem:* `FR-CHK-011` says a requirement is satisfied by an approved version of the **matching `doc_type_key`**. If a change request changes the requirement's `doc_type_key`, does the previously approved document cease to satisfy it?
   - *Required Behaviour:* `WF-20` impact analysis must flag any linked document whose `doc_type_key` no longer matches, and either re-classify the document's `doc_type_key` upon change-request approval or revert the requirement to `CHANGES_REQUESTED`.
2. **`EC-BIL-10` (NEW — MEDIUM): Customer pays invoice net of 10% TDS (under Sec 194J) via bank transfer / NEFT instead of full card/UPI amount.**
   - *Problem:* Razorpay recurring subscriptions charge 100% of the invoice total (`total_paise`). In India, B2B accounts-payable teams frequently deduct 10% TDS on software invoices >₹50,000/yr and pay only 90% of the pre-tax amount + 100% of the GST (`subtotal * 0.90 + tax`). If Razorpay expects 100%, the subscription stays `PAST_DUE`!
   - *Required Behaviour:* Support two TDS workflows in `FR-BIL-011`: (a) **Pay Full & Reimburse TDS** (customer pays 100% via Razorpay, uploads Form 16A quarterly, and receives a TDS credit/refund to their bank/wallet), or (b) **Annual Net-of-TDS Bank Transfer / NEFT Invoice** where admin marks the invoice `PAID` upon receiving `total_paise - tds_paise` plus a `PENDING_FORM_16A` tracker (`RT-030`).

---
---