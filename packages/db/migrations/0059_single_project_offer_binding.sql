ALTER TABLE billing_policy_versions ADD COLUMN one_time_project_model text
 CHECK(one_time_project_model IS NULL OR one_time_project_model='ORG_TEAM_AND_ONE_PROJECT');
ALTER TABLE subscriptions ADD COLUMN project_id uuid;
ALTER TABLE subscriptions ADD CONSTRAINT subscription_project_same_org_fk FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id);
CREATE OR REPLACE FUNCTION protect_single_project_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id
 THEN RAISE EXCEPTION 'PROJECT_OFFER_BINDING_IMMUTABLE'; END IF;
 IF NEW.project_id IS NOT NULL AND NEW.interval_snapshot<>'ONE_TIME_PROJECT'
 THEN RAISE EXCEPTION 'PROJECT_SCOPE_REQUIRES_PROJECT_OFFER'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_project_binding BEFORE INSERT OR UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION protect_single_project_binding();
