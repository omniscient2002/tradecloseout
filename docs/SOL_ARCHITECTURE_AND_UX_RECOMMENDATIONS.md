# SOL — Architecture and UX Recommendations

Analysis only. Evidence tags: **[V]** verified in repo, **[P]** practitioner knowledge to validate, **[H]** opinion. Where I did not read a module in full I say so.

---

# Part 1. Architecture

## 1.1 Guiding principle
A pilot-stage product with a 1-3 person team should run on **one Postgres, one API, one worker, one object store**. Add components only when a customer-visible capability needs them. Current estate: Postgres (RDS), EC2 app host, Redis, BullMQ, ClamAV daemon, qpdf, KMS, S3 via Terraform (`infra/terraform/main.tf`: KMS key, private S3 bucket + versioning + SSE, RDS instance, one EC2 host) **[V]**. That is reasonable for production, but Redis+BullMQ+ClamAV are only justified because of upload scanning and PDF compilation; keep, but don't add more.

## 1.2 Keep (these are right)
| Decision | Why keep |
|---|---|
| Postgres + `FORCE ROW LEVEL SECURITY` with `org_id = current_setting('app.current_org')` on every tenant table (`0000…sql:1369-1419`) | Hard multi-tenant isolation at the database; protects against application bugs. |
| Raw SQL services with explicit transactions and `FOR UPDATE` on review/version rows | Correct concurrency for approvals. |
| Immutable document versions with SHA-256, storage objects, quarantine states | Evidence integrity is the product. |
| Idempotency keys and `row_version` optimistic concurrency | Mobile/offline retries make this essential. |
| Hash-chained audit events with a verification job (`scheduler.ts`) | Cheap, differentiating trust feature. |
| Paise as BIGINT for money | Correct. |

## 1.3 Change (with trade-offs)

### A. One schema source of truth — **MUST**
- **Observation:** `schema.ts` (70 tables) and SQL migrations (0000-0007) diverge; `digital_signatures`, `bulk_import_jobs`, `billing_tax_configs` are in SQL but absent from `schema.ts` **[V]**. The services use raw `pg` queries, so Drizzle types are not enforcing anything.
- **Options:** (1) SQL migrations canonical, generate TS types from the live DB (e.g. introspection); (2) Drizzle canonical, generate SQL; (3) status quo.
- **Recommendation:** option 1. RLS, FORCE, triggers and composite FKs are SQL-native and awkward in an ORM schema. Add a CI "migrate on empty DB, introspect, diff types" check.
- **Complexity:** S-M. **Migration:** no data change.

### B. Replace the "requirement" monolith with a clearer deliverable model — **DIFF**, L
Today a *requirement* is both (a) a checklist line, (b) a state machine with 14 states, (c) the join point for documents, waivers, reviews, expiry. This worked for a closeout checklist but will strain once MARs, IRs and tests exist.

Proposed concepts (names are suggestions):
```text
Project ── Contract(s) ── Obligation (clause-level facts: retention %, DLP, response periods, approved makes)
   │
   ├── Equipment (tag, type, location, system) ── EquipmentRevision (identity changes)  [exists as assets/identity revisions]
   │        │
   │        └── Lifecycle events (approved, PO'd, delivered, inspected, tested, commissioned, handed over, warranty start)
   │
   ├── Deliverable  (what must exist)    : template-driven; scoped to project | system | equipment
   │        └── Evidence link  (document version | structured record) with relation type
   │
   ├── Submission   (a hand-off to an external party)  ── Decision (external/in-app) ── Comments
   │
   └── Work record  : InspectionRequest | TestRecord | Delivery(MIR) | Snag
```
- **Why:** MAR, IR, test, delivery and snag all follow the same pattern: *request -> external party responds -> decision -> evidence*. A generic `Submission + Decision` pair reduces new-feature cost, replacing per-feature state machines.
- **Trade-off:** more conceptual unification up front; risk of over-abstraction. Mitigate with three concrete types only (MAR, IR, Closeout item) before generalising.
- **Migration:** additive. Existing requirements remain "Closeout item" deliverables. Don't rewrite reviews; wrap them.

### C. State machines: fewer states, one transition table
- 14 requirement states and several review/file states, with `IN_REVIEW`/`UNDER_REVIEW` both present **[V]**. Recommend: store a **small canonical status** + **derived flags** (is_overdue, is_expired, awaiting_party_id). The "waiting on whom" should be a first-class derived column (it drives Inbox, Waiting Ledger and Money Gates).
- Put allowed transitions in a single declarative table checked in one function, instead of scattered `UPDATE ... SET status`. Easier tests, clearer UI.

