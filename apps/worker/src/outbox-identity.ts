import type { PoolClient } from 'pg';
import {
  parseTrustedOutboxDispatch,
  type OutboxDispatchRow,
} from '@tradecloseout/db';

/**
 * Parse/validate an immutable event before it can reach a queue.
 * Never infer tenant, project, event or actor authority from a domain payload.
 * Legacy pre-V1 rows must match every identity field they carry.
 */
export async function authorizeOutboxDispatch(
  client: Pick<PoolClient, 'query'>,
  row: OutboxDispatchRow,
): Promise<Record<string, unknown>> {
  const { payload } = parseTrustedOutboxDispatch(row);

  if (![
    'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN',
    'HANDOVER_PACKAGE_QUEUED',
    'PROJECT_ARCHIVE_EXPORT_QUEUED',
  ].includes(row.event_type)) return payload;

  if (!row.project_id || typeof row.project_id !== 'string') {
    throw new Error('OUTBOX_RESOURCE_PROJECT_REQUIRED');
  }
  const id = row.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN'
    ? payload.versionId
    : row.event_type === 'HANDOVER_PACKAGE_QUEUED'
      ? payload.packageId : payload.exportId;
  if (typeof id !== 'string' || !id) throw new Error('OUTBOX_RESOURCE_IDENTITY_REQUIRED');
  if (row.event_type !== 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN' &&
      payload.entityId !== id) throw new Error('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
  if (row.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN' &&
      payload.entityId !== undefined && payload.entityId !== id) {
    throw new Error('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
  }

  const org = row.org_id;
  const project = row.project_id;
  let result;
  if (row.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN') {
    const storageId = payload.storageObjectId;
    if (typeof storageId !== 'string' || !storageId ||
        typeof payload.bucket !== 'string' || !payload.bucket ||
        typeof payload.objectKey !== 'string' || !payload.objectKey ||
        typeof payload.providerVersionId !== 'string' || !payload.providerVersionId) {
      throw new Error('OUTBOX_STORAGE_IDENTITY_REQUIRED');
    }
    result = await client.query(
      `SELECT dv.id FROM document_versions dv
         JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
        WHERE dv.org_id=$1 AND dv.project_id=$2 AND dv.id=$3
          AND so.id=$4 AND so.bucket=$5 AND so.object_key=$6
          AND so.provider_version_id=$7
          AND dv.file_status='PROCESSING' AND so.status='PROCESSING'`,
      [org, project, id, storageId, payload.bucket, payload.objectKey, payload.providerVersionId],
    );
  } else if (row.event_type === 'HANDOVER_PACKAGE_QUEUED') {
    result = await client.query(
      'SELECT id FROM handover_packages WHERE org_id=$1 AND project_id=$2 AND id=$3',
      [org, project, id],
    );
  } else {
    result = await client.query(
      'SELECT id FROM archive_exports WHERE org_id=$1 AND project_id=$2 AND id=$3',
      [org, project, id],
    );
  }
  if (result.rowCount !== 1) throw new Error('OUTBOX_RESOURCE_SCOPE_MISMATCH');
  return payload;
}
