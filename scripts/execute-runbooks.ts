import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { parseIncidentRunbookArgs } from './incident-runbook-args';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RB-08/09/12: scoped, attributable, fail-closed incident intervention.
 *
 * INCIDENT_DATABASE_URL must authenticate as an individually accountable
 * non-superuser login permitted to SET ROLE tc_incident_operator. The shared
 * operator role has NOLOGIN. Never use a migrator, app or postgres identity.
 * --execute requires a matching, unexpired, single-use DB approval UUID.
 * This cannot revoke already distributed S3 presigned URLs (provider gate).
 */
async function executeRunbook() {
  const args = parseIncidentRunbookArgs(process.argv.slice(2));
  const connectionString = process.env.INCIDENT_DATABASE_URL;
  const operatorId = process.env.INCIDENT_OPERATOR_ID;
  const approvalRef = process.env.INCIDENT_APPROVAL_REF;
  if (!connectionString) throw new Error('INCIDENT_DATABASE_URL is required; migrator fallback is forbidden.');
  if (!operatorId || !UUID.test(operatorId)) throw new Error('INCIDENT_OPERATOR_ID must be an accountable operator UUID.');
  if (args.execute && (!approvalRef || !UUID.test(approvalRef))) {
    throw new Error('INCIDENT_APPROVAL_REF must be an approved, single-use UUID.');
  }
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '3000ms'");
        // DB login is a distinct, least-privileged individual principal.
        // Role membership is provisioned by the independent security operator.
        const identity = await client.query(
          `SELECT session_user AS login, rolsuper, rolbypassrls
             FROM pg_roles WHERE rolname = session_user`,
        );
        const login = identity.rows[0];
        if (!login || login.rolsuper || login.rolbypassrls ||
            ['tc_incident_operator', 'tc_migrator', 'tc_app', 'postgres'].includes(login.login)) {
          throw new Error('An independent nonprivileged operator database login is required.');
        }
        await client.query('SET LOCAL ROLE tc_incident_operator');
        const switched = await client.query('SELECT current_user AS role');
        if (switched.rows[0]?.role !== 'tc_incident_operator') {
          throw new Error('Incident operator privilege boundary could not be established.');
        }
        await client.query("SELECT set_config('app.current_org', $1, true)", [args.orgId]);
        const org = await client.query('SELECT id FROM organisations WHERE id = $1', [args.orgId]);
        if (org.rowCount !== 1) throw new Error('Incident organisation not found.');

        if (args.execute) {
          // Consume independent approval atomically with the containment and
          // audit records. A failed transaction rolls back consumption too.
          const { rows: [claim] } = await client.query(
            `SELECT public.claim_incident_runbook_approval(
                $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text
              ) AS permitted`,
            [approvalRef, args.orgId, args.code, args.entityId, operatorId, args.reason],
          );
          if (!claim?.permitted) {
            throw new Error('INCIDENT_APPROVAL_MISSING_EXPIRED_OR_USED');
          }
        }

        let targetCount = 0;
        let affected = 0;
        let projectId: string | null = null;
        if (args.code === 'RB-08') {
          const query = args.execute
            ? 'UPDATE sessions SET revoked_at = now() WHERE active_org_id = $1 AND revoked_at IS NULL RETURNING id'
            : 'SELECT id FROM sessions WHERE active_org_id = $1 AND revoked_at IS NULL';
          const result = await client.query(query, [args.orgId]);
          targetCount = result.rowCount || 0;
          affected = args.execute ? targetCount : 0;
        } else if (args.code === 'RB-09') {
          const version = await client.query(
            `SELECT dv.id, dv.project_id, dv.review_status, dv.file_status,
                    so.id AS storage_object_id, so.status AS storage_status
               FROM document_versions dv
               JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
              WHERE dv.org_id = $1 AND dv.id = $2
              ${args.execute ? 'FOR UPDATE OF dv, so' : ''}`,
            [args.orgId, args.entityId],
          );
          if (version.rowCount !== 1) throw new Error('Incident document version not found.');
          targetCount = 1;
          projectId = version.rows[0].project_id;
          if (args.execute) {
            // Historical approval stays attributable; quarantining the backing
            // object immediately denies new app download, preview and stream.
            // Idempotent replay must report zero newly changed objects.
            const result = await client.query(
              `UPDATE storage_objects SET status = 'QUARANTINED'
                WHERE org_id = $1 AND id = $2 AND status <> 'QUARANTINED' RETURNING id`,
              [args.orgId, version.rows[0].storage_object_id],
            );
            affected = result.rowCount || 0;
          }
        } else if (args.code === 'RB-12') {
          const pkg = await client.query(
            `SELECT id, project_id, status, pdf_object_id, zip_object_id, manifest_object_id
               FROM handover_packages WHERE org_id = $1 AND id = $2
              ${args.execute ? 'FOR UPDATE' : ''}`,
            [args.orgId, args.entityId],
          );
          if (pkg.rowCount !== 1) throw new Error('Incident package not found.');
          targetCount = 1;
          projectId = pkg.rows[0].project_id;
          if (args.execute) {
            const update = await client.query(
              `UPDATE handover_packages
                  SET status = 'REJECTED', row_version = row_version + 1, updated_at = now()
                WHERE org_id = $1 AND id = $2 AND status <> 'REJECTED' RETURNING id`,
              [args.orgId, args.entityId],
            );
            const quarantined = await client.query(
              `UPDATE storage_objects SET status = 'QUARANTINED'
                WHERE org_id = $1 AND id = ANY($2::uuid[]) AND status <> 'QUARANTINED' RETURNING id`,
              [args.orgId, [pkg.rows[0].pdf_object_id, pkg.rows[0].zip_object_id, pkg.rows[0].manifest_object_id].filter(Boolean)],
            );
            affected = (update.rowCount || 0) > 0 || (quarantined.rowCount || 0) > 0 ? 1 : 0;
          }
        }

        if (args.execute) {
          const eventId = uuidv7();
          const requestId = `rb_${eventId}`;
          const after = JSON.stringify({
            code: args.code, approvalRef: approvalRef!.trim(), reason: args.reason,
            matchedTargets: targetCount, affected, containment: 'DATABASE_AND_FUTURE_APP_DOWNLOADS_ONLY',
          });
          await client.query(
            `INSERT INTO admin_audit_events
              (id, org_id, admin_user_id, action, reason, entity_type, entity_id, after_json, request_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
            [uuidv7(), args.orgId, operatorId, `INCIDENT_${args.code}`, args.reason,
              'INCIDENT_RUNBOOK', args.entityId, after, requestId],
          );
          await client.query(
            `INSERT INTO audit_events
              (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id, after_json, request_id)
             VALUES ($1, $2, $3, 'ADMIN', $4, $5, 'RUNBOOK_EXECUTION', $6, $7::jsonb, $8)`,
            [eventId, args.orgId, projectId, operatorId,
              `RUNBOOK_${args.code}`, args.entityId || args.orgId, after, requestId],
          );
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
        // Never print success until the database confirms COMMIT.
        console.log(JSON.stringify({
          code: args.code, mode: args.execute ? 'EXECUTED' : 'DRY_RUN',
          matchedTargets: targetCount, changedTargets: affected,
          status: args.execute ? 'DATABASE_CONTAINMENT_COMMITTED' : 'NO_CHANGES',
          warning: 'Prior signed provider URLs and external replicas are not revoked by this database command.',
        }));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
executeRunbook().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Incident runbook failed.');
  process.exitCode = 1;
});
