-- A controlled locking read; tc_app retains no UPDATE/publication grant on packs.
CREATE FUNCTION lock_reviewed_hvac_pack_for_organisation(target_pack uuid)
RETURNS SETOF template_packs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
  JOIN public.organisations o ON o.id=m.org_id AND o.status='ACTIVE'
  WHERE m.org_id=nullif(current_setting('app.current_org',true),'')::uuid
   AND m.user_id=nullif(current_setting('app.current_user',true),'')::uuid
   AND m.status='ACTIVE' AND m.role IN('R-OWNER','R-ADMIN')) THEN RETURN; END IF;
 RETURN QUERY SELECT p.* FROM public.template_packs p WHERE p.id=target_pack AND p.trade='HVAC' AND p.status='ACTIVE'
  AND p.governance_version=1 AND p.schema_version=1 AND p.reviewed_at IS NOT NULL
  AND p.reviewer_identity<>p.author_identity AND p.review_record_json IS NOT NULL
  AND p.reviewed_candidate_sha ~ '^[a-f0-9]{40}$'
  AND p.payload_checksum=encode(public.digest(p.payload_json::text,'sha256'),'hex') FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION lock_reviewed_hvac_pack_for_organisation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_reviewed_hvac_pack_for_organisation(uuid) TO tc_app;
