# DELIVERABLE 7 — `TRADECLOSEOUT-AUDIT/06-REQUIREMENT-TRACEABILITY.md`
<a id="deliverable-7--06-requirement-traceabilitymd"></a>

## 1. Independent Audit of Requirement-to-Artefact Traceability

We audited every requirement in `03-PRODUCT-REQUIREMENTS.md` (`FILE 05`) against `06` (Workflows), `08` (Database), `10` (APIs), `11` (Screens), and `14` (Tests).

### 1.1 Exact Count & Structural Errors in `03-PRODUCT-REQUIREMENTS.md`

- **Duplicate Requirement Rows (`RT-017` — MEDIUM):** In `03` §9 (`Documents, uploads and metadata`), the table lists `FR-DOC-001` through `FR-DOC-033`, and then **repeats `FR-DOC-029` and `FR-DOC-030` a second time** at the bottom of the table!
- **Missing Requirement Area in `03` (`RT-028` — MEDIUM):** `03` §19 lists area `WTY/DEF` (Warranty & Defects) with tests `TC-WTY-*`, screens `SCR-058`–`059`, and APIs `API-180`–`185`. However, **`03-PRODUCT-REQUIREMENTS.md` has no `FR-WTY-*` or `FR-DEF-*` requirements section**, and **`14-TESTING-AND-ACCEPTANCE.md` has no `TC-WTY-*` or `TC-DEF-*` test cases!** Those entities (`warranty_events`, `defects`), workflows (`WF-24`, `WF-25`), APIs (`API-180`–`183`), and screens (`SCR-058`–`059`) were added in v0.2 without adding their functional requirements (`FR-WTY-001`–`003`, `FR-DEF-001`–`004`) or test cases (`TC-WTY-001`–`002`).

### 1.2 Broken Chains Across the Specification

| Requirement / Feature | Workflow (`06`) | DB Entity (`08`) | API (`10`) | Screen (`11`) | Test (`14`) | Audit Verdict |
|---|---|---|---|---|---|---|
| **FR-ORG-001** (Signup + first org) | `WF-01` | `E-SESSION` (`active_org_id NOT NULL`) | `API-002`, `API-010` | `SCR-002`, `SCR-003` | `TC-ORG-001` | ❌ **BROKEN (`RT-002`)** — `sessions.active_org_id NOT NULL` fails before org creation. |
| **FR-IAM-001** (Multi-org switcher) | — | `E-SESSION` | **✗ Missing in §7.1** | `SCR-005` | `TC-IAM-001` | ❌ **BROKEN (`RT-002`)** — `POST /auth/switch-org` missing from `10` §7.1. |
| **FR-IAM-018** (Effective permissions) | — | `E-PROJECT_MEMBER` | All | All | `TC-IAM-004` | ❌ **BROKEN (`RT-004`)** — `03`, `12`, `14` still require "explicit denies" deleted by `D-039`. |
| **FR-CHK-016** (Mandatory waiver 2nd approver) | **✗ Missing state in §3.6** | `E-WAIVER` (`second_approved_by`) | **✗ Missing countersign API** | `SCR-015` | `TC-CHK-004` | ❌ **BROKEN (`RT-023`)** — No `PENDING_WAIVER` state and no countersign API in `10` §7.5. |
| **FR-AST-005** (Asset-scoped requirements) | `WF-06`, `WF-07` | `E-REQUIREMENT` (`scope_key`) | `API-056`, `API-071` | `SCR-014`, `SCR-019` | `TC-AST-002` | ❌ **BROKEN (`RT-003`)** — String `scope_key` has no DB foreign key to `assets`. |
| **FR-DOC-004** (Resumable multipart upload) | `WF-09` | `E-STORAGE_OBJECT` | **✗ Missing refresh/list parts API** | `SCR-024` | `TC-DOC-002` | ❌ **BROKEN (`RT-012`)** — Cannot refresh expired presigned part URLs on resume. |
| **FR-DOC-014** (Revision upload & reservation) | `WF-13` | `E-DOCUMENT_VERSION` | `API-086` | `SCR-022` | `TC-DOC-005` | ❌ **BROKEN (`RT-011`)** — Failed/withdrawn unapproved upload permanently burns `revision_code`. |
| **FR-DOC-031** (Bulk ZIP + Excel import) | — | **✗ Missing `bulk_import_jobs`** | **✗ Missing in §7.7** | `SCR-055` | `TC-PTY-008` | ❌ **BROKEN (`RT-001`)** — `API-095` omitted from `10` §7.7; no job table in `08`. |
| **FR-REV-016** (Record external approval) | `WF-23` | `E-REVIEW` (`method=EXTERNAL`) | `API-106` (`POST /reviews/{id}/...`) | `SCR-027` | `TC-REV-006` | ❌ **BROKEN (`RT-022`)** — `API-106` requires a `reviewId` that does not exist when version is `UPLOADED`. |
| **FR-HND-019** (Multi-recipient submission) | `WF-17`, `WF-18` | `E-SUBMISSION_RECIPIENT` | `API-115`, `API-117` | `SCR-030`, `SCR-031` | `TC-HND-005` | ❌ **BROKEN (`RT-007`)** — No aggregation rule on `submissions.status` when recipients differ. |
| **Warranty & Defects (`WTY/DEF`)** | `WF-24`, `WF-25` | `E-WARRANTY_EVENT`, `E-DEFECT` | `API-180`–`183` (wrongly `130`–`135` in `03` §19) | `SCR-058`–`059` | **✗ Missing `TC-WTY-*` in `14`** | ❌ **BROKEN (`RT-016`, `RT-028`)** — Missing `FR-WTY`/`FR-DEF` in `03` and `TC-WTY` in `14`. |

---
---