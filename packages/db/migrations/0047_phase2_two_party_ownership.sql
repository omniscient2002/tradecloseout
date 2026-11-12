CREATE TABLE ownership_transfer_intents (
 id uuid PRIMARY KEY,
 org_id uuid NOT NULL REFERENCES organisations(id),
 requested_by uuid NOT NULL REFERENCES users(id),
 recipient_user_id uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL,
 expected_org_version integer NOT NULL CHECK(expected_org_version>0),
 recipient_membership_version integer NOT NULL CHECK(recipient_membership_version>0),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED')),
 expires_at timestamptz NOT NULL,
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(requested_by<>recipient_user_id),
 UNIQUE(org_id,request_key)
);
CREATE UNIQUE INDEX ownership_one_pending_intent ON ownership_transfer_intents(org_id) WHERE status='PENDING';
ALTER TABLE ownership_transfer_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_transfer_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY ownership_transfer_tenant ON ownership_transfer_intents
 USING(org_id=current_setting('app.current_org',true)::uuid)
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON ownership_transfer_intents TO tc_app;
