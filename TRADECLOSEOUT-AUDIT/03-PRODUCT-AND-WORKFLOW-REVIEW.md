# DELIVERABLE 4 — `TRADECLOSEOUT-AUDIT/03-PRODUCT-AND-WORKFLOW-REVIEW.md`
<a id="deliverable-4--03-product-and-workflow-reviewmd"></a>

## 1. Adversarial Review of Workflows & State Machines

We traced all 26 workflows (`WF-01` to `WF-26`) and 15 state machines in `06-WORKFLOWS-AND-STATE-MACHINES.md` against the database (`08`) and APIs (`10`). Below are the workflow and state-machine defects that the v0.2 self-audit missed.

### 1.1 State Machine & Workflow Defects

1. **Multi-Recipient Submission Aggregation Deadlock (`RT-007` — HIGH):**
   - `WF-17` creates multiple `submission_recipients` (Client, MC, Consultant), each with independent decisions, but `06` §3.11 and §3.12 have no aggregation state (`PARTIALLY_ACCEPTED`) and no rule for how `submissions.status` and `handover_packages.status` transition when recipients disagree or respond at different times.
2. **Expired Certificate State Deadlock (`RT-009` — HIGH):**
   - `06` §3.6 only allows `APPROVED → EXPIRED`. An expired certificate uploaded on day 1 cannot transition `UPLOADED → EXPIRED`, and `WF-22` leaves `documents.current_approved_version_id` pointing at an expired version.
3. **External Approval (`WF-23`) Breaks When Document Is Not Yet `IN_REVIEW` (`RT-022` — MEDIUM):**
   - Look at `06` `WF-23` (Record External Approval):
     - Preconditions say: *"Document version `READY`; requirement in `UPLOADED`/`IN_REVIEW`"*.
     - Now look at `10` §7.8 `API-106`: `POST /reviews/{id}/external-decision`.
     - **How can the client call `POST /reviews/{id}/external-decision` when the requirement is in `UPLOADED` state and no `reviews` row (`{id}`) has been created yet?!** A `reviews` row is only created when `POST /requirements/{id}/submit-review` (`API-062`) is called! If a PM uploads a consultant-stamped PDF (`UPLOADED`) and immediately clicks "Record external approval" per `WF-23`, there is no `reviewId` to pass to `API-106`!
   - **Correction:** Change `API-106` to `POST /document-versions/{id}/external-approval` (which creates the `reviews` row with `method = 'EXTERNAL'` and transitions the version and requirement to `APPROVED` in one atomic transaction, regardless of whether the version was `NOT_SUBMITTED` or `IN_REVIEW`).
4. **Mandatory Waiver Second-Approver Has No State or API (`RT-023` — MEDIUM):**
   - `FR-CHK-016` and `05` §4 state: *"Waiving or marking `NOT_APPLICABLE` a mandatory requirement requires a second approver and a reason."*
   - `08` §3.3 `waivers` has `approved_by` and `second_approved_by?` and `status`.
   - **However:**
     - `06` §3.6 (Requirement state machine) transitions directly `NOT_STARTED --> WAIVED: waiver approved` with **no `PENDING_WAIVER_APPROVAL` state**.
     - `10` §7.5 has only `API-061 POST /requirements/{id}/waivers`. **There is no `POST /waivers/{id}/countersign` (or `/approve`) endpoint in `10` §7.5!** How does the second approver actually countersign the waiver?
5. **Partial Handover (`WF-15` / `FR-PRJ-008`) Missing Transition out of `HANDED_OVER` (`RT-024` — MEDIUM):**
   - In `06` §3.6, a requirement in a partial handover transitions `APPROVED → HANDED_OVER`. What happens if the client **rejects** the partial handover submission (`WF-17`), or a certificate in the handed-over wing expires before final project closure? In `06` §3.6, the only outgoing transition from `HANDED_OVER` is `HANDED_OVER → SUPERSEDED`! There is no transition `HANDED_OVER → APPROVED` (if submission is withdrawn/rejected) or `HANDED_OVER → EXPIRED`.

---

## 2. Practical Scenario Testing (11 End-to-End Simulations)

The v0.2 self-audit (`FILE 31` §6) claimed that all 11 scenarios pass with *"zero undocumented developer decisions"*. We re-simulated all 11 scenarios against the exact DDL (`08`) and APIs (`10`). **Only 4 of 11 scenarios pass cleanly; 7 fail or require undocumented developer decisions.**

