import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';

/** Logical storage use. Count each immutable object once, including unlinked
 * generated artifacts. Unfinished uploads always retain their reservations;
 * a deleted document cannot release a still-live multipart upload. */
export async function readStorageCapacity(client: PoolClient, orgId: string) {
  const { rows } = await client.query<{ready_bytes:string;reserved_bytes:string}>(
    `SELECT
      COALESCE(sum(so.size_bytes) FILTER (WHERE so.status='READY' AND
        (NOT EXISTS(SELECT 1 FROM document_versions dv WHERE dv.org_id=so.org_id AND dv.object_id=so.id)
          OR EXISTS(SELECT 1 FROM document_versions dv JOIN documents d ON d.org_id=dv.org_id AND d.id=dv.document_id
            WHERE dv.org_id=so.org_id AND dv.object_id=so.id AND d.deleted_at IS NULL))),0)::text AS ready_bytes,
      COALESCE(sum(so.size_bytes) FILTER (WHERE so.status IN ('PENDING','PROCESSING')),0)::text AS reserved_bytes
     FROM storage_objects so WHERE so.org_id=$1`, [orgId]);
  const readyBytes=BigInt(rows[0]?.ready_bytes??'0');
  const reservedBytes=BigInt(rows[0]?.reserved_bytes??'0');
  return {readyBytes,reservedBytes,totalBytes:readyBytes+reservedBytes};
}

/** Lock order: project, STORAGE_BYTES mutex, document/version/object. The
 * counter serializes capacity changes; actual object rows determine usage. */
export async function lockStorageCapacity(client: PoolClient, orgId: string) {
  await client.query(`INSERT INTO usage_counters(id,org_id,metric,period,value)
    VALUES($1,$2,'STORAGE_BYTES','ALL_TIME',0)
    ON CONFLICT(org_id,metric,period) DO NOTHING`,[uuidv7(),orgId]);
  await client.query(`SELECT value FROM usage_counters
    WHERE org_id=$1 AND metric='STORAGE_BYTES' AND period='ALL_TIME' FOR UPDATE`,[orgId]);
  return readStorageCapacity(client,orgId);
}

/** Call while holding the capacity mutex after a state change. Cache drift
 * never increases allowance; this repairs the cache from canonical rows. */
export async function reconcileStorageCapacity(client: PoolClient, orgId: string) {
  const usage=await readStorageCapacity(client,orgId);
  await client.query(`UPDATE usage_counters SET value=$2::bigint,updated_at=now()
    WHERE org_id=$1 AND metric='STORAGE_BYTES' AND period='ALL_TIME'`,[orgId,usage.readyBytes.toString()]);
  return usage;
}
