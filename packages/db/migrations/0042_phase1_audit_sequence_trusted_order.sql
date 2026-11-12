-- PH1-G26-008: caller-controlled chain sequence could reorder stored events.
-- Applied migrations are immutable. Stop on historical ambiguity; never
-- silently rewrite an existing audit event or an old hash-chain checkpoint.
SET ROLE tc_migrator;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_events WHERE chain_seq IS NULL) OR
     EXISTS (SELECT chain_seq FROM audit_events GROUP BY chain_seq HAVING count(*)>1) THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_LEGACY_SEQUENCE_RECONCILIATION_REQUIRED'
      USING ERRCODE='23514';
  END IF;
END
$$;

-- A column DEFAULT would allocate a sequence value BEFORE the advisory lock.
-- The trusted BEFORE INSERT trigger now allocates exclusively under the lock.
ALTER TABLE audit_events ALTER COLUMN chain_seq DROP DEFAULT;

CREATE OR REPLACE FUNCTION compute_audit_event_hash_chain() RETURNS trigger AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical TEXT;
BEGIN
  -- Serialize audit chain per tenant within the current transaction (zero race conditions)
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW.org_id::text, 'GLOBAL_PLATFORM')));

  NEW.created_at := clock_timestamp();
  -- The serialized insertion boundary exclusively allocates chain position.
  -- Ignore a forged client value, even if it is a valid BIGINT.
  NEW.chain_seq := nextval('audit_events_chain_seq');

  SELECT hash INTO v_prev_hash
    FROM audit_events
   WHERE COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid) =
         COALESCE(NEW.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.prev_hash := COALESCE(v_prev_hash, 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000');

  v_canonical := jsonb_build_object(
    'id', NEW.id,
    'org_id', NEW.org_id,
    'project_id', NEW.project_id,
    'actor_type', NEW.actor_type,
    'actor_user_id', NEW.actor_user_id,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'before_json', NEW.before_json,
    'after_json', NEW.after_json,
    'request_id', NEW.request_id,
    'created_at', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text;

  NEW.hash := encode(digest(NEW.prev_hash || '||' || v_canonical, 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


RESET ROLE;
