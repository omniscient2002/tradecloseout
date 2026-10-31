# 11 — UI/UX Specification

**Status:** Draft v0.2
**Change history:** v0.2 adds SCR-055–059, the external-approval form, draft persistence, supplier scope rules and the explicit offline limitation.
**Design stance:** Mobile capture, desktop control, minimal training.
**Related:** `03` requirements, `05` permissions, `06` states, `10` API

---

## 1. Experience principles

1. **One question per screen.** Never ask a site engineer to understand a configuration model.
2. **Progress is visible.** Every project shows "X of Y required documents approved".
3. **Next action is obvious.** Empty states and blockers include the exact button to press.
4. **Uploading is the primary verb.** Persistent upload affordance on mobile.
5. **Status language is plain.** "Waiting for consultant", not `IN_REVIEW`.
6. **No dead ends.** Every error offers retry, help, or an alternative.
7. **Works on a ₹12,000 Android phone over 4G.** Previews optimised; uploads resumable.
8. **Guest screens are radically simpler** than internal screens.
9. **Destructive actions are reversible** where possible; irreversible ones require typing or explicit confirmation.
10. **No dark patterns** in billing or cancellation.

## 2. Navigation

### 2.1 Contractor (desktop)

```
Top bar: [Org switcher] [Global search] [Help] [Notifications] [Profile]
Left nav: Dashboard | Projects | Parties | Templates | Audit | Billing | Settings
Project tabs: Overview | Checklist | Assets | Documents | Reviews | Packages | People | Audit | Settings
```

### 2.2 Contractor (mobile)

```
Bottom nav: Home | Projects | [+] Upload | Reviews | More
```

- `[+]` opens the upload flow scoped to the last project or asks for one.
- "More" contains parties, templates, billing, settings, help.
- Project view uses a segmented control for overview/checklist/assets/docs.

### 2.3 Guest (supplier)

Single page: request summary → file upload → confirmation. No navigation, no project browsing.

### 2.4 Guest (consultant/client)

```
Header: [Contractor logo] [Project name] [External access]
Tabs: Requests | Documents | Packages | Help
```

Only granted resources are shown. No org switcher.

## 3. Screen inventory

| ID | Screen | Primary users | Purpose |
|---|---|---|---|
| SCR-001 | Marketing landing | Visitor | Explain product, start trial |
| SCR-002 | Sign up | Visitor | Create account/org |
| SCR-003 | Verify OTP | Visitor | Verify identity |
| SCR-004 | Onboarding wizard | Owner | Profile → trade → project → invite |
| SCR-005 | Org switcher | Multi-org user | Switch tenant |
| SCR-010 | Home dashboard | Owner/PM | Active projects, missing docs, reviews |
| SCR-011 | Projects list | All | Search/filter projects |
| SCR-012 | Create project | PM | Project details |
| SCR-013 | Project overview | PM/owner | Progress, risks, activity |
| SCR-014 | Checklist | PM/QC/doc | Requirements by group/status |
| SCR-015 | Requirement detail | All internal | Evidence, reviews, history |
| SCR-016 | Checklist customiser | PM/admin | Add/edit requirements pre-activation |
| SCR-017 | Change request | PM/approver | Controlled post-activation change |
| SCR-018 | Assets list | Site/PM | Equipment register |
| SCR-019 | Asset detail | Site/PM | Asset info, documents, matrix |
| SCR-020 | Asset import | PM | CSV/Excel import + errors |
| SCR-021 | Documents library | All internal | Search/filter documents |
| SCR-022 | Document detail | All internal | Versions, links, reviews |
| SCR-023 | Upload sheet | Site/supplier | Fast mobile upload |
| SCR-024 | Upload progress | Site/supplier | Resumable status |
| SCR-025 | Document viewer | Reviewer | PDF/image preview + comments |
| SCR-026 | Review queue | Reviewer/PM | Assigned reviews, SLA |
| SCR-027 | Review decision | Reviewer | Approve/request changes/reject |
| SCR-028 | Package builder | PM/doc | Scope, layout, readiness |
| SCR-029 | Package detail | PM/client | Status, download, submission |
| SCR-030 | Submission form | PM/doc | Recipient, method, reference |
| SCR-031 | Client acceptance | Client | Accept/reject package |
| SCR-032 | Parties list | PM/proc | Directory |
| SCR-033 | Party detail | PM/proc | Contacts, projects, documents |
| SCR-034 | Supplier request (guest) | Supplier | Upload requested docs |
| SCR-035 | Consultant portal | Consultant | Assigned reviews |
| SCR-036 | Client portal | Client | Approved docs, packages |
| SCR-037 | Templates | Admin/PM | Trade/client/org templates |
| SCR-038 | Template editor | Admin | Requirements, rules, settings |
| SCR-039 | Config diff/upgrade | Admin | Apply template updates |
| SCR-040 | Members | Admin | Invite, roles, suspend |
| SCR-041 | Member detail | Admin | Scope, owned work, reassign |
| SCR-042 | Org settings | Owner/admin | Legal, branding, defaults |
| SCR-043 | Notification settings | All | Channels, digest, quiet hours |
| SCR-044 | Billing | Owner/billing | Plan, usage, invoices |
| SCR-045 | Checkout | Owner/billing | Razorpay hosted |
| SCR-046 | Audit log | Owner/admin/auditor | Filter/export |
| SCR-047 | Global search | All | Scoped results |
| SCR-048 | Notifications | All | In-app list |
| SCR-049 | Help / support | All | FAQ, WhatsApp, email |
| SCR-050 | Error / not found | All | Recover gracefully |
| SCR-051 | Admin: orgs | Platform admin | Support operations |
| SCR-052 | Admin: jobs | Platform admin | Retry/monitor |
| SCR-053 | Export center | Owner/admin | Data export |
| SCR-054 | Retention/legal hold | Owner/admin | Policy settings |
| SCR-055 | Bulk document import | PM/doc | ZIP + mapping spreadsheet, dry-run, per-file outcomes |
| SCR-056 | Reassign work | Admin | Bulk reassignment after a member leaves |
| SCR-057 | Package preview | PM/doc | Resolved item list and page estimate before generation |
| SCR-058 | Warranty register | PM/proc | Warranty registrations, basis conflicts, expiry |
| SCR-059 | Defect / snag tracker | PM/QC/site | Raise, assign, close defects; DLP status |