### D. Commercial records
- Keep `contracts` (value, retention_bps, dlp_months **[V]**) but add structured **release stages** (e.g. completion, end of DLP) and a **Money Hold** ledger: `(contract_id, kind[retention|BG|final_bill|disputed_variation], amount_paise, release_condition_ref[]...)`.
- Do **not** model RA bills' accounting. Add `ra_bill` as a *container of attachments and BOQ line references* only, after validation (see D2 in improvements doc).

### E. Evidence relationships
- Current: document <-> requirement, document <-> asset, document <-> contract **[V]**. Add one more relation type: **supports(structured record)** so a pressure-test record, an IR and a PDF can all satisfy a deliverable. Keep the "relation_type" explicit (primary evidence, supporting, superseded-by).

### F. Document versions
- Fine as is (versions, hashes, quarantine). Fix the read path (must use the storage adapter, not `/tmp/tradecloseout-sim`) **[V]**. Add "source" metadata for ingestion channel (upload, e-mail, WhatsApp, supplier link) — needed for provenance and for the Decision Register.

### G. Ingestion layer (new, small)
- Inbound e-mail webhook + WhatsApp webhook -> normalised "Inbox item" (original blob + metadata) -> matcher (deterministic rules by doc number/tag/revision/sender) -> human confirm -> create Submission/Decision/Evidence.
- **Cost:** one provider (WhatsApp BSP, inbound e-mail like SES/Postmark-type) and a small matcher. **Risk:** spam/abuse; PII in forwards -> per-project unguessable address and allow-listed senders.

### H. Tenant permissions
- Today: positive-only permission engine in `packages/shared/src/permissions.ts` (455 lines), roles like R-OWNER, plus guest grants and a visibility-projection interceptor **[V]**. Good approach.
- Needed additions: **field-level financial visibility** (contract value and money gates hidden from QC/site roles), and **party-scoped views** (a consultant should see only items sent to them).
- Fix: replace the hard-coded persona list (`login-switch-user-modal.tsx`) with real invitations.

