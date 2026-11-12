# Phase 3 Pass 02 — PH3-G10-002 immutable storage receipts

**Status: PARTIAL / VERIFY — NOT INDEPENDENTLY CLOSED.**
**Priority:** P0. **PR:** #22, draft/unmerged. Original audit: `docs/audits/remaining-phases-2026-11-12/phase3/G10.md` at `f51a90894589091ddeaeaeefea14f86473479568`. Finding R44 demonstrated that S3's literal `VersionId: "null"` was accepted as immutable by upload finalization. This pass performs code changes and controlled automated tests only, with real providers and their production acceptance intentionally deferred.

## Implementation inventory

- `packages/shared/src/object-version.ts`: shared version-ID predicate rejects absent, empty, padded, control-character, overlong and `null` (case-insensitive) identities while preserving valid opaque IDs byte-for-byte.
- `apps/api/src/modules/documents/s3-storage.service.ts`: require a bucket's live `GetBucketVersioning.Status === Enabled` before issuing upload intents, refreshing multipart URLs or settling uploads; deny a suspended or unverifiable configuration. Single-part finalization discovers an immutable ID then reads `HEAD` against exactly that version. Multipart finalization requires the *CompleteMultipartUpload* response's immutable version and verifies it via version-pinned `HEAD`. A failed/lost multipart completion is **not** recovered from same-sized current-key HEAD. Signing and streaming always demand immutable IDs, and direct `GetObject` requires a matching provider VersionId.
- `apps/api/src/modules/documents/documents.service.ts`: before changing `document_versions`, `storage_objects`, latest pointers or the scan outbox, validate the storage adapter's version ID and observed byte count. Legacy `PROCESSING`/`READY` receipts containing `null` no longer produce false idempotent success.
- `apps/worker/src/main.ts`: reject mutable file-scan job version IDs, require matching GetObject response version and recheck immutable DB identity before setting any evidence READY.
- `apps/worker/src/queues/handover-package.processor.ts`: reject mutable source versions, check GetObject response is exactly the requested version, and refuse publishing READY artifacts unless the destination bucket has enabled versioning and the PUT/HEAD receipt matches.
- `apps/worker/src/queues/portable-archive.processor.ts`: reject mutable historical and manifest source version IDs and refuse publication into a suspended/unversioned bucket. Existing checksum/readback requirements remain.
- `apps/api/src/modules/handover/handover.service.ts` and `closeout-readiness.ts`: do not qualify legacy `null` storage IDs as ready evidence or handover/archive artifacts; check exact immutable ID before generating signed downloads. SQL filters out blank and `null` versions, runtime check additionally rejects control characters and malformed IDs.
- Additional evidence eligibility consumers (`apps/api/src/modules/reviews/reviews.service.ts`, `apps/api/src/modules/assets/assets.service.ts`, `apps/api/src/modules/billing/warranty-and-billing.service.ts`, `apps/api/src/modules/parties/parties.service.ts`) now fail closed on legacy blank/`null` version IDs rather than letting a mutable object count as reviewed, qualified, commercially ready or supplier-accepted evidence.
- Abort cleanup only attempts to delete a concrete immutable version. No fallback to unversioned provider operations is introduced.

## Regression evidence added/updated

1. `apps/api/test/phase3-storage-versioning.spec.ts`: shared predicate positive/negative matrix; suspended/unverified bucket rejection; single-part null/pinned-HEAD mismatch; multipart Complete receipt exact binding and lost-response/current-key overwrite rejection; signing/fetch source guards; upload-adapter DB/scan-outbox rollback; legitimate receipt; handover and archive download URL denial of historical mutable versions.
2. `apps/worker/test/helpers/storage-server.ts` and `apps/worker/test/worker-integration.spec.ts`: programmable S3 versioning capability response; portable-archive source variants null/empty/padded null; negative suspended-bucket publication with no uploaded bytes; existing exact pinned-source bytes vs overwritten latest version retained.
3. Older presigner and upload integration mocks updated to exercise an explicitly **enabled** versioned provider and the exact `versionId` receipt shape. Production checks were **not** bypassed to satisfy test fixtures.
4. The full `pnpm typecheck`, `pnpm build`, PostgreSQL/RLS, API/worker/shared/PDF/browser suites, security and group protocol must be verified on the exact final SHA via CI, not a previous green commit.

## Unclosed requirements / limitations

- Lost multipart completion response now deliberately fails closed rather than adopting an unpinned current object; a provably safe, authorization-checked recovery workflow belongs to PH3-G10-004/005 and must be independently implemented and tested.
- Object-store `GetBucketVersioning` permissions, real S3/S3-compatible eventual consistency and provider-specific response contracts, tested suspend/overwrite experiments, real scanner/stream/download behavior and operational provider-matrix acceptance belong to the **deferred external gate PH3-G10-008**. No real cloud credentials or provider actions were supplied or used here.
- Historical READY records that were accepted with `null` must be identified and reconciled by an independent, auditable migration/operations policy; this pass rejects them on protected reads/qualification rather than silently rewriting history.
- Multi-process/HTTP service failure injection and Phase 1/2/4/5 integration, independent security reviewer, release-management signoff and exact-head CI evidence remain required. No storage-provider or production certification claim is made.

**Decision:** PH3-G10-002 = `PARTIAL_VERIFY`; no autonomous production enablement, merging or provider activation. This does not close PH3-G10-001 or 003–008.