## 4. Key screens

### 4.1 SCR-002 — Sign up

**Fields:** full name, business email, mobile (optional but recommended), organisation name, trade (default HVAC), passwordless consent.

**Actions:** Send OTP / Send magic link; "Already have an account".

**Validation:**

- Name 2–80 characters.
- Email valid; mobile `+91` 10 digits if provided.
- Org name 2–120 characters.
- Terms/privacy checkbox required.

**States:**

- Empty: helpful examples ("Sharma HVAC Solutions").
- Loading: button spinner + "Sending code…".
- Error: inline field errors; rate-limit message with retry time.
- Success: OTP screen with masked identifier.

### 4.2 SCR-004 — Onboarding wizard

Four steps with progress and skip:

1. **Company** — legal name, display name, entity type, GSTIN (optional), state, logo (optional).
2. **Trade** — HVAC preselected; template preview with requirement count.
3. **First project** — name, code (auto-suggested), client name, target handover date.
4. **Invite team** — emails/phones, roles.

**Rules:** every step resumable; "Skip for now" allowed except company name; completion creates a sample project if the user skips project creation (with clear "demo" badge).

**Empty/loading:** skeleton for template preview; failure keeps entered data locally.

### 4.3 SCR-010 — Home dashboard

**Content:**

- Greeting + org name.
- KPI cards: Active projects, Missing documents, Awaiting my review, Expiring soon.
- "Needs attention" list: top 5 requirements by due date across projects.
- Recent activity (approved, rejected, uploaded).
- Quick actions: New project, Upload, Invite supplier.

**Empty state:** "No projects yet. Create your first project to see what documents are needed." CTA.

**Failure:** if metrics fail, show partial dashboard with retry per card; never a blank page.

### 4.4 SCR-013 — Project overview

**Header:** project name, code, client, status pill, handover date countdown.

**Progress:** approved / applicable, segmented bar by status (approved, in review, missing, waived).

**Sections:**

- Readiness checklist (top blockers).
- Asset coverage (assets with all mandatory docs vs not).
- Reviews awaiting action.
- Expiring certificates.
- Recent packages.
- Team.

**Actions:** Upload, Generate package, Invite supplier, Edit settings.

**States:**

