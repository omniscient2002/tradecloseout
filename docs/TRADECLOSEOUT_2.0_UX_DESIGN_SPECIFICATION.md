# TradeCloseout 2.0 — UX Design Specification

**Status:** Discovery/design only; no application source changes  
**Date:** 4 November 2026  
**Experience goal:** A dense, trustworthy engineering workspace that makes the next action obvious and never manufactures certainty

## 1. Experience diagnosis

The current UI has useful project tabs, a document review concept, mobile upload intentions and guest views. It is not yet a dependable operating system for a contractor because:

- Some dashboard controls show success without a server operation.
- Hardcoded personas, organisation details and static metrics compete with real project state.
- Role dashboards are long, separate presentations rather than one task-oriented work queue.
- Users see many statuses but not always the current actor, blocker or next action.
- The project is organised around data entities, while frequent work spans requirements, equipment, documents and commercial milestones.
- Mobile/offline state language is too optimistic; an API response can be mistaken for verified evidence.
- The review layout is desktop-fixed and does not translate well to a field device.
- Modal accessibility and keyboard/focus behaviour need systematic treatment.

The redesign should not add visual polish over these problems. It should change the product from a portfolio demo into a work system.

## 2. Navigation architecture

### 2.1 Company-level desktop

```text
Top bar, 56px
[TradeCloseout] [Organisation switcher] [Global search] [Help] [Notifications] [Profile]

Left navigation, 232px collapsible
  Inbox
  Projects
  Reviews
  Suppliers & parties
  Reports
  ─────────────
  Team
  Organisation settings
```

- **Inbox is the default home**, not a generic dashboard.
- “Billing” lives inside organisation settings for authorised users.
- Global search opens a permission-filtered command/search panel, not an AI chat by default.
- Navigation labels use customer language; `Assets` becomes `Equipment`, `Packages` becomes `Handover`, `Checklist` becomes `Requirements`.

### 2.2 Project desktop

```text
Breadcrumb: Projects / HYD-BIO-09
Header: code, project name, client, stage, target handover, primary next action

Secondary navigation:
Overview | Requirements | Equipment | Documents | Inspections & Cx
Reviews | Suppliers | Handover | Defects & warranties | Commercial | Activity
Settings is a permission-gated action, not another always-visible content tab.
```

Secondary navigation scrolls horizontally only when unavoidable; prioritise Overview, Requirements, Equipment, Reviews and Handover for small laptop widths. Deep links preserve tab, filter and selection.

### 2.3 Mobile contractor

```text
Bottom navigation:
Inbox | Projects | [Capture] | Reviews | More
```

- Capture asks for project only when context is unknown; it never invents a default project.
- More contains equipment, suppliers, defects, handover and settings allowed by role.
- Project detail shows current action and a compact section menu rather than ten full tabs.
- Do not put commercial controls on a site engineer's mobile home.

### 2.4 External participants

Supplier: contractor identity → request list → upload/correction → processing/confirmation. No project browser or org switcher.

Consultant: assigned review/package only, with preview, comments and decision. Client: package index, artefacts and recipient-specific acceptance. All external views say **External access** and show only intended resources.

## 3. Design system

### 3.1 Visual principles

- Professional engineering utility, not a generic “AI dashboard.”
- One primary action per region; secondary actions remain quiet.
- Borders, spacing and alignment create hierarchy before cards or shadows.
- Tables and structured lists dominate operational views; cards are for actual independent objects such as equipment or projects, not every metric.
- No decorative gradients, floating blobs, pulse animations or unexplained chart junk.
- Status is always text/icon + colour, never colour alone.
- Original evidence and derived previews are visibly different.

### 3.2 Colour tokens

Exact contrast must be verified with automated and manual tests before release.

| Token | Suggested value | Usage |
|---|---|---|
| `canvas` | `#F8FAFC` | Application background |
| `surface` | `#FFFFFF` | Main content and panels |
| `surface-subtle` | `#F1F5F9` | Table headers, selected filter groups |
| `border` | `#D9E2EC` | Dividers and input borders |
| `text-primary` | `#0F172A` | Primary content |
| `text-secondary` | `#475569` | Metadata and secondary labels |
| `text-muted` | `#64748B` | Non-essential metadata; not tiny low-contrast body text |
| `brand-900` | `#0F2942` | Navigation identity, primary buttons |
| `brand-700` | `#1D4E79` | Links and interactive emphasis |
| `accent-700` | `#0F766E` | Positive action accents, not generic success |
| `success-800` | `#166534` | Verified/approved/accepted with label |
| `warning-900` | `#92400E` | Waiting/expiring/attention |
| `danger-700` | `#B91C1C` | Failed/rejected/expired/destructive |
| `info-700` | `#1D4ED8` | Processing/information |
| `focus` | `#2563EB` | Visible focus ring, 2px plus offset |

