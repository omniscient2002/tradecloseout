# PDF, viewer, reports and efficiency review — 2026-11-07

## Assessment

The implementation contains sound foundations: pinned storage versions, SHA-256 checks, streaming downloads/hashes, out-of-process merging when qpdf exists, worker concurrency limits and set-based SQL aggregates. It does not yet demonstrate consistently excellent document quality, field-device usability or production-scale efficiency. Comments claiming “10/10”, “O(1) memory”, “~2 MB RAM” or “<3s on 4G” are not benchmark evidence.

This follow-up extends [the full production review](TRADECLOSEOUT_FULL_PRODUCTION_REVIEW_2026-11-07.md). Source findings below are separated from measured failures. No throughput, p95 latency, browser memory or production capacity benchmark was run. Algorithmic complexity alone cannot establish end-user performance, especially with PDF decompression, network transfer and tenant database policies.

Two deterministic artifact probes were run using locally generated inert PDFs, current built code and independent `pdftotext`. No application code was changed. See [harness](evidence/pdf-quality-2026-11-07/replay-probes.cjs) and [results](evidence/pdf-quality-2026-11-07/results.jsonl).

## PDF generation and artifact quality

### PQ01 — P1: live dossier compiler cannot render ordinary Unicode contractor names

**Reproduced:** calling `compileHandoverDossierStreamingQpdf` with `orgLegalName: 'शर्मा HVAC'` fails with `WinAnsi cannot encode "श" (0x0936)`.

**Source:** `apps/worker/src/queues/pdf-stream-compiler.ts` embeds Helvetica/Courier standard fonts and draws user-provided strings. `pdf.processor.ts:37` strips control characters but does not provide glyph coverage or script shaping. Local names, copied symbols and engineering notation are realistic inputs. This is a correctness failure, independent of document size.

**Implement:** define supported scripts and engineering characters, embed licensed fonts with correct glyph coverage/shaping, measure text in the selected font and wrap it into bounded cells. If a glyph cannot be rendered, return an actionable validation error before a long build, rather than dropping text. Preserve the original metadata and a renderable representation. Font subsetting is an optimization to measure, not an excuse to omit characters.

**Acceptance:** Latin, Devanagari and other explicitly supported project languages; currency/degree/diameter/subscript symbols; mixed-script names, long titles and copied nonbreaking spaces. Independently extract text and visually inspect glyph correctness. Unsupported script is reported explicitly.

### PQ02 — P1: exported alternate builder silently truncates the index

**Reproduced:** `PackageBuilder.generateFrontMatterPdf` given 50 uniquely titled items produced only **35 index rows** and two total front-matter pages. Independent text extraction counted the retained rows.

**Source:** `packages/pdf-engine/src/package-builder.ts` adds a single index page and draws items only while `currentY > 70`; remaining entries are silently skipped. `compilePackage` assumes two front-matter pages. It also keeps all parsed source documents in memory, and missing/unreadable source files become placeholders.

**Reachability:** this exported package builder is covered by engine tests, but the current live handover worker uses `compileHandoverDossierStreamingQpdf` instead. Do not describe this as proof that the live worker drops its index entries: the live worker already paginates 38 rows per page.

**Implement:** consolidate the supported builder or retire the alternate export. If retained, paginate based on actual wrapped row height, calculate front matter before page ranges, and reject missing required sources. Do not label placeholders as complete evidence. Avoid retaining every parsed document in one process for the supported large-dossier path.

**Acceptance:** 0/1/35/36/50/250 items, long wrapped rows, exact page-range mapping, missing source, readable originals and independent extraction of every index entry. The actual production entry point must run the same fixtures.

### PQ03 — P1: report metadata and navigation are incomplete in the live worker

**Sources:** `handover-package.processor.ts:211–224`, `pdf-stream-compiler.ts:350–430`.

- Requirement rows passed to the compiler set `revisionCode: null`, so the live index shows `-` rather than actual revision data.
- The rendered master register includes key/asset/revision/status but does not render requirement title, approver, decision method or the computed source page range. Those fields/ranges partly exist in memory/receipts; they are not a complete navigable printed register.
- Bookmark titles use a version-ID prefix plus “Submittal Document” even though real source titles and section keys exist.
- Bookmarks are skipped above 64 MiB. Below that threshold, the complete merged PDF is loaded/saved again with the JS writer after qpdf linearization. That final rewrite has no subsequent linearization step or verification; the final artifact cannot be assumed to preserve qpdf's fast-view layout.
- Bookmark errors are swallowed without a quality warning. The generated outline is flat despite the helper's “hierarchical” wording.

**Implement:** create one frozen report model containing requirement scope/revision, document revision/title, source version, section, decision provenance, actual page ranges and exceptions. Distinguish requirement-to-document mappings when one source serves several requirements. Render a measured/wrapped register and clickable destinations. Group bookmarks by actual section/equipment/title. Write bookmarks before final optimization or use an out-of-process mechanism that preserves navigation at large sizes. Verify the final file and expose degraded navigation as a visible warning rather than silent success.

