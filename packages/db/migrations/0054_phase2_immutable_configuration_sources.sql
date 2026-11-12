-- A stored definition is immutable. ACTIVE denotes selection/publication state;
-- it does not certify HVAC qualification or independent business approval.
ALTER TABLE config_versions
 ADD COLUMN format_version integer,
 ADD COLUMN source_manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX config_versions_scope_checksum_idx ON config_versions(org_id,level,scope_id,checksum)
 WHERE format_version=1;

CREATE FUNCTION phase2_config_digest(payload jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT encode(public.digest(payload::text,'sha256'),'hex')
$$;
CREATE FUNCTION phase2_configuration_source_invariants() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE normalised boolean:=false;stripped_provenance boolean:=false;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONFIGURATION_VERSION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.org_id,NEW.level,NEW.scope_type,NEW.scope_id,NEW.version_no,NEW.schema_version,NEW.payload_json,
       NEW.checksum,NEW.source_pack_id,NEW.created_by,NEW.created_at,NEW.format_version,NEW.source_manifest_json)
     IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.level,OLD.scope_type,OLD.scope_id,OLD.version_no,OLD.schema_version,OLD.payload_json,
       OLD.checksum,OLD.source_pack_id,OLD.created_by,OLD.created_at,OLD.format_version,OLD.source_manifest_json) THEN
   RAISE EXCEPTION 'CONFIGURATION_VERSION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.status='ARCHIVED' AND NEW.status<>'ARCHIVED' THEN
   RAISE EXCEPTION 'CONFIGURATION_VERSION_RETIRED' USING ERRCODE='23514'; END IF;
  IF OLD.status='ACTIVE' AND NEW.status NOT IN('ACTIVE','ARCHIVED') THEN
   RAISE EXCEPTION 'CONFIGURATION_VERSION_CANNOT_UNPUBLISH' USING ERRCODE='23514'; END IF;
  IF OLD.published_at IS NOT NULL THEN NEW.published_at:=OLD.published_at;
  ELSIF NEW.status='ACTIVE' THEN NEW.published_at:=now(); ELSE NEW.published_at:=NULL; END IF;
  RETURN NEW;
 END IF;
 IF NEW.format_version IS DISTINCT FROM 1 OR NEW.schema_version<>1 OR NEW.version_no<1
   OR jsonb_typeof(NEW.payload_json)<>'object' OR octet_length(NEW.payload_json::text)>1048576
   OR jsonb_typeof(NEW.source_manifest_json)<>'object' OR octet_length(NEW.source_manifest_json::text)>16384 THEN
  RAISE EXCEPTION 'CONFIGURATION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.payload_json ? 'requirements' AND NEW.payload_json ? 'checklist.requirements' THEN
  RAISE EXCEPTION 'CONFIGURATION_MIXED_REQUIREMENT_ENCODINGS' USING ERRCODE='23514';
 ELSIF NEW.payload_json ? 'checklist.requirements' THEN
  NEW.payload_json:=(NEW.payload_json-'checklist.requirements')||jsonb_build_object('requirements',NEW.payload_json->'checklist.requirements');
  normalised:=true;
 END IF;
 IF jsonb_typeof(NEW.payload_json->'requirements')='array' THEN
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.payload_json->'requirements') item
    WHERE jsonb_typeof(item)='object' AND item ? 'provenanceLevel') INTO stripped_provenance;
  NEW.payload_json:=jsonb_set(NEW.payload_json,'{requirements}',COALESCE((SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(item)='object' THEN item-'provenanceLevel' ELSE item END ORDER BY position)
    FROM jsonb_array_elements(NEW.payload_json->'requirements') WITH ORDINALITY AS x(item,position)),'[]'::jsonb));
 END IF;
 IF NEW.level='PLATFORM' THEN
  IF NEW.org_id IS NOT NULL OR NEW.scope_type<>'GLOBAL' OR NEW.scope_id<>'00000000-0000-0000-0000-000000000000'::uuid THEN
   RAISE EXCEPTION 'CONFIGURATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 ELSIF NEW.org_id IS NULL OR NOT (
  (NEW.level='ORG' AND NEW.scope_type='ORGANISATION' AND NEW.scope_id=NEW.org_id) OR
  (NEW.level='PROJECT' AND NEW.scope_type='PROJECT' AND EXISTS(SELECT 1 FROM public.projects WHERE org_id=NEW.org_id AND id=NEW.scope_id)) OR
  (NEW.level='CLIENT_CONTRACT' AND NEW.scope_type='CONTRACT' AND EXISTS(SELECT 1 FROM public.contracts WHERE org_id=NEW.org_id AND id=NEW.scope_id))
 ) THEN RAISE EXCEPTION 'CONFIGURATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF current_user='tc_app' AND (NEW.created_by IS DISTINCT FROM nullif(current_setting('app.current_user',true),'')::uuid OR
    NEW.created_by IS NULL OR NEW.level='PLATFORM') THEN
  RAISE EXCEPTION 'CONFIGURATION_AUTHOR_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NEW.source_pack_id IS NOT NULL AND (NEW.level<>'ORG' OR NOT EXISTS(
   SELECT 1 FROM public.template_packs p WHERE p.id=NEW.source_pack_id AND p.trade='HVAC' AND p.status='ACTIVE'
    AND p.governance_version=1 AND p.reviewed_at IS NOT NULL AND p.reviewer_identity<>p.author_identity
    AND p.review_record_json IS NOT NULL AND p.payload_checksum=public.phase2_config_digest(NEW.payload_json)
 )) THEN RAISE EXCEPTION 'CONFIGURATION_REVIEWED_PACK_REQUIRED' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();
 NEW.published_at:=CASE WHEN NEW.status='ACTIVE' THEN now() ELSE NULL END;
 NEW.checksum:=public.phase2_config_digest(NEW.payload_json);
 NEW.source_manifest_json:=NEW.source_manifest_json||jsonb_build_object(
   'databaseRole',current_user,'databaseSessionIdentity',session_user,'createdByUserId',NEW.created_by,
   'definitionEncoding','ROOT_REQUIREMENTS_V1','normalisedLegacyEncoding',normalised,'normalisedGeneratedProvenance',stripped_provenance);
 IF octet_length(NEW.source_manifest_json::text)>16384 THEN RAISE EXCEPTION 'CONFIGURATION_SOURCE_MANIFEST_TOO_LARGE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase2_configuration_source_guard BEFORE INSERT OR UPDATE OR DELETE ON config_versions
 FOR EACH ROW EXECUTE FUNCTION phase2_configuration_source_invariants();

