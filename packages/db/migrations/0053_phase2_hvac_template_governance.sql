-- Governance only. Existing ACTIVE rows receive no retrospective approval.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tc_hvac_template_author') THEN
  CREATE ROLE tc_hvac_template_author NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tc_hvac_template_reviewer') THEN
  CREATE ROLE tc_hvac_template_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO tc_hvac_template_author,tc_hvac_template_reviewer;
ALTER TABLE template_packs ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE template_packs ADD COLUMN author_identity text;
ALTER TABLE template_packs ADD COLUMN reviewer_identity text;
ALTER TABLE template_packs ADD COLUMN reviewed_at timestamptz;
ALTER TABLE template_packs ADD COLUMN review_evidence_ref text;
ALTER TABLE template_packs ADD COLUMN payload_checksum text;
ALTER TABLE template_packs ADD COLUMN governance_version integer;
ALTER TABLE template_packs ADD COLUMN review_record_json jsonb;
ALTER TABLE template_packs ADD COLUMN reviewed_candidate_sha text;
REVOKE ALL ON template_packs FROM PUBLIC,tc_app;
GRANT SELECT ON template_packs TO tc_app;
CREATE TABLE hvac_template_publication_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pack_id uuid NOT NULL REFERENCES template_packs(id),
 action text NOT NULL CHECK(action IN('DRAFT_CREATED','PUBLISHED','DEPRECATED')),
 actor_identity text NOT NULL,payload_checksum text NOT NULL,evidence_ref text,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON hvac_template_publication_events FROM PUBLIC,tc_app;
-- Syntax validation only; no engineering mappings or approvals are seeded.
CREATE FUNCTION phase2_hvac_json_safe(v jsonb,depth integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE entry record;item jsonb;
BEGIN
 IF v IS NULL OR depth>8 THEN RETURN false; END IF;
 CASE jsonb_typeof(v)
 WHEN 'null','boolean' THEN RETURN true;
 WHEN 'number' THEN RETURN abs(v::text::numeric)<=9007199254740991 AND trunc(v::text::numeric)=v::text::numeric;
 WHEN 'string' THEN RETURN length(v#>>'{}')<=2048;
 WHEN 'array' THEN
  IF jsonb_array_length(v)>1000 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
   IF NOT public.phase2_hvac_json_safe(item,depth+1) THEN RETURN false; END IF;
  END LOOP;
 WHEN 'object' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(v))>64 THEN RETURN false; END IF;
  FOR entry IN SELECT key,value FROM jsonb_each(v) LOOP
   IF entry.key IN('__proto__','constructor','prototype') OR length(entry.key)>128 OR
    NOT public.phase2_hvac_json_safe(entry.value,depth+1) THEN RETURN false; END IF;
  END LOOP;
 ELSE RETURN false;
 END CASE;
 RETURN true;
END $$;
CREATE FUNCTION phase2_hvac_keyed_item_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE field text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'key') IS DISTINCT FROM 'string'
  OR COALESCE(v->>'key','') !~ '^[A-Za-z0-9_.:-]{1,100}$' THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['title','description','docTypeKey','groupKey','assetCategoryKey','assetId','reviewerRole'] LOOP
  IF v ? field AND (jsonb_typeof(v->field)<>'string' OR length(trim(v->>field))<1) THEN RETURN false; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['locked','mandatory','$remove'] LOOP
  IF v ? field AND jsonb_typeof(v->field)<>'boolean' THEN RETURN false; END IF;
 END LOOP;
 IF v ? 'scopeType' AND (jsonb_typeof(v->'scopeType')<>'string' OR v->>'scopeType' NOT IN('PROJECT','ASSET_CATEGORY','ASSET')) THEN RETURN false; END IF;
 IF v ? 'dueOffsetDays' AND (jsonb_typeof(v->'dueOffsetDays')<>'number' OR (v->>'dueOffsetDays')::numeric<>trunc((v->>'dueOffsetDays')::numeric)) THEN RETURN false; END IF;
 IF v ? 'validityRule' AND jsonb_typeof(v->'validityRule')<>'object' THEN RETURN false; END IF;
 RETURN true;
