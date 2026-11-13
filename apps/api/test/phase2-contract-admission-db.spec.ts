import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);
it('PH2-NEW-014: contract admission survives a real project lock and retains exact terms/history',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const org=uuidv7(),user=uuidv7(),project=uuidv7(),party=uuidv7(),foreign=uuidv7(),foreignParty=uuidv7();
    await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic contract issuer','ACTIVE')",[user]);
    for(const id of [org,foreign])await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
      VALUES($1,'Synthetic contract tenant','Synthetic contract tenant','KA')`,[id]);
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,user]);
    await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
      VALUES($1,$2,'CONTRACT-INPUT','Synthetic project','ACTIVE',$3)`,[project,org,user]);
    for(const [id,tenant] of [[party,org],[foreignParty,foreign]])await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
      VALUES($1,$2,'Synthetic counterparty',ARRAY['CLIENT'],'ACTIVE')`,[id,tenant]);
    const ctx:any={orgId:org,userId:user,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-contract'};
    const service=new ProjectsService(app);
    const blocker=await admin.connect();let outcome:Promise<any>|undefined;
    const input:any={contractRef:'  ADMITTED-C  ',title:'  Admitted contract  ',partyId:party,valuePaise:'9007199254740993',
      retentionBps:0,commencementDate:'2027-01-01',completionDate:'2027-12-01'};
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);
      outcome=service.createContract(ctx,project,input).then(value=>({value}),error=>({error}));
      let waiting=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const {rows}=await admin.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='tc_app'
          AND wait_event_type='Lock' AND query LIKE '%FROM projects%'`);
        if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      input.contractRef='MUTATED';input.title=123;input.partyId=foreignParty;input.retentionBps=10000;input.completionDate='2026-01-01';
      await blocker.query('COMMIT');
      expect(await outcome).toMatchObject({value:{contract_ref:'ADMITTED-C',title:'Admitted contract',party_id:party,
        value_paise:'9007199254740993',retention_bps:0}});
    }finally{await blocker.query('ROLLBACK');blocker.release();await outcome;}
    const row=(await admin.query(`SELECT commencement_date::text,completion_date::text FROM contracts WHERE org_id=$1 AND contract_ref='ADMITTED-C'`,[org])).rows[0];
    expect(row).toEqual({commencement_date:'2027-01-01',completion_date:'2027-12-01'});
    const zero=await service.createContract(ctx,project,{contractRef:'ZERO',title:'Explicit zero',valuePaise:0,retentionBps:10000});
    const unknown=await service.createContract(ctx,project,{contractRef:'UNKNOWN',title:'Unknown value'});
    expect(zero).toMatchObject({value_paise:'0',retention_bps:10000});expect(unknown.value_paise).toBeNull();
    for(const state of ['SUSPENDED','CLOSED','HANDOVER','CANCELLED','ARCHIVED']){
      await admin.query('UPDATE projects SET status=$2 WHERE id=$1',[project,state]);
      await expect(service.createContract(ctx,project,{contractRef:`LOCKED-${state}`,title:'Locked project'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_COMMERCIAL_WRITES_LOCKED'})});
    }
    await admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1",[project]);
    await expect(service.createContract(ctx,project,{contractRef:'FOREIGN',title:'Foreign party',partyId:foreignParty})).rejects.toThrow('CONTRACT_PARTY_NOT_FOUND');
    await admin.query("UPDATE parties SET status='ARCHIVED' WHERE id=$1",[party]);
    await expect(service.createContract(ctx,project,{contractRef:'ARCHIVED',title:'Archived party',partyId:party})).rejects.toThrow('CONTRACT_PARTY_NOT_FOUND');
    const counts=async()=>{
      const result=[];for(const [table,predicate] of [['contracts',''],['audit_events'," AND action='CONTRACT_CREATED'"],['outbox_events'," AND event_type='CONTRACT_CREATED'"]]){
        result.push((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1${predicate}`,[org])).rows[0].n);
      }return result;
    };
    expect(await counts()).toEqual([3,3,3]);
    await admin.query(`CREATE FUNCTION synthetic_fail_contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='CONTRACT_CREATED' THEN RAISE EXCEPTION 'SYNTHETIC_CONTRACT_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_contract_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_fail_contract_audit()`);
    await expect(service.createContract(ctx,project,{contractRef:'ROLLBACK',title:'Atomic rollback'})).rejects.toThrow('SYNTHETIC_CONTRACT_AUDIT_FAILURE');
    expect(await counts()).toEqual([3,3,3]);
    expect((await admin.query(`SELECT actor_user_id,after_json FROM audit_events WHERE org_id=$1 AND action='CONTRACT_CREATED'
      AND after_json->>'reference'='ADMITTED-C'`,[org])).rows).toEqual([{actor_user_id:user,after_json:{reference:'ADMITTED-C',status:'ACTIVE'}}]);
  });
});
