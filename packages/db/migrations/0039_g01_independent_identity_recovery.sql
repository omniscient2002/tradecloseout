-- Human-operated recovery is separate from contractor authority and API MFA.
-- Provision individually accountable LOGINs out of band; no role is granted
-- to tc_app, tc_migrator, the legal-signatory reviewers or the deployment user.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tc_identity_recovery_reviewer') THEN
  CREATE ROLE tc_identity_recovery_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tc_identity_recovery_executor') THEN
  CREATE ROLE tc_identity_recovery_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
SET ROLE tc_migrator;
ALTER TABLE users ADD COLUMN auth_proof_valid_after TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z';
CREATE POLICY auth_security_events_recovery_operator ON auth_security_events FOR INSERT TO tc_migrator WITH CHECK(true);
CREATE POLICY mfa_recovery_codes_recovery_operator ON mfa_recovery_codes TO tc_migrator
 USING(user_id=NULLIF(current_setting('app.current_user',true),'')::uuid)
 WITH CHECK(user_id=NULLIF(current_setting('app.current_user',true),'')::uuid);
CREATE TABLE identity_recovery_cases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('MFA_RESET','CONTACT_REPLACE')),
 new_contact_type TEXT CHECK(new_contact_type IN ('EMAIL','PHONE')),new_contact_value TEXT,
 evidence_digest TEXT NOT NULL CHECK(evidence_digest ~ '^[0-9a-f]{64}$'),
 case_ref TEXT NOT NULL CHECK(case_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
 status TEXT NOT NULL DEFAULT 'REVIEW_PENDING' CHECK(status IN ('REVIEW_PENDING','APPROVED','CANCELLED','EXPIRED','EXECUTED')),
 not_before TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '72 hours',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),executed_at TIMESTAMPTZ,executor NAME,
 cancelled_at TIMESTAMPTZ,cancelled_by NAME,
 CHECK((kind='MFA_RESET' AND new_contact_type IS NULL AND new_contact_value IS NULL) OR
       (kind='CONTACT_REPLACE' AND new_contact_type IS NOT NULL AND new_contact_value IS NOT NULL))
);
CREATE UNIQUE INDEX identity_recovery_one_open_case ON identity_recovery_cases(user_id)
 WHERE status IN ('REVIEW_PENDING','APPROVED');
CREATE TABLE identity_recovery_approvals (
 case_id UUID NOT NULL REFERENCES identity_recovery_cases(id),reviewer NAME NOT NULL,
 approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(case_id,reviewer)
);
CREATE TABLE identity_recovery_notices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),case_id UUID NOT NULL REFERENCES identity_recovery_cases(id),
 channel TEXT NOT NULL CHECK(channel IN ('SMS','EMAIL')),destination TEXT NOT NULL,
 is_new_contact BOOLEAN NOT NULL DEFAULT false,status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK(status IN ('PENDING','SUBMITTED','DELIVERED','FAILED')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),attempted_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,
 UNIQUE(case_id,channel,destination)
);
REVOKE ALL ON identity_recovery_cases,identity_recovery_approvals,identity_recovery_notices
 FROM PUBLIC,tc_app,tc_external_authority_reviewer,tc_identity_recovery_reviewer,tc_identity_recovery_executor;
ALTER TABLE identity_recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_recovery_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_recovery_cases_operator ON identity_recovery_cases TO tc_migrator USING(true) WITH CHECK(true);
ALTER TABLE identity_recovery_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_recovery_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_recovery_approvals_operator ON identity_recovery_approvals TO tc_migrator USING(true) WITH CHECK(true);
ALTER TABLE identity_recovery_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_recovery_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_recovery_notices_operator ON identity_recovery_notices TO tc_migrator USING(true) WITH CHECK(true);
CREATE FUNCTION identity_recovery_forbid_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IDENTITY_RECOVERY_APPROVAL_IMMUTABLE' USING ERRCODE='42501'; END $$;
CREATE TRIGGER identity_recovery_approval_immutable BEFORE UPDATE OR DELETE ON identity_recovery_approvals
 FOR EACH ROW EXECUTE FUNCTION identity_recovery_forbid_approval_mutation();

