-- PH4-G17-005 / G17-006: immutable defect transition evidence, tenant-scoped.
-- The current defects row is a projection; all new assignment/remedy/review
-- transitions retain their prior evidence, actor and exact row-version pair.
SET ROLE tc_migrator;

ALTER TABLE defects
  ADD CONSTRAINT defects_org_project_id_uq UNIQUE (org_id, project_id, id);

CREATE TABLE defect_transition_events (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  project_id UUID NOT NULL,
  defect_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'ASSIGNED','REMEDY_SUBMITTED','REMEDY_REJECTED',
    'INDEPENDENTLY_CLOSED','WAIVED','REOPENED','SEVERITY_UPDATED'
  )),
  from_status TEXT NOT NULL CHECK (from_status IN
    ('OPEN','IN_PROGRESS','RECTIFIED','CLOSED','WAIVED')),
  to_status TEXT NOT NULL CHECK (to_status IN
    ('OPEN','IN_PROGRESS','RECTIFIED','CLOSED','WAIVED')),
  previous_row_version INTEGER NOT NULL CHECK (previous_row_version >= 1),
  next_row_version INTEGER NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  assigned_user_id UUID REFERENCES users(id),
  assigned_party_id UUID,
  due_at TIMESTAMPTZ,
  previous_assigned_user_id UUID REFERENCES users(id),
  previous_assigned_party_id UUID,
  previous_due_at TIMESTAMPTZ,
  from_severity TEXT CHECK (from_severity IS NULL OR from_severity IN
    ('LOW','MEDIUM','HIGH','CRITICAL')),
  to_severity TEXT CHECK (to_severity IS NULL OR to_severity IN
    ('LOW','MEDIUM','HIGH','CRITICAL')),
  evidence_object_id UUID,
  remedy_document_version_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, defect_id)
    REFERENCES defects(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, assigned_party_id)
    REFERENCES parties(org_id, id),
  FOREIGN KEY (org_id, previous_assigned_party_id)
    REFERENCES parties(org_id, id),
  FOREIGN KEY (org_id, evidence_object_id)
    REFERENCES storage_objects(org_id, id),
  FOREIGN KEY (org_id, project_id, remedy_document_version_id)
    REFERENCES document_versions(org_id, project_id, id),
  CONSTRAINT defect_event_version_step CHECK
    (next_row_version = previous_row_version + 1),
  CONSTRAINT defect_event_reason_required CHECK (
    action NOT IN ('REMEDY_REJECTED','WAIVED','REOPENED','SEVERITY_UPDATED') OR
    (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 12 AND 1200)
  ),
  CONSTRAINT defect_event_severity_change CHECK (
    action <> 'SEVERITY_UPDATED' OR
    (from_severity IS NOT NULL AND to_severity IS NOT NULL
     AND from_severity <> to_severity)
  )
);

CREATE UNIQUE INDEX defect_transition_version_uq
  ON defect_transition_events(org_id, project_id, defect_id, next_row_version);
CREATE INDEX defect_transition_timeline_idx
  ON defect_transition_events(org_id, project_id, defect_id, created_at, id);

ALTER TABLE defect_transition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE defect_transition_events FORCE ROW LEVEL SECURITY;
CREATE POLICY defect_transition_events_tenant_isolation
  ON defect_transition_events
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT ON defect_transition_events TO tc_app;
REVOKE UPDATE, DELETE ON defect_transition_events FROM tc_app;

COMMENT ON TABLE defect_transition_events IS
  'Append-only defect assignment, remedy attempt and independently reviewed decision history. Historical pre-migration defects are not silently certified.';

RESET ROLE;
