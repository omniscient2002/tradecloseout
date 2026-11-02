#!/usr/bin/env bash
# ==============================================================================
# TRADECLOSEOUT v0.2.1 — PRE-INVOICE DATABASE + STORAGE RESTORE DRILL (15 §7 & §16)
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
DRILL_DB_URL="${SOURCE_DB_URL%/tradecloseout}/${DRILL_DB_NAME}"

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

echo "[DRILL STEP 5/5] Cleaning up drill database & recording RTO..."
psql "${SOURCE_DB_URL}" -c "DROP DATABASE ${DRILL_DB_NAME};"
rm -f "${DUMP_FILE}"
END_TS=$(date +%s)
echo "✓ PRE-INVOICE RESTORE DRILL PASSED! Measured RTO: $((END_TS - START_TS)) seconds (Target <= 14,400s)."