### I. External-party access
- Merge "supplier guest link", "client guest view" and "consultant review link" into a single **Link Grant** with scope (project, PO, request set), purpose and expiry; OTP-verify only when sensitive (this is what the repo's guest-grant model already mostly does **[V]**). Don't create accounts for suppliers by default.

### J. Notifications
- One outbox -> provider adapters (WhatsApp, SMS, e-mail, in-app) with delivery status callbacks. Status must be `QUEUED -> SENT -> DELIVERED/FAILED`, never marked SENT at insert (`notifications.service.ts:36-56`) **[V]**.

### K. Search and reporting
- Postgres full-text + trigram on titles, tags, doc numbers, party names, and extracted text later. No separate search cluster until volume demands. Reports as saved filters + CSV/PDF export. Keep dashboards on materialised views refreshed by the worker.

### L. Offline strategy
- Treat the phone as a **write-through cache of assigned work**: pre-sync assigned project's equipment, deliverables and templates (IndexedDB), queue mutations with idempotency keys (already supported server-side). Conflict rule: server wins for status; client wins for captured evidence (append-only). Show sync state per item.

### M. Storage and cost
- Evidence is write-once, read-rarely. Use S3 lifecycle: hot for active projects, infrequent-access after closure, archive after DLP. Compress site photos client-side. The storage cost per project is small relative to the project value; do not bill by storage (customers resent it), bill by active project (see competitive doc).

### N. Test and delivery discipline
- ≈121 DB-backed test cases exist **[V by grep, not executed]**. Add: (1) a contract test for each external adapter with a *real sandbox* where possible; (2) a Playwright-level "upload on throttled network, offline, resume" test; (3) a "no simulated success" lint: fail CI if known demo strings (`demo_ver_`, `tradecloseout-sim`, `isEicarTestVirus`) appear in production code.

## 1.4 Things I would *not* change
- Do not move to microservices.
- Do not adopt event sourcing everywhere; the audit log + immutable versions are enough.
- Do not introduce a graph database for obligations; a relational model with explicit edge tables suffices (Top-25 #1 can be done with Postgres).
- Do not introduce an LLM gateway until two AI features pass a validation gate.

---

# Part 2. UX

## 2.1 Principles
1. **Equipment- and money-centred**, not document-centred.
2. **Start from "what do I do next?"** (Work Inbox) not from a dashboard of counts.
3. **Phone-first for site roles; desktop-first for PM/MD/doc-control.**
4. **Never ask twice**: tag, project, party and date are inferred from context.
5. **Honest status**: show pending sync, failed, unconfirmed.
6. **Few statuses, plain words**; Indian English is fine; add Hindi and at least one regional language for field screens **[H]** (language set to be validated).

## 2.2 Current UX as built (verified)
- Contractor shell with sidebar whose items depend on role: e.g. "Site Dashboard / Projects / Parties" for site, "QC Station", "Executive Dashboard / Audit Log / Billing & GST" for owner (`(contractor)/layout.tsx:137-166`) **[V]**.
- Project page with seven horizontal tabs: Overview, Checklist, Equipment, Reviews, Handover, Warranties, Reports (`projects/[projectId]/page.tsx:204-206`), in one 1,947-line component **[V]**.
- A separate "review workbench" route.
- A guest page for suppliers/clients.
- **Problems:** (i) the same noun "Dashboard" is a different thing per role, which is good in principle but is built as hard-coded demo content (Deccan/"HYD-BIO-09" ids) **[V]**; (ii) no global Work Inbox; (iii) no cross-project search; (iv) "Billing & GST" (TradeCloseout's own SaaS billing) sits beside operational screens in the owner menu - confusing; (v) tab sprawl: checklist/reviews/handover/warranties are *stages of one thing*; (vi) no mobile-specific capture flow beyond the upload sheet.

## 2.3 Target information architecture

```text
Global
  Home (role-aware)          Work Inbox | Portfolio (MD/PM) | My Site (site/QC)
  Projects
  Equipment (cross-project search by tag/serial/model)
  Parties (suppliers, consultants, clients; scorecards)
  Search (⌘K / top bar)
  Settings (team, templates, notifications, billing) — low in the menu

Project workspace (one page, left rail not tabs)
  Today          — what changed, what's due, who is blocking
  Deliverables   — the matrix (equipment x stage) + list view
  Equipment      — passport pages
  Submissions    — MAR, IR, tests, decisions (the Decision Register)
  Money          — gates and release conditions (role-restricted)
  Handover       — completeness gate + builder + acceptance
  After-sales    — warranty, DLP, snags
  Files          — all documents (secondary, not primary)
```

### 2.4 Screen-by-screen

#### Global navigation
- Max 6 top-level items. Search always visible. A "+" quick-action (Upload evidence / New IR / Log snag / Forward decision) available everywhere.
- Role defaults: Site -> My Site; QC -> Work Inbox; Doc controller -> Submissions; PM -> Portfolio; MD -> Portfolio (Money tab first).
- **Remove from the primary nav:** Audit Log (move into project/Admin), Billing & GST (Settings).

#### Work Inbox (new, highest priority screen)
- Single list of *actions assigned to me or my team*: "Reply to supplier", "Review upload", "Chase consultant (31 days)", "Fix rejected report", "Expiring warranty", "IR response overdue".
- Each row: what, equipment tag, project, who is waiting, days waiting, one primary action button (Approve / Request revision / Chase / Upload). Bulk actions. Snooze.
- Replaces the current "review queue" tab and the notification list.
- **Metric:** items cleared per session; median time from notification to action.

#### Portfolio dashboard (MD/PM)
- Top: **Money blocked** (₹ and # items) by project; **Oldest waiting** (party, days); **Handover forecast** (projects whose last gate is cleared).
- Table of projects with status chips and "next blocker". No decorative charts; every number is clickable to the underlying items.
- Hide figures from roles without financial visibility.

#### Project "Today"
- Four blocks: *Due this week*, *Waiting on others (grouped by party, days)*, *Rejected & needs fix*, *New evidence to review*. Replaces the Overview tab.

#### Requirements register / Deliverables
- Default view: **matrix** — rows = equipment tags (grouped by system), columns = lifecycle stages (Submittal, PO/Delivery, Inspection, Test, Commissioning, Warranty, O&M). Cells coloured by state with counts; click a cell for the item. Alternate "list" view for filters.
- Bulk: assign, request from supplier, mark N/A with reason, set due dates. Inline edits.
- Show "why blocked" in-line, not in a drawer.
- Avoid 14 coloured pills; use 6 colours with icons (accessibility).

#### Equipment experience
- Passport page: header (tag, type, make/model, serial, location, status), timeline of lifecycle events, checklist of deliverables with evidence thumbnails, warranty clock, QR download, service history. A "Replace/Change tag/serial" action that shows exactly which evidence needs revalidation (the repo's identity-revision feature **[V]**, exposed properly).
- Bulk import & QR label sheet print.

#### Document repository ("Files")
- Secondary. Filterable by tag, doc type, status, supplier, date. Always shows linkage ("used for 3 deliverables"). Upload anywhere, with auto-suggest of the target deliverable (deterministic matching first).

#### Review workbench
- Current route exists (`review/[versionId]`, 646 lines) **[V]**. Keep but ensure: split view (document left, checklist of acceptance criteria right), keyboard shortcuts, standard coded rejection reasons (picklist, plus comment), "approve with note" and "approve all in this batch", compare with previous revision (metadata first), and *consultant mode* that works through a link without login.
- Time-box feel: reviewer can finish a typical review in under 2 minutes.

#### Supplier portal (link-based)
- One page, mobile-first: "PO-2231 needs 7 documents": each row has status, example of what good looks like, upload from camera/files, WhatsApp share. Rejection reasons displayed with fix suggestions. Language toggle. No account creation.

#### Inspections (new)
- Create from the equipment passport or "+". Template-driven checklist, photos, location, notice period. Share link to inspector; response screen with Approve / Comment / Reject and signature or name+OTP. Record is stored as structured data + generated PDF.

#### Handover builder
- Step 1: completeness gate (what's missing, whose action). Step 2: choose index template (client/consultant format). Step 3: preview with page counts and flagged missing pages. Step 4: freeze & generate. Step 5: send for acceptance and capture acceptance. Today this exists as a modal (`compile-handover-modal.tsx`, 395 lines) and a packages view **[V]**; promote it to a stepped page and add acceptance capture.

#### Commercial dashboard (Money)
- Per contract: contract value, retention held, BG, final bill, disputed variations; each with release conditions and blockers. Timeline of expected release dates (DLP end, completion). Export "release request pack". Role-restricted.

#### Search & reporting
- Global search by tag/serial/doc number/supplier/consultant/PO. Saved reports: "Open items by consultant", "Documents expiring in 90 days", "Supplier cycle times", "Snag ageing". CSV and PDF export; scheduled e-mail digest to MD every Monday.

### 2.5 Role views (who sees what)
| Role | Default home | Core actions | Must NOT see |
|---|---|---|---|
| Owner/MD | Portfolio (Money) | Approve waivers, view blockers, scorecards | Nothing hidden; but avoid config clutter |
| Project manager | Portfolio / Project Today | Assign, chase, approve, create packages | Org billing |
| Commercial/accounts | Money | Retention, BG, bills pack | QC internals not needed |
| QC engineer | Work Inbox | Review, IR, test entry | Contract values |
| Site engineer | My Site (mobile) | Capture photos, IR, deliveries, snags | Contract values, org settings |
| Procurement | Submissions (MAR/PO) | Supplier requests, approved-make check | Contract values (except PO) |
| Document controller | Submissions/Files | Register, transmittals, revisions | Billing |
| Supplier (guest) | Their request page | Upload, respond | Anything outside their PO |
| Consultant/client (guest) | Their review list | Approve/comment | Contractor internal notes, other parties' items |

### 2.6 Mobile
- Bottom tab bar: Inbox, Capture (camera), Equipment (scan QR), Me.
- Capture flow: scan equipment QR or choose from recent -> pick deliverable (suggested) -> photo(s)/file -> auto-compress -> queue. Maximum 5 taps.
- Persist drafts; show sync indicator; large touch targets; high-contrast mode for bright sites.
- Offline: assigned project data cached; stale-while-revalidate for lists.

### 2.7 Remove or merge
- Remove demo persona switcher and hard-coded KPIs from production builds **[V]**.
- Merge Reviews + Checklist + Handover + Warranties tabs into the single workspace rail above.
- Move Audit and Billing out of main nav.
- Replace modals that run multi-step workflows (compile, import, share link) with pages with progress state; modals only for confirmations.

### 2.8 Accessibility and language
- Currently English only (`lang="en"`) **[V]**. Add i18n scaffolding; translate field screens and supplier portal first. Don't machine-translate legal text. Check colour contrast on status pills; do not rely on colour alone.

### 2.9 UX metrics
- Time to first populated project; median taps per capture; time-to-approve per review; % of users who open Work Inbox daily; support tickets per active project.
