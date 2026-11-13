ALTER TABLE handover_packages ADD COLUMN responsible_user_id uuid REFERENCES users(id);
UPDATE handover_packages SET responsible_user_id=requested_by WHERE responsible_user_id IS NULL;
CREATE OR REPLACE FUNCTION assign_package_responsibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.responsible_user_id=COALESCE(NEW.responsible_user_id,NEW.requested_by);RETURN NEW;END $$;
CREATE TRIGGER package_initial_responsibility BEFORE INSERT ON handover_packages FOR EACH ROW EXECUTE FUNCTION assign_package_responsibility();
CREATE TABLE organisation_deletion_requests (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organisations(id),requested_by uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL,requested_org_version integer NOT NULL,confirmed_name text NOT NULL,reason text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN('PENDING_REVIEW','CANCELLED','BLOCKED_RETENTION')),
 retention_evaluation_json jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,
 UNIQUE(org_id,request_key),UNIQUE(org_id,id)
);
CREATE TABLE organisation_onboarding (
 org_id uuid PRIMARY KEY REFERENCES organisations(id),step integer NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4),
 terms_version text,terms_accepted_by uuid REFERENCES users(id),terms_accepted_at timestamptz,
 selected_template_pack_id uuid REFERENCES template_packs(id),completed_at timestamptz,row_version integer NOT NULL DEFAULT 1
);
ALTER TABLE organisation_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_deletion_tenant ON organisation_deletion_requests
 USING(org_id=current_setting('app.current_org',true)::uuid) WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
ALTER TABLE organisation_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_onboarding_tenant ON organisation_onboarding
 USING(org_id=current_setting('app.current_org',true)::uuid) WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT,INSERT ON organisation_deletion_requests TO tc_app;
GRANT UPDATE(status,cancelled_at) ON organisation_deletion_requests TO tc_app;
GRANT SELECT,INSERT,UPDATE ON organisation_onboarding TO tc_app;
REVOKE DELETE,TRUNCATE ON organisation_deletion_requests,organisation_onboarding FROM tc_app;
