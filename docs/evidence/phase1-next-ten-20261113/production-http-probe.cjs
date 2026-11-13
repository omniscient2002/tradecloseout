const {Pool}=require('/tmp/tco-phase1-next-ten/apps/api/node_modules/pg');
const {randomUUID,createHash}=require('crypto');
const fs=require('fs');
(async()=>{
 const db=new Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});const org=randomUUID(),user=randomUUID(),project=randomUUID(),a=randomUUID(),b=randomUUID();
 const token='fixture-session-'+randomUUID(),csrf='fixture-csrf';const hash=x=>createHash('sha256').update(x).digest('hex');
 const observations=[];
 try {
  await db.query("INSERT INTO users(id,name,status) VALUES($1,'HTTP boundary fixture','ACTIVE')",[user]);
  await db.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'HTTP fixture','HTTP fixture','MH')",[org]);
  await db.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-SITE','ACTIVE')",[randomUUID(),org,user]);
  await db.query("INSERT INTO projects(id,org_id,code,name,created_by,status) VALUES($1,$2,'HTTP-FIXTURE','Authorization fixture',$3,'ACTIVE')",[project,org,user]);
  await db.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,scope_json,added_by) VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$5,$4)",[randomUUID(),org,project,user,JSON.stringify({assetIds:[a],mode:'READ_ONLY'})]);
  for(const [id,tag]of[[a,'HTTP-A'],[b,'HTTP-B']])await db.query("INSERT INTO assets(id,org_id,project_id,tag,name,category_key,created_by) VALUES($1,$2,$3,$4,$4,'AHU',$5)",[id,org,project,tag,user]);
  await db.query("INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[randomUUID(),user,org,hash(token),hash(csrf)]);
  const run=async(method,path,payload,expected)=>{
   const res=await fetch('http://127.0.0.1:3111/api/v1'+path,{method,headers:{Cookie:'tc_session='+token,'x-csrf-token':csrf,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
   const value=await res.json();if(res.status!==expected)throw new Error(JSON.stringify({path,status:res.status,expected,value}));
   observations.push({method,path:path.replaceAll(project,'PROJECT').replaceAll(a,'ALLOWED_ASSET').replaceAll(b,'DENIED_ASSET'),status:res.status,code:value.code??null});return value;
  };
  const list=await run('GET',`/projects/${project}/assets`,null,200);if(list.length!==1||list[0].id!==a)throw new Error('SCOPED_LIST_LEAK');
  await run('GET',`/projects/${project}/assets/${b}`,null,404);
  await run('PATCH',`/projects/${project}/assets/${a}`,{name:'READONLY_BYPASS'},403);
  await db.query("UPDATE project_members SET scope_json=$1 WHERE org_id=$2",[JSON.stringify({assetIds:[a]}),org]);
  await run('PATCH',`/projects/${project}/assets/${a}`,{name:'Authorized update'},200);
  await run('PATCH',`/projects/${project}/assets/${b}`,{name:'SCOPE_BYPASS'},404);
  await run('POST','/auth/mfa/verify',{code:'invalid'},400);
  await run('POST','/auth/mfa/recovery',{recoveryCode:'invalid'},400);
  await run('POST','/reviews/bulk-decisions',{reviewIds:['invalid'],decision:'REJECT'},400);
  await db.query("UPDATE projects SET status='CLOSED' WHERE id=$1",[project]);
  await run('PATCH',`/projects/${project}/assets/${a}`,{name:'CLOSED_BYPASS'},403);
  if((await db.query('SELECT name FROM assets WHERE id=$1',[a])).rows[0].name!=='Authorized update')throw new Error('UNAUTHORIZED_MUTATION');
  if((await db.query('SELECT count(*)::int AS n FROM mfa_attempt_budgets WHERE user_id=$1',[user])).rows[0].n!==0)throw new Error('MALFORMED_BUDGET_CONSUMPTION');
  fs.writeFileSync('/tmp/tco-phase1-next-logs/production-http.json',JSON.stringify({observations,mode:'production, loopback HTTP, seeded session; no actual OTP/MFA enrollment/provider or engineering evidence acceptance'},null,2));
  console.log('9 actual production-mode HTTP outcomes verified');
 }finally{await db.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
