CREATE TABLE transmittals (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  transmittal_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, transmittal_no),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

CREATE TABLE transmittal_items (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  transmittal_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, transmittal_id, document_version_id),
  FOREIGN KEY (org_id, project_id, transmittal_id)
    REFERENCES transmittals(org_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id, document_version_id)
    REFERENCES document_versions(org_id, project_id, id)
);

CREATE INDEX transmittals_project_created_idx
  ON transmittals(org_id, project_id, created_at DESC);

ALTER TABLE transmittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmittals FORCE ROW LEVEL SECURITY;
ALTER TABLE transmittal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmittal_items FORCE ROW LEVEL SECURITY;

CREATE POLICY transmittals_tenant_isolation ON transmittals
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
CREATE POLICY transmittal_items_tenant_isolation ON transmittal_items
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