CREATE FUNCTION identity_recovery_require_role(p_role TEXT) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
BEGIN
 IF session_user IN ('postgres','tc_app','tc_migrator') OR
   pg_has_role(session_user,'tc_migrator','MEMBER') OR pg_has_role(session_user,'tc_app','MEMBER') OR
   NOT pg_has_role(session_user,p_role,'MEMBER') OR NOT EXISTS(
    SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper
      AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN
  RAISE EXCEPTION 'INDEPENDENT_IDENTITY_RECOVERY_ROLE_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION open_identity_recovery_case(p_user UUID,p_digest TEXT,p_ref TEXT,
 p_contact_type TEXT DEFAULT NULL,p_contact_value TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_case UUID;v_value TEXT;v_contact TEXT;
BEGIN
 PERFORM identity_recovery_require_role('tc_identity_recovery_reviewer');
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_ref IS NULL OR p_ref !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_INDEPENDENT_EVIDENCE_REQUIRED' USING ERRCODE='22023';
 END IF;
 IF (p_contact_type IS NULL)<>(p_contact_value IS NULL) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_CONTACT_INVALID' USING ERRCODE='22023';
 END IF;
 v_value:=lower(btrim(p_contact_value));
 IF p_contact_type IS NOT NULL AND (p_contact_type NOT IN ('EMAIL','PHONE') OR
    char_length(v_value)>254 OR v_value !~ '^[!-~]+$' OR
    (p_contact_type='EMAIL' AND v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR
    (p_contact_type='PHONE' AND v_value !~ '^\+91[6-9][0-9]{9}$')) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_CONTACT_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_contact_type='EMAIL' AND (
   char_length(split_part(v_value,'@',1))>64 OR split_part(v_value,'@',1) LIKE '.%' OR
   split_part(v_value,'@',1) LIKE '%.' OR position('..' IN split_part(v_value,'@',1))>0 OR
   split_part(v_value,'@',1) !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+$' OR
   split_part(v_value,'@',2) !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$') THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_CONTACT_INVALID' USING ERRCODE='22023';
 END IF;
 -- User first, then sessions, then recovery codes: same order as MFA.
 PERFORM 1 FROM users WHERE id=p_user AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM user_identities WHERE user_id=p_user AND verified_at IS NOT NULL) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_ACCOUNT_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF v_value IS NOT NULL AND EXISTS(SELECT 1 FROM user_identities WHERE type=p_contact_type AND value=v_value) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_CONTACT_ALREADY_ASSIGNED' USING ERRCODE='23505';
 END IF;
 UPDATE identity_recovery_cases SET status='EXPIRED'
  WHERE user_id=p_user AND status IN ('REVIEW_PENDING','APPROVED') AND expires_at<=now();
 INSERT INTO identity_recovery_cases(user_id,kind,new_contact_type,new_contact_value,evidence_digest,case_ref)
 VALUES(p_user,CASE WHEN p_contact_type IS NULL THEN 'MFA_RESET' ELSE 'CONTACT_REPLACE' END,
  p_contact_type,v_value,p_digest,p_ref) RETURNING id INTO v_case;
 INSERT INTO identity_recovery_approvals(case_id,reviewer) VALUES(v_case,session_user);
 INSERT INTO identity_recovery_notices(case_id,channel,destination)
  SELECT v_case,CASE WHEN type='PHONE' THEN 'SMS' ELSE 'EMAIL' END,value
  FROM user_identities WHERE user_id=p_user AND verified_at IS NOT NULL;
 IF v_value IS NOT NULL THEN
  INSERT INTO identity_recovery_notices(case_id,channel,destination,is_new_contact)
   VALUES(v_case,CASE WHEN p_contact_type='PHONE' THEN 'SMS' ELSE 'EMAIL' END,v_value,true);
 END IF;
 -- First independent review starts containment and the notification window;
 -- it does not clear factors, replace contacts or mint a session.
 UPDATE sessions SET revoked_at=now(),mfa_verified=false,mfa_verified_at=NULL
  WHERE user_id=p_user AND revoked_at IS NULL;
 INSERT INTO auth_security_events(id,actor_user_id,event_type,outcome,subject_digest)
  VALUES(gen_random_uuid(),p_user,'IDENTITY_RECOVERY_REVIEW_STARTED','SUCCESS',encode(digest(v_case::text,'sha256'),'hex'));
 RETURN v_case;
END $$;

CREATE FUNCTION attest_identity_recovery_case(p_case UUID,p_digest TEXT,p_ref TEXT,p_user UUID,
 p_contact_type TEXT DEFAULT NULL,p_contact_value TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_case identity_recovery_cases%ROWTYPE;v_count INTEGER;
BEGIN
 PERFORM identity_recovery_require_role('tc_identity_recovery_reviewer');
 SELECT * INTO v_case FROM identity_recovery_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR v_case.status<>'REVIEW_PENDING' OR v_case.expires_at<=now() THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_CASE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF p_digest IS DISTINCT FROM v_case.evidence_digest OR p_ref IS DISTINCT FROM v_case.case_ref OR
   p_user IS DISTINCT FROM v_case.user_id OR p_contact_type IS DISTINCT FROM v_case.new_contact_type OR
   lower(btrim(p_contact_value)) IS DISTINCT FROM v_case.new_contact_value THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_EVIDENCE_MISMATCH' USING ERRCODE='22023';
 END IF;
 INSERT INTO identity_recovery_approvals(case_id,reviewer) VALUES(p_case,session_user);
 SELECT count(*)::int INTO v_count FROM identity_recovery_approvals WHERE case_id=p_case;
 IF v_count>=2 THEN UPDATE identity_recovery_cases SET status='APPROVED' WHERE id=p_case;END IF;
 RETURN v_count;
END $$;

CREATE FUNCTION cancel_identity_recovery_case(p_case UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user UUID;
BEGIN
 PERFORM identity_recovery_require_role('tc_identity_recovery_reviewer');
 UPDATE identity_recovery_cases SET status='CANCELLED',cancelled_at=now(),cancelled_by=session_user
  WHERE id=p_case AND status IN ('REVIEW_PENDING','APPROVED') RETURNING user_id INTO v_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_RECOVERY_CASE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 INSERT INTO auth_security_events(id,actor_user_id,event_type,outcome,subject_digest)
  VALUES(gen_random_uuid(),v_user,'IDENTITY_RECOVERY_CANCELLED','SUCCESS',encode(digest(p_case::text,'sha256'),'hex'));
END $$;

CREATE FUNCTION inspect_identity_recovery_case(p_case UUID)
RETURNS TABLE(case_id UUID,user_id UUID,kind TEXT,status TEXT,not_before TIMESTAMPTZ,expires_at TIMESTAMPTZ,
 reviewer_count INTEGER,notification_window_complete BOOLEAN,contact_confirmation_complete BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF pg_has_role(session_user,'tc_identity_recovery_reviewer','MEMBER') THEN
  PERFORM identity_recovery_require_role('tc_identity_recovery_reviewer');
 ELSE PERFORM identity_recovery_require_role('tc_identity_recovery_executor');END IF;
 RETURN QUERY SELECT c.id,c.user_id,c.kind,c.status,c.not_before,c.expires_at,
  (SELECT count(*)::int FROM identity_recovery_approvals a WHERE a.case_id=c.id),
  EXISTS(SELECT 1 FROM identity_recovery_notices n WHERE n.case_id=c.id AND NOT n.is_new_contact) AND
   NOT EXISTS(SELECT 1 FROM identity_recovery_notices n WHERE n.case_id=c.id AND NOT n.is_new_contact
     AND (n.attempted_at IS NULL OR n.attempted_at>now()-interval '24 hours')),
  c.kind='MFA_RESET' OR EXISTS(SELECT 1 FROM identity_recovery_notices n
    WHERE n.case_id=c.id AND n.is_new_contact AND n.delivered_at IS NOT NULL)
  FROM identity_recovery_cases c WHERE c.id=p_case;
END $$;

CREATE FUNCTION execute_identity_recovery_case(p_case UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_case identity_recovery_cases%ROWTYPE;v_user UUID;
BEGIN
 PERFORM identity_recovery_require_role('tc_identity_recovery_executor');
 SELECT user_id INTO v_user FROM identity_recovery_cases WHERE id=p_case;
 PERFORM 1 FROM users WHERE id=v_user AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_RECOVERY_ACCOUNT_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO v_case FROM identity_recovery_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR v_case.status<>'APPROVED' OR v_case.expires_at<=now() OR v_case.not_before>now() OR
   (SELECT count(DISTINCT reviewer) FROM identity_recovery_approvals WHERE case_id=p_case)<2 OR
   EXISTS(SELECT 1 FROM identity_recovery_approvals WHERE case_id=p_case AND reviewer=session_user) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_APPROVAL_OR_COOLDOWN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM identity_recovery_notices WHERE case_id=p_case AND NOT is_new_contact) OR
   EXISTS(SELECT 1 FROM identity_recovery_notices WHERE case_id=p_case AND NOT is_new_contact
     AND (attempted_at IS NULL OR attempted_at>now()-interval '24 hours')) OR
   (v_case.kind='CONTACT_REPLACE' AND NOT EXISTS(SELECT 1 FROM identity_recovery_notices
     WHERE case_id=p_case AND is_new_contact AND delivered_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'IDENTITY_RECOVERY_NOTIFICATION_WINDOW_REQUIRED' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('app.current_user',v_case.user_id::text,true);
 IF v_case.kind='CONTACT_REPLACE' THEN
  PERFORM pg_advisory_xact_lock(hashtext('identity-recovery-contact:'||v_case.new_contact_value));
  IF EXISTS(SELECT 1 FROM user_identities WHERE type=v_case.new_contact_type AND value=v_case.new_contact_value) THEN
   RAISE EXCEPTION 'IDENTITY_RECOVERY_CONTACT_ALREADY_ASSIGNED' USING ERRCODE='23505';
  END IF;
  DELETE FROM user_identities WHERE user_id=v_case.user_id AND type=v_case.new_contact_type;
  INSERT INTO user_identities(id,user_id,type,value,verified_at)
   VALUES(gen_random_uuid(),v_case.user_id,v_case.new_contact_type,v_case.new_contact_value,now());
  UPDATE users SET email_display=CASE WHEN v_case.new_contact_type='EMAIL' THEN v_case.new_contact_value ELSE email_display END,
   phone_display=CASE WHEN v_case.new_contact_type='PHONE' THEN v_case.new_contact_value ELSE phone_display END
   WHERE id=v_case.user_id;
 END IF;
 UPDATE users SET mfa_totp_secret=NULL,mfa_totp_pending_secret=NULL,mfa_totp_last_step=-1,
  mfa_enabled_at=NULL,auth_proof_valid_after=clock_timestamp(),
  row_version=row_version+1,updated_at=now() WHERE id=v_case.user_id;
 UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()),mfa_verified=false,mfa_verified_at=NULL WHERE user_id=v_case.user_id;
 DELETE FROM mfa_recovery_codes WHERE user_id=v_case.user_id;
 UPDATE identity_recovery_cases SET status='EXECUTED',executed_at=now(),executor=session_user WHERE id=p_case;
 INSERT INTO auth_security_events(id,actor_user_id,event_type,outcome,subject_digest)
  VALUES(gen_random_uuid(),v_case.user_id,'IDENTITY_RECOVERY_EXECUTED','SUCCESS',encode(digest(p_case::text,'sha256'),'hex'));
END $$;

CREATE FUNCTION claim_identity_recovery_notices(p_limit INTEGER DEFAULT 10)
RETURNS TABLE(id UUID,user_id UUID,channel TEXT,destination TEXT,case_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF session_user<>'tc_app' THEN RAISE EXCEPTION 'RUNTIME_LOGIN_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN QUERY WITH due AS(SELECT n.id FROM identity_recovery_notices n JOIN identity_recovery_cases c ON c.id=n.case_id
  WHERE n.status='PENDING' AND n.attempt_count<5 AND n.next_attempt_at<=now()
   AND c.status IN ('REVIEW_PENDING','APPROVED') AND c.expires_at>now()
  ORDER BY n.next_attempt_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT LEAST(20,GREATEST(1,p_limit)))
 UPDATE identity_recovery_notices n SET attempt_count=attempt_count+1,next_attempt_at=now()+interval '2 minutes'
 FROM due,identity_recovery_cases c WHERE n.id=due.id AND c.id=n.case_id
 RETURNING n.id,c.user_id,n.channel,n.destination,n.case_id;
END $$;
CREATE FUNCTION identity_recovery_notice_expiry(p_notice UUID,p_user UUID) RETURNS TIMESTAMPTZ
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT c.expires_at FROM identity_recovery_notices n JOIN identity_recovery_cases c ON c.id=n.case_id
 WHERE n.id=p_notice AND c.user_id=p_user AND c.status IN ('REVIEW_PENDING','APPROVED') AND c.expires_at>now()
$$;
CREATE FUNCTION record_identity_recovery_notice_receipt(p_notice UUID) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE identity_recovery_notices n SET status=a.status,
  attempted_at=COALESCE(n.attempted_at,now()),
  delivered_at=CASE WHEN a.status='DELIVERED' THEN COALESCE(n.delivered_at,now()) ELSE n.delivered_at END
 FROM auth_delivery_attempts a,identity_recovery_cases c
 WHERE a.target_kind='RECOVERY_NOTICE' AND a.target_id=n.id AND n.id=p_notice AND c.id=n.case_id
  AND c.status IN ('REVIEW_PENDING','APPROVED') AND c.expires_at>now()
  AND a.status IN ('SUBMITTED','DELIVERED','FAILED')
$$;

REVOKE ALL ON FUNCTION identity_recovery_require_role(TEXT),identity_recovery_forbid_approval_mutation(),
 open_identity_recovery_case(UUID,TEXT,TEXT,TEXT,TEXT),attest_identity_recovery_case(UUID,TEXT,TEXT,UUID,TEXT,TEXT),
 cancel_identity_recovery_case(UUID),inspect_identity_recovery_case(UUID),execute_identity_recovery_case(UUID),claim_identity_recovery_notices(INTEGER),
 identity_recovery_notice_expiry(UUID,UUID),record_identity_recovery_notice_receipt(UUID) FROM PUBLIC,tc_app;
GRANT EXECUTE ON FUNCTION open_identity_recovery_case(UUID,TEXT,TEXT,TEXT,TEXT),attest_identity_recovery_case(UUID,TEXT,TEXT,UUID,TEXT,TEXT),
 cancel_identity_recovery_case(UUID) TO tc_identity_recovery_reviewer;
GRANT EXECUTE ON FUNCTION execute_identity_recovery_case(UUID) TO tc_identity_recovery_executor;
GRANT EXECUTE ON FUNCTION inspect_identity_recovery_case(UUID) TO tc_identity_recovery_reviewer,tc_identity_recovery_executor;
GRANT EXECUTE ON FUNCTION claim_identity_recovery_notices(INTEGER),identity_recovery_notice_expiry(UUID,UUID),
 record_identity_recovery_notice_receipt(UUID) TO tc_app;
ALTER TABLE auth_delivery_attempts DROP CONSTRAINT auth_delivery_attempts_target_kind_check;
ALTER TABLE auth_delivery_attempts ADD CONSTRAINT auth_delivery_attempts_target_kind_check
 CHECK(target_kind IN ('LOGIN_OTP','GUEST_OTP','INVITATION','RECOVERY_NOTICE'));
-- Replace the unnamed org-scope check with an explicit expanded contract.
ALTER TABLE auth_delivery_attempts DROP CONSTRAINT auth_delivery_attempts_check;
ALTER TABLE auth_delivery_attempts ADD CONSTRAINT auth_delivery_attempts_org_scope
 CHECK((target_kind IN ('LOGIN_OTP','RECOVERY_NOTICE') AND org_id IS NULL) OR
       (target_kind IN ('GUEST_OTP','INVITATION') AND org_id IS NOT NULL));
RESET ROLE;
