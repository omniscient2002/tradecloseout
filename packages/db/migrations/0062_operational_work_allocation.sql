ALTER TABLE submissions ADD COLUMN responsible_user_id uuid REFERENCES users(id);
UPDATE submissions SET responsible_user_id=COALESCE(submitted_by,created_by);
CREATE FUNCTION assign_submission_responsibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.responsible_user_id=COALESCE(NEW.responsible_user_id,NEW.submitted_by,NEW.created_by);RETURN NEW;END $$;
CREATE TRIGGER submission_initial_responsibility BEFORE INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION assign_submission_responsibility();
CREATE TABLE work_allocation_commands (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organisations(id),request_key uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),target_user_id uuid NOT NULL REFERENCES users(id),input_hash text NOT NULL,
 response_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,request_key)
);
ALTER TABLE work_allocation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_allocation_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY work_allocation_tenant ON work_allocation_commands USING(org_id=current_setting('app.current_org',true)::uuid)
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid AND actor_user_id=current_setting('app.current_user',true)::uuid);
GRANT SELECT,INSERT ON work_allocation_commands TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON work_allocation_commands FROM tc_app;
