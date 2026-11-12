-- Pre-authentication security metadata, like otp_challenges/sessions: no raw
-- destinations, OTPs, links, provider payloads or credentials are retained.
SET ROLE tc_migrator;
CREATE TABLE auth_delivery_attempts (
  id UUID PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('LOGIN_OTP','GUEST_OTP','INVITATION')),
  target_id UUID NOT NULL,
  org_id UUID REFERENCES organisations(id),
  actor_user_id UUID REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUBMITTED','AMBIGUOUS','DELIVERED','FAILED','EXPIRED')),
  provider_message_id TEXT CHECK (provider_message_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  reconcile_count INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_count BETWEEN 0 AND 20),
  next_reconcile_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 seconds',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_kind,target_id),
  UNIQUE (channel,provider_message_id),
  CHECK ((target_kind='LOGIN_OTP' AND org_id IS NULL) OR
         (target_kind IN ('GUEST_OTP','INVITATION') AND org_id IS NOT NULL))
);
CREATE INDEX auth_delivery_reconcile_due ON auth_delivery_attempts(next_reconcile_at)
 WHERE status IN ('PENDING','AMBIGUOUS','SUBMITTED');
CREATE TABLE auth_delivery_receipts (
  event_id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES auth_delivery_attempts(id),
  provider_message_id TEXT NOT NULL CHECK (provider_message_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','DELIVERED','FAILED')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_delivery_receipts_attempt ON auth_delivery_receipts(attempt_id);
REVOKE ALL ON auth_delivery_attempts,auth_delivery_receipts FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON auth_delivery_attempts TO tc_app;
GRANT SELECT,INSERT ON auth_delivery_receipts TO tc_app;
-- Default privileges grant UPDATE/DELETE to tc_app; explicitly remove them
-- from the append-only, redacted receipt history.
REVOKE UPDATE,DELETE ON auth_delivery_receipts FROM tc_app;
REVOKE DELETE ON auth_delivery_attempts FROM tc_app;
ALTER TABLE auth_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_delivery_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_delivery_attempts_scope ON auth_delivery_attempts TO tc_app
 USING(org_id IS NULL OR org_id=NULLIF(current_setting('app.current_org',true),'')::uuid)
 WITH CHECK(org_id IS NULL OR org_id=NULLIF(current_setting('app.current_org',true),'')::uuid);
CREATE POLICY auth_delivery_attempts_operator ON auth_delivery_attempts TO tc_migrator USING(true) WITH CHECK(true);
ALTER TABLE auth_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_delivery_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_delivery_receipts_scope ON auth_delivery_receipts TO tc_app
 USING(EXISTS(SELECT 1 FROM auth_delivery_attempts a WHERE a.id=attempt_id))
 WITH CHECK(EXISTS(SELECT 1 FROM auth_delivery_attempts a WHERE a.id=attempt_id));
CREATE POLICY auth_delivery_receipts_operator ON auth_delivery_receipts TO tc_migrator USING(true) WITH CHECK(true);

-- Callback authentication happens before this opaque-ID lookup. It reveals
-- scope only, never tenant payload or credentials, and does not authorize any
-- tenant business operation. Actual receipt writes use scoped tc_app queries.
CREATE FUNCTION auth_delivery_attempt_scope(p_id UUID)
RETURNS TABLE(org_id UUID,actor_user_id UUID) LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
 SELECT a.org_id,a.actor_user_id FROM auth_delivery_attempts a WHERE a.id=p_id
$$;
CREATE FUNCTION claim_auth_delivery_reconciliation(p_limit INTEGER DEFAULT 20)
RETURNS TABLE(id UUID,channel TEXT,provider_message_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF session_user<>'tc_app' THEN RAISE EXCEPTION 'RUNTIME_LOGIN_REQUIRED' USING ERRCODE='42501';END IF;
 WITH expired AS(SELECT a.id FROM auth_delivery_attempts a
  WHERE a.status IN ('PENDING','AMBIGUOUS','SUBMITTED') AND a.expires_at<=now()
  ORDER BY a.expires_at,a.id FOR UPDATE SKIP LOCKED LIMIT LEAST(50,GREATEST(1,p_limit)))
 UPDATE auth_delivery_attempts a SET status='EXPIRED',updated_at=now() FROM expired WHERE a.id=expired.id;
 RETURN QUERY WITH due AS(SELECT a.id FROM auth_delivery_attempts a
  WHERE a.status IN ('PENDING','AMBIGUOUS','SUBMITTED') AND a.expires_at>now()
   AND a.reconcile_count<20 AND a.next_reconcile_at<=now()
  ORDER BY a.next_reconcile_at,a.id FOR UPDATE SKIP LOCKED LIMIT LEAST(50,GREATEST(1,p_limit)))
 UPDATE auth_delivery_attempts a SET reconcile_count=a.reconcile_count+1,
  next_reconcile_at=now()+make_interval(secs=>LEAST(120,15*(a.reconcile_count+1))),updated_at=now()
 FROM due WHERE a.id=due.id RETURNING a.id,a.channel,a.provider_message_id;
END $$;
REVOKE ALL ON FUNCTION auth_delivery_attempt_scope(UUID),claim_auth_delivery_reconciliation(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_delivery_attempt_scope(UUID),claim_auth_delivery_reconciliation(INTEGER) TO tc_app;
CREATE FUNCTION forbid_auth_delivery_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'AUTH_DELIVERY_RECEIPT_IMMUTABLE' USING ERRCODE='42501'; END $$;
CREATE TRIGGER auth_delivery_receipts_immutable BEFORE UPDATE OR DELETE ON auth_delivery_receipts
 FOR EACH ROW EXECUTE FUNCTION forbid_auth_delivery_receipt_mutation();
RESET ROLE;
