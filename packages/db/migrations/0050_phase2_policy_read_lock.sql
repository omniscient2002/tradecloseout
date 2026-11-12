-- FOR SHARE requires UPDATE privilege. Keep policy approvals read-only to the
-- application and expose only a tenant-bound, narrow locking read instead.
CREATE FUNCTION lock_current_billing_policy(target_policy_id uuid)
RETURNS TABLE(policy_version text,policy_status text,policy_approved_at timestamptz,policy_grace_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.policy_version_id=target_policy_id
    AND s.org_id=current_setting('app.current_org',true)::uuid) THEN RETURN; END IF;
 RETURN QUERY SELECT bp.version,bp.status,bp.approved_at,bp.grace_seconds
  FROM public.billing_policy_versions bp WHERE bp.id=target_policy_id FOR SHARE OF bp;
END $$;
REVOKE ALL ON FUNCTION lock_current_billing_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_current_billing_policy(uuid) TO tc_app;
