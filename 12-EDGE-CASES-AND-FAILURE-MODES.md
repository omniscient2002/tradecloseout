# 12 — Edge Cases and Failure Modes

**Status:** Draft v0.2
**Change history:** v0.2 adds EC-DOC-26/27, EC-PRJ-15/16, EC-USR-15/16, EC-TECH-26/30, EC-SEC-07/08, EC-BIL-09.
**Rule:** every scenario has a defined outcome. If a scenario is not listed, the default is: fail closed, preserve data, return an actionable error, and audit.
**Related:** `06` states, `13` security, `15` operations

---

## 1. Severity and handling codes

| Code | Meaning |
|---|---|
| **A** | Automatic recovery; user sees a clear message |
| **M** | Manual intervention by customer admin |
| **O** | Manual intervention by TradeCloseout operations |
| **X** | Security/legal escalation |

"Manual?" column: `No`, `Customer`, `Ops`, `Both`.

## 2. Document scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-DOC-01 | Duplicate file uploaded to same project | Detect identical SHA-256; warn before creating a second version; offer "use existing", "upload anyway with reason", cancel | User chooses; if "anyway", new logical document linked | `DOCUMENT_DUPLICATE_WARNED` | No |
| EC-DOC-02 | Document attached to wrong asset | Before approval: metadata/asset link editable with audit. After approval: new revision or correction record; old link retained historically | Reassign link; reviewer re-approves if evidence changed | `DOCUMENT_LINK_CHANGED` | Customer |
| EC-DOC-03 | Document attached to wrong project | Cross-project link is prohibited; if discovered post-upload, soft-delete and re-upload in correct project with new approval | New upload in correct project; cannot move evidence silently | `DOCUMENT_DELETED`, `DOCUMENT_CREATED` | Customer |
| EC-DOC-04 | Incorrect metadata (revision/date/title) | Editing allowed before approval; after approval requires correction reason and audit; revision code changes require new version | Correct with reason; reviewer notified | `METADATA_CORRECTED` | Customer |
| EC-DOC-05 | Corrupt PDF | Processing fails; version `FAILED`; user sees "File could not be read"; no download | Re-upload a valid file | `FILE_PROCESSING_FAILED` | No |
| EC-DOC-06 | Password-protected PDF | MVP: rejected with instruction to remove password; V1: optional in-memory password unlock, never stored | Re-upload unprotected or unlock (V1) | `FILE_ENCRYPTED_REJECTED` | No |
| EC-DOC-07 | Unsupported format (EXE, macro Office) | Reject at intent and again at processing; no storage of executable content | Convert to PDF and upload | `FILE_TYPE_REJECTED` | No |
| EC-DOC-08 | Scanned document, no text layer | Accepted; preview works; OCR optional (V2); search by metadata only | Reviewer can read image | `FILE_SCANNED_DETECTED` | No |
| EC-DOC-09 | Multiple documents in one PDF | Accepted with warning "Contains multiple documents"; reviewer may ask for split; V1 split tool | Split and re-upload as separate documents (V1) | `FILE_MULTI_DOC_WARNED` | No |
| EC-DOC-10 | Missing pages discovered | Reviewer requests changes with page comment; evidence not approved | Upload complete revision | `REVIEW_CHANGES_REQUESTED` | Customer |
| EC-DOC-11 | Poor-quality scan (illegible) | Processing warns on low DPI/image ratio (V1); reviewer rejects with reason | Re-scan | `REVIEW_REJECTED` | No |
| EC-DOC-12 | Expired certificate uploaded | Automated validation marks FAIL; review submission rejected with 422 DOCUMENT_ALREADY_EXPIRED; requirement cannot be approved and blocks package readiness (RT-009) | Upload valid certificate | `DOCUMENT_ALREADY_EXPIRED` | No |
| EC-DOC-13 | Incorrect model/serial in certificate | Reviewer requests changes; metadata correction possible; if document content is wrong, new revision required | Obtain corrected OEM document | `REVIEW_CHANGES_REQUESTED` | Customer |
| EC-DOC-14 | Conflicting info across documents | System flags conflicting serial/model/rating on asset view (V1); reviewer decides; no automatic rejection | Resolve with supplier; upload authoritative revision | `CONFLICT_FLAGGED` | Customer |
| EC-DOC-15 | Superseded revision uploaded by mistake | User soft-deletes or withdraws unapproved version; revision_code reservation is freed immediately so correct revision can be re-uploaded without 409 trap (RT-011) | Re-upload correct file | `VERSION_WITHDRAWN` | No |
| EC-DOC-16 | Accidental deletion | Soft delete to trash 30 days; restore by admin; if approved, requirement temporarily shows missing | Restore; audit | `DOCUMENT_SOFT_DELETED` | Customer |
| EC-DOC-17 | Rejected then resubmitted | New version linked to prior; full review history retained; reviewer sees previous comments | Resubmit for review | `VERSION_RESUBMITTED` | No |
| EC-DOC-18 | Malware detected | Version `QUARANTINED`; download blocked; uploader and admin notified; file not auto-deleted until investigation | Ops reviews; purge; user re-uploads clean file | `FILE_QUARANTINED` (critical) | Both |
| EC-DOC-19 | Upload interrupted at 90% | Multipart parts retained until expiry; user resumes; no partial version becomes ready | Resume or restart | `UPLOAD_RESUMED` | No |
| EC-DOC-20 | Same document linked to multiple requirements | Allowed if type permits; one approved version satisfies all links; each requirement records satisfaction | Unlink individual requirement if wrong | `DOCUMENT_LINKED_MULTI` | No |
| EC-DOC-21 | Document reused across projects | Allowed only for reuse-enabled types with attestation; new project record; approvals do not carry unless explicitly configured | Re-review in new project | `DOCUMENT_REUSED` | Customer |
| EC-DOC-22 | File larger than plan limit | Reject before upload with exact limit and upgrade path | Compress/split or upgrade | `FILE_SIZE_REJECTED` | No |
| EC-DOC-23 | Zero-byte file | Reject at completion; version `FAILED` | Re-upload | `FILE_EMPTY_REJECTED` | No |
| EC-DOC-24 | Filename with unsafe characters | Sanitise display name; storage key uses UUID; original name preserved escaped | None | `FILENAME_SANITISED` | No |
| EC-DOC-25 | Duplicate revision code | Reject with `DUPLICATE_REVISION`; suggest next code | Choose a new revision code | `REVISION_CONFLICT` | No |
| EC-DOC-26 | Same file uploaded to two different projects | Org-level duplicate warning naming the other project; user confirms or cancels | Accept with reason or cancel | `CROSS_PROJECT_DUPLICATE_WARNED` | No |
| EC-DOC-27 | Document linked to more than 20 requirements | Warn on link 21; index groups under one heading | Reduce links or accept | `DOC_LINK_LIMIT_WARNED` | No |