- Draft: banner "This project is not active. Activate after selecting a checklist."
- Suspended: banner with reason and "Resume" for permitted users.
- Handover: banner "Handover in progress".
- Closed: read-only banner.

### 4.5 SCR-014 — Checklist

**Layout:** grouped accordion or table. Filters: status, owner, asset, mandatory, due. Search.

**Row:** requirement title, document type, asset tag, status pill, owner avatar, due date, evidence count, quick action (Upload/Review).

**Bulk actions:** assign owner, request from supplier, mark N/A (permission), export.

**Empty state:** if no requirements: "This checklist has no items. Add requirements or contact support."

**Performance:** virtualised list for 1,000 items; server-side filters.

### 4.6 SCR-015 — Requirement detail

**Content:** title, description, why it matters, mandatory badge, asset link, due date, owner, reviewer, validity rule, naming hint.

**Evidence list:** each document/version with status, uploader, date, reviewer, download.

**Review timeline:** submitted → comments → decision, with actor and timestamp.

**Actions:** Upload, Request from supplier, Submit for review, Waive/N/A (permission), Reassign, View history.

**Blocking messages:** "Add revision code and issue date before submitting." with direct field link.

### 4.7 SCR-016 — Checklist customiser

**Left:** template tree (groups/items). **Right:** item editor.

**Item fields:** title, description, document type, category, mandatory, evidence count, owner role, reviewer role, due offset, validity, naming pattern, applicability conditions, reuse policy.

**Top bar:** resolved preview, validation count, Save draft, Publish/Activate.

**Guardrails:** locked items show a lock icon with reason; removing an item used in an active project is blocked; limit warnings.

### 4.8 SCR-023 — Upload sheet (mobile-first)

**Flow:**

1. Big drop zone / "Take photo" / "Choose file".
2. Auto-detected type and suggested title.
3. Requirement/asset context chips (pre-filled if launched from requirement).
4. Metadata fields in progressive disclosure; only required fields visible.
5. Upload button with size and network hint.

**Validation messages:**

- "This file type isn't supported. Use PDF, JPG, PNG, DOCX, XLSX, DWG or ZIP."
- "This file is 142 MB. The limit is 100 MB."
- "This PDF is password-protected. Remove the password and try again."
- "A file with the same content already exists in this project. Use it instead?"

**States:** queued offline, uploading with percentage, paused, processing ("Checking file…"), failed with retry, duplicate warning, success with "Submit for review" next action.

**Critical:** never lose the selected file on a validation error **or on transient network loss**; keep it in memory/browser storage until the upload intent is created or the user explicitly cancels. Metadata entered is autosaved to `localStorage` per project and restored on reload.

### 4.9 SCR-025 — Document viewer / review

**Layout:** left preview (PDF.js), right panel (details, comments, decision).

**Toolbar:** page navigation, zoom, fit width, download (permission), full screen.

**Right panel:** requirement context, metadata, version selector, review comments (general/page), decision buttons.

**Decision modal (in-app):**

- Approve: optional comment.
- Request changes: comment required (min 10 chars), page comments optional.
- Reject: reason required, warning that it returns to uploader.

**Record external approval (second tab of the decision modal, `FR-REV-016`, `AUD-010`):**

- Decision: Approve / Request changes / Reject.
- Approver name (required) and role/organisation.
- Decision date (required, ≤ today).
- Method: `Stamped PDF` / `Email` / `Portal transmittal` / `Physical meeting` (required).
- Reference (transmittal no., email subject, minute reference).
- Evidence file upload (required for Stamped PDF and Email).
- Confirmation: this records an approval obtained outside TradeCloseout and will be labelled `Approved (external)` in the handover package.


**States:** preview loading skeleton; unsupported preview → "Download to view"; scanned PDF with no text → still viewable; corrupt file → error with support reference.

### 4.10 SCR-028 — Package builder

**Steps:**

1. Scope: whole project / asset category / selected assets / selected requirements / partial handover.
1b. **Preview (`SCR-057`, `FR-HND-020`):** resolved item list grouped by section, with per-item status (approved / external / waived / missing / expired), estimated page count and total size. The user can exclude items here with a reason.
2. Readiness: blocking missing items with links; warnings for expiring; "Generate anyway" requires reason.
3. Layout: choose template, reorder sections, include/exclude waivers and drafts.
4. Review summary: document count, estimated pages, file size.
5. Generate.

