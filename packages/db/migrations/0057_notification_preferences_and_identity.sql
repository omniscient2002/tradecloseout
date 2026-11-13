-- Fail on conflicting legacy identities; never rewrite delivered content.
DROP INDEX notifications_dedup_uq;
CREATE UNIQUE INDEX notifications_dedup_uq ON notifications
 (org_id,dedup_key,channel,recipient_user_id,recipient_party_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX notification_preference_identity_uq ON notification_preferences(org_id,user_id,category,channel);
ALTER TABLE notification_preferences ADD COLUMN row_version integer NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE notifications ADD COLUMN category text NOT NULL DEFAULT 'WORK';
ALTER TABLE notifications ADD COLUMN urgent boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN expires_at timestamptz;
ALTER TABLE notifications ADD COLUMN provider_message_id text;
ALTER TABLE notifications ADD COLUMN receipt_sequence integer NOT NULL DEFAULT 0;
CREATE TABLE notification_delivery_receipts (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,notification_id uuid NOT NULL,
 provider_message_id text NOT NULL,sequence integer NOT NULL CHECK(sequence>0),
 outcome text NOT NULL CHECK(outcome IN('DELIVERED','BOUNCED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,notification_id,sequence)
);
ALTER TABLE notifications ADD CONSTRAINT notifications_org_id_id_unique UNIQUE(org_id,id);
ALTER TABLE notification_delivery_receipts ADD FOREIGN KEY(org_id,notification_id) REFERENCES notifications(org_id,id);
ALTER TABLE notification_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_receipt_tenant ON notification_delivery_receipts
 USING(org_id=current_setting('app.current_org',true)::uuid) WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT,INSERT ON notification_delivery_receipts TO tc_app;
REVOKE UPDATE,DELETE,TRUNCATE ON notification_delivery_receipts FROM tc_app;
CREATE OR REPLACE FUNCTION immutable_notification_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.org_id,NEW.project_id,NEW.recipient_user_id,NEW.recipient_party_id,NEW.channel,NEW.event_key,NEW.payload_json,NEW.dedup_key,NEW.category,NEW.urgent,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.org_id,OLD.project_id,OLD.recipient_user_id,OLD.recipient_party_id,OLD.channel,OLD.event_key,OLD.payload_json,OLD.dedup_key,OLD.category,OLD.urgent,OLD.expires_at)
 THEN RAISE EXCEPTION 'NOTIFICATION_EVENT_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION immutable_notification_content();