Use a dark canvas only for the document-viewing stage, not for the whole application. Red is reserved for genuine failures/risk, not ordinary “open” work.

### 3.3 Typography and numbers

- UI font: self-hosted Inter Variable if added as a free asset, otherwise `system-ui, -apple-system, Segoe UI, sans-serif`.
- Monospace: `ui-monospace, SFMono-Regular, Consolas, monospace` for IDs, revisions, hashes and numeric ledger values.
- Page title: 20–24px/1.25, weight 650.
- Section title: 14–16px/1.35, weight 600.
- Body/table: 14px/1.45; compact secondary text 12–13px, not 10px for meaningful content.
- Field labels: 13px/1.3, weight 550.
- Large KPI values: 24–28px only when genuinely actionable.
- Dates: `04 Nov 2026`, explicit time zone where needed; relative age also show exact timestamp on detail/hover.
- Money: Indian digit grouping, exact paise detail in ledger; rounded display must say approximate where applicable.
- Hashes: truncated visually with copy action and full accessible value.

### 3.4 Spacing, layout and elevation

Use a 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48.

- Page content max width: 1440px; fluid wide registers may use available width with 24px margins.
- Form reading width: 640–760px.
- Desktop table header: 40px; data row 44–52px.
- Mobile interactive target: minimum 44×44 CSS px.
- Panel border: 1px; radius 8px; dialogs 12px.
- Shadows only for floating overlays/menus; operational panels use borders.
- Sticky table headers and bottom decision bars must not obscure focused content.

### 3.5 Core components

#### Tables and registers

- Title and result count first, filters second, primary batch action last.
- Server-driven sorting/filtering/pagination for large datasets.
- Column customisation is optional, not setup homework.
- Row click opens detail; explicit buttons for actions avoid ambiguous whole-row multiple actions.
- Selection appears only where a valid batch action exists. Bulk approvals must run all invariants per item and report individual outcomes.
- Mobile converts each row to a structured record with key fields and one primary action; optional columns are available in detail, not silently lost.

#### Filters and search

- Search input with accessible label and debounce; filter chips show active values.
- URL stores query/filter/sort/cursor where appropriate.
- Saved views only after default views prove useful: `My actions`, `Awaiting QC`, `Supplier overdue`, `Expiring evidence`, `Handover blockers`.
- Empty filtered state says which filters exclude results and offers Reset.

#### Forms

- Labels above fields; helper/error text associated using `aria-describedby`.
- Required metadata shown before optional details; do not expose every database field.
- Numeric readings include unit and valid range adjacent, not hidden in another page.
- Draft saves preserve non-sensitive form metadata; never persist session/CSRF/bearer tokens.
- Submission buttons describe the result: `Submit for review`, `Generate package`, `Record external approval`.
- Server errors map to fields and preserve files/form state.

#### Dialogs and side panels

- Dialogs for short decisions only; complex revision history/review uses a page or wide side panel.
- `role=dialog`, accessible title, focus trap, initial focus, Escape and focus restoration.
- Backdrop click does not discard unsaved work without confirmation.
- On mobile, use a full-height sheet with safe-area insets and visible close action.
- Destructive actions state exact consequence; waiver/revocation requires reason and, where needed, a second approver.

#### Status indicators

Use a controlled vocabulary and explanatory second line:

| Display | Required meaning |
|---|---|
| Upload pending | Bytes not complete; not evidence yet |
| Security checks pending | Stored, but cannot review/download |
| Ready for review | Server verification passed |
| In review | Current reviewer and waiting age shown |
| Changes required | Uploader action and unresolved comments shown |
| Approved | Exact version approved by named human/authority |
| Approved (external) | External method/reference/evidence shown |
| Expired | Satisfaction validity ended; replacement needed |
| Waived / Not applicable | Authorised decision and reason visible |
| Package generating | Not a handover or acceptance |
| Awaiting recipient | Named recipient and submission date shown |
| Accepted with exceptions | Exceptions and current owners shown |

#### Notifications

