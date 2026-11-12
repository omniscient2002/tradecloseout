import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { TenantDbService } from '../src/database/tenant-db.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120_000);

describe('PH1-G26-007: real API tenant/user/token pool transitions',()=>{
  it('reuses one restricted backend without retaining tenant, user, actor or token after COMMIT and ROLLBACK',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const {userId,tenants:[a,b]}=await seedTenants(admin);
      for(const tenant of [a,b]) await admin.query(`INSERT INTO memberships(id,org_id,user_id,role)
        VALUES ($1,$2,$3,'R-OWNER')`,[randomUUID(),tenant.orgId,userId]);
      const single=new Pool({...app.options,max:1});
      const service=new TenantDbService(single);
      const pids=new Set<number>();
      const ctx={orgId:a.orgId,userId,actorType:'USER' as const,requestId:randomUUID()};
      const inspect=async(client:any)=>{
        const row=(await client.query(`SELECT pg_backend_pid() AS pid,
          public.current_app_org_id() AS org,
          nullif(current_setting('app.current_user',true),'') AS actor,
          nullif(current_setting('app.actor_type',true),'') AS type,
          nullif(current_setting('app.current_token_hash',true),'') AS token`)).rows[0];
        pids.add(row.pid); return row;
      };
      try {
        for(const fail of [false,true]){
          for(const kind of ['tenant','user','token']){
            const work=async(client:any)=>{
              const row=await inspect(client);
              if(kind==='tenant'){
                expect(row).toMatchObject({org:a.orgId,actor:userId,type:'USER',token:null});
                expect((await client.query('SELECT id FROM projects')).rowCount).toBe(2);
              }else if(kind==='user'){
                expect(row).toMatchObject({org:null,actor:userId,type:null,token:null});
                expect((await client.query('SELECT id FROM memberships')).rowCount).toBe(2);
                expect((await client.query('DELETE FROM memberships RETURNING id')).rowCount).toBe(0);
              }else{
                expect(row).toMatchObject({org:null,actor:null,type:null,token:'a'.repeat(64)});
                expect((await client.query('SELECT id FROM projects')).rowCount).toBe(0);
              }
              if(fail) await client.query('SELECT 1/0');
            };
            const operation=kind==='tenant'? service.withTenantContext(ctx,work):kind==='user'?
              service.withUserContext(userId,work):service.withTokenContext('a'.repeat(64),work);
            if(fail) await expect(operation).rejects.toMatchObject({code:'22012'});else await operation;
            expect(await inspect(single)).toMatchObject({org:null,actor:null,type:null,token:null});
            expect((await single.query('SELECT id FROM projects')).rowCount).toBe(0);
          }
        }
        await service.withTenantContext({...ctx,orgId:b.orgId},async client=>{
          expect((await client.query('SELECT id FROM projects')).rowCount).toBe(2);
          expect((await client.query('SELECT id FROM projects WHERE org_id=$1',[a.orgId])).rowCount).toBe(0);
        });
        expect(pids.size).toBe(1);
      }finally{await single.end();}
    });
  });
});
