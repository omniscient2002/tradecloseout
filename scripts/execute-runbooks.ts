import { Pool } from 'pg';
import { parseIncidentRunbookArgs } from './incident-runbook-args';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RB-08/09/12: approved break-glass operator. The caller cannot directly read
 * sessions or mutate storage: a trusted SECURITY DEFINER SQL function performs
 * target validation, one-time approval, containment and both audit writes.
 *
 * The DB role tc_incident_operator has NOLOGIN. Each human needs a distinct
 * externally approved, nonprivileged DB login granted role membership.
 * Nothing here provisions credentials, approves incidents or revokes already
 * distributed S3 presigned URLs/provider copies.
 */
async function executeRunbook(): Promise<void> {
  const args = parseIncidentRunbookArgs(process.argv.slice(2));
  const connectionString = process.env.INCIDENT_DATABASE_URL;
  const operatorId = process.env.INCIDENT_OPERATOR_ID;
  const approvalRef = process.env.INCIDENT_APPROVAL_REF;

  if (!connectionString) {
    throw new Error('INCIDENT_DATABASE_URL must identify an individual operator login.');
  }
  if (!operatorId || !UUID.test(operatorId)) {
    throw new Error('INCIDENT_OPERATOR_ID must be an accountable operator UUID.');
  }
  // Even dry runs inspect incident targets and require independent approval.
  if (!approvalRef || !UUID.test(approvalRef)) {
    throw new Error('INCIDENT_APPROVAL_REF must be an approved, unexpired UUID.');
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '3000ms'");

        const { rows: [login] } = await client.query(
          `SELECT session_user AS login, rolsuper, rolbypassrls
             FROM pg_roles WHERE rolname = session_user`,
        );
        if (!login || login.rolsuper || login.rolbypassrls ||
            ['tc_incident_operator', 'tc_migrator', 'tc_app', 'postgres'].includes(login.login)) {
          throw new Error('INCIDENT_INDIVIDUAL_NONPRIVILEGED_LOGIN_REQUIRED');
        }
        await client.query('SET LOCAL ROLE tc_incident_operator');
        const { rows: [effective] } = await client.query('SELECT current_user AS role');
        if (effective?.role !== 'tc_incident_operator') {
          throw new Error('INCIDENT_OPERATOR_ROLE_REQUIRED');
        }

        const { rows: [result] } = await client.query(
          `SELECT matched_targets, changed_targets, project_id, audit_event_id
             FROM public.execute_approved_incident_runbook(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::boolean
             )`,
          [
            approvalRef, args.orgId, args.code, args.entityId,
            operatorId, args.reason, args.execute,
          ],
        );
        if (!result || !Number.isInteger(result.matched_targets) ||
            !Number.isInteger(result.changed_targets)) {
          throw new Error('INCIDENT_COMMITTED_RESULT_UNVERIFIED');
        }
        await client.query('COMMIT');
        // Do not print an execution success before the database commits.
        console.log(JSON.stringify({
          code: args.code,
          mode: args.execute ? 'EXECUTED' : 'DRY_RUN',
          matchedTargets: result.matched_targets,
          changedTargets: result.changed_targets,
          status: args.execute ? 'DATABASE_CONTAINMENT_COMMITTED' : 'NO_CHANGES',
          auditEventId: args.execute ? result.audit_event_id : null,
          warning: 'Existing provider URLs, downloaded copies and external replicas are not revoked by this operation.',
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