- Inline success/error near the action, with next step.
- Toast only for non-critical background events; no disappearing confirmation as sole proof.
- Offline/server status is a persistent banner where it affects work.
- Validation errors are not generic “Something went wrong.” Include actionable detail and safe correlation ID.

#### Charts

Charts are secondary to registers. Use:

- Small status distribution for requirement readiness with click-through filters.
- Trend of satisfied requirements over time only when the underlying data is valid.
- Commercial waterfall only for actual RA/deduction/release records, with paise-exact table alternative.
- No doughnut gauges or meaningless “health score” without a documented formula.

### 3.6 Motion

- Default transitions 100–160ms for hover/menu/sheet; no entrance choreography.
- Respect `prefers-reduced-motion`; remove scale/parallax/pulse effects.
- Skeletons only for unresolved data, never as decorative permanent placeholders.
- No automatic background video, carousel or animated metrics.

## 4. Role-specific experiences

### Owner / projects head

First view: exceptions and commercial risk. Required information: projects needing intervention, pending mandatory waivers, acceptance age, actual instalments due. Do not show fake “100% validated” metrics or daily equipment metadata.

### PM

First view: inbox grouped by actor and urgency. Project overview opens with blockers and next action, then readiness, current reviews, supplier ageing and handover/commercial milestones. One-click export of the coordination register.

### QC / commissioning

First view: assigned reviews, failed/expiring instrument checks, inspections requiring witnesses, returned defects and due dates. Review workbench prioritises evidence, comments and decision over general project analytics.

### Site

First view: today's assigned captures/inspections and offline outbox. Search/scan equipment, take photo/record reading, save draft. No organisation-wide financial or administrative navigation.

### Document controller

First view: revision anomalies, metadata incomplete, unlinked evidence, pending submissions and exports. Dense tables, batch metadata edit and source register download are primary.

### Procurement

First view: supplier requests by due/age, OEM submissions awaiting screening and warranty gaps. Share a request via WhatsApp deep link; never claim a message was sent unless provider confirms it.

### Accounts / commercial

First view: milestone readiness and actual commercial events, not technical cards. Technical blockers link to exact requirements. Paise ledger and downloadable reconciliation are primary.

### Supplier / consultant / client

Each receives a single-purpose page with contractor identity, only granted resources, clear due/action and simple upload/review/acceptance. No persona dock, admin navigation or internal notes.

## 5. Screen redesign requirements

The product specification defines the full data/API dependencies. This section defines the interaction and visual hierarchy that implementation must follow.

### 5.1 C01 — Work Inbox

**Purpose:** Replace multiple hardcoded role dashboards with one authoritative action queue.

**Hierarchy:**

1. `Overdue` and `Due today`.
2. `Awaiting my action` grouped by type: reviews, uploads, supplier screening, waivers, inspections, exceptions.
3. `Waiting on others`, with current party and age.
4. `Recently completed`, collapsed by default.

**Row:** urgency icon, requirement/equipment, project, next action, current actor, waiting age, due date, blocker and one action button.

**Actions:** Open, reassign where permitted, send reminder, save filter. Bulk assignment must not bypass per-item checks.

**States:** No assignments is a useful “No open actions” state, not zero fake KPIs. Partial query failure identifies failed queue types. Mobile uses segmented `Mine / Waiting / Completed` and one action per row.

### 5.2 C02/C03 — Portfolio and management overview

**Purpose:** Find projects needing intervention, not admire metrics.

Use a sortable project register with handover target, unresolved blockers, current actor, accepted/applicable counts and actual commercial exceptions. Management adds waiver and retention-release queues only when backed by data.

Empty organisation starts with `Create project` and `Import existing closeout`; sample data is explicitly marked demo and cannot appear as live. Mobile shows ranked projects with a short reason for risk.

### 5.3 C04/C05 — Projects and parties

Project directory supports code/client/PM/status filters. Supplier directory separates party identity from grants; a contact is not an active grant. Show obligations and last submission rather than static supplier examples.

Creating a supplier link requires a preview of scope, requirements, expiry and verification policy. The share sheet offers copy link and WhatsApp deep link; it does not say “sent.”

### 5.4 C06/C07/C08 — Reports, team and organisation

Reports show export status/history and actual row scopes. Team offboarding opens a gap report before reassignment. Organisation settings show legal/billing details only to authorised roles and never hardcoded tenant identity.

### 5.5 P01 — Project Overview

**Above the fold:** project identity/stage/date + top three blockers + primary next action.

