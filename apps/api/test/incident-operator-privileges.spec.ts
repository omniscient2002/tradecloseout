import { Pool } from 'pg';

const admin = new Pool({
  connectionString: process.env.MIGRATOR_DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout',
});

describe('PH5-G28-001 least-privilege incident operator database contract', () => {
  afterAll(async () => admin.end());

  it('provisions an operator that cannot bypass tenant RLS or own schema', async () => {
    const { rows } = await admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit
         FROM pg_roles WHERE rolname = 'tc_incident_operator'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rolcanlogin: false, rolsuper: false, rolbypassrls: false,
      rolcreaterole: false, rolcreatedb: false, rolinherit: false,
    });
  });

  it('has no direct content/session privileges, only the guarded incident function', async () => {
    const { rows: [p] } = await admin.query(
      `SELECT
          has_table_privilege('tc_incident_operator', 'organisations', 'SELECT') AS read_orgs,
          has_table_privilege('tc_incident_operator', 'sessions', 'SELECT') AS read_sessions,
          has_table_privilege('tc_incident_operator', 'storage_objects', 'SELECT') AS read_storage,
          has_column_privilege('tc_incident_operator', 'storage_objects', 'status', 'UPDATE') AS quarantine_storage,
          has_column_privilege('tc_incident_operator', 'handover_packages', 'status', 'UPDATE') AS contain_package,
          has_column_privilege('tc_incident_operator', 'sessions', 'revoked_at', 'UPDATE') AS revoke_session,
          has_table_privilege('tc_incident_operator', 'audit_events', 'INSERT') AS insert_event,
          has_function_privilege('tc_incident_operator',
             'claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)', 'EXECUTE') AS manual_claim,
          has_function_privilege('tc_incident_operator',
             'execute_approved_incident_runbook(uuid,uuid,text,uuid,uuid,text,boolean)',
             'EXECUTE') AS guarded_execution`,
    );
    expect(p).toEqual({
      read_orgs: false, read_sessions: false, read_storage: false,
      quarantine_storage: false, contain_package: false, revoke_session: false,
      insert_event: false, manual_claim: false, guarded_execution: true,
    });
  });

  it('must not inherit application role privileges', async () => {
    const { rows } = await admin.query(
      `SELECT pg_has_role('tc_incident_operator', 'tc_app', 'MEMBER') AS inherits_app,
              pg_has_role('tc_app', 'tc_incident_operator', 'MEMBER') AS app_is_operator`,
    );
    expect(rows[0]).toEqual({ inherits_app: false, app_is_operator: false });
  });
});
