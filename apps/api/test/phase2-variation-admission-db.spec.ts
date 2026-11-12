import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);

it('PH2-NEW-012: explicit exact amounts, draft history and a detached proposal across a real project lock',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const org=uuidv7(),user=uuidv7(),project=uuidv7(),contract=uuidv7();
    await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic proposal issuer','ACTIVE')",[user]);
    await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
      VALUES($1,'Synthetic proposal tenant','Synthetic proposal tenant','KA')`,[org]);
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
      VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,user]);
    await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
      VALUES($1,$2,'PROPOSAL','Synthetic project','ACTIVE',$3)`,[project,org,user]);
    await admin.query(`INSERT INTO contracts(id,org_id,project_id,contract_ref,title,status,created_by)
      VALUES($1,$2,$3,'C1','Synthetic contract','ACTIVE',$4)`,[contract,org,project,user]);
    const ctx:any={orgId:org,userId:user,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-proposals'};
    const service=new ProjectsService(app);
    const amounts=[0,0n,'0',-100n,'9007199254740993','9223372036854775807','-9223372036854775808'];
    for(const [index,amount] of amounts.entries()){
      const row=await service.createVariation(ctx,project,contract,{variationRef:`  V${index}  `,title:' Synthetic proposal ',costDeltaPaise:amount as any});
      expect(row).toMatchObject({org_id:org,project_id:project,contract_id:contract,variation_ref:`V${index}`,
        title:'Synthetic proposal',cost_delta_paise:String(amount),status:'DRAFT',approved_by:null,scope_delta_json:{}});
    }
    const counts=async()=>{
      const result=[];
      for(const [table,predicate] of [['variations',''],['audit_events'," AND action='VARIATION_DRAFT_CREATED'"],['outbox_events'," AND event_type='VARIATION_DRAFT_CREATED'"]]){
        result.push((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1${predicate}`,[org])).rows[0].n);
      }return result;
    };
    expect(await counts()).toEqual([7,7,7]);
    for(const amount of [undefined,null])await expect(service.createVariation(ctx,project,contract,
      {variationRef:'MISSING',title:'Missing amount',costDeltaPaise:amount} as any)).rejects.toMatchObject({status:422});
    expect(await counts()).toEqual([7,7,7]);

    const blocker=await admin.connect();let outcome:Promise<any>|undefined;
    const input:any={variationRef:'DETACHED',title:'Admitted title',costDeltaPaise:1n,scopeDeltaJson:{description:'Admitted scope'}};
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);
      outcome=service.createVariation(ctx,project,contract,input).then(value=>({value}),error=>({error}));
      let waiting=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const {rows}=await admin.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND usename='tc_app' AND wait_event_type='Lock' AND query LIKE '%FROM projects%'`);
        if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      input.variationRef='MUTATED';input.title=123;input.costDeltaPaise=999n;input.scopeDeltaJson.description='Mutated scope';
      await blocker.query('COMMIT');
      expect(await outcome).toMatchObject({value:{variation_ref:'DETACHED',title:'Admitted title',cost_delta_paise:'1',
        scope_delta_json:{description:'Admitted scope'},status:'DRAFT',approved_by:null}});
    }finally{await blocker.query('ROLLBACK');blocker.release();await outcome;}
    const event=(await admin.query(`SELECT after_json FROM audit_events WHERE org_id=$1 AND action='VARIATION_DRAFT_CREATED'
      AND after_json->>'reference'='DETACHED'`,[org])).rows[0];
    expect(event.after_json).toMatchObject({contractId:contract,reference:'DETACHED',status:'DRAFT'});
    expect(await counts()).toEqual([8,8,8]);
  });
});