**Below:** readiness grouped by requirement state, equipment with incomplete mandatory work, reviews/supplier waiting, latest handover/submission, commercial milestone blockers and recent activity.

Avoid four disconnected KPI cards. Each readiness number links to its underlying register. Draft/suspended/closed banners explain writes allowed. Lifecycle actions require guards; `Close project` is never offered merely because stage says HANDOVER.

### 5.6 P02 — Contract & Milestones

Show contract baseline and approved variations side-by-side, milestone evidence mapping and warranty/retention terms. Commercial fields are hidden from guests and restricted roles. Variation creation is a controlled form with effective date/reference/impact, not an instant “APPROVED” default.

### 5.7 P03/P04 — Requirement Register and Detail

**Register columns:** requirement/type, equipment/system, owner, evidence/review state, current actor, due, mandatory. Group by milestone or system rather than arbitrary cards.

**Detail order:**

1. Current required action and satisfaction.
2. Applicability, owner/reviewer/due/validity.
3. Current exact evidence version and review history.
4. Other versions/supporting evidence.
5. Inspection links and commercial dependencies.
6. Full change history.

Upload/link/request/supplier actions are contextual. Waiver/N/A is in a guarded secondary menu, not equal in prominence to Upload.

### 5.8 P05/P06 — Equipment Register and Passport

Register shows tag + serial + readiness, with scanning on mobile. Passport header shows tag, make/model/serial/location and current stage. Lifecycle sections are chronological and source-linked, not static narrative cards.

A missing stage says exactly what is missing and gives an allowed action: `Add MIR`, `Start commissioning test`, `Register warranty`. QR opens the passport, never an unrestricted document download. Replacement lineage preserves the old passport.

### 5.9 P07/P08/P09 — Document Centre and Review

Document centre distinguishes `Latest` and `Current approved` columns. Filters include verification state, review state, requirement, equipment and external approval.

Review desktop:

```text
Top: back, document/version, requirement/equipment, download permission
Left, flexible: original/sanitised PDF preview with page tools
Right, 400px: current action → metadata → comments/resolution → versions/history
Bottom right: decision controls appropriate to role/state
```

- Preview labels `ORIGINAL`, `SANITISED PREVIEW`, or `DERIVED IMAGE`.
- Comparison selects two versions and reports page/text differences with citations; never asserts contractual equivalence automatically.
- Comments include page/pin, visibility, assignee and resolved state. Internal comments cannot leak to guests.
- Decision buttons are hidden/disabled for ineligible state; explanatory text remains.
- External approval is a separate form and never labelled in-app DSC.
- Mobile preview is full-screen; details/comments/decision open as bottom sheets. No fixed 420px sidebar.

### 5.10 P10/X01 — Supplier Requests and Guest Upload

Contractor sees requests/grants/screening. Supplier sees only assigned requirements with due dates and clear per-item upload. The flow:

1. Verify link/PIN/OTP if configured.
2. Select requirement and original file/photo.
3. Show size/type and optional compression preview without deleting original.
4. Save offline safely if necessary.
5. Show `Uploading`, `Security checks pending`, `Contractor screening`, `Needs correction`, `Accepted`.
6. Provide receipt/reference and support contact.

Never show success on enqueue. Expired links and revoked grants are explicit and contain no project data beyond safe recovery text.

### 5.11 P11 — Inspection & Commissioning

Mobile form prioritises actual test date/time, equipment, instrument and readings. Each item has required unit/range/evidence. Add photo/voice note without treating speech transcription as approved fact until confirmed.

Offline:

- Draft is stored on device with operation UUID and timestamp.
- User sees `Saved on this device`, not `Uploaded`.
- Reconnection syncs once using idempotency key.
- Conflicts show server and device values; no silent last-write-wins.
- Calibration failure includes the instrument and actual test date.

### 5.12 P12 — Defects & Warranties

Defect list separates `Open`, `Rectification submitted`, `Verified` and `Waived`. Closure requires evidence and QC verification, not just an uploaded photo. Warranty passport shows contractual basis, OEM basis and conflicts in plain language.

### 5.13 P13/P14/X03 — Handover and Acceptance

Builder is a four-step guided flow:

1. Scope/milestone.
2. Blockers/readiness.
3. Exact item/version preview and exceptions.
4. Generate/status/download/submit.

Blocker rows link directly to resolution. `Generate anyway` is a permissioned override requiring reason and prominent inclusion in the manifest.