END $$;
CREATE FUNCTION phase2_hvac_evidence_ref_valid(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT v IS NOT NULL AND length(v) BETWEEN 12 AND 2000 AND
  v ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9/_.,:=%~!()*+;-]+(#[A-Za-z0-9._:-]+)?$'
$$;
CREATE FUNCTION phase2_immutable_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.trade,NEW.code,NEW.name,NEW.version,NEW.schema_version,NEW.payload_json,NEW.author_identity,NEW.payload_checksum,NEW.governance_version)
   IS DISTINCT FROM ROW(OLD.id,OLD.trade,OLD.code,OLD.name,OLD.version,OLD.schema_version,OLD.payload_json,OLD.author_identity,OLD.payload_checksum,OLD.governance_version) THEN
  RAISE EXCEPTION 'TEMPLATE_VERSION_IMMUTABLE_CREATE_NEW_VERSION' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN('ACTIVE','DEPRECATED') AND (
   (OLD.status='DEPRECATED' AND NEW.status<>'DEPRECATED') OR
   NEW.status NOT IN('ACTIVE','DEPRECATED') OR
   ROW(NEW.reviewer_identity,NEW.reviewed_at,NEW.review_evidence_ref,NEW.review_record_json,NEW.reviewed_candidate_sha)
    IS DISTINCT FROM ROW(OLD.reviewer_identity,OLD.reviewed_at,OLD.review_evidence_ref,OLD.review_record_json,OLD.reviewed_candidate_sha)) THEN
  RAISE EXCEPTION 'PUBLISHED_TEMPLATE_REVIEW_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase2_template_version_immutable BEFORE UPDATE OR DELETE ON template_packs
 FOR EACH ROW EXECUTE FUNCTION phase2_immutable_template_version();
CREATE FUNCTION stage_hvac_template_pack(pack_id uuid,pack_code text,pack_name text,pack_version integer,pack_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE digest_value text; existing public.template_packs%ROWTYPE;field text;
BEGIN
 IF NOT pg_has_role(session_user,'tc_hvac_template_author','MEMBER') OR session_user='tc_app' THEN
  RAISE EXCEPTION 'HVAC_AUTHOR_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF pack_id IS NULL OR pack_code IS NULL OR pack_code !~ '^[A-Za-z0-9_.:-]{1,80}$' OR
    pack_name IS NULL OR length(trim(pack_name)) NOT BETWEEN 2 AND 200 OR pack_version IS NULL OR pack_version<1 OR
    pack_payload IS NULL OR jsonb_typeof(pack_payload)<>'object' OR octet_length(pack_payload::text)>1048576 OR
    NOT public.phase2_hvac_json_safe(pack_payload) OR
    (SELECT count(*) FROM jsonb_path_query(pack_payload,'strict $.**'))>50000 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(pack_payload) k WHERE k NOT IN('requirements','checklist.groups','handover.sections')) THEN
  RAISE EXCEPTION 'HVAC_PACK_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(pack_payload->'requirements') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'HVAC_PACK_REQUIREMENTS_REQUIRED' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(pack_payload->'requirements') NOT BETWEEN 1 AND 1000 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(pack_payload->'requirements') r
    WHERE NOT public.phase2_hvac_keyed_item_valid(r) OR jsonb_typeof(r->'key') IS DISTINCT FROM 'string'
     OR jsonb_typeof(r->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'docTypeKey') IS DISTINCT FROM 'string'
     OR jsonb_typeof(r->'scopeType') IS DISTINCT FROM 'string' OR r ? '$remove' OR r ? 'provenanceLevel'
     OR COALESCE(r->>'key','') !~ '^[A-Za-z0-9_.:-]{1,100}$'
     OR length(trim(COALESCE(r->>'title',''))) NOT BETWEEN 1 AND 500
     OR COALESCE(r->>'docTypeKey','') !~ '^DT-[0-9]{3}$'
     OR jsonb_typeof(r->'mandatory') IS DISTINCT FROM 'boolean'
     OR COALESCE(r->>'scopeType','') NOT IN('PROJECT','ASSET_CATEGORY')
     OR (r->>'scopeType'='ASSET_CATEGORY' AND COALESCE(r->>'assetCategoryKey','') !~ '^[A-Za-z0-9_.:-]{1,80}$')
     OR r ? 'assetId' OR (r ? 'locked' AND jsonb_typeof(r->'locked')<>'boolean')
     OR (r ? 'reviewerRole' AND r->>'reviewerRole' NOT IN('R-QC','R-PM','R-OWNER','R-ADMIN','R-REVIEWER','R-CONSULTANT'))
 ) OR (SELECT count(*) FROM jsonb_array_elements(pack_payload->'requirements'))<>
      (SELECT count(DISTINCT r->>'key') FROM jsonb_array_elements(pack_payload->'requirements') r) THEN
  RAISE EXCEPTION 'HVAC_PACK_REQUIREMENT_INVALID' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['checklist.groups','handover.sections'] LOOP
  IF pack_payload ? field THEN
   IF jsonb_typeof(pack_payload->field)<>'array' THEN RAISE EXCEPTION 'HVAC_PACK_SECTION_INVALID' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(pack_payload->field) item WHERE NOT public.phase2_hvac_keyed_item_valid(item)
     OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string' OR COALESCE(item->>'key','') !~ '^[A-Za-z0-9_.:-]{1,100}$'
     OR item ? '$remove' OR item ? 'provenanceLevel'
     OR (item ? 'title' AND jsonb_typeof(item->'title')<>'string')
     OR (item ? 'locked' AND jsonb_typeof(item->'locked')<>'boolean')
     OR (item ? 'mandatory' AND jsonb_typeof(item->'mandatory')<>'boolean')) OR
    (SELECT count(*) FROM jsonb_array_elements(pack_payload->field))<>
    (SELECT count(DISTINCT item->>'key') FROM jsonb_array_elements(pack_payload->field) item) THEN
     RAISE EXCEPTION 'HVAC_PACK_SECTION_INVALID' USING ERRCODE='22023';
   END IF;
  END IF;
 END LOOP;
 digest_value:=encode(public.digest(pack_payload::text,'sha256'),'hex');
 SELECT * INTO existing FROM public.template_packs WHERE id=pack_id FOR UPDATE;
 IF FOUND THEN
  IF existing.author_identity=session_user AND ROW(existing.code,existing.name,existing.version,existing.payload_checksum)
    IS NOT DISTINCT FROM ROW(pack_code,pack_name,pack_version,digest_value) THEN RETURN pack_id; END IF;
  RAISE EXCEPTION 'HVAC_PACK_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.template_packs(id,trade,code,name,version,schema_version,payload_json,status,author_identity,payload_checksum,governance_version)
  VALUES(pack_id,'HVAC',pack_code,pack_name,pack_version,1,pack_payload,'DRAFT',session_user,digest_value,1);
 INSERT INTO public.hvac_template_publication_events(pack_id,action,actor_identity,payload_checksum)
  VALUES(pack_id,'DRAFT_CREATED',session_user,digest_value);
 RETURN pack_id;
