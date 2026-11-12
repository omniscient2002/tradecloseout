-- PH5-G28-001: independently issued, single-use incident approval gate.
-- Deliberately NO credentials and NO approval records are created here.
SET ROLE tc_migrator;

CREATE TABLE IF NOT EXISTS public.incident_runbook_approvals (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organisations(id),
  code text NOT NULL CHECK (code IN ('RB-08', 'RB-09', 'RB-12')),
  entity_id uuid,
  operator_db_login text NOT NULL CHECK (length(operator_db_login) BETWEEN 1 AND 128),
  operator_user_id uuid NOT NULL REFERENCES public.users(id),
  approved_by_user_id uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 12 AND 500),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (operator_user_id <> approved_by_user_id),
  CHECK ((code = 'RB-08' AND entity_id IS NULL) OR
         (code IN ('RB-09', 'RB-12') AND entity_id IS NOT NULL)),
  CHECK (expires_at > approved_at AND expires_at <= approved_at + interval '60 minutes')
);

CREATE INDEX IF NOT EXISTS incident_runbook_approvals_scope
  ON public.incident_runbook_approvals (org_id, code, entity_id, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.incident_runbook_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_runbook_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY incident_approvals_migrator_only
  ON public.incident_runbook_approvals TO tc_migrator
  USING (true) WITH CHECK (true);

-- tc_app has default table permissions from the base migration: explicitly
-- remove them. Incident operators may claim an approval only through the
-- narrow SECURITY DEFINER function; they cannot inspect or edit the ledger.
REVOKE ALL ON public.incident_runbook_approvals FROM PUBLIC, tc_app, tc_incident_operator;

CREATE OR REPLACE FUNCTION public.claim_incident_runbook_approval(
  p_id uuid,
  p_org uuid,
  p_code text,
  p_entity uuid,
  p_operator_user uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  claimed uuid;
BEGIN
  IF session_user = 'tc_incident_operator' THEN
    RETURN false; -- a shared database login can never authorize an incident
  END IF;
  UPDATE public.incident_runbook_approvals
     SET consumed_at = statement_timestamp()
   WHERE id = p_id AND org_id = p_org AND code = p_code
     AND entity_id IS NOT DISTINCT FROM p_entity
     AND operator_db_login = session_user
     AND operator_user_id = p_operator_user
     AND reason = p_reason
     AND consumed_at IS NULL
     AND expires_at > statement_timestamp()
  RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)
  TO tc_incident_operator;

-- Per-person login membership is granted only by an independent security
-- administrator, outside this migration. The shared operator role cannot log in.
ALTER ROLE tc_incident_operator NOLOGIN;
RESET ROLE;