**During generation:** progress stages (validating, rendering index, merging documents, packaging), cancel, safe-to-leave message.

**Failure:** item-level list of failures, retry, download partial diagnostic (admin only).

### 4.11 SCR-031 — Client acceptance

**Guest screen:** package summary, document list with statuses, download, decision:

- Accept (with optional remarks).
- Accept with exceptions (remarks required).
- Reject (reason required, structured category: missing document, wrong revision, quality, other).

**Exceptions create follow-up items (`AUD-P-16`):** each exception is written back as a requirement change request so nothing is lost after the call.

**Confirmation:** "This decision will be recorded with your name and timestamp."

### 4.12 SCR-034 — Supplier request (guest)

**Content:** contractor name, project, request list (title, description, deadline), upload area per item or bulk.
**Scope rule (`AUD-P-15`):** the page shows **only** the requirements assigned to this link. If a supplier is assigned requirements across several projects, each link is scoped to one project and one request batch; a supplier dashboard is **not** provided in MVP.

**No login** in the simplest link mode; OTP if the contractor enabled verification.

**Upload:** metadata fields limited to revision/date/remarks; camera support.

**After upload:** "Uploaded. Sharma HVAC will review it." Status visible for 30 days via the same link.

**Failure:** expired link → "Ask Sharma HVAC for a new link" with contact; wrong file → replace before final submit.

### 4.13 SCR-040 — Members

**Table:** name, role, projects, status, last active. **Actions:** invite, change role, suspend, remove, reassign work.

**Guardrails:** cannot remove the last owner; removing a member with open reviews prompts reassignment.

### 4.14 SCR-044 — Billing

**Content:** plan, renewal date, usage (active projects, seats, storage), invoices, payment method, cancel.

**Rules:** show GST breakdown; show limits before upgrade; cancellation explains data retention and export.

## 5. Cross-cutting UI behaviour

### 5.1 Status colours and labels

| Status | Colour | Label |
|---|---|---|
| NOT_STARTED | Grey | Not started |
| REQUESTED | Blue | Requested |
| UPLOADED | Indigo | Uploaded |
| IN_REVIEW | Amber | Waiting for review |
| CHANGES_REQUESTED | Orange | Changes requested |
| REJECTED | Red | Rejected |
| APPROVED | Green | Approved |
| WAIVED | Purple | Waived |
| NOT_APPLICABLE | Grey | Not applicable |
| EXPIRED | Red outline | Expired |
| MISSING (derived) | Red | Missing |

Never rely on colour alone; include icon + text.

### 5.2 Empty states

| Screen | Message | CTA |
|---|---|---|
| Projects | "No projects yet. Your first checklist takes about 10 minutes." | Create project |
| Checklist | "No requirements in this view." | Clear filters / Add requirement |
| Assets | "No equipment registered. Import from Excel or add one." | Import / Add asset |
| Documents | "No documents match these filters." | Clear filters / Upload |
| Reviews | "Nothing waiting for you. Nice." | Back to dashboard |
| Packages | "No handover package generated yet." | Generate package |
| Search | "No results for 'chiller'." | Clear / Search documents |

### 5.3 Loading states

- Skeletons for tables/cards, not spinners on full pages.
- Buttons show progress and disable duplicates.
- Long jobs (package) show staged progress and allow navigation away.
- Never show a blank white screen; use layout skeletons.

### 5.4 Error states

- Inline field errors with specific fixes.
- Page-level error with `requestId` and "Try again".
- Offline banner: "You're offline. Uploads will resume when you reconnect." (queued uploads only if implemented; otherwise block with clear message.)
- Permission error: "You don't have access to this project. Ask your admin."
- Expired session: modal re-login, preserve unsaved form.

### 5.5 Forms

- Labels above fields, required marked with text.
- Inline help for GSTIN/revision/naming.
- Autosave drafts where safe (project setup, metadata), with "Saved" indicator.
- No loss of data on validation failure.
- Indian phone input with `+91` prefix fixed; date input `DD MMM YYYY` display.

### 5.6 Tables

- Sticky header, row actions menu, bulk selection.
- Column chooser on desktop; card layout on mobile.
- Pagination/infinite scroll with count.
- Export respects filters and permissions.

## 6. Mobile and low-bandwidth

