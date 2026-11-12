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

  it('limits writes to individual containment columns and append-only incident records', async () => {
    const { rows: [p] } = await admin.query(
      `SELECT
          has_table_privilege('tc_incident_operator', 'document_versions', 'UPDATE') AS mutate_document,
          has_table_privilege('tc_incident_operator', 'storage_objects', 'DELETE') AS delete_storage,
          has_column_privilege('tc_incident_operator', 'storage_objects', 'status', 'UPDATE') AS quarantine_storage,
          has_column_privilege('tc_incident_operator', 'storage_objects', 'object_key', 'UPDATE') AS mutate_key,
          has_column_privilege('tc_incident_operator', 'handover_packages', 'status', 'UPDATE') AS contain_package,
          has_column_privilege('tc_incident_operator', 'sessions', 'revoked_at', 'UPDATE') AS revoke_session,
          has_table_privilege('tc_incident_operator', 'audit_events', 'INSERT') AS record_tenant_event,
          has_table_privilege('tc_incident_operator', 'audit_events', 'DELETE') AS delete_event,
          has_table_privilege('tc_incident_operator', 'admin_audit_events', 'INSERT') AS record_operator_event`,
    );
    expect(p).toEqual({
      mutate_document: false, delete_storage: false, quarantine_storage: true,
      mutate_key: false, contain_package: true, revoke_session: true,
      record_tenant_event: true, delete_event: false, record_operator_event: true,
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
