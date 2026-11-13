-- A document reference is valid only within its exact tenant and project.
-- Preserve historical records: inconsistent links block this migration for
-- explicit reconciliation rather than deleting rows or guessing replacements.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE specification_refs
  ADD CONSTRAINT specification_document_scope_fk
  FOREIGN KEY (org_id, project_id, document_id)
  REFERENCES documents (org_id, project_id, id) NOT VALID;

ALTER TABLE specification_refs
  VALIDATE CONSTRAINT specification_document_scope_fk;
