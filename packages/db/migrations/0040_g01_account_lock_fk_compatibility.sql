-- Serialize account/factor writes without conflicting with foreign-key
-- KEY SHARE checks from audited session revocation. No user key is changed.
-- Keep all authority, proof, notification and cooldown predicates unchanged.
SET ROLE tc_migrator;

CREATE OR REPLACE FUNCTION open_identity_recovery_case(p_user UUID,p_digest TEXT,p_ref TEXT,
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
 PERFORM 1 FROM users WHERE id=p_user AND status='ACTIVE' FOR NO KEY UPDATE;
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

CREATE OR REPLACE FUNCTION execute_identity_recovery_case(p_case UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_case identity_recovery_cases%ROWTYPE;v_user UUID;
BEGIN
 PERFORM identity_recovery_require_role('tc_identity_recovery_executor');
 SELECT user_id INTO v_user FROM identity_recovery_cases WHERE id=p_case;
 PERFORM 1 FROM users WHERE id=v_user AND status='ACTIVE' FOR NO KEY UPDATE;
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
RESET ROLE;
