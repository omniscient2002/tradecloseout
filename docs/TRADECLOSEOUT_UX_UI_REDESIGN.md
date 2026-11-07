# Workflow and interface redesign

## UX diagnosis and target

Current pages expose many controls but do not consistently explain the next responsible action or the difference between file processing, review and requirement state. Several upload/modals and demo views duplicate behaviours. A large project page couples domain concerns and increases inconsistency. This review is source based; existing screenshot assets were inventoried but not visually inspected, and no browser usability study was executed. The following is an implementable design proposal, not a validated usability result.

Every work surface should answer: what is required, for which scope, who owes the next action, when is it due, which exact revision is being assessed, and what blocks completion. Use plain product language; hide catalogue codes and technical processing details behind metadata disclosure unless users need them.

## Information architecture

Global sidebar: **Work Inbox, Projects, Suppliers, Reports**. Bottom: organisation switcher, help, profile. Settings and security visible only to authorised users. Commercial SaaS subscription billing belongs in organisation settings, separate from project commercial readiness.

Project navigation: **Overview, Requirements, Equipment, Evidence, Reviews & Submissions, Handover, Commercial readiness**. Add **Quality** and **Aftercare** only when enabled and complete. Show project title/code, client, active scope baseline and project status in persistent header. A project picker retains filter context only within an authorised actor/tenant.

Desktop: 240px sidebar; content header 64px; 24px content gutters; 12-column fluid grid; operational tables use full content width. Tablet: collapsed 64px rail, detail drawers become full-height sheets. Mobile under 768px: project header, four bottom destinations Inbox/Project/Capture/More, single-column cards and full-screen task details. Review PDF can open separately on small screens while retaining the decision draft.

## Role journeys

| Role | Start page | Main action sequence | Essential guardrails |
|---|---|---|---|
| Owner | Portfolio exceptions | Open blockers → project → accountable owner → milestone prerequisites | Avoid unsupported financial entitlement or ready percentages |
| PM | Project inbox | Resolve assignment/dependency → review exception → issue submission | Explicit authority for waivers and acceptance |
| Site | My actions | Select/scan equipment → requirement → capture original → sync status | Large targets, visible offline queue, no success until server confirms relevant state |
| QC | Assigned reviews/quality | Confirm scope/version → inspect evidence/readings → comment/decide | Stage assignment, self-approval prohibition, visible instrument validity |
| DC | Requirements/evidence | Import baseline → request supplier docs → map version → issue transmittal → reconcile return | Bulk work with row outcomes and reusable filters |
| Procurement | Supplier obligations | PO documentary schedule → due follow-up → receive → contractor QC intake | Generic versus serial-specific evidence and explicit supplier scope |
| Supplier | Restricted requested list | Confirm request → upload per requested item → view receipt → respond to clarification | No tenant navigation, peer supplier data or technical approval actions |
| Consultant | Assigned submitted revision | Open numbered submission → compare → return comments/response | No generic latest-file substitution; response identity/time recorded |
| Client/FM | Handover acceptance | Inspect frozen package → record scoped acceptance/exceptions → export passport | Downloaded/seen is distinct from accepted |

## Screen specifications

### S01 Work Inbox

Header includes My actions / My team / Waiting on others and project filter. Summary counts are actionable filters, not ornamental dashboard tiles. Table columns: action, project, requirement/equipment, exact revision, responsible party/person, due date, age, blocker and primary action. Sort overdue before due soon with stable pagination. Each row opens right detail panel with evidence and timeline; primary action deep-links to correct domain screen. Marking notification read never completes a work item. Waiting-on-external shows last issued date and response due, with follow-up draft and recent delivery status. PM can reassign with reason; no silent task deletion.

Empty state distinguishes no work from no assigned projects, permission restriction and service failure. Failed query shows Retry and last-success timestamp; never show zero blockers on failure.

### S02 Project overview