| # | Scenario | v0.2 Claim | Independent Red-Team Result | Exact Failure Point / Undocumented Decision in v0.2 |
|---|---|---|---|---|
| **S-1** | **Normal HVAC project (creation to handover)** | ✅ Pass | ❌ **FAILS AT SIGNUP & DB MIGRATION** | 1. Database migration fails on `08` §5.1 (`projects` has no `project_id`, `documents` self-FK fails — `RT-003`).<br>2. First user OTP verification (`API-002`) crashes inserting into `sessions` because `active_org_id` is `NOT NULL` before `POST /orgs` is called (`RT-002`). |
| **S-2** | **Multiple suppliers and equipment models** | ✅ Pass | ⚠️ **FAILS ON EXTERNAL APPROVAL** | Supplier uploads a factory test certificate (`UPLOADED`). Consultant stamps it physically at site. PM uploads stamped scan (`review_status = NOT_SUBMITTED`) and tries to record external approval (`WF-23`). Fails because `API-106` (`POST /reviews/{id}/external-decision`) requires an existing `reviewId`, which does not exist until `submit-review` is called (`RT-022`). |
| **S-3** | **Project with missing and rejected documents** | ✅ Pass | ❌ **FAILS ON MANDATORY WAIVER** | 3 mandatory documents are missing; client agrees to waive 1 of them. PM calls `API-061 POST /requirements/{id}/waivers`. Per `FR-CHK-016`, a mandatory waiver requires a second approver (`second_approved_by`), **but no API endpoint exists in `10` §7.5 for the Owner/Admin to countersign the waiver** (`RT-023`)! |
| **S-4** | **Changing client requirements** | ✅ Pass | ✅ **Pass** | `WF-20` + `requirement_revisions` + `package_requirements` + `snapshot_checksum` handle post-activation changes cleanly once `RT-003` DDL is fixed. |
| **S-5** | **Project with partial handover** | ✅ Pass | ⚠️ **FAILS ON REJECTION / MULTI-RECIPIENT** | PM generates partial package for Wing A, marks requirements `HANDED_OVER`, and submits to Client + Main Contractor (`WF-17`). Consultant accepts, Main Contractor rejects (`RT-007` deadlock), and `HANDED_OVER` requirements have no transition back to `APPROVED` or `CHANGES_REQUESTED` (`RT-024`). |
| **S-6** | **Equipment replaced after commissioning** | ✅ Pass | ⚠️ **BROKEN FK INTEGRITY** | Chiller `CH-01` is marked `REPLACED` by `CH-01A`. New asset-scoped requirements are instantiated with `scope_key = 'asset:{uuid}'`, which has **no database foreign key** to `assets` (`RT-003`). |
| **S-7** | **Supplier uploading the wrong document** | ✅ Pass | ❌ **FAILS ON REVISION RE-UPLOAD** | Supplier uploads wrong PDF as Revision `R0`, then withdraws/deletes it before review (`EC-DOC-15`). Supplier tries to upload the correct PDF as Revision `R0`. Blocked by `409 DUPLICATE_REVISION` because `WF-13` reserves `revision_code` even on soft-deleted/withdrawn unapproved uploads (`RT-011`)! |
| **S-8** | **Two employees editing the same project** | ✅ Pass | ✅ **Pass** | Optimistic concurrency (`row_version` + `If-Match`) and `SELECT ... FOR UPDATE` on `documents` (`08` §5.3) handle concurrent edits and approvals. |
| **S-9** | **Contractor losing internet connectivity** | ✅ Pass | ❌ **FAILS ON MULTIPART RESUME** | Site engineer loses 4G for 60 minutes mid-upload of a 50 MB PDF. Presigned URLs expire (15–60 min TTL). When 4G returns, **no API endpoint exists in `10` §7.7 to list completed parts or issue fresh presigned URLs for the remaining parts** (`RT-012`)! |
| **S-10** | **Employee leaving the company** | ✅ Pass | ✅ **Pass** | `WF-21` + `API-019` (`POST /orgs/{orgId}/reassign-work`) + `SCR-056` cover suspension, session revocation, gap report, and bulk reassignment. |
| **S-11** | **Project reopening after closure** | ✅ Pass | ✅ **Pass** | `WF-18`/`WF-19` + `purged_at` guard + `reopen_count` handle reopening cleanly. |

---
---