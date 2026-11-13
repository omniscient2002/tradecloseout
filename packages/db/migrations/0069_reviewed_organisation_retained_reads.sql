DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tc_org_recovery_reviewer') THEN
  CREATE ROLE tc_org_recovery_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
CREATE TABLE organisation_retained_read_grants(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organisations(id),org_row_version integer NOT NULL,
 suspension_kind text NOT NULL CHECK(suspension_kind IN('BILLING','POLICY')),
 evidence_ref text NOT NULL,reviewer_identity text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,revoked_by text,
 CHECK(expires_at>created_at),CHECK((revoked_at IS NULL)=(revoked_by IS NULL))
);
ALTER TABLE organisation_retained_read_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_retained_read_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_retained_read_scope ON organisation_retained_read_grants FOR SELECT USING(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT ON organisation_retained_read_grants TO tc_app;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON organisation_retained_read_grants FROM tc_app;
CREATE FUNCTION protect_retained_read_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.org_id,NEW.org_row_version,NEW.suspension_kind,NEW.evidence_ref,NEW.reviewer_identity,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.org_row_version,OLD.suspension_kind,OLD.evidence_ref,OLD.reviewer_identity,OLD.created_at,OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'RETAINED_READ_GRANT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_read_grant_immutable BEFORE UPDATE OR DELETE ON organisation_retained_read_grants FOR EACH ROW EXECUTE FUNCTION protect_retained_read_grant();
CREATE FUNCTION review_organisation_retained_reads(grant_id uuid,organisation_id uuid,kind text,evidence text,expiry timestamptz)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o organisations;existing organisation_retained_read_grants;
BEGIN
 IF session_user='tc_app' OR NOT pg_has_role(session_user,'tc_org_recovery_reviewer','MEMBER')
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'ACCOUNTABLE_RECOVERY_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF kind NOT IN('BILLING','POLICY') OR kind IS NULL OR evidence IS NULL OR length(evidence)>1000
  OR evidence !~ '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$' OR expiry IS NULL OR expiry<=now() OR expiry>now()+interval '30 days' THEN
  RAISE EXCEPTION 'INVALID_RETAINED_READ_REVIEW'; END IF;
 SELECT * INTO o FROM organisations WHERE id=organisation_id FOR UPDATE;
 IF NOT FOUND OR o.status<>'SUSPENDED' THEN RAISE EXCEPTION 'SUSPENDED_ORGANISATION_REQUIRED'; END IF;
 SELECT * INTO existing FROM organisation_retained_read_grants WHERE id=grant_id;
 IF FOUND THEN
  IF ROW(existing.org_id,existing.org_row_version,existing.suspension_kind,existing.evidence_ref,existing.reviewer_identity,existing.expires_at)
   IS DISTINCT FROM ROW(organisation_id,o.row_version,kind,evidence,session_user::text,expiry) OR existing.revoked_at IS NOT NULL THEN
   RAISE EXCEPTION 'RETAINED_READ_REVIEW_REPLAY_CONFLICT'; END IF;
  RETURN grant_id;
 END IF;
 INSERT INTO organisation_retained_read_grants(id,org_id,org_row_version,suspension_kind,evidence_ref,reviewer_identity,expires_at)
 VALUES(grant_id,organisation_id,o.row_version,kind,evidence,session_user,expiry);
 RETURN grant_id;
END $$;
CREATE FUNCTION revoke_organisation_retained_reads(grant_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF session_user='tc_app' OR NOT pg_has_role(session_user,'tc_org_recovery_reviewer','MEMBER')
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'ACCOUNTABLE_RECOVERY_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;
 -- Match the account -> organisation -> grant lock order used by normal transactions.
 PERFORM 1 FROM organisations WHERE id=(SELECT org_id FROM organisation_retained_read_grants WHERE id=grant_id) FOR UPDATE;
 UPDATE organisation_retained_read_grants SET revoked_at=now(),revoked_by=session_user WHERE id=grant_id AND revoked_at IS NULL;
END $$;
CREATE FUNCTION organisation_has_retained_read_access(organisation_id uuid,member_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM organisations o JOIN memberships m ON m.org_id=o.id AND m.user_id=member_id AND m.status='ACTIVE'
  JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' JOIN organisation_retained_read_grants g ON g.org_id=o.id AND g.org_row_version=o.row_version
  WHERE o.id=organisation_id AND o.status='SUSPENDED' AND g.revoked_at IS NULL AND g.expires_at>statement_timestamp())
$$;
REVOKE ALL ON FUNCTION review_organisation_retained_reads(uuid,uuid,text,text,timestamptz),revoke_organisation_retained_reads(uuid),organisation_has_retained_read_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_organisation_retained_reads(uuid,uuid,text,text,timestamptz),revoke_organisation_retained_reads(uuid) TO tc_org_recovery_reviewer;
GRANT EXECUTE ON FUNCTION organisation_has_retained_read_access(uuid,uuid) TO tc_app;

-- Transaction-local read mode fences accidental business writes in an allowed
-- read handler. Audit/outbox append paths remain available for download history.
CREATE FUNCTION fence_retained_organisation_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('app.retained_organisation_read',true)='true' THEN
  RAISE EXCEPTION 'AUTH_RETAINED_ACCESS_READ_ONLY' USING ERRCODE='42501'; END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN pg_class pc ON pc.relname=c.table_name
  JOIN pg_namespace pn ON pn.oid=pc.relnamespace AND pn.nspname='public'
  WHERE c.table_schema='public' AND (c.column_name='org_id' OR c.table_name='organisations')
    AND pc.relkind IN('r','p') AND NOT pc.relispartition
    AND c.table_name NOT LIKE 'audit\_%' ESCAPE '\' AND c.table_name NOT LIKE 'admin\_audit\_%' ESCAPE '\'
    AND c.table_name NOT IN('auth_security_events','outbox_events')
 LOOP
  EXECUTE format('CREATE TRIGGER retained_read_write_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION fence_retained_organisation_write()',t.table_name);
 END LOOP;
END $$;
