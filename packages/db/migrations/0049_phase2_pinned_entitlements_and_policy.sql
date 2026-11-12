CREATE TABLE billing_policy_versions (
 id uuid PRIMARY KEY,version text NOT NULL UNIQUE CHECK(length(version) BETWEEN 1 AND 100),
 schema_version integer NOT NULL CHECK(schema_version=1),
 status text NOT NULL CHECK(status IN('DRAFT','APPROVED','RETIRED')),
 grace_seconds integer NOT NULL CHECK(grace_seconds BETWEEN 0 AND 2592000),
 created_by_identity text NOT NULL CHECK(length(trim(created_by_identity)) BETWEEN 2 AND 200),
 reviewer_identity text,approved_at timestamptz,evidence_ref text,
 CHECK(status<>'APPROVED' OR (reviewer_identity IS NOT NULL AND length(trim(reviewer_identity)) BETWEEN 2 AND 200
  AND lower(trim(reviewer_identity))<>lower(trim(created_by_identity))
  AND approved_at IS NOT NULL AND evidence_ref LIKE 'https://%'))
);
REVOKE ALL ON billing_policy_versions FROM PUBLIC,tc_app;
GRANT SELECT ON billing_policy_versions TO tc_app;
ALTER TABLE plans ADD COLUMN policy_version_id uuid REFERENCES billing_policy_versions(id);
ALTER TABLE subscriptions ADD COLUMN policy_version_id uuid REFERENCES billing_policy_versions(id);
CREATE FUNCTION phase2_immutable_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='APPROVED' AND NEW.status='RETIRED'
    AND to_jsonb(NEW)-'status'=to_jsonb(OLD)-'status' THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' OR OLD.status IN('APPROVED','RETIRED') THEN
  RAISE EXCEPTION 'BILLING_POLICY_VERSION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase2_policy_immutable BEFORE UPDATE OR DELETE ON billing_policy_versions
 FOR EACH ROW EXECUTE FUNCTION phase2_immutable_policy();

-- Existing subscriptions are pinned to their current recorded offer. This is a
-- mechanical preservation, not retrospective finance/provider acceptance.
ALTER TABLE subscriptions ADD COLUMN limits_snapshot_json jsonb;
ALTER TABLE subscriptions ADD COLUMN price_snapshot_paise bigint;
ALTER TABLE subscriptions ADD COLUMN interval_snapshot text;
ALTER TABLE subscriptions ADD COLUMN plan_code_snapshot text;
ALTER TABLE subscriptions ADD COLUMN snapshot_version integer NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN grace_until timestamptz;
UPDATE subscriptions s SET limits_snapshot_json=p.limits_json,price_snapshot_paise=p.price_paise,
  interval_snapshot=p.interval,plan_code_snapshot=p.code FROM plans p WHERE p.id=s.plan_id;

CREATE FUNCTION phase2_plan_limits_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; n numeric;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR
    v - ARRAY['maxActiveProjects','maxSeats','maxStorageBytes','maxPackageGenerationsPerMonth'] <> '{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['maxActiveProjects','maxSeats','maxStorageBytes','maxPackageGenerationsPerMonth'] LOOP
   IF NOT(v ? k) OR jsonb_typeof(v->k)<>'number' THEN RETURN false; END IF;
   n:=(v->>k)::numeric;
   IF n<0 OR n>9007199254740991 OR n<>trunc(n) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION phase2_pin_subscription_offer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p plans%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' OR NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
   SELECT * INTO p FROM plans WHERE id=NEW.plan_id FOR SHARE;
   IF NOT FOUND OR p.status<>'ACTIVE' OR NOT phase2_plan_limits_valid(p.limits_json) THEN
     RAISE EXCEPTION 'PLAN_CONFIGURATION_INVALID' USING ERRCODE='23514';
   END IF;
   NEW.limits_snapshot_json:=p.limits_json;NEW.price_snapshot_paise:=p.price_paise;
   NEW.interval_snapshot:=p.interval;NEW.plan_code_snapshot:=p.code;NEW.policy_version_id:=p.policy_version_id;
   IF TG_OP='UPDATE' THEN NEW.snapshot_version:=OLD.snapshot_version+1; END IF;
 ELSIF ROW(NEW.limits_snapshot_json,NEW.price_snapshot_paise,NEW.interval_snapshot,NEW.plan_code_snapshot,NEW.snapshot_version,NEW.policy_version_id)
    IS DISTINCT FROM ROW(OLD.limits_snapshot_json,OLD.price_snapshot_paise,OLD.interval_snapshot,OLD.plan_code_snapshot,OLD.snapshot_version,OLD.policy_version_id) THEN
   RAISE EXCEPTION 'SUBSCRIPTION_OFFER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.current_period_end<=NEW.current_period_start OR
    (NEW.grace_until IS NOT NULL AND NEW.grace_until<NEW.current_period_end) THEN
   RAISE EXCEPTION 'SUBSCRIPTION_PERIOD_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase2_pin_subscription_offer BEFORE INSERT OR UPDATE ON subscriptions
 FOR EACH ROW EXECUTE FUNCTION phase2_pin_subscription_offer();

ALTER TABLE plans ADD COLUMN published_at timestamptz;
-- Legacy ACTIVE is not approval; publication remains unverified until a reviewed policy is attached.
CREATE FUNCTION phase2_immutable_published_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_at IS NOT NULL AND ROW(NEW.code,NEW.limits_json,NEW.price_paise,NEW.interval,NEW.policy_version_id)
    IS DISTINCT FROM ROW(OLD.code,OLD.limits_json,OLD.price_paise,OLD.interval,OLD.policy_version_id) THEN
   RAISE EXCEPTION 'PUBLISHED_PLAN_IMMUTABLE_CREATE_NEW_VERSION' USING ERRCODE='23514';
 END IF;
 IF NEW.status='ACTIVE' AND (NOT phase2_plan_limits_valid(NEW.limits_json) OR NEW.price_paise<0) THEN
   RAISE EXCEPTION 'PLAN_CONFIGURATION_INVALID' USING ERRCODE='23514';
 END IF;
 IF OLD.published_at IS NOT NULL THEN NEW.published_at:=OLD.published_at;
 ELSIF NEW.status='ACTIVE' AND NEW.policy_version_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM billing_policy_versions WHERE id=NEW.policy_version_id AND status='APPROVED') THEN
   RAISE EXCEPTION 'BILLING_POLICY_NOT_APPROVED' USING ERRCODE='23514'; END IF;
  NEW.published_at:=now();
 ELSE NEW.published_at:=NULL; END IF;
 RETURN NEW;
END $$;
-- Validate only new publication/edits: do not rewrite or fabricate legacy offers.
CREATE TRIGGER phase2_validate_plan BEFORE INSERT OR UPDATE ON plans
 FOR EACH ROW EXECUTE FUNCTION phase2_immutable_published_plan();
