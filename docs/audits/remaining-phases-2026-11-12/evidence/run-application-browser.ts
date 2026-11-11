import {withDisposableDatabase} from '../../../../packages/db/test/helpers/disposable-database';
import {spawn} from 'child_process';
import {openSync,closeSync,writeFileSync,mkdirSync} from 'fs';
const root=process.cwd(),logs=(process.env.AUDIT_EXECUTION_DIR||'/tmp/tradecloseout-remaining-app-browser')+'/';mkdirSync(logs,{recursive:true});
async function main(){await withDisposableDatabase(async({name})=>{
 const db=new URL(process.env.APP_DATABASE_URL!);db.pathname='/'+name;
 const env={...process.env,APP_DATABASE_URL:db.toString(),REDIS_URL:process.env.REDIS_URL,NODE_ENV:'test',ENABLE_DEBUG_OTP:'true',FRONTEND_URL:'http://localhost:3002',PUBLIC_APP_URL:'http://localhost:3002',AUTH_OTP_HMAC_KEY:'synthetic-browser-audit-otp-key-0000000000000000',AUTH_CSRF_KEY:'synthetic-browser-audit-csrf-key-0000000000000000',AUTH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),NEXT_PUBLIC_ENABLE_DEV_PERSONAS:'false',AWS_EC2_METADATA_DISABLED:'true'};
 const apiFd=openSync(logs+'browser-api.log','w'),webFd=openSync(logs+'browser-web.log','w');
 const api=spawn(process.execPath,['dist/apps/api/src/main.js'],{cwd:root+'/apps/api',env:{...env,API_PORT:'3001'},stdio:['ignore',apiFd,apiFd]});
 const web=spawn(root+'/apps/web/node_modules/.bin/next',['start','-p','3002'],{cwd:root+'/apps/web',env:{...env,NODE_ENV:'production'},stdio:['ignore',webFd,webFd]});
 async function stop(p:any){if(p.exitCode!==null)return;await new Promise<void>(r=>{const t=setTimeout(()=>p.kill('SIGKILL'),3000);p.once('exit',()=>{clearTimeout(t);r();});p.kill('SIGTERM');});}
 try{let ready=false;for(let i=0;i<120;i++){try{const [a,w]=await Promise.all([fetch('http://127.0.0.1:3001/api/v1/auth/me'),fetch('http://localhost:3002/login')]);if(a.status===401&&w.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('BROWSER_APP_STARTUP_FAILED');
 const code=await new Promise<number>(r=>{const fd=openSync(logs+'application-browser.log','w');const p=spawn(root+'/apps/web/node_modules/.bin/playwright',['test','--project=application','--grep','E2E-G01'],{cwd:root+'/apps/web',env:{...env,E2E_BASE_URL:'http://localhost:3002',E2E_LIVE_AUTH:'true'},stdio:['ignore',fd,fd]});p.once('exit',c=>{closeSync(fd);r(c??1);});});writeFileSync(logs+'application-browser-execution.json',JSON.stringify({sourceSha:'36c8efb94ce2ed77ef016ef58ad44d494bfc6e84',exitCode:code,scope:'Existing E2E-G01 production-built Next + real API/PG/Redis; test OTP and fixture delivery only. Not full Phase3/4 workflow/provider acceptance.'},null,2));if(code)process.exitCode=code;
 }finally{await stop(web);await stop(api);closeSync(apiFd);closeSync(webFd);}
});}main().catch(e=>{console.error(e.message);process.exitCode=1;});
