import {uuidv7} from 'uuidv7';
import {Pool} from 'pg';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {ChecklistsService} from '../src/modules/checklists/checklists.service';

jest.setTimeout(180_000);

async function asSyntheticPrincipal<T>(admin:Pool,principal:string,action:(client:any)=>Promise<T>) {
  const client=await admin.connect();let destroy=false;
  try {await client.query(`SET SESSION AUTHORIZATION "${principal}"`);return await action(client);}
  finally {try{await client.query('RESET SESSION AUTHORIZATION');}catch{destroy=true;}client.release(destroy);}
}

// Distinct synthetic database identities test publication controls only. They
// are not qualified HVAC reviewers or independent business acceptance records.
describe('Phase2 immutable HVAC publication and unsigned legacy isolation',()=>{
  it('requires separately provisioned author/reviewer principals and never treats legacy ACTIVE as approval',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const suffix=uuidv7().replaceAll('-',''),author='synthetic_hvac_author_'+suffix,reviewer='synthetic_hvac_review_'+suffix;
      const role=(name:string,work:(c:any)=>Promise<any>)=>asSyntheticPrincipal(admin,name,work);
      await admin.query(`CREATE ROLE "${author}" NOLOGIN;CREATE ROLE "${reviewer}" NOLOGIN`);
      try {
        await admin.query(`GRANT tc_hvac_template_author,tc_hvac_template_reviewer TO "${author}";GRANT tc_hvac_template_reviewer TO "${reviewer}"`);
        const user=uuidv7(),org=uuidv7(),project=uuidv7(),legacy=uuidv7(),pack=uuidv7();
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic governance owner','ACTIVE')",[user]);
        await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic governance','Synthetic governance','KA')",[org]);
        await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[uuidv7(),org,user]);
        await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
          VALUES($1,$2,'GOVERNANCE-FIXTURE','Synthetic governance project','DRAFT',$3)`,[project,org,user]);
        const payload={requirements:[
          {key:'SYNTHETIC-CALC',title:'Synthetic mapping mechanics: design calculation',docTypeKey:'DT-018',groupKey:'SYNTHETIC',mandatory:false,scopeType:'PROJECT'},
          {key:'SYNTHETIC-CERT',title:'Synthetic mapping mechanics: calibration certificate',docTypeKey:'DT-025',groupKey:'SYNTHETIC',mandatory:false,scopeType:'PROJECT'},
        ]};
        await admin.query(`INSERT INTO template_packs(id,trade,code,name,version,schema_version,payload_json,status)
          VALUES($1,'HVAC','SYNTHETIC-LEGACY','Legacy ACTIVE, not reviewed',1,1,$2,'ACTIVE')`,[legacy,JSON.stringify(payload)]);
        const ctx:any={orgId:org,userId:user,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-governance'};
        const service=new ChecklistsService(app);
        expect(await service.listApprovedHvacTemplates(ctx,project)).toEqual([]);
        await expect(service.applyApprovedHvacTemplate(ctx,project,legacy)).rejects.toThrow('APPROVED_HVAC_TEMPLATE_NOT_FOUND');
        await expect(app.query("UPDATE template_packs SET status='ACTIVE' WHERE id=$1",[legacy])).rejects.toMatchObject({code:'42501'});
        expect((await app.query("SELECT has_table_privilege(current_user,'template_packs','TRIGGER') AS allowed")).rows[0].allowed).toBe(false);
        await expect(app.query("SELECT stage_hvac_template_pack($1,'SYNTHETIC','Synthetic',1,$2)",[pack,JSON.stringify(payload)])).rejects.toMatchObject({code:'42501'});
        for(const invalidPayload of [
          {requirements:[{...payload.requirements[0],mandatory:'false'}]},
          {requirements:[{...payload.requirements[0],key:123}]},
          {requirements:[{...payload.requirements[0],scopeType:'ASSET',assetId:uuidv7()}]},
          {...payload,'security.retention_days':0},
          {...payload,'checklist.groups':true},
          {...payload,'handover.sections':[{key:'A',description:null}]},
          {...payload,'handover.sections':[{key:'A',scopeType:null}]},
          {requirements:[{...payload.requirements[0],dueOffsetDays:1.1}]},
        ]) {
          await expect(role(author,c=>c.query("SELECT stage_hvac_template_pack($1,'INVALID-SYNTHETIC','Invalid mechanics',1,$2)",
            [uuidv7(),JSON.stringify(invalidPayload)]))).rejects.toMatchObject({code:'22023'});
        }
        const stage=()=>role(author,c=>c.query("SELECT stage_hvac_template_pack($1,'SYNTHETIC','Synthetic mechanics, not domain approval',1,$2)",[pack,JSON.stringify(payload)]));
        await stage();await stage();
        const review={candidateSha:'0'.repeat(40),qualifiedReviewerEvidence:'https://example.invalid/synthetic-qualification',
          catalogueRef:'https://example.invalid/synthetic-catalogue-version',mappingEvidence:'https://example.invalid/synthetic-mapping',
          applicabilityEvidence:'https://example.invalid/synthetic-applicability',scenarioEvidence:'https://example.invalid/synthetic-scenarios',exceptions:[]};
        const publish=(who:string,record:unknown=review,id=pack)=>role(who,c=>c.query('SELECT review_hvac_template_pack($1,$2)',[id,JSON.stringify(record)]));
        await expect(publish(author)).rejects.toMatchObject({code:'42501'});
        await expect(publish(reviewer,{})).rejects.toMatchObject({code:'22023'});
        await expect(publish(reviewer,{...review,mappingEvidence:'https://example.invalid/signed?token=synthetic'})).rejects.toMatchObject({code:'22023'});
        await expect(publish(reviewer,review,legacy)).rejects.toMatchObject({code:'42501'});
        await publish(reviewer);await publish(reviewer);
        const published=(await admin.query('SELECT * FROM template_packs WHERE id=$1',[pack])).rows[0];
        expect(published).toMatchObject({status:'ACTIVE',author_identity:author,reviewer_identity:reviewer,governance_version:1,reviewed_candidate_sha:review.candidateSha});
        expect(published.reviewed_at).toBeTruthy();expect(published.review_record_json).toEqual(review);
        expect((await admin.query('SELECT count(*)::int AS n FROM hvac_template_publication_events WHERE pack_id=$1',[pack])).rows[0].n).toBe(2);
        await expect(admin.query("UPDATE template_packs SET payload_json='{}' WHERE id=$1",[pack])).rejects.toMatchObject({code:'23514'});
        await expect(admin.query("UPDATE template_packs SET reviewer_identity='forged' WHERE id=$1",[pack])).rejects.toMatchObject({code:'23514'});
        await expect(admin.query('DELETE FROM hvac_template_publication_events WHERE pack_id=$1',[pack])).rejects.toMatchObject({code:'42501'});
        expect((await service.listApprovedHvacTemplates(ctx,project)).map((p:any)=>p.id)).toEqual([pack]);
        const applied=await service.applyApprovedHvacTemplate(ctx,project,pack);
        expect(applied.instantiatedRequirements).toBe(2);
        await role(reviewer,c=>c.query('SELECT deprecate_hvac_template_pack($1,$2)',[pack,'Synthetic retirement mechanics, not domain policy']));
        expect(await service.listApprovedHvacTemplates(ctx,project)).toEqual([]);
        await expect(service.applyApprovedHvacTemplate(ctx,project,pack)).rejects.toThrow('APPROVED_HVAC_TEMPLATE_NOT_FOUND');
        expect((await admin.query('SELECT checksum FROM checklist_snapshots WHERE id=$1',[applied.snapshotId])).rows[0].checksum).toBe(applied.checksum);
      } finally {await admin.query(`DROP ROLE "${author}";DROP ROLE "${reviewer}"`);}
    });
  });
});
