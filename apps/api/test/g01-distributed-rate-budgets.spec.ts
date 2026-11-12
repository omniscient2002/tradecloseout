import { Pool } from 'pg';
import { fork, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { consumeAuthenticationBudget } from '../src/modules/identity/auth-security';

jest.setTimeout(180_000);

describe('G01 rate limiting uses one atomic shared security budget', () => {
  it('enforces the same limit across two actual Node processes with restricted PostgreSQL access',async()=>{
    await withDisposableDatabase(async ({ admin,name }) => {
      const runtime = new URL(process.env.APP_DATABASE_URL!);
      runtime.pathname = '/'+name;
      const category = `g01:real-process:${uuidv7()}`;
      const key = `same-contact-${uuidv7()}`;
      const children: ChildProcess[] = [];
      const spawnWorker = () => new Promise<{accepted:number;denied:number}>((resolveDone,rejectDone)=>{
        let ready = false, settled = false, output = '';
        const child=fork(resolve(__dirname,'helpers/g01-auth-budget-process.cjs'),[],{
          execArgv:['-r',require.resolve('ts-node/register/transpile-only')],
          stdio:['ignore','ignore','pipe','ipc'],
          env:{...process.env,
            TS_NODE_PROJECT:resolve(__dirname,'../tsconfig.json'),
            NODE_ENV:'test',
            G01_PROCESS_DATABASE_URL:runtime.toString(),
            G01_PROCESS_BUDGET_CATEGORY:category,
            G01_PROCESS_BUDGET_KEY:key,
          },
        });
        children.push(child);
        child.stderr?.on('data',chunk=>{output=(output+String(chunk)).slice(-900);});
        const timer=setTimeout(()=>{
          if(!settled){settled=true;child.kill('SIGKILL');rejectDone(new Error('G01_PROCESS_TIMEOUT'));}
        },20_000);
        const done=(err?:Error,value?:{accepted:number;denied:number})=>{
          if(settled)return;
          settled=true;clearTimeout(timer);
          if(err)rejectDone(err);
          else resolveDone(value!);
        };
        child.on('error',e=>done(e));
        child.on('exit',code=>{
          if(!settled)done(new Error(`G01_PROCESS_EXIT_${code}: ${output}`));
        });
        child.on('message',(msg:any)=>{
          if(msg?.ready && !ready){ready=true;child.send('begin');}
          else if(msg?.done){
            if(msg.error)done(new Error(msg.error));
            else done(undefined,{accepted:msg.accepted,denied:msg.denied});
          }
        });
      });
      try {
        // The actual budget SQL runs in two separate Node VMs with separate
        // connections and no shared module/global memory.
        const outcomes=await Promise.all([spawnWorker(),spawnWorker()]);
        expect(outcomes.reduce((n,x)=>n+x.accepted,0)).toBe(7);
        expect(outcomes.reduce((n,x)=>n+x.denied,0)).toBe(25);
        const {rows}=await admin.query(
          `SELECT count,budget_key FROM auth_request_budgets
            WHERE budget_key LIKE $1`,[category+':%'],
        );
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].count)).toBe(32);
      }finally{
        for(const child of children){
          if(child.exitCode===null)child.kill('SIGTERM');
        }
      }
    });
  });

  it('cannot be bypassed by simultaneous calls through two independent Postgres pools', async () => {
    await withDisposableDatabase(async ({ app, admin }) => {
      const secondNode = new Pool({ ...app.options });
      // Disposable helper force-drops its database. Idle pool sockets may
      // receive SQLSTATE 57P01 during teardown; this isn't a test assertion
      // or an unhandled event, and must not mask the budget race result.
      secondNode.on('error', () => {});
      try {
        const category = `g01:distributed:${uuidv7()}`;
        const key = `source-${uuidv7()}`;
        const limit = 6;
        const requests = Array.from({ length: 16 }, (_, i) =>
          consumeAuthenticationBudget(
            i % 2 ? app : secondNode, category, key, limit, 3600,
          ),
        );
        const outcomes = await Promise.allSettled(requests);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(limit);
        const denials = outcomes.filter(
          (x): x is PromiseRejectedResult => x.status === 'rejected',
        );
        expect(denials).toHaveLength(requests.length - limit);
        for (const denial of denials) {
          expect(denial.reason.getStatus()).toBe(429);
          expect(denial.reason.getResponse()).toMatchObject({
            code: 'RATE_LIMITED',
          });
        }
        const rows = (await admin.query(
          `SELECT budget_key,count FROM auth_request_budgets WHERE budget_key LIKE $1`,
          [category + ':%'],
        )).rows;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].count)).toBe(16);
        // An attacker changing source keys cannot bypass a separate
        // global/provider-spend budget that remains common to all requests.
        const global = `g01:global:${uuidv7()}`;
        const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
          consumeAuthenticationBudget(
            i % 2 ? app : secondNode, global, 'all', 3, 3600,
          ),
        ));
        expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(3);
      } finally {
        await secondNode.end();
      }
    });
  });
});
