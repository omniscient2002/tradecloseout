import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase, migrateDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { withTenantTransaction } from '@tradecloseout/db';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);
const migration='0054_specification_document_scope.sql';
const constraint='specification_document_scope_fk';
async function seed(admin:Pool){
  const org=uuidv7(),foreign=uuidv7(),user=uuidv7(),project=uuidv7(),other=uuidv7(),foreignProject=uuidv7();
  const document=uuidv7(),otherDocument=uuidv7(),foreignDocument=uuidv7(),deletedDocument=uuidv7();
  await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic reference issuer','ACTIVE')",[user]);
  for(const id of [org,foreign])await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
    VALUES($1,'Synthetic specification tenant','Synthetic specification tenant','KA')`,[id]);
  await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,user]);
  for(const [id,tenant] of [[project,org],[other,org],[foreignProject,foreign]])await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
    VALUES($1,$2,$3,'Synthetic project','ACTIVE',$4)`,[id,tenant,id.slice(-10).toUpperCase(),user]);
  // Metadata-only references: no object/version or engineering approval is fabricated.
  for(const [id,tenant,target,deleted] of [[document,org,project,false],[otherDocument,org,other,false],
    [foreignDocument,foreign,foreignProject,false],[deletedDocument,org,project,true]])await admin.query(`INSERT INTO documents
    (id,org_id,project_id,title,doc_type_key,category_key,created_by,deleted_at)
    VALUES($1,$2,$3,'Synthetic reference metadata','SYNTHETIC-SPEC','SYNTHETIC',$4,CASE WHEN $5 THEN now() ELSE NULL END)`,[id,tenant,target,user,deleted]);
  return {org,foreign,user,project,document,otherDocument,foreignDocument,deletedDocument,
    ctx:{orgId:org,userId:user,actorType:'MEMBER' as const,orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-spec'}};
}

it('PH2-NEW-015: restricted runtime SQL cannot bind foreign-project or foreign-tenant documents',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const s=await seed(admin);
    for(const doc of [s.otherDocument,s.foreignDocument])await expect(withTenantTransaction(app,s.ctx,async client=>
      client.query(`INSERT INTO specification_refs(id,org_id,project_id,spec_number,title,document_id,created_by)
        VALUES($1,$2,$3,'BAD-SCOPE','Synthetic denied reference',$4,$5)`,[uuidv7(),s.org,s.project,doc,s.user])))
      .rejects.toMatchObject({code:'23503',constraint});
    expect((await admin.query('SELECT count(*)::int AS n FROM specification_refs WHERE org_id=$1',[s.org])).rows[0].n).toBe(0);
  });
});