Top: readiness by named stage, evaluated-at time and baseline, next milestone and unresolved exceptions. Left: blockers grouped by responsible party and scope; right: issued submissions awaiting response. Lower sections: equipment identity changes requiring evidence review, missing supplier docs and recent decisions. Readiness numerator/denominator count requirement revisions once; excluded, waived, not applicable and unknown have separate counts. Open evidence dependency drawer from any metric. Owner amount cards visible only with commercial permission; site users see actionable documentary counts.

### S03 Requirements register and detail

Columns: requirement/reference, scope/system/location, responsible actor, required evidence slots, accepted revision, pending revision, reviewer/current ball-in-court, due date, satisfaction, blocker. Save views by phase, document type, supplier, milestone and overdue. Virtualisation may supplement server pagination; it never justifies fetching the entire project. Bulk assign/request/change due date supports a preview and per-row outcomes, up to 100 rows per command.

Detail drawer sections: requirement/source clause; applicability and rule revision; evidence slots; review stage/authority; history and dependencies. Show Accepted R1 and Pending R2 separately. Attach evidence offers existing exact version or upload new version, requires scope match, and displays whether document is generic or equipment-specific. Satisfaction panel lists each missing/qualified slot and source decision. Upload does not make the requirement green.

Import wizard: choose existing CSV/XLSX → map headings → preview rows and duplicate identities → validate required fields/unknown types → choose merge versus new baseline → impact summary → confirm revision. Invalid rows display original row number, column, reason and correction guidance. Never overwrite requirements with decisions without explicit amendment review. Draft import is resumable, committed once and auditable.

### S04 Evidence library and upload

Document table separates document number/title from revision, observed file state and review state. Detail opens original/preview switch, version timeline, qualified requirement links, equipment identity, digest and upload provenance. Historical original downloadable only with permission; unsafe original blocked. Preview derived from sanitisation is labelled a derivative.

Upload sheet steps: choose scope → file → revision/issue/expiry and optional metadata → review associations → upload → processing receipt. Show byte progress separate from verification status. States: Draft locally saved, Waiting for connection, Uploading 3 of 8, Upload received/verification pending, Ready for review, Needs correction, Quarantined. Provide cancel/resume/retry semantics according to server lifecycle. Never fabricate ETags or success IDs. Duplicate revision offers open existing version or resume own intent; do not silently create another document.

### S05 Equipment passport

Header: tag, asset identity revision, name, system/location, make/model/serial. Tabs: Evidence, Installation & tests, Warranty, Identity history. Evidence groups: approved datasheet, supplier tests, installed inspection, commissioning, O&M, warranty, as-built reference. Each item shows exact version and applicable asset identity. Replacement opens guided change with effective date/reason, old/new identity, warranty impact and revalidation tasks. Reused tag does not imply same physical unit. QR opens authenticated passport; public view must be explicitly published and redacted. Batch label print includes tag plus project code so a moved label is detectable.

### S06 Review workspace

Three panels on wide screens: submission list 240px, PDF/viewer flexible, decision/comments 360px. Header pins document number, revision, submitted scope, stage, reviewer assignment, current response state and concurrency version. Main buttons: Approve, Approve with notes where configured, Request changes, Reject. Comments use page and normalized coordinates and remain bound to version; internal/external visibility explicit. Decisions requiring remedy need a meaningful comment, at least 10 trimmed characters. Unresolved required conditions appear beside approval action. On stale data show changes and require reload/reconfirmation; never silently retry a decision with a new version.

External response form records authority party/person, role, response date/precision, response code, reference, original proof version and internal recorder. It says Recorded external response, not In-app approval. Stamp-back intake matches returned response to persisted transmittal items; ambiguous match remains pending. No approval by QR click or free-text name alone.

### S07 Supplier workspace

No global sidebar. Branded request header shows requesting contractor, project, supplier identity and expiration; disclose minimal metadata before verification. Required items show title, related PO/equipment, expected file type/metadata and due date. Upload on one item cannot select another requirement. Receipt shows uploaded, verified and contractor intake/review separately. Expired/revoked link shows contact route without exposing historic files. OTP is required by default; any later bearer-link mode requires separate risk acceptance and upload-only intake design. Mobile upload is one task per screen with persistent progress and multilingual assistance as a validated later option.