Package detail distinguishes generated PDF/ZIP/manifest and acceptance. Recipient decisions use `Accept`, `Accept with exceptions`, `Reject`; exception text is required and creates assigned follow-up work. Client gets a downloadable receipt after decision.

### 5.14 P15 — Commercial Closeout

Lead with milestone readiness table, then actual RA/retention ledger. Every amount carries a status: `Estimated`, `Certified`, `Withheld`, `Released`, `Received` or `Adjusted`. No green `Retention released` label without a dated actual event/reference.

### 5.15 P16/P17 — Activity and Settings

Timeline groups related events rather than displaying raw JSON. Users can inspect actor, timestamp, version and correlation without needing database vocabulary. Settings use versioned forms and a readable diff before apply; no silent current-template mutation.

## 6. Mobile, offline and regional-language UX

### 6.1 Field-first design

- Search or scan QR to identify equipment; QR contains an opaque asset reference, not a public object key.
- Keep capture under a small number of deliberate steps, while preserving required metadata and verification.
- Allow camera, file, photo and voice-note capture; voice transcription is a suggestion confirmed by the user.
- Display storage usage and allow cleanup after server verification, not merely upload enqueue.
- Shared-device sign-out clears cached metadata/drafts according to policy; never expose previous user's offline files to another account.

### 6.2 Offline state machine in UI

```text
Saved on this device
→ Uploading / paused
→ Stored; security checks pending
→ Ready for review
→ Submitted for review
→ In review
→ Approved / Changes required
```

Each state has next action, error/retry and last successful server contact. Never show “All offline captures uploaded” without a server reconciliation.

### 6.3 Language and readability

- English first with externalised labels, dates, units and error messages.
- Hindi should be added only after field-user testing; other regional languages follow evidence.
- Do not translate source evidence or contractual terminology automatically without preserving original text.
- Use plain action labels: `Upload evidence`, `Submit for review`, `Record external approval`, not unexplained acronyms.
- Technical terms include inline explanations where necessary (`RA bill`, `DLP`, `N/A`, `FAT`, `ITP`).

## 7. Accessibility requirements

Target **WCAG 2.2 AA**, to be tested rather than claimed achieved.

- Complete keyboard workflows, visible focus and no keyboard traps.
- Accessible names, roles, labels and state announcements.
- Focus management in dialogs, sheets, filters, PDF controls and tables.
- Text contrast at least 4.5:1 for normal text, 3:1 for large text and meaningful UI boundaries.
- 200% zoom/reflow without loss of task functionality; 400% where practical for content views.
- Touch targets 44px and adequate spacing to prevent accidental approvals.
- Status includes text/icon, not colour alone.
- Accessible validation summaries and field associations.
- Captions/transcripts for voice notes; user confirms transcript before saving as metadata.
- Reduced-motion support and no time-limited actions without warning/extension.
- PDF preview alternative: document metadata and download when browser cannot render content.

## 8. UX instrumentation and validation

Instrument intent and outcome without recording sensitive file contents:

- Checklist import started/previewed/applied/correction count.
- Requirement action opened/completed and current actor age.
- Supplier link opened, verification abandoned, upload result and support requests.
- Offline saved, sync attempted, server verified and conflict resolved.
- Review opened, comments added/resolved and decision result.
- Handover blocker resolved, package generated/downloaded/submitted/accepted.
- Time-on-task and assistance contacts by role, without invasive session replay of confidential documents.

### Usability test tasks

1. Import a real consultant checklist and resolve three ambiguous rows.
2. Find all evidence missing for one chiller and assign the next action.
3. Upload a supplier document on a mid-range Android device with interrupted connectivity.
4. Identify which revision was approved and why a newer upload is not yet approved.
5. Complete an inspection with an expired instrument and explain the block.
6. Generate a partial handover and convert two client exceptions into owned work.
7. Explain the difference between technical milestone readiness and actual retention receipt.

Record completion, errors, assistance, time and participant interpretation. Iterate before large-scale UI implementation.

## 9. UX acceptance gates

- No production hardcoded personas, fake KPI values or local-only success actions.
- All frequent tasks have an identified actor, action, state and next step.
- Upload/review/package states accurately match backend state and failure behaviour.
- Desktop review and mobile capture pass keyboard, screen-reader, zoom and touch checks.
- Core registers remain usable on small laptop and mid-range Android widths.
- No internal notes/commercials appear in external projections.
- A real PM, site user, supplier and consultant can complete their respective tasks without training beyond the agreed pilot onboarding.