**Acceptance:** first/last page of every source matches index and manifest; printed revision and authority match frozen records; bookmarks work in representative viewers; large files retain the promised navigation; inspect final linearization rather than intermediate output. Test mixed page sizes, landscape sheets, rotation and long labels visually.

### PQ04 — P1: resource containment is incomplete; avoid repeated work deliberately

**Sources:** `handover-package.processor.ts:184–208`, `pdf-stream-compiler.ts:217–240`, `sanitise-pdf.ts`, artifact processors.

The worker downloads each source, checks size after writing, then hashes it. The compiler hashes it again and starts a separate page-count process per file. SHA-256 is appropriately linear in bytes and is needed for integrity; the avoidable issue is repeated reads of an already verified private immutable temp file. Sequential downloads/process starts also add latency for many small files. Unlimited parallelization would worsen memory, disk, storage and database contention.

Metadata byte ceilings do not bound actual downloaded bytes before disk writes complete. Some transfer pipelines lack whole-operation timeout/cancellation. qpdf timeouts do not establish a child-process memory limit. The JS fallback parses full PDFs in the worker and the merged document grows with aggregate content. Compressed input bytes are not a reliable memory ceiling. A fixed 64 MiB bookmark threshold likewise does not establish a safe parse memory budget.

**Implement:** meter bytes and hash during download; enforce per-object and whole-job deadlines, aggregate temp quotas and client cancellation. Return an internal verified-source receipt tied to a private immutable temp file and choose where a second hash is necessary. Cache page/structural observations by exact object version/hash plus scanner/policy/tool version. Use measured bounded concurrency and per-tenant admission. Put parsing in processes with enforced memory/CPU/time/disk ceilings. Require the supported toolchain for large jobs; keep fallback limits explicit and tested.

**Acceptance:** compare 1 large vs hundreds of small sources; actual oversized/stalled streams abort before exceeding quota; parser death affects one job; concurrent tenants progress fairly; queued/retried jobs expose observable terminal outcomes. Benchmark the complete process tree and temp disk, not only Node heap.

### PQ05 — P1: duplicate PDF paths require one tested policy

Shared engine inspection, worker inspection/fallback and multiple compiler implementations have different rules and output details. The worker `sanitizeAndCheckPdfBomb` helper's qpdf counter filters xref lines by `offset =`, while the shared engine uses parsed JSON object inventories. The worker helper does not have an evident live caller in the current application inventory; its differences are a maintenance/contract concern, not proof of a live bypass.

**Implement:** inventory live versus exported/test-only paths, retire redundant implementations, and make one supported inspection/output policy authoritative. Run fixtures against actual installed qpdf and fallback mode with independently inspected artifacts. A successful parse or antivirus scan does not alone establish safe active-content behavior. Preserve original source bytes and signed-document lineage when generating sanitized derivatives.

## Viewer and review experience

### VQ01 — P1: the viewer stream has no byte-range contract

**Sources:** `documents.controller.ts:100–122`, `documents.service.ts:811–872`, `s3-storage.service.ts:259`.

The iframe uses the API stream. Neither controller passes a Range header nor storage adapter forwards one; the response does not implement Content-Range/206/416 or a version-based conditional request contract. It streams the whole selected object. Streaming avoids buffering the entire file in the API, but is not equivalent to random-access PDF delivery. Large-document seeking and repeated opens can use more bytes/API bandwidth than necessary.

**Implement:** authorize the exact immutable version for every request, then implement a bounded single-byte-range contract, validated metadata length, suffix/open-ended cases, 206/416 and version-based ETag/If-Range/HEAD behavior; alternatively use an authorized version-pinned storage delivery design with equivalent semantics. Cancel upstream storage reads when the client disconnects. Keep sensitive caching private and explicitly scoped; a cache improvement must not weaken revocation/tenant policy.

**Acceptance:** inspect actual network behavior for initial render and seeking a late page, exact returned byte ranges, truncated reads, disconnect, expired/revoked access and changed document versions. Measure initial visible page under chosen network profiles; do not assume linearization makes an unrestricted stream fast.

### VQ02 — P1: review UI is a browser-native preview, not a controlled engineering viewer

**Source:** `apps/web/src/app/(contractor)/projects/[projectId]/review/[versionId]/page.tsx:241–300` and page-comment form near line 410.

The iframe delegates rendering/zoom/search/navigation to whatever PDF support the browser provides. This is a useful basic preview, but controlled thumbnails, page navigation, annotation overlays, rotation-aware coordinates, synchronized comment-to-page jumps, visible render errors and consistent mobile behavior are not implemented here. Page comments use manually entered page numbers; they are not anchored visual markups. A fixed 420px side panel with a side-by-side layout creates a clear narrow-screen layout risk; actual Pixel rendering was not exercised in this review.