DROP POLICY tenant_write ON config_versions;
CREATE POLICY tenant_config_insert ON config_versions FOR INSERT TO tc_app WITH CHECK(
 org_id=nullif(current_setting('app.current_org',true),'')::uuid AND format_version=1
 AND level IN('ORG','CLIENT_CONTRACT','PROJECT'));
CREATE POLICY tenant_config_update ON config_versions FOR UPDATE TO tc_app USING(
 org_id=nullif(current_setting('app.current_org',true),'')::uuid AND level IN('ORG','CLIENT_CONTRACT','PROJECT'))
 WITH CHECK(org_id=nullif(current_setting('app.current_org',true),'')::uuid AND level IN('ORG','CLIENT_CONTRACT','PROJECT'));
-- The schema-owning migration role can introduce a reviewed platform release;
-- the runtime has no platform-authoring path or role membership.
CREATE POLICY platform_config_release ON config_versions FOR INSERT TO tc_migrator WITH CHECK(
 org_id IS NULL AND level='PLATFORM' AND scope_type='GLOBAL');

-- Runtime may author a new tenant definition and change selection state only.
-- Payload/identity edits, truncate and trigger attachment are not granted.
REVOKE ALL ON config_versions FROM PUBLIC,tc_app;
GRANT SELECT,INSERT ON config_versions TO tc_app;
GRANT UPDATE(status) ON config_versions TO tc_app;

-- SELECT FOR SHARE also applies UPDATE RLS. A tenant UPDATE policy correctly
-- excludes global rows; use a scoped locking read instead of granting a global
-- UPDATE path. DRAFT tenant definitions take their eventual write lock first,
-- avoiding shared-to-exclusive upgrades when two projects select one version.
CREATE FUNCTION lock_project_configuration_sources(target_project uuid,source_ids uuid[],application boolean)
RETURNS SETOF config_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_org uuid:=nullif(current_setting('app.current_org',true),'')::uuid;
 target_user uuid:=nullif(current_setting('app.current_user',true),'')::uuid;source record;
BEGIN
 IF target_org IS NULL OR target_user IS NULL OR cardinality(source_ids) NOT BETWEEN 1 AND 4 THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects p JOIN public.organisations o ON o.id=p.org_id
   JOIN public.memberships m ON m.org_id=p.org_id AND m.user_id=target_user AND m.status='ACTIVE'
   JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
   WHERE p.id=target_project AND p.org_id=target_org AND p.purged_at IS NULL
    AND (o.status='ACTIVE' OR (NOT application AND o.status='SUSPENDED'))
    AND (NOT application OR p.status IN('DRAFT','ACTIVE','HANDOVER'))
    AND (m.role IN('R-OWNER','R-ADMIN') OR EXISTS(SELECT 1 FROM public.project_members pm
      WHERE pm.org_id=target_org AND pm.project_id=target_project AND pm.user_id=target_user AND pm.status='ACTIVE'
       AND (m.role='R-PM' OR pm.role IN('R-PM','R-OWNER','R-ADMIN'))
       AND CASE WHEN pm.scope_json IS NULL THEN true WHEN jsonb_typeof(pm.scope_json)='object' THEN
        pm.scope_json-'readOnly'-'mode'='{}'::jsonb AND COALESCE(pm.scope_json->'readOnly','false'::jsonb)='false'::jsonb
         AND COALESCE(pm.scope_json->'mode','"READ_WRITE"'::jsonb)='"READ_WRITE"'::jsonb
        ELSE false END))) THEN RETURN; END IF;
 FOR source IN SELECT c.id,c.org_id,c.status FROM public.config_versions c
  WHERE c.id=ANY(source_ids) AND (
   (c.org_id IS NULL AND c.level='PLATFORM' AND c.scope_type='GLOBAL' AND c.scope_id='00000000-0000-0000-0000-000000000000'::uuid) OR
   (c.org_id=target_org AND (
     (c.level='ORG' AND c.scope_type='ORGANISATION' AND c.scope_id=target_org) OR
     (c.level='PROJECT' AND c.scope_type='PROJECT' AND c.scope_id=target_project) OR
     (c.level='CLIENT_CONTRACT' AND c.scope_type='CONTRACT' AND EXISTS(SELECT 1 FROM public.contracts ct
       WHERE ct.org_id=target_org AND ct.project_id=target_project AND ct.id=c.scope_id)))))
  ORDER BY c.id
 LOOP
  IF application AND source.org_id=target_org AND source.status='DRAFT' THEN
   RETURN QUERY SELECT c.* FROM public.config_versions c WHERE c.id=source.id FOR UPDATE;
  ELSE
   RETURN QUERY SELECT c.* FROM public.config_versions c WHERE c.id=source.id FOR SHARE;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION lock_project_configuration_sources(uuid,uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_project_configuration_sources(uuid,uuid[],boolean) TO tc_app;
