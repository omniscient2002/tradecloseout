-- PH1-G26-008: 0044's original historical SELECT ran with SET ROLE
-- tc_migrator and could see zero rows under FORCE RLS. Correct this with
-- an independently privilege-checked forward migration, never by changing
-- historical audit events, hashes, timestamps or chain positions.
--
-- RESET ROLE is safe here only when the authenticated migration connection
-- has RLS-bypass authority. row_security=off does not disable row security
-- for lesser roles; instead PostgreSQL fails rather than silently filtering.
RESET ROLE;
SET row_security = off;

DO $$
DECLARE
  genesis constant text := 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
  -- Fail upgrades with ambiguous or damaged historical evidence.
  IF EXISTS (
    SELECT 1 FROM public.audit_events
     WHERE chain_seq IS NULL OR chain_seq <= 0 OR prev_hash IS NULL OR hash IS NULL
        OR hash !~ '^[a-f0-9]{64}$'
  ) OR EXISTS (
    SELECT chain_seq FROM public.audit_events GROUP BY chain_seq HAVING count(*) > 1
  ) OR EXISTS (
    WITH ordered AS (
      SELECT org_id, chain_seq, prev_hash, hash,
             row_number() OVER (PARTITION BY org_id ORDER BY chain_seq) AS ordinal,
             lag(hash) OVER (PARTITION BY org_id ORDER BY chain_seq) AS previous
        FROM public.audit_events
    )
    SELECT 1 FROM ordered
     WHERE (ordinal = 1 AND prev_hash IS DISTINCT FROM genesis)
        OR (ordinal > 1 AND prev_hash IS DISTINCT FROM previous)
  ) OR EXISTS (
    SELECT 1 FROM public.audit_events
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
  ) OR EXISTS (
    SELECT 1 FROM public.audit_chain_positions p
    LEFT JOIN public.audit_events a ON a.chain_seq=p.chain_seq
     WHERE a.id IS NULL OR a.id IS DISTINCT FROM p.event_id
       OR a.org_id IS DISTINCT FROM p.org_id
       OR a.created_at IS DISTINCT FROM p.event_created_at
       OR a.prev_hash IS DISTINCT FROM p.prev_hash
       OR a.hash IS DISTINCT FROM p.event_hash
  ) THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_LEGACY_RECONCILIATION_REQUIRED'
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- The registry is append-only for the runtime; this narrowly reviewed
-- migrator backfill only adds historical positions that were hidden by RLS
-- in 0044. A collision is never ignored or overwritten.
INSERT INTO public.audit_chain_positions
  (chain_seq,org_id,event_id,event_created_at,prev_hash,event_hash)
SELECT a.chain_seq,a.org_id,a.id,a.created_at,a.prev_hash,a.hash
  FROM public.audit_events a
  LEFT JOIN public.audit_chain_positions p ON p.chain_seq=a.chain_seq
 WHERE p.chain_seq IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audit_events a
    LEFT JOIN public.audit_chain_positions p ON p.chain_seq=a.chain_seq
     WHERE p.chain_seq IS NULL OR p.event_id IS DISTINCT FROM a.id
       OR p.org_id IS DISTINCT FROM a.org_id
       OR p.event_created_at IS DISTINCT FROM a.created_at
       OR p.prev_hash IS DISTINCT FROM a.prev_hash
       OR p.event_hash IS DISTINCT FROM a.hash
  ) OR EXISTS (
    SELECT 1 FROM public.audit_chain_positions p
    LEFT JOIN public.audit_events a ON a.chain_seq=p.chain_seq
     WHERE a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_REGISTRY_BACKFILL_INCOMPLETE'
      USING ERRCODE = '23514';
  END IF;
END
$$;
RESET row_security;
