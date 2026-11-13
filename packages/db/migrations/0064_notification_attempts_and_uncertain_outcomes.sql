ALTER TABLE notifications DROP CONSTRAINT notifications_gateway_state_valid;
ALTER TABLE notifications ADD CONSTRAINT notifications_gateway_state_valid CHECK(gateway_state IN('PENDING','UNCERTAIN','ACCEPTED','DELIVERED','BOUNCED','FAILED'));
ALTER TABLE notifications ADD COLUMN reconcile_after timestamptz NOT NULL DEFAULT now();
CREATE TABLE notification_delivery_attempts(
 id uuid PRIMARY KEY,org_id uuid NOT NULL,notification_id uuid NOT NULL,attempt_no integer NOT NULL CHECK(attempt_no>0),
 claim_token uuid NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN('CLAIMED','SENDING','ACCEPTED','UNCERTAIN','RETRYABLE','ABANDONED','NOT_FOUND','DELIVERED','FAILED')),
 provider_message_id text,created_at timestamptz NOT NULL DEFAULT now(),settled_at timestamptz,
 UNIQUE(org_id,notification_id,attempt_no),UNIQUE(org_id,notification_id,claim_token),
 FOREIGN KEY(org_id,notification_id) REFERENCES notifications(org_id,id)
);
ALTER TABLE notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_attempt_tenant ON notification_delivery_attempts USING(org_id=current_setting('app.current_org',true)::uuid)
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT,INSERT ON notification_delivery_attempts TO tc_app;
GRANT UPDATE(status,provider_message_id,settled_at) ON notification_delivery_attempts TO tc_app;
REVOKE DELETE,TRUNCATE ON notification_delivery_attempts FROM tc_app;
CREATE FUNCTION protect_notification_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.org_id,NEW.notification_id,NEW.attempt_no,NEW.claim_token,NEW.input_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.notification_id,OLD.attempt_no,OLD.claim_token,OLD.input_hash,OLD.created_at)
 THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
 THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_PROVIDER_ID_IMMUTABLE'; END IF;
 IF OLD.status IN('RETRYABLE','ABANDONED','NOT_FOUND','DELIVERED','FAILED') AND ROW(NEW.status,NEW.provider_message_id,NEW.settled_at) IS DISTINCT FROM ROW(OLD.status,OLD.provider_message_id,OLD.settled_at) THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_TERMINAL_IMMUTABLE'; END IF;
 IF NEW.status<>OLD.status AND NOT(
  OLD.status='CLAIMED' AND NEW.status IN('SENDING','RETRYABLE','ABANDONED','DELIVERED','ACCEPTED') OR
  OLD.status='SENDING' AND NEW.status IN('ACCEPTED','UNCERTAIN','DELIVERED','FAILED') OR
  OLD.status='UNCERTAIN' AND NEW.status IN('ACCEPTED','NOT_FOUND','DELIVERED','FAILED') OR
  OLD.status='ACCEPTED' AND NEW.status IN('DELIVERED','FAILED')) THEN RAISE EXCEPTION 'NOTIFICATION_ATTEMPT_TRANSITION_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_attempt_guard BEFORE UPDATE ON notification_delivery_attempts FOR EACH ROW EXECUTE FUNCTION protect_notification_attempt();
CREATE INDEX notification_reconciliation_due ON notifications(org_id,reconcile_after,id) WHERE gateway_state IN('UNCERTAIN','ACCEPTED');
