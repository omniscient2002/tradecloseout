#!/usr/bin/env bash
# ==============================================================================
# TRADECLOSEOUT v0.2.1 — PRE-INVOICE DATABASE + STORAGE RESTORE DRILL (15 §7 & §16, TC-F027)
# ==============================================================================
set -euo pipefail

SOURCE_DB_URL="${MIGRATOR_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/tradecloseout}"
DRILL_DB_NAME="tradecloseout_restore_drill_$(date +%s)"
DUMP_FILE="/tmp/${DRILL_DB_NAME}.dump"
START_TS=$(date +%s)

echo "[DRILL STEP 1/5] Taking consistent snapshot of source database..."
pg_dump "${SOURCE_DB_URL}" -Fc -f "${DUMP_FILE}"

echo "[DRILL STEP 2/5] Provisioning isolated staging restore database (${DRILL_DB_NAME})..."
psql "${SOURCE_DB_URL}" -c "CREATE DATABASE ${DRILL_DB_NAME};"
DRILL_DB_URL=$(node -e '
  const u = new URL(process.argv[1]);
  u.pathname = "/" + process.argv[2];
  console.log(u.toString());
' "${SOURCE_DB_URL}" "${DRILL_DB_NAME}")

echo "[DRILL STEP 3/5] Restoring snapshot into ${DRILL_DB_NAME}..."
pg_restore -d "${DRILL_DB_URL}" "${DUMP_FILE}"

echo "[DRILL STEP 4/5] Verifying row counts, audit hash-chain integrity & storage checksums..."
psql "${DRILL_DB_URL}" -c "
  SELECT
    (SELECT COUNT(*) FROM organisations) AS orgs_count,
    (SELECT COUNT(*) FROM projects) AS projects_count,
    (SELECT COUNT(*) FROM requirements) AS requirements_count,
    (SELECT COUNT(*) FROM document_versions WHERE file_status = 'READY') AS ready_versions_count,
    (SELECT COUNT(*) FROM audit_events) AS audit_events_count;
"

echo "Verifying exact row parity between source and restored database..."
TABLES_TO_VERIFY=("organisations" "projects" "requirements" "document_versions" "storage_objects" "audit_events")
for tbl in "${TABLES_TO_VERIFY[@]}"; do
  SRC_COUNT=$(psql "${SOURCE_DB_URL}" -t -A -c "SELECT COUNT(*) FROM ${tbl};")
  DRL_COUNT=$(psql "${DRILL_DB_URL}" -t -A -c "SELECT COUNT(*) FROM ${tbl};")
  if [ "$SRC_COUNT" != "$DRL_COUNT" ]; then
    echo "FAIL: Count mismatch for table ${tbl}: source=${SRC_COUNT}, restored=${DRL_COUNT}!" >&2
    psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
    rm -f "${DUMP_FILE}"
    exit 1
  fi
done
echo "✓ Source and restored table counts match perfectly."

echo "Checking audit hash-chain linkage (chain_seq, prev_hash, hash)..."
NULL_HASH_COUNT=$(psql "${DRILL_DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM audit_events WHERE hash IS NULL;
")
if [ "$NULL_HASH_COUNT" -gt 0 ]; then
  echo "FAIL: Detected $NULL_HASH_COUNT audit events with NULL hash in restored snapshot!" >&2
  psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "✓ Zero NULL-hash audit events found."

BROKEN_AUDIT_COUNT=$(psql "${DRILL_DB_URL}" -t -A -c "
  WITH ordered_events AS (
    SELECT org_id, id, chain_seq, hash, prev_hash,
           LAG(hash) OVER (PARTITION BY org_id ORDER BY chain_seq) AS expected_prev_hash
      FROM audit_events
  )
  SELECT COUNT(*)
    FROM ordered_events
   WHERE (expected_prev_hash IS NOT NULL AND prev_hash != expected_prev_hash);
")

if [ "$BROKEN_AUDIT_COUNT" -gt 0 ]; then
  echo "FAIL: Detected $BROKEN_AUDIT_COUNT broken audit hash chain events in restored snapshot!" >&2
  psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "✓ Audit hash chain intact."

echo "Recomputing cryptographic SHA-256 payload digests for audit events..."
CORRUPT_PAYLOAD_COUNT=$(psql "${DRILL_DB_URL}" -t -A -c "
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
  psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "✓ All audit payload SHA-256 cryptographic digests recomputed and verified."

echo "Checking storage object verification state..."
UNVERIFIED_STORAGE=$(psql "${DRILL_DB_URL}" -t -A -c "
  SELECT COUNT(*)
    FROM storage_objects
   WHERE status = 'READY'
     AND (sha256 IS NULL OR provider_version_id IS NULL OR observed_size_bytes IS NULL OR observed_size_bytes != size_bytes);
")

if [ "$UNVERIFIED_STORAGE" -gt 0 ]; then
  echo "FAIL: Detected $UNVERIFIED_STORAGE unverified READY storage objects in restored snapshot!" >&2
  psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "✓ Storage object verified records intact."

echo "Checking that all public tenant tables enforce enabled and forced row security in pg_class..."
INVALID_RLS_TABLES=$(psql "${DRILL_DB_URL}" -t -A -c "
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
  psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};" || true
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "✓ All public tenant tables enforce enabled and FORCE Row Level Security."

echo "[DRILL STEP 5/5] Cleaning up drill database & recording RTO..."
psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};"
rm -f "${DUMP_FILE}"
END_TS=$(date +%s)
MEASURED_RTO=$((END_TS - START_TS))
MAX_RTO_SECONDS=14400 # 4 hours (TC-F027)
if [ "$MEASURED_RTO" -gt "$MAX_RTO_SECONDS" ]; then
  echo "FAIL: Restore RTO exceeded limit! Measured: ${MEASURED_RTO}s, Limit: ${MAX_RTO_SECONDS}s" >&2
  exit 1
fi
echo "✓ PRE-INVOICE RESTORE DRILL PASSED! Measured RTO: ${MEASURED_RTO} seconds (Enforced target <= ${MAX_RTO_SECONDS}s)."
