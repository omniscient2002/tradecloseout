import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);
it.each(['createProject','createDraftProject'] as const)('PH2-NEW-013: %s snapshots admitted fields before obtaining a real database connection',async method=>{
  await withDisposableDatabase(async({admin,app})=>{
    const org=uuidv7(),user=uuidv7(),party=uuidv7(),foreign=uuidv7(),foreignParty=uuidv7();
    await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic project issuer','ACTIVE')",[user]);
    for(const id of [org,foreign])await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
      VALUES($1,'Synthetic create tenant','Synthetic create tenant','KA')`,[id]);
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
      VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,user]);
    for(const [id,tenant] of [[party,org],[foreignParty,foreign]])await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
      VALUES($1,$2,'Synthetic client',ARRAY['CLIENT'],'ACTIVE')`,[id,tenant]);
    const ctx:any={orgId:org,userId:user,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-create'};
    {
      let announce!:()=>void,release!:()=>void;
      const reached=new Promise<void>(resolve=>{announce=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
      // Only coordinate connection acquisition; all SQL still uses restricted tc_app and real transactions.
      const delayed={connect:async()=>{announce();await gate;return app.connect();}};
      const service=new ProjectsService(delayed as any);
      const code=method==='createProject'?'PUBLIC-CREATE':'DIRECT-CREATE';
      const input:any={code,name:'  Admitted project  ',clientPartyId:party,contractValuePaise:9007199254740993n,
        startDate:'2027-01-01',targetHandoverDate:'2027-12-01',projectType:'HOSPITAL'};
      if(method==='createDraftProject')Object.assign(input,{siteJson:{address:{city:'Admitted city'}},settingsJson:{notes:['Admitted setting']}});
      const outcome=service[method](ctx,input).then(value=>({value}),error=>({error}));
      try{
        await reached;
        input.code='MUTATED';input.name='Mutated project';input.clientPartyId=foreignParty;input.startDate='2028-01-01';
        input.projectType='PRIVATE_COMMERCIAL';
        if(input.siteJson){input.siteJson.address.city='Mutated city';input.settingsJson.notes[0]='Mutated setting';}
      }finally{release();}
      const result=await outcome;expect(result).toMatchObject({value:{code,name:'Admitted project',status:'DRAFT'}});
      const projectId=(result as any).value.projectId;
      const stored=(await admin.query(`SELECT name,client_party_id,contract_value_paise,start_date::text,project_type,status,site_json,settings_json
        FROM projects WHERE id=$1 AND org_id=$2`,[projectId,org])).rows[0];
      expect(stored).toMatchObject({name:'Admitted project',client_party_id:party,contract_value_paise:'9007199254740993',
        start_date:'2027-01-01',project_type:'HOSPITAL',status:'DRAFT'});
      if(method==='createDraftProject'){
        expect(stored.site_json).toEqual({address:{city:'Admitted city'}});
        expect(stored.settings_json).toMatchObject({notes:['Admitted setting'],contract_value_paise:'9007199254740993'});
      }else{expect(stored.site_json).toEqual({});}
      expect((await admin.query(`SELECT role,status FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,[org,projectId,user])).rows)
        .toEqual([{role:'R-PM',status:'ACTIVE'}]);
      expect((await admin.query(`SELECT after_json FROM audit_events WHERE org_id=$1 AND project_id=$2 AND action='PROJECT_CREATED'`,[org,projectId])).rows)
        .toEqual([{after_json:{code,name:'Admitted project',status:'DRAFT'}}]);
      expect((await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE org_id=$1 AND project_id=$2 AND event_type='PROJECT_CREATED'`,[org,projectId])).rows[0].n).toBe(1);
    }
    const service=new ProjectsService(app);
    const zero=await service.createProject(ctx,{code:'EXPLICIT-ZERO',name:'Explicit zero',contractValuePaise:'0'});
    const unknown=await service.createProject(ctx,{code:'UNKNOWN-MONEY',name:'Unknown amount'});
    expect((await admin.query('SELECT contract_value_paise FROM projects WHERE id=$1',[zero.projectId])).rows[0].contract_value_paise).toBe('0');
    expect((await admin.query('SELECT contract_value_paise FROM projects WHERE id=$1',[unknown.projectId])).rows[0].contract_value_paise).toBeNull();
    await expect(service.createProject(ctx,{code:'FOREIGN',name:'Foreign client',clientPartyId:foreignParty})).rejects.toThrow('PROJECT_PARTY_NOT_FOUND');
    await admin.query(`CREATE FUNCTION synthetic_fail_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='PROJECT_CREATED' THEN RAISE EXCEPTION 'SYNTHETIC_CREATE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_create_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_fail_create_audit()`);
    const counts=async()=>{
      const result=[];for(const table of ['projects','project_members','audit_events','outbox_events']){
        result.push((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1`,[org])).rows[0].n);
      }return result;
    };
    const before=await counts();
    await expect(service.createDraftProject(ctx,{code:'ROLLBACK',name:'Atomic create rollback'})).rejects.toThrow('SYNTHETIC_CREATE_AUDIT_FAILURE');
    expect(await counts()).toEqual(before);
  });
});
