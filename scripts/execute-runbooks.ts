import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';

const adminPool = new Pool({
  connectionString: process.env.MIGRATOR_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout',
});

/**
 * Executable Incident Runbooks (15-DEPLOYMENT-AND-OPERATIONS.md §10 RB-08, RB-09, RB-12)
 */
async function executeRunbook() {
  const [, , rbCode, targetOrgId, targetEntityId, reason] = process.argv;
  if (!rbCode || !targetOrgId) {
    console.log(
      'Usage: pnpm tsx scripts/execute-runbooks.ts <RB-08|RB-09|RB-12> <orgId> [entityId] [reason]',
    );
    process.exit(1);
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [targetOrgId]);

    if (rbCode === 'RB-08') {
      // RB-08: Suspected Tenant Isolation Breach — Immediately revoke all active sessions for org
      const { rowCount } = await client.query(
        `UPDATE sessions SET revoked_at = now() WHERE active_org_id = $1 AND revoked_at IS NULL`,
        [targetOrgId],
      );
      console.log(`✓ [RB-08 CONTAINMENT] Revoked ${rowCount} active sessions for org ${targetOrgId}.`);
    } else if (rbCode === 'RB-09' && targetEntityId) {
      // RB-09: Malware Upload — Quarantine version and storage object immediately
      await client.query(
        `UPDATE document_versions SET file_status = 'QUARANTINED', row_version = row_version + 1
          WHERE org_id = $1 AND id = $2`,
        [targetOrgId, targetEntityId],
      );
      console.log(`✓ [RB-09 QUARANTINE] Quarantined document_version ${targetEntityId}.`);
    } else if (rbCode === 'RB-12' && targetEntityId) {
      // RB-12: Suspected PDF Injection — Mark generated package FAILED/REJECTED to block download
      await client.query(
        `UPDATE handover_packages
            SET status = 'REJECTED', row_version = row_version + 1
          WHERE org_id = $1 AND id = $2`,
        [targetOrgId, targetEntityId],
      );
      console.log(
        `✓ [RB-12 PDF INJECTION CONTAINMENT] Marked package ${targetEntityId} REJECTED (${reason || 'escaping audit'}).`,
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (id, org_id, actor_type, action, entity_type, entity_id, after_json, request_id)
       VALUES ($1, $2, 'ADMIN', $3, 'RUNBOOK_EXECUTION', $4, $5, $6)`,
      [
        uuidv7(),
        targetOrgId,
        `RUNBOOK_${rbCode}`,
        targetEntityId || targetOrgId,
        JSON.stringify({ rbCode, reason: reason || 'Emergency runbook execution' }),
        `rb_${uuidv7()}`,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await adminPool.end();
  }
}

executeRunbook().catch((err) => {
  console.error(err);
  process.exit(1);
});