### S08 Handover builder and recipient view

Wizard: purpose/scope/baseline → readiness and blockers → exact manifest preview → issue build. Preview includes inclusion reason, exact revision, exclusion/waiver reference and expected sequence. A draft exception package is labelled incomplete and cannot be issued as final acceptance-ready. Progress shows queued/building/failed/ready with job receipt. READY reveals digest, artifact size, item/page map and download. Rebuild creates new artifact/version, never overwrites issued history.

Submission form chooses named required/optional recipients and authority scopes; delivery and responses shown independently. Recipient sees immutable index, controlled download, Accept / Accept with exceptions / Reject and required comment/proof rules. Exception acceptance creates actions and never closes unresolved contractual requirements automatically. Export includes originals where needed plus manifest and portable verification instructions.

### S09 Commercial readiness and aftercare

Stage rows: contract milestone, prerequisites, blockers, bill reference, application date, certification response, follow-up owner. Amounts appear only if explicitly granted; readiness never equates to paid. Retention tranches separately show calculated/entered amount, eligibility condition/date, application, certified amount and receipts. Contract terms determine rules; no default DLP or release percentage. Aftercare shows project DLP and asset warranty as separate timelines; anchor-pending is a first-class state.

### S10 Search and bulk operations

Global search defaults active project; explicit permission-filtered portfolio scope available. Results group requirements, assets, documents and submissions with matching field and exact revision. Never reveal inaccessible record counts. Keyboard navigation and recently viewed items partitioned by actor. Bulk destructive or authority actions require explicit selection preview; long work returns a job receipt with row outcomes and retry failed rows only. Do not support bulk consultant approval without per-item authority validation.

## Premium enterprise design system

| Token/group | Decision |
|---|---|
| Typography | System sans stack for offline resilience; 14px operational body, 16px form/mobile body, 12px metadata minimum, 20/28px page heading, 28/36px key summary; tabular numbers for measures |
| Surfaces | Page #F6F8FB, card #FFFFFF, subtle #EEF2F6, border #D5DDE7; text #172033, secondary #475569 |
| Brand/action | Navy #17324D for navigation; blue #1D4ED8 primary action, pale-blue selection #EFF6FF |
| Semantic | Success #166534, warning #92400E, danger #B91C1C, informational #1E40AF; text/icon/label together, not colour alone |
| Spacing | 4px base; 8/12 inline gaps; 16/24 section spacing; 32/48 major section spacing |
| Shape/elevation | 6px controls, 10px surfaces; borders primary separator; shallow shadow only floating layers |
| Controls | 40px desktop, 44–48px mobile touch height; explicit label/help/error; disabled reason available to keyboard/screen reader |
| Tables | 44px standard rows, 36px optional dense mode, 56px touch; sticky header and identity columns; saved column settings |
| Focus | Visible 2px action-colour ring with offset; logical DOM order; skip link and named regions |
| Motion | 120–180ms state transitions only; reduced-motion support; no animated metrics or delayed access to controls |
| Formatting | Dates day-month-year with unambiguous month text; show project timezone on timestamps; paise stored, INR display in Indian grouping |

Target WCAG 2.2 AA with measured contrast, keyboard operation, semantic tables, focus trap/restore on dialogs, labelled status changes, text zoom and reflow. Validate palette combinations rather than assuming tokens guarantee contrast. Charts require equivalent tables. Upload status is aria-live polite; failures assertive without repeating progress. Offline storage limitations and shared-device draft handling are explicit user decisions.

## UX acceptance and implementation mapping

T12 owns evidence/upload states and actor draft isolation; T15 owns S01–S03/S10 and navigation; T07 owns S06/S07 authority; T09 owns S08; T16–T19 stage S05/quality/aftercare/commercial completeness. Remove duplicate components only after checking active imports. Usability test six representative roles against real redacted files; proposed threshold five of six complete their primary task without coaching, all correctly distinguish verified/approved/accepted. Record actual result before claiming usability improvement.