## 3. Project scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-PRJ-01 | Project cancelled mid-flight | Status `CANCELLED`; writes blocked; reads/exports retained; reminders stop; open reviews cancelled | Reopen not allowed from cancelled; duplicate project if work resumes | `PROJECT_CANCELLED` | Customer |
| EC-PRJ-02 | Project suspended | Writes blocked; uploads/reviews rejected with reason; existing links readable; billing still counts if active | Resume with reason | `PROJECT_SUSPENDED`/`RESUMED` | Customer |
| EC-PRJ-03 | Partial handover | Selected assets/requirements packaged and marked `handed_over`; remaining project stays active; package scope recorded | Continue remaining scope | `PARTIAL_HANDOVER` | Customer |
| EC-PRJ-04 | Equipment replaced after approval | Old asset `REPLACED`, successor linked; old documents remain with old asset; new asset gets requirement instances; package flags replacement | Upload new evidence for successor | `ASSET_REPLACED` | Customer |
| EC-PRJ-05 | Scope change adds equipment | New assets created; asset-scoped requirements instantiated as `NOT_STARTED` with due dates; change request if post-activation rules change | Upload new evidence | `SCOPE_EXPANDED` | Customer |
| EC-PRJ-06 | Scope change removes equipment | Assets retired, not deleted; linked requirements marked `NOT_APPLICABLE` only with approval; history retained | Approve retirement | `ASSET_RETIRED` | Customer |
| EC-PRJ-07 | Multiple contractors on one project | Each contractor has its own tenant/project; collaboration via guest grants or shared package; no shared tenant | Separate closeout packages | `GUEST_GRANT_CREATED` | Customer |
| EC-PRJ-08 | Multiple suppliers for one requirement | Requirement can have multiple evidence docs; each supplier sees only its assignment; reviewer sees all | Resolve duplicates | `SUPPLIER_ASSIGNED` | No |
| EC-PRJ-09 | Client changes requirements after activation | Change request with impact analysis and approval; new snapshot; old package remains valid for its date | Apply change; regenerate package | `SNAPSHOT_CHANGED` | Customer |
| EC-PRJ-10 | Different checklists within one project (e.g., two buildings) | Model separate projects or requirement groups with `scope_key`; package scope by building | Split project if governance differs | `SCOPE_KEY_CREATED` | Customer |
| EC-PRJ-11 | Project reopened after closure | V1: `CLOSED → ACTIVE` with reason, reopen count, new snapshot if needed; prior packages retained | Re-close | `PROJECT_REOPENED` | Customer |
| EC-PRJ-12 | Project duplicated | Copies settings, checklist structure, optionally assets; never documents, approvals or audit | New project activation | `PROJECT_DUPLICATED` | Customer |
| EC-PRJ-13 | Contract value or DLP edited after closure | Read-only after closure; correction requires admin override with reason and audit | Override | `PROJECT_FIELD_CORRECTED` | Customer |
| EC-PRJ-14 | Handover date passed with missing docs | Dashboard escalates; reminders continue; no automatic cancellation | Extend date with reason | `DUE_DATE_EXTENDED` | Customer |
| EC-PRJ-15 | Archived project reopened after purge | Reopen blocked with `PROJECT_PURGED`; user is directed to create a linked new project | Create new project | `REOPEN_BLOCKED_PURGED` | Customer |
| EC-PRJ-16 | Two change requests submitted simultaneously | Optimistic lock; second receives `409` with the current snapshot state | Rebase on the applied snapshot | `CHANGE_REQUEST_CONFLICT` | No |

