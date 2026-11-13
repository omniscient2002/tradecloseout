-- Durable command identity supplements transport-level idempotency.
CREATE TABLE project_lifecycle_commands (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, project_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
 actor_user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL CHECK(action IN ('ACTIVATE','HANDOVER','SUSPEND','CLOSE','REOPEN','RESUME','CANCEL','ARCHIVE')),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 response_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,project_id,request_key),
 FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id)
);
ALTER TABLE project_lifecycle_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_lifecycle_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY project_lifecycle_commands_tenant ON project_lifecycle_commands
 USING(org_id=current_setting('app.current_org',true)::uuid) WITH CHECK(org_id=current_setting('app.current_org',true)::uuid AND actor_user_id=current_setting('app.current_user',true)::uuid);
GRANT SELECT,INSERT ON project_lifecycle_commands TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON project_lifecycle_commands FROM tc_app;