| Concern | Requirement |
|---|---|
| Upload | Camera capture, compression for images (optional), resumable, background tab tolerated |
| Preview | Lazy load, page-by-page rendering, max 2 MB thumbnails |
| Navigation | Bottom nav, one-hand reach, 44 px targets |
| Forms | Minimal typing, selects over free text, remember recent values |
| Offline | Clear offline detection. **MVP does not support offline work**; uploads and edits require connectivity. Selected files and entered metadata survive transient network loss within a session. |
| Language | English MVP; strings externalised; Hindi V1 |
| Performance | Initial JS <250 KB gzipped on core routes; images lazy |

## 7. Accessibility

- WCAG 2.1 AA target.
- Keyboard navigation for all actions; visible focus.
- Screen-reader labels for icons and status pills.
- Contrast ≥4.5:1 for text.
- Forms with programmatic labels and error associations.
- PDF preview has an accessible alternative (download link, page count).
- No time-limited modals except OTP with generous expiry.
- Respect `prefers-reduced-motion`.

## 8. Persona journeys

### 8.1 Owner (Rajesh, 52, Pune)

Logs in weekly on desktop. Wants: total missing count, which project is at risk, billing. Journey: dashboard → project overview → calls PM → checks package status. Needs large text, clear numbers, no jargon.

### 8.2 Project manager (Meera, 34)

Daily desktop + mobile. Creates project, customises checklist, assigns, chases suppliers, reviews internally, generates packages. Needs bulk actions, filters, export.

### 8.3 Site engineer (Amit, 26)

Mobile only, on site, gloves, sunlight. Uploads a test report photo, scans an asset tag, submits. Needs 3 taps, camera, offline tolerance, no metadata burden (defaults).

### 8.4 Document controller (Fatima, 29)

Desktop, manages registers. Needs import/export, naming rules, transmittals, audit, package layout.

### 8.5 Supplier (Vendor clerk, low tech)

Receives WhatsApp link, opens on phone, uploads warranty PDF. Needs no account, no jargon, single purpose, confirmation.

### 8.6 Consultant (External, 40s)

Receives review link, reviews 10 documents, comments, approves. Needs preview quality, page comments, clear decision, audit confidence.

## 9. Screen acceptance criteria (examples)

| Screen | Criterion |
|---|---|
| SCR-023 Upload | A user can go from project home to uploaded file in ≤3 taps when launched from a requirement; required metadata never exceeds 3 fields before upload |
| SCR-014 Checklist | 1,000 requirements render in <2 s p95 with filters applied server-side |
| SCR-025 Viewer | PDF first page visible in <3 s on 4G for a 10 MB file |
| SCR-028 Package | User can see blocking items before generation and resolve them via links |
| SCR-034 Supplier | A first-time supplier can upload without creating an account |
| SCR-031 Client | Decision requires explicit confirmation and records name/time |
| SCR-055 Bulk import | A 240-document ZIP with a mapping spreadsheet produces a dry-run report and imports with per-file outcomes in <10 minutes |
| SCR-056 Reassign work | Admin can reassign all open work of a departing member in one operation |
| SCR-057 Package preview | Preview lists every item with status and page estimate before generation |
| SCR-027 External approval | Recording an external approval requires approver name, date, method and evidence; the package shows `Approved (external)` |

## 10. Content and microcopy rules

- Use "document" not "artifact"; "equipment" not "asset" in user-facing text (asset is internal).
- Use "waiting for review" rather than "in review".
- Avoid "configuration", "snapshot", "tenant" in customer UI.
- Errors say what happened, why, and what to do next.
- Dates: `31 Oct 2026`; relative dates for recent activity ("2 hours ago").
- Currency: `₹1,25,000` (Indian grouping).
- Do not use all caps except status codes internally.

## 11. Open UX questions

- Should supplier upload links require OTP by default? (Security vs friction; `Q-004`.)
- Should the client portal show individual document statuses or only the package?
- How much checklist editing should a site engineer be allowed?
- Is a WhatsApp-first interface (chatbot) needed for suppliers, or is a link enough?
- Should package generation allow including drafts with a warning, or block entirely?

## 12. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial UI/UX specification |
| 0.2 | 2026-10-31 | Remediation: SCR-055–059, external-approval form, draft persistence, supplier scope rules, exception follow-ups, explicit offline limitation |
