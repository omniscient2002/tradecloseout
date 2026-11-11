const fs=require('node:fs');
const root='/tmp/tc-g01-implementation';
const {AppModule}=require(root+'/apps/api/src/app.module.ts');
const {registeredHttpRoutes}=require(root+'/apps/api/src/common/security/route-inventory.ts');
const p=require(root+'/packages/shared/src/permissions.ts');
const routes=registeredHttpRoutes(AppModule).map(r=>({...r,guards:r.guards.map(g=>g.name)}));
const permissions=new Set(Object.values(p.ORG_ROLE_PERMISSIONS).flatMap(r=>Object.keys(r)));
const missing=[];
for(const role of Object.keys(p.ORG_ROLE_MATRIX)){
  for(const permission of new Set([...Object.keys(p.ORG_ROLE_MATRIX[role]),...Object.keys(p.ORG_ROLE_PERMISSIONS[role]||{})])){
    const a=!!p.ORG_ROLE_PERMISSIONS[role]?.[permission],b=!!p.ORG_ROLE_MATRIX[role]?.[permission];
    if(a!==b)missing.push({role,permission,runtime_granted:a,alternate_granted:b});
  }
}
const summary={route_count:routes.length,explicit_public_count:routes.filter(r=>!r.guards.includes('SessionCsrfGuard')).length,
  protected_business_routes_without_permission:routes.filter(r=>r.guards.includes('SessionCsrfGuard')&&!r.path.startsWith('/api/v1/auth/')&&r.path!=='/api/v1/guest/me/context'&&(!r.guards.includes('PermissionGuard')||!r.permission)),
  runtime_org_role_count:Object.keys(p.ORG_ROLE_PERMISSIONS).length,runtime_project_roles:Object.keys(p.PROJECT_ROLE_PERMISSIONS),
  org_matrix_grant_disagreements:missing,runtime_permission_vocabulary:[...permissions].sort()};
fs.writeFileSync('/tmp/tc-g02-audit/route-inventory.json',JSON.stringify(routes,null,2)+'\n');
fs.writeFileSync('/tmp/tc-g02-audit/inventory-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