## 4. User, permission and access scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-USR-01 | Employee resigns | Admin suspends; sessions revoked ≤60 s; owned requirements/reviews listed; reassignment required before removal | Bulk reassign; remove | `MEMBER_SUSPENDED`, `WORK_REASSIGNED` | Customer |
| EC-USR-02 | Supplier link forwarded to wrong person | If OTP enabled, wrong recipient cannot verify; if not, access is possible until expiry; admin revokes and reissues | Revoke link; notify supplier | `GUEST_LINK_REVOKED` | Customer |
| EC-USR-03 | Invitation expired | Link shows "expired"; admin can resend; old token invalid | Resend invitation | `INVITATION_EXPIRED` | Customer |
| EC-USR-04 | Access revoked while user is active | Session invalidated within 60 s; next request returns 401; unsaved work may be lost with warning | Re-login if still authorised | `SESSION_REVOKED` | No |
| EC-USR-05 | Incorrect approval by reviewer | Cannot silently undo; admin override with reason creates a correction record and may revert requirement to `CHANGES_REQUESTED`; package already generated is unaffected but flagged | Override; regenerate package | `APPROVAL_OVERRIDDEN` | Customer |
| EC-USR-06 | Two reviewers act concurrently | First committed decision wins; second gets `409` with current state; no lost update | Refresh and act if still valid | `REVIEW_CONFLICT` | No |
| EC-USR-07 | Uploader approves own document | Blocked by default with `SELF_APPROVAL_DENIED`; org may allow with recorded override | Another reviewer decides | `SELF_APPROVAL_BLOCKED` | No |
| EC-USR-08 | Unauthorised download attempt | `404` for out-of-scope resource; signed URL not issued; denial audited and rate-limited | Request access | `ACCESS_DENIED` | No |
| EC-USR-09 | Owner leaves without transfer | Block deactivation/removal until ownership transferred; last owner cannot be removed | Transfer ownership | `OWNER_TRANSFER_REQUIRED` | Customer |
| EC-USR-10 | Same person has two accounts | Support merges only after identity verification; memberships reconciled; audit preserved | Account merge (manual) | `ACCOUNT_MERGED` | Ops |
| EC-USR-11 | Guest claims to be someone else / SMS pumping | OTP rate-limited to 3/hr and 10/day with 15-min cooldown (API-028B); recipient channel locked to guest_grants destination; prevents toll fraud (RT-014) | Revoke; reissue | `GUEST_IDENTITY_FAILED` | Customer |
| EC-USR-12 | Auditor tries to write | `403`; UI read-only; audit | None | `ACCESS_DENIED` | No |
| EC-USR-13 | Member has multiple org/project roles | Positive-only additive model: capabilities = org_role ∪ project_role; scope narrows to resource grant (05 §3.2); no explicit denies exist (RT-004) | Admin adjusts assignments | `ROLE_EVALUATED` | Customer |
| EC-USR-14 | Delegation expires mid-review | Review returns to delegator; delegate loses access; notification sent | Reassign | `DELEGATION_EXPIRED` | Customer |
| EC-USR-15 | Same person accepts two invitations to the same org | Second invitation is marked `SUPERSEDED`; only one membership is created | None | `INVITATION_SUPERSEDED` | No |
| EC-USR-16 | A user is both an org member and a guest on another org's project | Org membership wins for that org; guest grant applies only in the granting org; sessions carry `active_org_id` | None | `ROLE_CONTEXT_RESOLVED` | No |

