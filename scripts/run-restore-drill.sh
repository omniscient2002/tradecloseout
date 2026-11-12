#!/usr/bin/env bash
# ==============================================================================
# TRADECLOSEOUT v0.2.1 — ISOLATED STAGING DATABASE RESTORE MECHANICS (NOT PHYSICAL OBJECT RESTORE)
# ==============================================================================
set -euo pipefail
umask 077

# This tool is an *isolated staging* database restore mechanics drill only.
# It does not measure production PITR, provider-object recovery, KMS or RPO.
if [[ "${RESTORE_DRILL_SCOPE:-}" != "disposable-staging-only" ]]; then
  echo "Refusing restore drill: set RESTORE_DRILL_SCOPE=disposable-staging-only after verifying the target." >&2
  exit 2
fi
SOURCE_DB_URL="${RESTORE_SOURCE_DATABASE_URL:?RESTORE_SOURCE_DATABASE_URL must point to an authorized disposable staging source}"
DRILL_DB_NAME="tradecloseout_restore_drill_$(date +%s)_${BASHPID}_${RANDOM}"
DUMP_FILE="$(mktemp "${TMPDIR:-/tmp}/tradecloseout-restore.XXXXXXXX")"
START_TS=$(date +%s)
CREATED_DB=0
cleanup() {
  local prior_status=$?
  trap - EXIT
  if [[ "$CREATED_DB" == "1" ]]; then
    psql -X -v ON_ERROR_STOP=1 "${SOURCE_DB_URL}" -c "DROP DATABASE IF EXISTS ${DRILL_DB_NAME} WITH (FORCE);" >&2 || {
      echo "WARNING: could not clean up isolated restore database ${DRILL_DB_NAME}" >&2
      [[ "$prior_status" != "0" ]] || prior_status=1
    }
  fi
  rm -f -- "$DUMP_FILE"
  exit "$prior_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[DRILL STEP 1/5] Taking consistent snapshot of source database..."
pg_dump "${SOURCE_DB_URL}" -Fc -f "${DUMP_FILE}"

echo "[DRILL STEP 2/5] Provisioning isolated staging restore database (${DRILL_DB_NAME})..."
psql -X -v ON_ERROR_STOP=1 "${SOURCE_DB_URL}" -c "CREATE DATABASE ${DRILL_DB_NAME};"
CREATED_DB=1
DRILL_DB_URL=$(node -e '
  const u = new URL(process.argv[1]);
  u.pathname = "/" + process.argv[2];
  console.log(u.toString());
' "${SOURCE_DB_URL}" "${DRILL_DB_NAME}")

echo "[DRILL STEP 3/5] Restoring snapshot into ${DRILL_DB_NAME}..."
pg_restore -d "${DRILL_DB_URL}" "${DUMP_FILE}"

echo "[DRILL STEP 4/5] Verifying row counts, audit hash-chain integrity & storage checksums..."
psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -c "
  SELECT
    (SELECT COUNT(*) FROM organisations) AS orgs_count,
    (SELECT COUNT(*) FROM projects) AS projects_count,
    (SELECT COUNT(*) FROM requirements) AS requirements_count,
    (SELECT COUNT(*) FROM document_versions WHERE file_status = 'READY') AS ready_versions_count,
    (SELECT COUNT(*) FROM audit_events) AS audit_events_count;
"

# pg_dump -Fc captures a consistent source snapshot. Comparing against a
# *new live query* after the dump is invalid: concurrent writes change counts.
# The restored database is now the only comparison subject. A real PITR drill
# requires WAL checkpoints/object-version manifests and separate evidence.
pg_restore --list "$DUMP_FILE" >/dev/null
echo "Restored the internally consistent dump snapshot; no invalid post-dump live-source count comparison was made."
echo "Snapshot dump SHA-256: $(sha256sum "$DUMP_FILE" | awk '{print $1}')"
psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -At -c "
SELECT 'organisations', count(*) FROM organisations
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'requirements', count(*) FROM requirements
UNION ALL SELECT 'document_versions', count(*) FROM document_versions
UNION ALL SELECT 'storage_objects', count(*) FROM storage_objects
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;
"

echo "Checking audit hash-chain linkage (chain_seq, prev_hash, hash)..."
NULL_HASH_COUNT=$(psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM audit_events WHERE hash IS NULL;
")
if [ "$NULL_HASH_COUNT" -gt 0 ]; then
  echo "FAIL: Detected $NULL_HASH_COUNT audit events with NULL hash in restored snapshot!" >&2
  exit 1
fi
echo "✓ Zero NULL-hash audit events found."

BROKEN_AUDIT_COUNT=$(psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -t -A -c "
  WITH ordered_events AS (
    SELECT org_id, id, chain_seq, hash, prev_hash,
           LAG(hash) OVER (PARTITION BY org_id ORDER BY chain_seq) AS expected_prev_hash
      FROM audit_events
  )
  SELECT COUNT(*)
    FROM ordered_events
   WHERE (expected_prev_hash IS NOT NULL AND prev_hash IS DISTINCT FROM expected_prev_hash);
")

if [ "$BROKEN_AUDIT_COUNT" -gt 0 ]; then
  echo "FAIL: Detected $BROKEN_AUDIT_COUNT broken audit hash chain events in restored snapshot!" >&2
  exit 1
fi
echo "✓ Restored audit inter-event linkage valid; independent genesis and external anchor verification remain outstanding."

echo "Recomputing cryptographic SHA-256 payload digests for audit events..."
CORRUPT_PAYLOAD_COUNT=$(psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -t -A -c "
  WITH recomputed_events AS (
    SELECT id, org_id, chain_seq, prev_hash, hash,
           encode(digest(prev_hash || '||' || jsonb_build_object(
             'id', id,
             'org_id', org_id,
             'project_id', project_id,
             'actor_type', actor_type,
             'actor_user_id', actor_user_id,
             'action', action,
             'entity_type', entity_type,
             'entity_id', entity_id,
             'before_json', before_json,
             'after_json', after_json,
             'request_id', request_id,
             'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')
           )::text, 'sha256'), 'hex') AS computed_hash
      FROM audit_events
  )
  SELECT COUNT(*)
    FROM recomputed_events
   WHERE hash != computed_hash;
")

if [ "$CORRUPT_PAYLOAD_COUNT" -gt 0 ]; then
  echo "FAIL: Detected $CORRUPT_PAYLOAD_COUNT audit events with payload tamper or digest mismatch!" >&2
  exit 1
fi
echo "✓ All audit payload SHA-256 cryptographic digests recomputed and verified."

echo "Checking restored storage object metadata (not recovered provider bytes)..."
UNVERIFIED_STORAGE=$(psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -t -A -c "
  SELECT COUNT(*)
    FROM storage_objects
   WHERE status = 'READY'
     AND (sha256 IS NULL OR provider_version_id IS NULL OR observed_size_bytes IS NULL OR observed_size_bytes != size_bytes);
")

if [ "$UNVERIFIED_STORAGE" -gt 0 ]; then
  echo "FAIL: Detected $UNVERIFIED_STORAGE unverified READY storage objects in restored snapshot!" >&2
  exit 1
fi
echo "✓ Restored storage object metadata checks passed; object bytes and KMS recovery are not verified."

echo "Checking that all public tenant tables enforce enabled and forced row security in pg_class..."
INVALID_RLS_TABLES=$(psql -X -v ON_ERROR_STOP=1 "${DRILL_DB_URL}" -t -A -c "
  SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relispartition
     AND c.relname NOT IN ('organisations')
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
     )
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
")

if [ -n "$INVALID_RLS_TABLES" ]; then
  echo "FAIL: Detected tenant tables without forced RLS: ${INVALID_RLS_TABLES}!" >&2
  exit 1
fi
echo "✓ All public tenant tables enforce enabled and FORCE Row Level Security."

echo "[DRILL STEP 5/5] Recording database-only restore elapsed time..."
END_TS=$(date +%s)
MEASURED_DB_RESTORE_SECONDS=$((END_TS - START_TS))
echo "Database dump/restore mechanics verified in ${MEASURED_DB_RESTORE_SECONDS}s; cleanup occurs in EXIT trap."
echo "NOT CERTIFIED: production PITR/RPO/RTO, physical object version recovery, KMS, operator IAM and audit anchor acceptance remain open."
