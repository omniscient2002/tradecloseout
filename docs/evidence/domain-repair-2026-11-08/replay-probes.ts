import {withDisposableDatabase} from '/home/cassandra/tradecloseout/packages/db/test/helpers/disposable-database';
import {seedTenants} from '/home/cassandra/tradecloseout/packages/db/test/helpers/fixtures';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire('/home/cassandra/tradecloseout/apps/api/package.json');
const base='/home/cassandra/tradecloseout/apps/api/dist/apps/api/src/modules/';
const {HandoverService}=require(base+'handover/handover.service.js');
const {ProjectsService}=require(base+'projects/projects.service.js');
const {ChecklistsService}=require(base+'checklists/checklists.service.js');
async function main(){await withDisposableDatabase(async({admin,app})=>{
 const {userId,tenants:[a]}=await seedTenants(admin);
 const ctx={orgId:a.orgId,userId,actorType:'USER',orgRole:'R-OWNER',requestId:randomUUID()};
 const handover=new HandoverService(app,{}),projects=new ProjectsService(app),checklists=new ChecklistsService(app);
 console.log(JSON.stringify({probe:'existing_project_empty_checklist',result:await handover.evaluateProjectReadiness(ctx,a.projectIds[0])}));
 console.log(JSON.stringify({probe:'nonexistent_project_readiness',result:await handover.evaluateProjectReadiness(ctx,randomUUID())}));
 const created=await projects.createProject(ctx,{code:'AUDIT-TEST-1',name:'Synthetic Hospital',projectType:'HOSPITAL'});
 const row=(await admin.query('SELECT project_type FROM projects WHERE id=$1',[created.id])).rows[0];
 console.log(JSON.stringify({probe:'project_type_roundtrip',requested:'HOSPITAL',persisted:row.project_type}));
 try {
  const snapshot=await checklists.createSnapshot(ctx,a.projectIds[0]);
  const reqs=(await admin.query('SELECT requirement_key,doc_type_key FROM requirements WHERE project_id=$1',[a.projectIds[0]])).rows;
  console.log(JSON.stringify({probe:'default_snapshot',result:snapshot,requirements:reqs}));
 } catch(error:any) {console.log(JSON.stringify({probe:'default_snapshot',errorCode:error.code,message:error.message}));}
 try {await checklists.importL3Checklist(ctx,a.projectIds[0],{requirements:[{title:'Synthetic AHU commissioning'}]});}
 catch(error:any) {console.log(JSON.stringify({probe:'consultant_import',errorCode:error.code,message:error.message}));}
 const closureProject=a.projectIds[1];
 await admin.query("UPDATE projects SET status='HANDOVER' WHERE id=$1",[closureProject]);
 await admin.query("INSERT INTO submissions(id,org_id,project_id,status,created_by) VALUES($1,$2,$3,'PARTIALLY_ACCEPTED',$4)",[randomUUID(),a.orgId,closureProject,userId]);
 const closed=await projects.closeProject(ctx,closureProject,1);
 console.log(JSON.stringify({probe:'closure_partial_submission_without_package_or_checklist',status:closed.status}));
});}
main().catch(e=>{console.error(e);process.exitCode=1});