## 5. Technology and operations scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-TECH-01 | Multipart presigned URLs expire mid-upload | Client calls API-082A to refresh signed part URLs with existing s3_upload_id without restarting upload; completed parts preserved (RT-012) | Refresh URLs & resume | `UPLOAD_URLS_REFRESHED` | No |
| EC-TECH-02 | Duplicate upload request (double tap) | Idempotency key returns same intent/version; no duplicate document | None | `IDEMPOTENT_REPLAY` | No |
| EC-TECH-03 | Storage quota exhausted (org) | Upload blocked with clear message and usage; reads continue; admin alerted | Archive/delete or upgrade | `STORAGE_LIMIT_REACHED` | Customer |
| EC-TECH-04 | Storage provider outage | Upload intents fail closed; processing retries; no data loss for completed files | Retry; status page | `STORAGE_UNAVAILABLE` | Ops |
| EC-TECH-05 | Background job fails | Retries with exponential backoff up to 5; then dead-letter + alert; user sees failed state | Ops retry from admin | `JOB_FAILED` | Ops |
| EC-TECH-06 | Email delivery failure | Notification marked failed; retried; in-app remains; admin alerted after threshold | Alternate channel | `NOTIFICATION_FAILED` | Ops |
| EC-TECH-07 | Duplicate notifications | Dedup by `(event, recipient, channel, window)`; at most 1/day/channel/recipient for reminders | None | `NOTIFICATION_DEDUPED` | No |
| EC-TECH-08 | PDF generation failure | Package `FAILED` with stage and reason; no partial ready; retry safe | Retry; fix source file | `PACKAGE_FAILED` | Customer/Ops |
| EC-TECH-09 | PDF merge timeout | Job times out; partial temp files cleaned; package failed; retry with larger worker (V1) | Ops retry | `PACKAGE_TIMEOUT` | Ops |
| EC-TECH-10 | Database outage | Writes fail with `503`; reads may fail; clients retry; no partial transactions | Failover; restore | `DB_UNAVAILABLE` | Ops |
| EC-TECH-11 | Backup restore required | Restore to point in time; verify integrity; replay outbox; notify customers of data loss window | Runbook | `RESTORE_PERFORMED` | Ops |
| EC-TECH-12 | Concurrent package generation | Each request gets its own package row; per-project lock prevents duplicate identical jobs or allows with warning; no shared temp paths | Wait/download latest | `PACKAGE_CONCURRENT` | No |
| EC-TECH-13 | Security incident (suspected breach) | Contain, rotate secrets, preserve logs, assess scope, notify per law/policy, isolate tenant if needed | Incident runbook | `SECURITY_INCIDENT` (critical) | Ops/X |
| EC-TECH-14 | Queue backlog | Uploads still accepted; processing delayed; user sees "in queue"; autoscale workers; alert | Scale; drain | `QUEUE_BACKLOG` | Ops |
| EC-TECH-15 | Clock skew / statutory compliance | Server NTP syncs with time.nplindia.org and samay1.nic.in; alert if skew > 1,000 ms; security breaches reported to CERT-In within 6 hours (RT-013) | Resync NTP; notify CERT-In | `CLOCK_SKEW_DETECTED` | Ops |
| EC-TECH-16 | Malicious file upload | AV quarantine; no preview; alert; rate-limit actor; preserve evidence | Investigate; purge; notify | `MALWARE_DETECTED` | Both |
| EC-TECH-17 | Cross-tenant access attempt via ID substitution | `404`; denial audited; rate-limit; security alert after repeated attempts | Investigate actor | `TENANT_ACCESS_DENIED` (critical) | Ops |
| EC-TECH-18 | Orphaned storage object | Cleanup job deletes objects without DB reference after 24 h grace; logs count | Automatic | `ORPHAN_CLEANED` | No |
| EC-TECH-19 | Orphaned DB row (object missing) | Download fails; version marked `FAILED`; user notified; regenerate from source if possible | Re-upload/recover backup | `OBJECT_MISSING` | Ops |
| EC-TECH-20 | Browser crashes during metadata entry | Draft saved locally (where implemented); otherwise warn before unload; no server partial record | Re-enter | `DRAFT_LOST` | No |
| EC-TECH-21 | Razorpay webhook replay/out-of-order | Verify signature/timestamp; idempotent by event ID; fetch current subscription state | Reconcile daily | `PAYMENT_EVENT_REPLAYED` | No |
| EC-TECH-22 | Invoice PDF generation fails | Invoice remains valid in DB; retry; user can request; no duplicate invoice number | Retry | `INVOICE_PDF_FAILED` | Ops |
| EC-TECH-23 | Deletion job partial failure | Mark deletion request `PARTIAL`; retry; do not report complete; alert | Ops rerun | `DELETION_PARTIAL` | Ops |
| EC-TECH-24 | Search index stale | Document events retried; UI shows "indexing" for new docs; no incorrect permissions | Reindex | `SEARCH_INDEX_LAG` | Ops |
| EC-TECH-25 | Notification sent to wrong recipient | Stop further sends; correct template/preferences; notify affected; audit; consider incident | Fix; apology | `MISDIRECTED_NOTIFICATION` (critical) | Both |
| EC-TECH-26 | SMS/OTP provider outage | Fall back to email magic link after 2 failed sends; alert; block new signups if neither channel works | Provider failover | `SMS_PROVIDER_UNAVAILABLE` | Ops |
| EC-TECH-27 | HTTP client closes connection mid-request | No partial state; idempotency key allows safe retry | Retry | `CLIENT_DISCONNECT` | No |
| EC-TECH-28 | Object-storage eventual consistency on HEAD | Retry with backoff up to 5 times before failing the job | Automatic | `STORAGE_READ_RETRY` | No |
| EC-TECH-29 | Job queue poison message | 5 attempts then DLQ + alert; job marked `FAILED` with reason | Ops retry | `JOB_POISONED` | Ops |
| EC-TECH-30 | Clock skew between app and database | Deadlines computed from DB `now()`; ±2 min tolerance; webhook timestamps outside 5 min rejected | NTP sync | `CLOCK_SKEW_DETECTED` | Ops |

