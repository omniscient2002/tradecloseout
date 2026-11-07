-- ==============================================================================
-- 0017_hvac_commissioning_tab_and_inspections.sql
-- XP16, XP17, XP18: HVAC Native Quality Inspections, Air/Water TAB, and Seasonal Commissioning
-- ==============================================================================

SET ROLE tc_migrator;

-- 1. TAB WORKSHEETS (Testing, Adjusting & Balancing)
CREATE TABLE IF NOT EXISTS tab_worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  system_type text NOT NULL CHECK (system_type IN ('AIR_SIDE', 'WATER_SIDE', 'REFRIGERANT_VRF', 'CHILLED_WATER')),
  worksheet_type text NOT NULL, -- e.g. AHU_AIR_BALANCING, PUMP_HYDRONIC, COOLING_TOWER, VAV_TERMINALS
  readings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  design_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tolerance_percent numeric(5,2) NOT NULL DEFAULT 10.00,
  is_within_tolerance boolean NOT NULL DEFAULT true,
  tested_by uuid REFERENCES users(id),
  tested_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT', 'COMPLETED', 'NEEDS_REBALANCING')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

ALTER TABLE tab_worksheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_worksheets FORCE ROW LEVEL SECURITY;

CREATE POLICY tab_worksheets_tenant_isolation ON tab_worksheets
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

CREATE INDEX IF NOT EXISTS idx_tab_worksheets_project
  ON tab_worksheets(org_id, project_id, asset_id);

-- 2. QUALITY INSPECTIONS & ITRs (Inspection Test Requests)
CREATE TABLE IF NOT EXISTS quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  itr_number text NOT NULL,
  title text NOT NULL,
  stage_key text NOT NULL, -- PRE_COMMISSIONING, STATIC_PRESSURE, DYNAMIC_TEST, WITNESS_RUN
  checklist_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  witness_parties_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL DEFAULT 'PASSED' CHECK (outcome IN ('PENDING', 'PASSED', 'FAILED', 'CONCESSION')),
  inspected_by uuid REFERENCES users(id),
  inspected_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspections FORCE ROW LEVEL SECURITY;

CREATE POLICY quality_inspections_tenant_isolation ON quality_inspections
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

CREATE INDEX IF NOT EXISTS idx_quality_inspections_project
  ON quality_inspections(org_id, project_id, itr_number);

-- 3. SEASONAL COMMISSIONING SCHEDULES
CREATE TABLE IF NOT EXISTS seasonal_commissioning_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  season text NOT NULL CHECK (season IN ('SUMMER_PEAK', 'MONSOON_HUMIDITY', 'WINTER_MINIMUM')),
  target_date date NOT NULL,
  parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'PERFORMED', 'DEFERRED', 'WAIVED')),
  test_results_json jsonb,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

ALTER TABLE seasonal_commissioning_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_commissioning_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY seasonal_commissioning_schedules_tenant_isolation ON seasonal_commissioning_schedules
  FOR ALL TO PUBLIC
  USING (org_id = current_app_org_id())
  WITH CHECK (org_id = current_app_org_id());

CREATE INDEX IF NOT EXISTS idx_seasonal_comm_project
  ON seasonal_commissioning_schedules(org_id, project_id, season);

GRANT SELECT, INSERT, UPDATE, DELETE ON tab_worksheets, quality_inspections, seasonal_commissioning_schedules TO tc_app;

RESET ROLE;
