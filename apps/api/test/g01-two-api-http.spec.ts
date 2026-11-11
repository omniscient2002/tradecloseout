import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(300_000);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function port():Promise<number>{
  const server=createHttpServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const value=(server.address() as AddressInfo).port;await new Promise<void>(r=>server.close(()=>r()));return value;
}
async function stop(child:ChildProcess):Promise<void>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>(resolveDone=>{
    const timeout=setTimeout(()=>child.kill('SIGKILL'),2500);
    const exited=()=>{clearTimeout(timeout);resolveDone();};
    child.once('exit',exited);
    if(!child.kill('SIGTERM')){child.off('exit',exited);exited();}
  });
}
function cookie(response:Response,name:string):string {
  return response.headers.getSetCookie().map(value=>value.split(';')[0]).find(value=>value.startsWith(name+'='))||'';
}
function totp(secret:string):string {
  let bits=0,value=0;const bytes:number[]=[];
  for(const char of secret){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;
    if(bits>=8){bytes.push((value>>>(bits-=8))&255);value&=(1<<bits)-1;}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();
  return String((hash.readUInt32BE(hash[hash.length-1]&15)&0x7fffffff)%1000000).padStart(6,'0');
}

it('G01 actual two-API strict-mode HTTP: shared budgets, MFA, lost response and crash rollback',async()=>{
  const apiRoot=resolve(__dirname,'..'),workspace=resolve(apiRoot,'../..');
  // This acceptance test owns its compiled processes. It also works after a
  // clean pnpm test (whose workspace prerequisites build shared/db/pdf only).
  for(const project of ['packages/shared/tsconfig.json','packages/db/tsconfig.json','packages/pdf-engine/tsconfig.json','apps/api/tsconfig.json','apps/worker/tsconfig.json']){
    const build=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',resolve(workspace,project),'--incremental','false'],
      {cwd:workspace,encoding:'utf8',timeout:60000});
    if(build.status!==0)throw new Error('G01_HTTP_PROCESS_BUILD_FAILED: '+build.stdout.slice(-2000));
  }
  const directory=mkdtempSync(join(tmpdir(),'g01-http-'));
  const ca=join(directory,'gateway-cert.pem'),key=join(directory,'gateway-key.pem');
  const openssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-keyout',key,'-out',ca,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  if(openssl.status!==0)throw new Error('G01_FIXTURE_TLS_CERTIFICATE_FAILED');
  const submissions:Array<{id:string,to:string,code:string}>=[];
  const receipts=new Map<string,unknown>();
  let loseAckFor='';
  const gateway=createHttpsServer({key:readFileSync(key),cert:readFileSync(ca)},async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(req.url==='/status'){
      const receipt=receipts.get(body.deliveryAttemptId);
      res.writeHead(receipt?200:404,{'Content-Type':'application/json'}).end(JSON.stringify(receipt||{}));return;
    }
    const to=body.to||body.recipient;
    submissions.push({id:body.deliveryAttemptId,to,code:body.otp||String(body.text).match(/code is (\d{6})/)?.[1]||''});
    receipts.set(body.deliveryAttemptId,{eventId:randomUUID(),
      deliveryAttemptId:body.deliveryAttemptId,messageId:'fixture-'+body.deliveryAttemptId,sequence:1,status:'DELIVERED'});
    if(to===loseAckFor){req.socket.destroy();return;}
    res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({accepted:true,
      deliveryAttemptId:body.deliveryAttemptId,messageId:'fixture-'+body.deliveryAttemptId}));
  });
  await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));
  const gatewayUrl='https://127.0.0.1:'+(gateway.address() as AddressInfo).port;
  const children:ChildProcess[]=[];let logs='';
  try {
    await withDisposableDatabase(async({admin,app,name})=>{
      const runtime=new URL(process.env.APP_DATABASE_URL!);runtime.pathname='/'+name;
      const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'production',APP_DATABASE_URL:runtime.toString(),
        FRONTEND_URL:'https://app.g01.test',PUBLIC_APP_URL:'https://app.g01.test',AUTH_TRUSTED_PROXY_CIDRS:'direct',
        AUTH_OTP_HMAC_KEY:randomBytes(32).toString('hex'),AUTH_CSRF_KEY:randomBytes(32).toString('hex'),
        AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AUTH_DELIVERY_CALLBACK_KEY:randomBytes(32).toString('hex'),
        DLT_SMS_URL:gatewayUrl+'/send',MAIL_GATEWAY_URL:gatewayUrl+'/send',
        DLT_SMS_STATUS_URL:gatewayUrl+'/status',MAIL_STATUS_URL:gatewayUrl+'/status',
        DLT_SMS_API_KEY:'fixture-sms-key',MAIL_API_KEY:'fixture-mail-key',MAIL_FROM_ADDRESS:'security@g01.test',
        DLT_SENDER_ID:'TESTG01',DLT_ENTITY_ID:'FIXTURE-ENTITY',DLT_OTP_TEMPLATE_ID:'FIXTURE-OTP',DLT_RECOVERY_TEMPLATE_ID:'FIXTURE-RECOVERY',
        NODE_EXTRA_CA_CERTS:ca,ENABLE_DEBUG_OTP:'false',ENABLE_OUTBOX_DELIVERY:'false',
        AWS_EC2_METADATA_DISABLED:'true'};
      async function start(entry:string,extra:NodeJS.ProcessEnv={}){
        const child=spawn(process.execPath,[entry],{cwd:apiRoot,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
        children.push(child);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-30000);});
        return child;
      }
      const firstPort=await port(),secondPort=await port();
      const first=await start(resolve(apiRoot,'dist/apps/api/src/main.js'),{API_PORT:String(firstPort),PGAPPNAME:'g01_http_first'});
      const second=await start(resolve(apiRoot,'dist/apps/api/src/main.js'),{API_PORT:String(secondPort),PGAPPNAME:'g01_http_second'});
      expect(first.pid).not.toBe(second.pid);
      const urls=[firstPort,secondPort].map(p=>'http://127.0.0.1:'+p);
      async function ready(base:string){for(let i=0;i<100;i++){
        try{if((await fetch(base+'/api/v1/auth/me')).status===401)return;}catch{}
        await sleep(100);
      }throw new Error('G01_API_STARTUP_FAILED: '+logs.slice(-3000));}
      await Promise.all(urls.map(ready));
      const origin={Origin:'https://app.g01.test','Content-Type':'application/json'};
      const post=(node:number,path:string,body:unknown,headers:Record<string,string>={})=>fetch(urls[node]+path,
        {method:'POST',headers:{...origin,...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});

      const limited='shared-budget@g01.test';
      const outcomes=await Promise.all(Array.from({length:12},(_,i)=>post(i%2,'/api/v1/auth/otp/request',{identifier:limited})));
      expect(outcomes.filter(r=>r.status===429)).toHaveLength(7);
      expect(outcomes.map(r=>r.status).filter(status=>![201,409,429].includes(status))).toEqual([]);
      expect(submissions.filter(s=>s.to===limited).length).toBeGreaterThan(0);
      expect(submissions.filter(s=>s.to===limited).length).toBeLessThanOrEqual(5);
      await admin.query('TRUNCATE auth_request_budgets');

      // Real JSON decoding and strict-mode handlers, before any provider send.
      const malformed=[null,[],{},123,true,'bad', 'x@y.test\u0000','x@y.test\u200b','x'.repeat(321),'+911234567890'];
      const sendsBefore=submissions.length;
      for(const identifier of malformed)expect((await post(0,'/api/v1/auth/otp/request',{identifier})).status).toBe(422);
      expect(submissions).toHaveLength(sendsBefore);
      for(const value of [null,[],{},true,123,'123456\u0000']){
        expect((await post(0,'/api/v1/auth/otp/verify',{challengeId:randomUUID(),code:value})).status).toBe(422);
        expect((await post(1,'/api/v1/auth/otp/verify',{challengeId:value,code:'123456'})).status).toBe(422);
      }

      async function issue(email:string,node=0){
        const response=await post(node,'/api/v1/auth/otp/request',{identifier:email});expect(response.status).toBe(201);
        const body=await response.json() as any;
        return {challengeId:body.challengeId,code:submissions.find(s=>s.id===body.challengeId)!.code,
          intent:cookie(response,'tc_auth_intent')};
      }
      const proof=await issue('owner@g01.test');
      const registered=await post(1,'/api/v1/auth/otp/verify',{challengeId:proof.challengeId,code:proof.code,
        signupProfile:{fullName:'HTTP Fixture Owner',orgName:'HTTP Fixture HVAC',state:'KA'}},{Cookie:proof.intent});
      expect(registered.status).toBe(201);
      const login:any=await registered.json();expect(login.sessionToken).toBeUndefined();expect(login.mfaRequired).toBe(true);
      let sessionCookie=cookie(registered,'tc_session');
      const unauthenticatedProjects=await fetch(urls[0]+'/api/v1/projects',{headers:{Cookie:sessionCookie}});
      expect(unauthenticatedProjects.status).toBe(403);
      expect((await fetch(urls[1]+'/api/v1/auth/sessions',{headers:{Cookie:sessionCookie}})).status).toBe(403);
      let authHeaders={Cookie:sessionCookie,'x-csrf-token':login.csrfToken,'x-auth-generation':login.authGeneration};
      const enrollment=await post(0,'/api/v1/auth/mfa/enroll/start',{},authHeaders);expect(enrollment.status).toBe(201);
      const setup:any=await enrollment.json();
      const confirmation=await post(1,'/api/v1/auth/mfa/enroll/confirm',{code:totp(setup.manualSetupKey)},authHeaders);
      expect(confirmation.status).toBe(201);const factor:any=await confirmation.json();
      expect((await fetch(urls[0]+'/api/v1/auth/me',{headers:{Cookie:sessionCookie}})).status).toBe(401);
      sessionCookie=cookie(confirmation,'tc_session');
      authHeaders={Cookie:sessionCookie,'x-csrf-token':factor.csrfToken,'x-auth-generation':factor.authGeneration};
      expect((await fetch(urls[0]+'/api/v1/projects',{headers:{Cookie:sessionCookie}})).status).toBe(200);
      const projectId=randomUUID(),partyId=randomUUID();
      await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
        VALUES($1,$2,'HTTP Fixture Supplier',ARRAY['SUPPLIER']::text[],'ACTIVE')`,[partyId,login.activeOrgId]);
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,'G01-HTTP','HTTP Guest Authentication Fixture','ACTIVE',$3)`,[projectId,login.activeOrgId,login.userId]);
      // These are identity fixtures with no requirement/template or readiness
      // claims. Exercise real grant validation and guest principals on both APIs.
      for(const email of [null,[],{},'x@y.test\u0000','x@y.test\u200b']){
        expect((await post(0,'/api/v1/orgs/current/invitations',{email,role:'R-SITE'},authHeaders)).status).toBe(422);
        expect((await post(1,`/api/v1/projects/${projectId}/guest-grants`,{partyId,email},authHeaders)).status).toBe(400);
      }
      const grantResponse=await post(0,`/api/v1/projects/${projectId}/guest-grants`,
        {partyId,email:'guest-http@g01.test',grantType:'SUPPLIER_UPLOAD'},authHeaders);
      expect(grantResponse.status).toBe(201);const grant:any=await grantResponse.json();
      const guestPath='/api/v1/guest/'+grant.token;
      const firstGuestResponse=await post(0,guestPath+'/otp/request',{});
      expect(firstGuestResponse.status).toBe(201);const firstGuest:any=await firstGuestResponse.json();
      const guestIntent=cookie(firstGuestResponse,'tc_auth_intent');
      const secondGuestResponse=await post(1,guestPath+'/otp/request',{}, {Cookie:guestIntent});
      expect(secondGuestResponse.status).toBe(201);const secondGuest:any=await secondGuestResponse.json();
      for(const value of [null,[],{},true,123,'123456\u0000']){
        expect((await post(0,guestPath+'/otp/verify',{challengeId:secondGuest.challengeId,code:value},{Cookie:guestIntent})).status).toBe(400);
      }
      expect((await post(0,guestPath+'/session',{pin:'123456'})).status).toBe(401);
      const oldGuest=await post(1,guestPath+'/otp/verify',{challengeId:firstGuest.challengeId,
        code:submissions.find(s=>s.id===firstGuest.challengeId)!.code},{Cookie:guestIntent});
      expect(oldGuest.status).toBe(401);
      const guestVerified=await post(0,guestPath+'/otp/verify',{challengeId:secondGuest.challengeId,
        code:submissions.find(s=>s.id===secondGuest.challengeId)!.code},{Cookie:guestIntent});
      expect(guestVerified.status).toBe(201);const guestCookie=cookie(guestVerified,'tc_session');
      const guestPrincipal=(await admin.query('SELECT user_id FROM sessions WHERE guest_grant_id=$1',[grant.grantId])).rows[0].user_id;
      expect(guestPrincipal).not.toBe(login.userId);
      expect((await fetch(urls[1]+'/api/v1/guest/me/context',{headers:{Cookie:guestCookie}})).status).toBe(200);
      expect((await post(1,'/api/v1/guest-grants/'+grant.grantId+'/revoke',{},authHeaders)).status).toBe(201);
      expect((await fetch(urls[0]+'/api/v1/guest/me/context',{headers:{Cookie:guestCookie}})).status).toBe(401);
      expect(logs).not.toContain(grant.token);
      for(const value of [null,[],{},123,true,'12345','123456\u0000']){
        expect((await post(0,'/api/v1/auth/mfa/verify',{code:value},authHeaders)).status).toBe(400);
        expect((await post(1,'/api/v1/auth/switch-org',{targetOrgId:value},authHeaders)).status).toBe(422);
      }
      expect((await post(1,'/api/v1/auth/logout',{},authHeaders)).status).toBe(204);
      expect((await fetch(urls[0]+'/api/v1/auth/me',{headers:{Cookie:sessionCookie}})).status).toBe(401);

      // A recovered account rejects outstanding pre-recovery first factors.
      const oldProof=await issue('owner@g01.test');
      await admin.query('UPDATE users SET auth_proof_valid_after=clock_timestamp() WHERE id=$1',[login.userId]);
      const stale=await post(1,'/api/v1/auth/otp/verify',{challengeId:oldProof.challengeId,code:oldProof.code},{Cookie:oldProof.intent});
      expect(stale.status).toBe(401);expect((await stale.json() as any).code).toBe('OTP_REISSUE_REQUIRED_AFTER_RECOVERY');

      // Submission accepted but its HTTP acknowledgement is lost. A separate
      // actual worker queries the trusted TLS gateway by durable attempt ID.
      loseAckFor='lost-ack@g01.test';
      expect((await post(0,'/api/v1/auth/otp/request',{identifier:loseAckFor})).status).toBe(503);
      const lost=submissions.find(s=>s.to===loseAckFor)!;
      await admin.query('UPDATE auth_delivery_attempts SET next_reconcile_at=now() WHERE id=$1',[lost.id]);
      const receiptWorker=await start(resolve(workspace,'apps/worker/dist/apps/worker/src/main.js'),{PGAPPNAME:'g01_http_worker'});
      let reconciled=false;
      for(let i=0;i<150;i++){
        const status=(await admin.query('SELECT delivery_status FROM otp_challenges WHERE id=$1',[lost.id])).rows[0].delivery_status;
        if(status==='SENT'){reconciled=true;break;}await sleep(100);
      }
      if(!reconciled){
        const challengeState=(await admin.query(
          `SELECT delivery_status FROM otp_challenges WHERE id=$1`,[lost.id])).rows[0];
        const attemptState=(await admin.query(
          `SELECT status,channel,reconcile_count,last_sequence,next_reconcile_at
             FROM auth_delivery_attempts WHERE id=$1`,[lost.id])).rows[0];
        // Only coarse process and delivery-state indicators may be printed.
        // Never include captured gateway traffic, OTP, bearer grants, or logs.
        throw new Error('G01_DELIVERY_RECONCILE_TIMEOUT '+JSON.stringify({
          workerExit:receiptWorker.exitCode,
          workerSignal:receiptWorker.signalCode,
          challengeStatus:challengeState?.delivery_status,
          attemptStatus:attemptState?.status,
          channel:attemptState?.channel,
          attempts:attemptState?.reconcile_count,
          sequence:attemptState?.last_sequence,
          nextDue:attemptState?.next_reconcile_at && new Date(attemptState.next_reconcile_at).getTime()<=Date.now(),
          workerStarted:logs.includes('Leader-Locked Schedulers are ACTIVE'),
          workerQpdfDetected:logs.includes('qpdf engine detected'),
          workerDependencyFailure:logs.includes('BOOT_WORKER_'),
          schedulerDeliveryFailure:logs.includes('SCHEDULER_AUTH_DELIVERY_FAILED'),
        }));
      }
      loseAckFor='';

      // Discard the real HTTP response after COMMIT. Replaying the same OTP
      // on the other API cannot create a second user, membership or session.
      const dropped=await issue('dropped-response@g01.test');
      const payload=JSON.stringify({challengeId:dropped.challengeId,code:dropped.code,
        signupProfile:{fullName:'Dropped Response Fixture',orgName:'Response Fixture HVAC',state:'KA'}});
      await new Promise<void>((resolveDone,reject)=>{
        const req=httpRequest(urls[0]+'/api/v1/auth/otp/verify',{method:'POST',headers:{...origin,Cookie:dropped.intent}},res=>{
          if(res.statusCode!==201){reject(new Error('G01_COMMIT_RESPONSE_NOT_CREATED'));return;}
          res.destroy();resolveDone();
        });req.on('error',reject);req.end(payload);
      });
      expect((await post(1,'/api/v1/auth/otp/verify',JSON.parse(payload),{Cookie:dropped.intent})).status).toBe(401);
      const persisted=(await admin.query(`SELECT u.id FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.value='dropped-response@g01.test'`)).rows;
      expect(persisted).toHaveLength(1);
      expect(Number((await admin.query('SELECT count(*) FROM sessions WHERE user_id=$1',[persisted[0].id])).rows[0].count)).toBe(1);

      // Kill the first API while its registration INSERT waits on a real
      // PostgreSQL lock. Its open transaction rolls back; the second API can
      // complete the same proof once after the lock is released.
      const interrupted=await issue('crash-before-commit@g01.test');
      const input={challengeId:interrupted.challengeId,code:interrupted.code,
        signupProfile:{fullName:'Crash Fixture Owner',orgName:'Crash Fixture HVAC',state:'KA'}};
      const locker=await admin.connect();
      try {
        await locker.query('BEGIN');await locker.query('LOCK TABLE organisations IN ACCESS EXCLUSIVE MODE');
        const pending=post(0,'/api/v1/auth/otp/verify',input,{Cookie:interrupted.intent}).catch(()=>null);
        let blocked=false;
        for(let i=0;i<100;i++){
          if((await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name='g01_http_first'
            AND wait_event_type='Lock' AND query LIKE '%INSERT INTO organisations%'`)).rows.length){blocked=true;break;}
          await sleep(20);
        }
        expect(blocked).toBe(true);first.kill('SIGKILL');await pending;
        await locker.query('COMMIT');
        expect((await admin.query('SELECT consumed_at FROM otp_challenges WHERE id=$1',[interrupted.challengeId])).rows[0].consumed_at).toBeNull();
        expect((await post(1,'/api/v1/auth/otp/verify',input,{Cookie:interrupted.intent})).status).toBe(201);
      }finally{await locker.query('ROLLBACK').catch(()=>{});locker.release();}
      expect(submissions.every(s=>s.id && s.code)).toBe(true);
      expect(logs).not.toContain('owner@g01.test');expect(logs).not.toContain(proof.intent.split('=')[1]);
      await Promise.all(children.map(stop));
      await expect(app.query('SELECT 1')).resolves.toBeDefined();
    });
  }finally{
    await Promise.all(children.map(stop));gateway.closeAllConnections();
    await new Promise<void>(r=>gateway.close(()=>r()));rmSync(directory,{recursive:true,force:true});
  }
});
