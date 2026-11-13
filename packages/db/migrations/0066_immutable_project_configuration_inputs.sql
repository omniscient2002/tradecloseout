CREATE TABLE project_configuration_inputs(
 id uuid PRIMARY KEY,org_id uuid NOT NULL,project_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 source_kind text NOT NULL CHECK(source_kind IN('CONSULTANT_IMPORT','MANUAL_REQUIREMENT','CHANGE_PROPOSAL')),
 payload_json jsonb NOT NULL,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,project_id,id),FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id)
);
ALTER TABLE project_configuration_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_configuration_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY project_configuration_input_read ON project_configuration_inputs FOR SELECT USING(org_id=current_setting('app.current_org',true)::uuid);
CREATE POLICY project_configuration_input_insert ON project_configuration_inputs FOR INSERT WITH CHECK(org_id=current_setting('app.current_org',true)::uuid
 AND created_by=current_setting('app.current_user',true)::uuid);
GRANT SELECT,INSERT ON project_configuration_inputs TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON project_configuration_inputs FROM tc_app;
CREATE FUNCTION freeze_project_configuration_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PROJECT_CONFIGURATION_INPUT_IMMUTABLE'; END $$;
CREATE TRIGGER project_configuration_input_immutable BEFORE UPDATE OR DELETE ON project_configuration_inputs FOR EACH ROW EXECUTE FUNCTION freeze_project_configuration_input();
