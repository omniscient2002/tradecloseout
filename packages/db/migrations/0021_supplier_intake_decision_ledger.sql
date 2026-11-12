-- PH3-G04-004: immutable, tenant-scoped supplier intake decision history.
-- Only contractor-controlled intake decisions are recorded here; they do not
-- constitute technical review or client acceptance.
SET ROLE tc_migrator;

ALTER TABLE supplier_document_obligations
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE supplier_document_obligations
  ADD CONSTRAINT supplier_document_obligations_row_version_positive
    CHECK (row_version >= 1);
ALTER TABLE supplier_document_obligations
  ADD CONSTRAINT supplier_document_obligations_org_proj_id_uq
    UNIQUE (org_id, project_id, id);

CREATE TABLE IF NOT EXISTS supplier_intake_decisions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ACCEPT', 'REJECT')),
  document_version_id uuid NOT NULL,
  reason text,
  previous_status text NOT NULL,
  resulting_status text NOT NULL CHECK (resulting_status IN ('ACCEPTED', 'PENDING')),
  resulting_row_version integer NOT NULL CHECK (resulting_row_version > 1),
  decided_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, obligation_id, command_id),
  UNIQUE (org_id, project_id, obligation_id, resulting_row_version),
  FOREIGN KEY (org_id, project_id, obligation_id)
    REFERENCES supplier_document_obligations(org_id, project_id, id),
  FOREIGN KEY (org_id, project_id, document_version_id)
    REFERENCES document_versions(org_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_intake_decisions_history_idx
  ON supplier_intake_decisions(org_id, project_id, obligation_id, created_at DESC, id DESC);

ALTER TABLE supplier_intake_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_intake_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_intake_decisions_tenant_policy ON supplier_intake_decisions
  FOR ALL TO PUBLIC
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- Decisions remain append-only, even if a caller gets an overly broad write grant.
CREATE OR REPLACE FUNCTION forbid_supplier_intake_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SUPPLIER_INTAKE_HISTORY_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS supplier_intake_decisions_immutable ON supplier_intake_decisions;
CREATE TRIGGER supplier_intake_decisions_immutable
  BEFORE UPDATE OR DELETE ON supplier_intake_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_supplier_intake_history_mutation();

GRANT SELECT, INSERT ON supplier_intake_decisions TO tc_app;
GRANT SELECT, UPDATE ON supplier_document_obligations TO tc_app;
RESET ROLE;
