-- Extend the allowed project types to match the documented HVAC applicability
-- context. Keep existing legacy GOVT_PWD values valid for deployed tenants.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_type_check;
ALTER TABLE projects ADD CONSTRAINT projects_project_type_check
  CHECK (project_type IN (
    'PRIVATE_COMMERCIAL', 'GOVT_PWD', 'GOVERNMENT', 'CPWD', 'PSU',
    'INSTITUTIONAL', 'INDUSTRIAL', 'HOSPITAL', 'CLEANROOM'
  ));