**Implement:** define the review tasks first: page/search/zoom/rotate, clear file state, side-by-side metadata or mobile drawer, comment navigation and stable version-bound annotations. Adopt a controlled renderer only with a maintained compatibility/security plan. Virtualize pages, use background rendering and bounded canvas memory, cancel obsolete loads, and provide an explicit open/download fallback. Store annotation page coordinates normalized with crop/rotation transforms; keep internal/external projection authoritative in the API.

**Acceptance:** Chrome Android/Pixel, desktop browsers and keyboard use; large scanned drawings, text PDFs, landscape/rotated sheets and weak connectivity. Jumping to a comment targets the correct page/version; zoom/rotation preserves annotation position; failures are actionable; rendering does not allocate canvases for every page.

## Reports, dashboards and query efficiency

### RQ01 — P1: reporting definitions diverge before performance is considered

**Sources:** `projects.service.ts:552–625`, `organisations.service.ts:86–119`, `notifications.service.ts:92–146`, worker owner digest, readiness/commercial services.

Project dashboard “missing” counts only MISSING/EXPIRED, while the base requirement constraint uses NOT_STARTED/REQUESTED/etc. The query does not exclude superseded requirements or NOT_APPLICABLE from its total. Its “expiring soon” counts due_at, which is an obligation deadline, not necessarily an evidence expiry. Organisation summaries use another state grouping, omit REJECTED from missing_count and have their own applicability/approval definitions. The owner digest uses yet another subset. Project retention takes the latest active contract, whereas organisation/weekly views aggregate active contracts. These are source-confirmed differences; the correct business meaning must be specified rather than guessed.

**Implement:** define applicable/completed/blocked/overdue/expiring evidence and retention exposure separately, including waivers, handed-over items, rejected work, superseded baseline and multiple contracts. Build one canonical permission-aware report model and use it across dashboard/export/digest/readiness. Include generated-at/as-of time, scope, filter definition, units and source links. Preserve integer money in authoritative calculations and distinguish contractual retained amount from evidence-gated risk.

**Acceptance:** all public reports reconcile on the same frozen fixture; compare fresh project, rejected evidence, waiver, superseded requirement, partial handover, expiry and multi-contract cases. Report semantics are independently approved by product/domain owners before query tuning.

### RQ02 — P2: pagination and query plans need a workload, not speculative indexes

Project/assets/documents/checklists/notifications and passport histories have broad fetches; web project tables render arrays directly and build some grouped views with repeated per-asset filtering. Work-item list/count reruns a union of domain queries. SQL pre-aggregation is a positive foundation, but p95 under realistic RLS and history volumes has not been measured. Do not label these queries slow without execution plans.

**Implement:** record query counts and `EXPLAIN (ANALYZE, BUFFERS)` on isolated realistic datasets under the restricted role, including skewed tenants and many history rows. Add bounded cursor pagination where the actual UI can consume it; group/index requirement arrays once per dataset instead of repeated filters; virtualize long tables and lazy-load domain sections. Add composite/partial indexes from measured predicates/orderings, checking write cost. Use summary projections only where needed, with event-driven invalidation/rebuild and explicit freshness.

**Acceptance:** query plans and API payload sizes for the chosen workload; no growth-proportional request fan-out; stable pagination under writes; report totals stay consistent; projection lag is visible; authorization is preserved in caches and exports.

## Performance acceptance programme for the implementing agent

1. **Correctness first:** fix PQ01/PQ03/RQ01 and either fix or retire PQ02; keep originals and output provenance. Add independent text/artifact checks and visual regression fixtures. Snapshotting a success flag is insufficient.
2. **Viewer contract:** implement VQ01, then VQ02 based on required reviewer tasks. Test real Pixel viewport/network behavior, comments, download and authorization.
3. **Measured pipeline:** instrument stage time, bytes read/written, output size, process-tree peak RSS, CPU, temp disk, queue wait and retries. Implement PQ04 in measured slices, preserving checksums and cancellation.
4. **Database and UI:** collect plans/payloads/render measurements, then apply RQ02 changes. Report before/after results and regression thresholds on the same fixture/environment.
5. **Release evidence:** run all supported PDF tool paths, a real browser journey and operational failure tests. Remove numerical quality/performance claims from comments unless attached to repeatable evidence and a defined supported workload.

Use an initial **test matrix**, not an unsupported capacity promise: 10/100/500-page text/scanned/mixed-orientation PDFs; 1/50/250 source files; 10/1,000/10,000 requirements; single and concurrent tenants; cold/warm caches; stable and interrupted mobile networks. Some cases may intentionally exceed a configured product limit: verify early, clear rejection instead of forcing success. Choose actual supported sizes with contractor input and resource measurements.

Agree release budgets for first visible page, page-jump latency, dashboard p95, package completion time/queue age, maximum memory/temp disk, cancellation latency and per-tenant fairness. Measure on a declared deployment/device/network configuration. A millisecond number without its workload and environment is not evidence of an efficient production app.
