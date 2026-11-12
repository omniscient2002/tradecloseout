-- The runtime may decide an intent; it cannot rewrite its recipient, requester,
-- expiry, org/version binding or command identity after creation.
REVOKE UPDATE ON ownership_transfer_intents FROM tc_app;
GRANT UPDATE(status,decided_at) ON ownership_transfer_intents TO tc_app;
DROP POLICY ownership_transfer_tenant ON ownership_transfer_intents;
CREATE POLICY ownership_transfer_read ON ownership_transfer_intents FOR SELECT
 USING(org_id=current_setting('app.current_org',true)::uuid);
CREATE POLICY ownership_transfer_create ON ownership_transfer_intents FOR INSERT
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid
  AND requested_by=current_setting('app.current_user',true)::uuid
  AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=ownership_transfer_intents.org_id
    AND m.user_id=ownership_transfer_intents.requested_by AND m.role='R-OWNER' AND m.status='ACTIVE'));
CREATE POLICY ownership_transfer_decide ON ownership_transfer_intents FOR UPDATE
 USING(org_id=current_setting('app.current_org',true)::uuid
  AND current_setting('app.current_user',true)::uuid IN(requested_by,recipient_user_id))
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid
  AND (status='ACCEPTED' AND recipient_user_id=current_setting('app.current_user',true)::uuid
    OR status IN('CANCELLED','EXPIRED') AND current_setting('app.current_user',true)::uuid IN(requested_by,recipient_user_id)));