## 6. Billing and commercial scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-BIL-01 | Payment fails | `PAST_DUE`; grace period (7 days); retries; writes continue during grace; then `SUSPENDED` (read-only) | Update payment method | `PAYMENT_FAILED` | Customer |
| EC-BIL-02 | Plan limit exceeded (projects) | New project creation blocked with upgrade prompt; existing projects unaffected | Archive or upgrade | `PLAN_LIMIT_BLOCKED` | Customer |
| EC-BIL-03 | Downgrade below current usage | Block until projects archived or seats removed; explain exactly what to do | Archive/remove | `DOWNGRADE_BLOCKED` | Customer |
| EC-BIL-04 | Duplicate payment webhook | Idempotent; single invoice mark-paid | None | `PAYMENT_DUPLICATE_IGNORED` | No |
| EC-BIL-05 | Refund requested | Support reviews; credit note with approval; audit; no silent adjustment | Manual approval | `CREDIT_NOTE_ISSUED` | Ops |
| EC-BIL-06 | GSTIN changed after invoices | New billing profile for future invoices; prior invoices unchanged; audit | Update profile | `BILLING_PROFILE_CHANGED` | Customer |
| EC-BIL-07 | Subscription cancelled | Data read-only; export available; retention clock starts; clear reactivation path | Reactivate or export | `SUBSCRIPTION_CANCELLED` | Customer |
| EC-BIL-08 | Payment webhook arrives before the subscription record exists | Store event, resolve out of order by fetching current state from the provider | Daily reconciliation | `PAYMENT_EVENT_OUT_OF_ORDER` | No |
| EC-BIL-09 | Customer GSTIN becomes invalid mid-subscription | Block invoicing; alert billing manager; subscription continues; manual invoice issued meanwhile | Correct billing profile | `BILLING_IDENTITY_INVALID` | Customer |

