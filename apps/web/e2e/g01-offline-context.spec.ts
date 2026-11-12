import { test, expect } from '@playwright/test';
import { createServer, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Actual browser modules, transpiled without changing their behavior. The
// local API/object-store protocol fixture is not real S3/scanner acceptance.
function browserModule(name:string):string {
  const source=readFileSync(resolve(__dirname,'../src/lib',name+'.ts'),'utf8');
  return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}})
    .outputText.replace(/from\s+(['"])\.\/api-client\1/g,"from '/api-client.js'");
}
async function drafts(page:any):Promise<any[]>{return page.evaluate(()=>new Promise((resolveDone,reject)=>{
  const open=indexedDB.open('tradecloseout_field_pwa',1);
  open.onsuccess=()=>{const db=open.result;const tx=db.transaction('tc_offline_upload_outbox','readonly');
    const result=tx.objectStore('tc_offline_upload_outbox').getAll();
    result.onsuccess=()=>resolveDone(result.result.map((item:any)=>({status:item.status,parts:item.uploadedParts.length,bytes:item.fileBlob.size,checksum:item.checksumSha256})));
    result.onerror=()=>reject(result.error);tx.oncomplete=()=>db.close();};
}));}

for(const scenario of ['switch-during-put','switch-during-scan','interrupt-and-resume'] as const){
  test(`G01 browser IndexedDB/multipart: ${scenario}`,async({context,page})=>{
    const puts:number[]=[],received=new Map<number,Buffer>();
    let complete=0,polls=0,intents=0;let held:ServerResponse|undefined;
    let interruptionActive=true,forceDisconnect=false;
    const server=createServer(async(req,res)=>{
      const path=req.url||'';
      res.setHeader('Cache-Control','no-store');
      if(path==='/'){
        res.setHeader('Content-Type','text/html');
        res.end(`<script type="module">import * as queue from '/offline-upload-queue.js';import * as api from '/api-client.js';
          window.harness={queue,api};api.watchAuthChanges(()=>{window.authChanged=true});</script>`);return;
      }
      if(path==='/api-client.js'||path==='/offline-upload-queue.js'){
        res.setHeader('Content-Type','application/javascript');res.end(browserModule(path.slice(1,-3)));return;
      }
      const json=(body:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
      if(path.endsWith('/upload-intents')){
        intents++;
        const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
        json({documentId:'fixture-document',versionId:'fixture-version',isMultipart:true,partSizeBytes:4,
          parts:[1,2].map(partNumber=>({partNumber,url:base+'/parts/'+partNumber}))});return;
      }
      if(path.startsWith('/parts/')){
        const part=Number(path.split('/').pop());puts.push(part);
        const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        if(scenario==='interrupt-and-resume'&&part===2&&interruptionActive){
          if(forceDisconnect)req.socket.destroy();else held=res;
          return;
        }
        received.set(part,Buffer.concat(chunks));
        res.setHeader('ETag','"fixture-etag-'+part+'"');
        if(scenario==='switch-during-put'&&part===1){held=res;return;}
        res.end();return;
      }
      if(path.endsWith('/complete')){complete++;json({});return;}
      if(path==='/api/v1/documents/fixture-document'){
        polls++;
        if(scenario==='switch-during-scan'){held=res;return;}
        json({versions:[{id:'fixture-version',file_status:'READY'}]});return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    const other=await context.newPage();
    try {
      await page.goto(url);await other.goto(url);
      for(const tab of [page,other])await tab.waitForFunction(()=>Boolean((window as any).harness));
      await page.evaluate(()=>{const h=(window as any).harness;
        h.api.setCsrfToken('fixture-csrf-A','fixture-generation-A');h.queue.setOfflineActorPartition('member:org-a:user-a');});
      // Persist a real Blob and checksum while the browser is genuinely offline.
      await context.setOffline(true);
      await page.evaluate(async()=>{await (window as any).harness.queue.enqueueFieldUpload({
        projectId:'fixture-project',requirementId:'fixture-requirement',
        file:new File(['abcdefgh'],'fixture.pdf',{type:'application/pdf'}),
        revisionCode:'A',issueDate:'2026-11-11',title:'Disposable browser fixture',
      });});
      expect(await drafts(page)).toEqual([expect.objectContaining({status:'QUEUED_OFFLINE',bytes:8,parts:0})]);
      await context.setOffline(false);
      await page.evaluate(()=>{(window as any).draining=(window as any).harness.queue.drainOfflineUploadQueue();});

      if(scenario==='interrupt-and-resume'){
        await expect.poll(()=>Boolean(held)).toBe(true);
        forceDisconnect=true;await context.setOffline(true);held!.destroy();
        expect(await page.evaluate(()=>navigator.onLine)).toBe(false);
        await expect.poll(async()=>(await drafts(page))[0]?.status).toBe('QUEUED_OFFLINE');
        expect((await drafts(page))[0].parts).toBe(1);
        expect((await drafts(page))[0].bytes).toBe(8);
        const failedPutAttempts=puts.filter(n=>n===2).length;
        interruptionActive=false;
        await context.setOffline(false);await page.reload();
        await page.waitForFunction(()=>Boolean((window as any).harness));
        await page.evaluate(async()=>{await (window as any).harness.queue.drainOfflineUploadQueue();});
        expect(await drafts(page)).toEqual([]);
        expect(puts.filter(n=>n===1)).toHaveLength(1);expect(puts.filter(n=>n===2)).toHaveLength(failedPutAttempts+1);
        expect(intents).toBe(1);expect(complete).toBe(1);expect(polls).toBe(1);
        expect(createHash('sha256').update(Buffer.concat([received.get(1)!,received.get(2)!])).digest('hex'))
          .toBe(createHash('sha256').update('abcdefgh').digest('hex'));
      }else{
        await expect.poll(()=>Boolean(held)).toBe(true);
        // A different real tab broadcasts an actor/generation/epoch change
        // while bytes or a scan response are in flight on the original tab.
        await other.evaluate(()=>{const h=(window as any).harness;
          h.queue.setOfflineActorPartition('member:org-b:user-b');h.api.setCsrfToken('fixture-csrf-B','fixture-generation-B');});
        await page.waitForFunction(()=>Boolean((window as any).authChanged));
        if(scenario==='switch-during-scan'){
          held!.setHeader('Content-Type','application/json');held!.end(JSON.stringify({versions:[{id:'fixture-version',file_status:'READY'}]}));
        }else held!.end();
        await page.evaluate(async()=>{await (window as any).draining;});
        expect(await drafts(page)).toEqual([expect.objectContaining({status:'BLOCKED_SCOPE',bytes:8})]);
        if(scenario==='switch-during-put'){expect(puts).toEqual([1]);expect(complete).toBe(0);expect(polls).toBe(0);}
        else{expect(puts).toEqual([1,2]);expect(complete).toBe(1);expect(polls).toBe(1);}
        // Explicitly confirming B still cannot rebind A's persisted evidence.
        await page.evaluate(async()=>{const h=(window as any).harness;
          h.api.setCsrfToken('fixture-csrf-B','fixture-generation-B');await h.queue.drainOfflineUploadQueue();});
        expect((await drafts(page))[0].status).toBe('BLOCKED_SCOPE');
        expect(puts).toHaveLength(scenario==='switch-during-put'?1:2);
      }
    }finally{
      held?.end();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
      await other.close();
    }
  });
}

test('G01 browser logout keeps identity until the exact revocation acknowledgement',async({page})=>{
  let status=503,drop=false;
  const server=createServer(async(req,res)=>{
    const path=req.url||'';
    if(path==='/'){
      res.setHeader('Content-Type','text/html');
      res.end(`<script type="module">import * as api from '/api-client.js';window.harness={api};</script>`);return;
    }
    if(path==='/api-client.js'){res.setHeader('Content-Type','application/javascript');res.end(browserModule('api-client'));return;}
    if(path==='/api/v1/auth/logout'){
      if(drop){req.socket.destroy();return;}
      if(status===204){res.writeHead(204).end();return;}
      res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(
        status===503?{status:503,code:'DEPENDENCY_UNAVAILABLE',detail:'Fixture unavailable'}:{}));return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {
    await page.goto('http://127.0.0.1:'+(server.address() as AddressInfo).port);
    await page.waitForFunction(()=>Boolean((window as any).harness));
    await page.evaluate(()=>{(window as any).harness.api.setCsrfToken('fixture-csrf','fixture-generation');
      localStorage.setItem('tc_offline_actor_partition','member:fixture-user');});
    const originalEpoch=await page.evaluate(()=>(window as any).harness.api.getAuthEpoch());
    for(const failure of ['server','unexpected-2xx','connection-loss']){
      status=failure==='unexpected-2xx'?200:503;drop=failure==='connection-loss';
      const outcome=await page.evaluate(async()=>{const api=(window as any).harness.api;
        const result=await api.api.auth.logout();return {error:result.error,csrf:api.getCsrfToken(),generation:api.getAuthGeneration(),epoch:api.getAuthEpoch(),partition:localStorage.getItem('tc_offline_actor_partition')};});
      expect(outcome.error).toBeTruthy();
      expect(outcome).toMatchObject({csrf:'fixture-csrf',generation:'fixture-generation',epoch:originalEpoch,partition:'member:fixture-user'});
    }
    status=204;drop=false;
    const outcome=await page.evaluate(async()=>{const api=(window as any).harness.api;
      const result=await api.api.auth.logout();return {error:result.error,csrf:api.getCsrfToken(),generation:api.getAuthGeneration(),epoch:api.getAuthEpoch(),partition:localStorage.getItem('tc_offline_actor_partition')};});
    expect(outcome.error).toBeNull();expect(outcome.csrf).toBeNull();expect(outcome.generation).toBeNull();expect(outcome.epoch).not.toBe(originalEpoch);expect(outcome.partition).toBeNull();
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