END $$;
CREATE FUNCTION review_hvac_template_pack(target_pack_id uuid,review_record jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.template_packs%ROWTYPE;field text;
BEGIN
 IF NOT pg_has_role(session_user,'tc_hvac_template_reviewer','MEMBER') OR session_user='tc_app' THEN
  RAISE EXCEPTION 'HVAC_REVIEWER_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF review_record IS NULL OR jsonb_typeof(review_record)<>'object' OR
    NOT public.phase2_hvac_json_safe(review_record) OR octet_length(review_record::text)>16384 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(review_record) k WHERE k NOT IN(
     'candidateSha','qualifiedReviewerEvidence','catalogueRef','mappingEvidence','applicabilityEvidence','scenarioEvidence','exceptions')) OR
    COALESCE(review_record->>'candidateSha','') !~ '^[a-f0-9]{40}$' THEN
  RAISE EXCEPTION 'HVAC_REVIEW_RECORD_REQUIRED' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['qualifiedReviewerEvidence','catalogueRef','mappingEvidence','applicabilityEvidence','scenarioEvidence'] LOOP
  IF jsonb_typeof(review_record->field) IS DISTINCT FROM 'string' OR
     NOT public.phase2_hvac_evidence_ref_valid(review_record->>field) THEN
   RAISE EXCEPTION 'HVAC_REVIEW_EVIDENCE_REQUIRED' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF jsonb_typeof(review_record->'exceptions') IS DISTINCT FROM 'array' OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(review_record->'exceptions') e WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}') NOT BETWEEN 5 AND 2000) THEN
  RAISE EXCEPTION 'HVAC_REVIEW_EXCEPTIONS_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.template_packs WHERE id=target_pack_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HVAC_PACK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p.author_identity IS NULL OR p.author_identity=session_user OR p.governance_version IS DISTINCT FROM 1 OR
    p.payload_checksum IS DISTINCT FROM encode(public.digest(p.payload_json::text,'sha256'),'hex') THEN
  RAISE EXCEPTION 'INDEPENDENT_HVAC_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p.status='ACTIVE' AND p.reviewer_identity=session_user AND p.review_record_json=review_record THEN RETURN p.id; END IF;
 IF p.status<>'DRAFT' THEN RAISE EXCEPTION 'HVAC_PACK_NOT_REVIEWABLE' USING ERRCODE='23514'; END IF;
 UPDATE public.template_packs SET status='ACTIVE',reviewer_identity=session_user,reviewed_at=now(),
   review_evidence_ref=review_record->>'mappingEvidence',review_record_json=review_record,
   reviewed_candidate_sha=review_record->>'candidateSha' WHERE id=p.id;
 INSERT INTO public.hvac_template_publication_events(pack_id,action,actor_identity,payload_checksum,evidence_ref)
  VALUES(p.id,'PUBLISHED',session_user,p.payload_checksum,review_record->>'mappingEvidence');
 RETURN p.id;