it('PH2-NEW-015: the checked document and admitted fields are the persisted reference, with atomic history',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const s=await seed(admin);let announce!:()=>void,release!:()=>void;
    const checked=new Promise<void>(resolve=>{announce=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    const coordinated={connect:async()=>{
      const client=await app.connect();
      return {query:async(sql:string,params?:any[])=>{
        const result=await client.query(sql,params);
        if(sql.includes('SELECT 1 FROM documents')){announce();await gate;}
        return result;
      },release:(destroy?:boolean)=>client.release(destroy)};
    }};
    const dto:any={specNumber:'  ADMITTED-SPEC  ',title:'  Admitted reference  ',division:' 23 00 ',documentId:s.document};
    const outcome=new ProjectsService(coordinated as any).createSpecification(s.ctx,s.project,dto).then(value=>({value}),error=>({error}));
    try{await checked;dto.specNumber='MUTATED';dto.title='Mutated reference';dto.division='99';dto.documentId=s.foreignDocument;}
    finally{release();}
    const result=await outcome;
    expect(result).toMatchObject({value:{spec_number:'ADMITTED-SPEC',title:'Admitted reference',division:'23 00',document_id:s.document}});
    const service=new ProjectsService(app);
    const noDocument=await service.createSpecification(s.ctx,s.project,{specNumber:'METADATA',title:'Metadata reference',division:'   '});
    expect(noDocument).toMatchObject({document_id:null,division:null});
    for(const doc of [s.otherDocument,s.foreignDocument,s.deletedDocument])await expect(service.createSpecification(s.ctx,s.project,
      {specNumber:'DENIED',title:'Denied document',documentId:doc})).rejects.toThrow('SPECIFICATION_DOCUMENT_NOT_FOUND');
    for(const state of ['SUSPENDED','CLOSED','HANDOVER','CANCELLED','ARCHIVED']){
      await admin.query('UPDATE projects SET status=$2 WHERE id=$1',[s.project,state]);
      await expect(service.createSpecification(s.ctx,s.project,{specNumber:'LOCKED',title:'Locked reference'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_COMMERCIAL_WRITES_LOCKED'})});
    }
    await admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1",[s.project]);
    const count=async()=>(await admin.query(`SELECT
      (SELECT count(*)::int FROM specification_refs WHERE org_id=$1) AS refs,
      (SELECT count(*)::int FROM audit_events WHERE org_id=$1 AND action='PROJECT_SPECIFICATION_ADDED') AS audit,
      (SELECT count(*)::int FROM outbox_events WHERE org_id=$1 AND event_type='PROJECT_SPECIFICATION_ADDED') AS outbox`,[s.org])).rows[0];
    expect(await count()).toEqual({refs:2,audit:2,outbox:2});
    await admin.query(`CREATE FUNCTION synthetic_fail_spec_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='PROJECT_SPECIFICATION_ADDED' THEN RAISE EXCEPTION 'SYNTHETIC_SPEC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_spec_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_fail_spec_audit()`);
    await expect(service.createSpecification(s.ctx,s.project,{specNumber:'ROLLBACK',title:'Atomic rollback'})).rejects.toThrow('SYNTHETIC_SPEC_AUDIT_FAILURE');
    expect(await count()).toEqual({refs:2,audit:2,outbox:2});
  });
});

it('PH2-NEW-015: upgrade fails closed on inconsistent historical links, preserves records and validates a reconciled fixture',async()=>{
  let old:any;
  await withDisposableDatabase(async({admin,url})=>{
    const fk=(await admin.query('SELECT convalidated FROM pg_constraint WHERE conname=$1',[constraint])).rows;
    expect(fk).toEqual([{convalidated:true}]);
    expect((await admin.query('SELECT document_id FROM specification_refs WHERE id=$1',[old.bad])).rows[0].document_id).toBe(old.document);
    expect((await admin.query('SELECT document_id FROM specification_refs WHERE id=$1',[old.unlinked])).rows[0].document_id).toBeNull();
    const ledger=(await admin.query('SELECT checksum,applied_at FROM schema_migrations WHERE name=$1',[migration])).rows;
    await migrateDatabase(url);
    expect((await admin.query('SELECT checksum,applied_at FROM schema_migrations WHERE name=$1',[migration])).rows).toEqual(ledger);
  },{baselineThrough:'0053_phase2_hvac_template_governance.sql',beforeUpgrade:async legacy=>{
    const s=await seed(legacy);old={...s,bad:uuidv7(),unlinked:uuidv7()};
    await legacy.query(`INSERT INTO specification_refs(id,org_id,project_id,title,document_id)
      VALUES($1,$2,$3,'Historical inconsistent fixture',$4),($5,$2,$3,'Historical metadata only',NULL)`,[old.bad,s.org,s.project,s.foreignDocument,old.unlinked]);
    await expect(migrateDatabase(legacy.options.connectionString!)).rejects.toThrow(constraint);
    expect((await legacy.query('SELECT count(*)::int AS n FROM schema_migrations WHERE name=$1',[migration])).rows[0].n).toBe(0);
    expect((await legacy.query('SELECT count(*)::int AS n FROM pg_constraint WHERE conname=$1',[constraint])).rows[0].n).toBe(0);
    expect((await legacy.query('SELECT document_id FROM specification_refs WHERE id=$1',[old.bad])).rows[0].document_id).toBe(s.foreignDocument);
    // Explicit synthetic fixture correction only; migration performs no deletion, guessing or backfill.
    await legacy.query('UPDATE specification_refs SET document_id=$2 WHERE id=$1',[old.bad,s.document]);
  }});
});
