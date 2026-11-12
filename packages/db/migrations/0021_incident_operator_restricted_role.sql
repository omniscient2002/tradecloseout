-- PH5-G28-001: Separate least-privilege incident containment operator.
-- No reusable password/secret is embedded in migrations. Operators must be
-- provisioned through an approved, short-lived, audited credential workflow.
-- A role with a null password cannot authenticate using password auth.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_incident_operator') THEN
    CREATE ROLE tc_incident_operator WITH LOGIN
      PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
      NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tc_incident_operator'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
           OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'INCIDENT_ROLE_UNSAFE: existing role is not least privileged';
  END IF;
END
$role$;

-- No schema ownership, BYPASSRLS, GRANT OPTION, or application-role membership.
GRANT USAGE ON SCHEMA public TO tc_incident_operator;
DO $grant$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tc_incident_operator', current_database());
END
$grant$;

-- Read exactly the metadata needed to locate a named tenant/target and
-- confirm whether an operation can be performed.
GRANT SELECT ON organisations, sessions, document_versions,
  storage_objects, handover_packages TO tc_incident_operator;

-- Column-level writes restrict the operator to containment actions.
GRANT UPDATE (revoked_at) ON sessions TO tc_incident_operator;
GRANT UPDATE (status) ON storage_objects TO tc_incident_operator;
GRANT UPDATE (status, row_version, updated_at) ON handover_packages
  TO tc_incident_operator;

-- Two independently reviewable audit trails. No UPDATE or DELETE privileges.
GRANT INSERT ON audit_events, admin_audit_events TO tc_incident_operator;
GRANT USAGE ON SEQUENCE audit_events_chain_seq TO tc_incident_operator;

-- RLS remains FORCE-enabled for all tenant-bound records and uses
-- the transaction-local app.current_org specified by the runbook.
-- Never grant tc_app membership in tc_incident_operator.