## 7. Security and privacy scenarios

| ID | Scenario | Expected behaviour | Recovery | Audit | Manual? |
|---|---|---|---|---|---|
| EC-SEC-01 | Cross-tenant leak suspected | Immediate containment, scope assessment, notification per policy/law, forensic preservation | Incident runbook | `SECURITY_INCIDENT` | Ops/X |
| EC-SEC-02 | Stolen guest link | Revoke grant, invalidate sessions, review access logs, notify contractor | Reissue link | `GUEST_LINK_REVOKED` | Customer |
| EC-SEC-03 | Stolen session cookie | Revoke session, force re-auth, review actions, notify user | Session revocation | `SESSION_REVOKED` | Both |
| EC-SEC-04 | Data subject deletion request | Verify identity and authority; check legal hold/contract; delete or anonymise; record | Workflow | `DSR_COMPLETED` | Ops |
| EC-SEC-05 | Legal hold on project | Block purge/archive deletion; flag in UI; allow reads | Release hold | `LEGAL_HOLD_SET` | Customer/Ops |
| EC-SEC-06 | Platform admin accesses content | Break-glass reason, time limit, customer notification, full audit | Review | `BREAK_GLASS_ACCESS` | Ops |
| EC-SEC-07 | Malicious HTML/script in a user-controlled field rendered into a generated PDF | All values HTML- and attribute-escaped; template fails closed on unescaped placeholder; output scanned for active content; package generation aborts with `PACKAGE_RENDER_BLOCKED` | Fix input; regenerate | `PACKAGE_RENDER_BLOCKED` | Customer |
| EC-SEC-08 | Insider bulk export of a client's project | `export.data` restricted to Owner/Admin; one export per project per hour; reason required; alert on repeated exports | Investigate actor | `EXPORT_ABUSE_SUSPECTED` | Both |

## 8. Manual intervention matrix

| Situation | Who | Time target |
|---|---|---|
| Malware confirmed | Ops + customer | 4 business hours |
| Cross-tenant incident | Ops + counsel | Immediate containment |
| Backup restore | Ops | Per RTO 4 hours |
| Account merge | Ops | 2 business days |
| Refund/credit note | Ops | 3 business days |
| Deletion request | Ops | 30 days (or legal requirement) |
| Stuck package job | Ops | 1 business day |
| GST invoice correction | Ops + CA | 5 business days |

## 9. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial edge-case matrix |
| 0.2 | 2026-10-31 | Remediation: added EC-DOC-26/27, EC-PRJ-15/16, EC-USR-15/16, EC-TECH-26–30, EC-SEC-07/08, EC-BIL-08/09 |