END $$;
CREATE FUNCTION deprecate_hvac_template_pack(target_pack_id uuid,reason_ref text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.template_packs%ROWTYPE;
BEGIN
 IF NOT pg_has_role(session_user,'tc_hvac_template_reviewer','MEMBER') OR session_user='tc_app' THEN
  RAISE EXCEPTION 'HVAC_REVIEWER_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF reason_ref IS NULL OR length(trim(reason_ref)) NOT BETWEEN 5 AND 2000 THEN
  RAISE EXCEPTION 'HVAC_DEPRECATION_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.template_packs WHERE id=target_pack_id FOR UPDATE;
 IF NOT FOUND OR p.governance_version IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'GOVERNED_HVAC_PACK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p.status='DEPRECATED' THEN RETURN p.id; END IF;
 UPDATE public.template_packs SET status='DEPRECATED' WHERE id=p.id;
 INSERT INTO public.hvac_template_publication_events(pack_id,action,actor_identity,payload_checksum,evidence_ref)
  VALUES(p.id,'DEPRECATED',session_user,p.payload_checksum,reason_ref);
 RETURN p.id;
END $$;
REVOKE ALL ON FUNCTION stage_hvac_template_pack(uuid,text,text,integer,jsonb) FROM PUBLIC,tc_app;
REVOKE ALL ON FUNCTION review_hvac_template_pack(uuid,jsonb) FROM PUBLIC,tc_app;
REVOKE ALL ON FUNCTION deprecate_hvac_template_pack(uuid,text) FROM PUBLIC,tc_app;
GRANT EXECUTE ON FUNCTION stage_hvac_template_pack(uuid,text,text,integer,jsonb) TO tc_hvac_template_author;
GRANT EXECUTE ON FUNCTION review_hvac_template_pack(uuid,jsonb),deprecate_hvac_template_pack(uuid,text) TO tc_hvac_template_reviewer;

REVOKE ALL ON FUNCTION phase2_hvac_json_safe(jsonb,integer),phase2_hvac_evidence_ref_valid(text) FROM PUBLIC,tc_app;

CREATE FUNCTION phase2_publication_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PUBLICATION_EVENT_APPEND_ONLY' USING ERRCODE='42501'; END $$;
CREATE TRIGGER phase2_publication_events_immutable BEFORE UPDATE OR DELETE ON hvac_template_publication_events
 FOR EACH ROW EXECUTE FUNCTION phase2_publication_event_append_only();

-- A narrow locking read supplies no template-edit or publication authority.
CREATE FUNCTION lock_reviewed_hvac_template_pack(target_pack uuid,target_project uuid)
RETURNS SETOF template_packs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.projects p JOIN public.memberships m ON m.org_id=p.org_id
   JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
   JOIN public.organisations o ON o.id=p.org_id AND o.status='ACTIVE'
   WHERE p.id=target_project AND p.org_id=nullif(current_setting('app.current_org',true),'')::uuid
    AND m.user_id=nullif(current_setting('app.current_user',true),'')::uuid AND m.status='ACTIVE') THEN
  RETURN; END IF;
 RETURN QUERY SELECT p.* FROM public.template_packs p WHERE p.id=target_pack AND p.trade='HVAC' AND p.status='ACTIVE'
  AND p.schema_version=1 AND p.governance_version=1 AND p.reviewed_at IS NOT NULL
  AND p.reviewer_identity IS NOT NULL AND p.author_identity IS NOT NULL AND p.reviewer_identity<>p.author_identity
  AND p.review_record_json IS NOT NULL AND p.reviewed_candidate_sha ~ '^[a-f0-9]{40}$'
  AND p.payload_checksum=encode(public.digest(p.payload_json::text,'sha256'),'hex') FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION lock_reviewed_hvac_template_pack(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_reviewed_hvac_template_pack(uuid,uuid) TO tc_app;

GRANT SELECT ON template_packs,hvac_template_publication_events TO tc_hvac_template_author,tc_hvac_template_reviewer;

REVOKE ALL ON FUNCTION phase2_hvac_keyed_item_valid(jsonb) FROM PUBLIC,tc_app;
