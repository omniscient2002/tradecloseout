import {test,expect} from '../../../../apps/web/node_modules/@playwright/test';
import {createServer,ServerResponse} from 'http';
import {readFileSync,writeFileSync} from 'fs';
import {resolve} from 'path';
import ts from '../../../../apps/web/node_modules/typescript';
const observations:any[]=[];
function module(name:string){return ts.transpileModule(readFileSync(resolve(__dirname,'../../../../apps/web/src/lib',name+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from\s+(['"])\.\/api-client\1/g,"from '/api-client.js'");}
for(const scenario of ['expired-presign','concurrent-drain'])test('Remaining G22 browser observation: '+scenario,async({page,context})=>{
 let intents=0,puts=0,completes=0,refreshes=0;const held:ServerResponse[]=[];
 const server=createServer(async(req,res)=>{const path=req.url||'';const json=(x:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<script type="module">import * as queue from "/offline-upload-queue.js";import * as api from "/api-client.js";window.harness={queue,api};</script>');return;}
  if(path==='/api-client.js'||path==='/offline-upload-queue.js'){res.setHeader('Content-Type','application/javascript');res.end(module(path.slice(1,-3)));return;}
  if(path.endsWith('/upload-intents')){intents++;json({documentId:'fixture-doc',versionId:'fixture-version',isMultipart:false,partSizeBytes:8,parts:[{partNumber:1,url:'http://127.0.0.1:'+(server.address()as any).port+'/put'}]});return;}
  if(path.includes('refresh')){refreshes++;json({});return;}
  if(path==='/put'){puts++;for await(const _ of req){}if(scenario==='expired-presign'){res.statusCode=403;res.end('synthetic expired URL');return;}held.push(res);if(held.length===2)held.splice(0).forEach(r=>r.end());return;}
  if(path.endsWith('/complete')){completes++;json({});return;}
  if(path==='/api/v1/documents/fixture-doc'){json({versions:[{id:'fixture-version',file_status:'READY'}]});return;}res.writeHead(404).end();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));try{
  await page.goto('http://127.0.0.1:'+(server.address()as any).port);await page.waitForFunction(()=>!!(window as any).harness);
  await page.evaluate(()=>{const h=(window as any).harness;h.api.setCsrfToken('synthetic-csrf','synthetic-generation');h.queue.setOfflineActorPartition('member:synthetic-org:synthetic-user');});
  await context.setOffline(true);await page.evaluate(async()=>{await(window as any).harness.queue.enqueueFieldUpload({projectId:'synthetic-project',requirementId:'synthetic-requirement',file:new File(['abcdefgh'],'synthetic.pdf',{type:'application/pdf'}),revisionCode:'R0',issueDate:'2026-11-11',title:'Synthetic recovery fixture'});});await context.setOffline(false);
  if(scenario==='expired-presign'){await page.evaluate(async()=>{await(window as any).harness.queue.drainOfflineUploadQueue();await(window as any).harness.queue.drainOfflineUploadQueue();});expect(intents).toBe(1);expect(puts).toBe(2);expect(refreshes).toBe(0);expect(completes).toBe(0);}
  else{await page.evaluate(async()=>{await Promise.all([(window as any).harness.queue.drainOfflineUploadQueue(),(window as any).harness.queue.drainOfflineUploadQueue()]);});expect(puts).toBe(2);expect(completes).toBe(2);}
  observations.push({id:scenario==='expired-presign'?'B01':'B02',group:'G22',scenario,intents,puts,completes,refreshes,method:'Real Chromium, IndexedDB Blob and actual browser modules; loopback protocol fixture, not real S3/API acceptance'});
 }finally{held.splice(0).forEach(r=>r.end());await context.setOffline(false);await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
test.afterAll(()=>writeFileSync(process.env.OFFLINE_PROBE_RESULTS||'/tmp/tradecloseout-remaining-offline-results.json',JSON.stringify({sourceSha:'36c8efb94ce2ed77ef016ef58ad44d494bfc6e84',observations},null,2)));
