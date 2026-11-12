-- PH1-G26-008: unique audit-chain positions across time partitions, with
-- tenant-scoped expected-head verification. Forward-only: never rewrite audit
-- events or repair ambiguous historical chain evidence automatically.
SET ROLE tc_migrator;

DO $$
DECLARE
  genesis constant text := 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit_events
     WHERE chain_seq IS NULL OR chain_seq <= 0 OR
       prev_hash IS NULL OR hash IS NULL OR
       hash !~ '^[a-f0-9]{64}$'
  ) OR EXISTS (
    SELECT chain_seq FROM audit_events GROUP BY chain_seq HAVING count(*) > 1
  ) OR EXISTS (
    WITH ordered AS (
      SELECT org_id, chain_seq, prev_hash, hash,
             row_number() OVER (PARTITION BY org_id ORDER BY chain_seq) AS ordinal,
             lag(hash) OVER (PARTITION BY org_id ORDER BY chain_seq) AS previous
        FROM audit_events
    )
    SELECT 1 FROM ordered
     WHERE (ordinal = 1 AND prev_hash IS DISTINCT FROM genesis)
        OR (ordinal > 1 AND prev_hash IS DISTINCT FROM previous)
  ) OR EXISTS (
    SELECT 1 FROM audit_events
     WHERE hash IS DISTINCT FROM encode(digest(
       prev_hash || '||' || jsonb_build_object(
         'id',id,'org_id',org_id,'project_id',project_id,
         'actor_type',actor_type,'actor_user_id',actor_user_id,
         'action',action,'entity_type',entity_type,'entity_id',entity_id,
         'before_json',before_json,'after_json',after_json,
         'request_id',request_id,
         'created_at',to_char(created_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       )::text, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_PREEXISTING_INTEGRITY_REVIEW_REQUIRED'
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- A PostgreSQL partitioned UNIQUE index must include created_at, so it cannot
-- enforce globally unique chain_seq. This protected registry does so across
-- all partitions, within the SAME audit INSERT transaction.
CREATE TABLE public.audit_chain_positions (
  chain_seq bigint PRIMARY KEY CHECK (chain_seq > 0),
  org_id uuid,
  event_id uuid NOT NULL,
  event_created_at timestamptz NOT NULL,
  prev_hash text NOT NULL,
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (event_id, event_created_at)
);
REVOKE ALL PRIVILEGES ON TABLE public.audit_chain_positions FROM PUBLIC, tc_app;
ALTER TABLE public.audit_chain_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_chain_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_chain_positions_migrator ON public.audit_chain_positions
  FOR ALL TO tc_migrator USING (true) WITH CHECK (true);
CREATE INDEX audit_chain_positions_org_seq_idx
  ON public.audit_chain_positions (org_id, chain_seq DESC);

-- Preserve historical sequences and hashes exactly. A duplicate must abort.
INSERT INTO public.audit_chain_positions
  (chain_seq,org_id,event_id,event_created_at,prev_hash,event_hash)
SELECT chain_seq,org_id,id,created_at,prev_hash,hash
  FROM public.audit_events;

ALTER TABLE public.audit_events ALTER COLUMN chain_seq SET NOT NULL;
ALTER TABLE public.audit_events ALTER COLUMN hash SET NOT NULL;
ALTER TABLE public.audit_events ALTER COLUMN prev_hash SET NOT NULL;

CREATE FUNCTION public.phase1_register_audit_position()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_chain_positions
    (chain_seq,org_id,event_id,event_created_at,prev_hash,event_hash)
  VALUES (NEW.chain_seq,NEW.org_id,NEW.id,NEW.created_at,NEW.prev_hash,NEW.hash);
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.phase1_register_audit_position() FROM PUBLIC, tc_app;

-- The BEFORE ROW hash trigger is already inherited by all audit partitions.
-- AFTER ROW registration is likewise inherited by future attached children.
DROP TRIGGER IF EXISTS trg_phase1_audit_position ON public.audit_events;
CREATE TRIGGER trg_phase1_audit_position
  AFTER INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.phase1_register_audit_position();

-- Runtime cannot access the registry directly. This narrowly scoped, readonly
-- expectation function exposes *only the current tenant's* count/head for
-- checking that the committed audit history and registry agree after restore.
CREATE FUNCTION public.phase1_audit_expected_head(p_org uuid)
RETURNS TABLE(event_count bigint, head_seq bigint, head_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count bigint;
  v_seq bigint;
  v_hash text;
BEGIN
  IF p_org IS NULL OR public.current_app_org_id() IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'AUDIT_HEAD_TENANT_CONTEXT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT count(*)::bigint INTO v_count
    FROM public.audit_chain_positions WHERE org_id = p_org;
  SELECT chain_seq, event_hash INTO v_seq, v_hash
    FROM public.audit_chain_positions
   WHERE org_id = p_org ORDER BY chain_seq DESC LIMIT 1;
  RETURN QUERY SELECT v_count, v_seq, v_hash;
END
$$;
REVOKE ALL ON FUNCTION public.phase1_audit_expected_head(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase1_audit_expected_head(uuid) TO tc_app;

RESET ROLE;
