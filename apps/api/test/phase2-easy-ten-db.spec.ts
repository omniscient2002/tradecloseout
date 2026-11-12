import {uuidv7} from 'uuidv7';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {ProjectsService} from '../src/modules/projects/projects.service';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';

jest.setTimeout(180_000);
describe('Phase2 easiest ten: real tenant transactions',()=>{
  it('persists dates, fences current relationships, reads canonical policy and requires immutable branding identity',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const orgId=uuidv7(),owner=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic boundary owner','ACTIVE')",[owner]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Synthetic boundary tenant','Synthetic boundary tenant','KA')`,[orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,owner]);
      const ctx:any={orgId,userId:owner,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-boundaries'};
      const projects=new ProjectsService(app),orgs=new OrganisationsService(app);
      const created=await projects.createProject(ctx,{code:'BOUNDARY',name:'Boundary fixture',startDate:'2027-01-02',targetHandoverDate:'2027-02-01'} as any);
      const project=created.projectId;
      expect(String((await admin.query("SELECT start_date::text FROM projects WHERE id=$1",[project])).rows[0].start_date)).toBe('2027-01-02');
      await expect(projects.createProject(ctx,{code:'BAD-DATES',name:'Invalid dates',startDate:'2027-03-01',targetHandoverDate:'2027-02-01'} as any))
        .rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_PROJECT_DATE_ORDER'})});

      // B04: archived, deleted and foreign clients must not become current counterparties.
      const activeParty=uuidv7(),archivedParty=uuidv7(),deletedParty=uuidv7(),foreignOrg=uuidv7(),foreignParty=uuidv7();
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Foreign fixture','Foreign fixture','KA')`,[foreignOrg]);
      for(const [id,org,status,deleted] of [[activeParty,orgId,'ACTIVE',false],[archivedParty,orgId,'ARCHIVED',false],
        [deletedParty,orgId,'ACTIVE',true],[foreignParty,foreignOrg,'ACTIVE',false]]) {
        await admin.query(`INSERT INTO parties(id,org_id,name,types,status,deleted_at)
          VALUES($1,$2,'Synthetic client',ARRAY['CLIENT']::text[],$3,CASE WHEN $4 THEN now() ELSE NULL END)`,[id,org,status,deleted]);
      }
      for(const id of [archivedParty,deletedParty,foreignParty]) {
        await expect(projects.updateProject(ctx,project,{clientPartyId:id})).rejects.toThrow('PROJECT_PARTY_NOT_FOUND');
        await expect(projects.createProject(ctx,{code:'BAD-CLIENT',name:'Bad client fixture',clientPartyId:id})).rejects.toThrow('PROJECT_PARTY_NOT_FOUND');
      }
      await projects.updateProject(ctx,project,{clientPartyId:activeParty});
      expect((await admin.query('SELECT client_party_id FROM projects WHERE id=$1',[project])).rows[0].client_party_id).toBe(activeParty);

      // B05: parent eligibility is checked under lock, not only by a foreign key.
      const contract=await projects.createContract(ctx,project,{contractRef:'BOUNDARY-C1',title:'Synthetic active contract'});
      const variation={variationRef:'BOUNDARY-V1',title:'Synthetic scope proposal',costDeltaPaise:1};
      await projects.createVariation(ctx,project,contract.id,variation);
      await admin.query("UPDATE contracts SET status='SUPERSEDED' WHERE id=$1",[contract.id]);
      await expect(projects.createVariation(ctx,project,contract.id,{...variation,variationRef:'BOUNDARY-V2'}))
        .rejects.toThrow('VARIATION_CONTRACT_NOT_FOUND');
      const other=await projects.createProject(ctx,{code:'OTHER-PROJECT',name:'Other project fixture'});
      await expect(projects.createVariation(ctx,other.projectId,contract.id,{...variation,variationRef:'WRONG-PROJECT'}))
        .rejects.toThrow('VARIATION_CONTRACT_NOT_FOUND');
      expect((await admin.query('SELECT count(*)::int AS n FROM variations WHERE org_id=$1',[orgId])).rows[0].n).toBe(1);

      // B08: old profile rows cannot present a conflicting effective review policy.
      await admin.query(`INSERT INTO org_profiles(org_id,allow_self_approval) VALUES($1,true)`,[orgId]);
      let profile=await orgs.getOrganisation(ctx,'current');
      expect(profile.allow_self_approval).toBe(false);
      expect(profile.profile.allow_self_approval).toBe(false);
      await orgs.updateOrganisation(ctx,'current',{rowVersion:profile.row_version,allowSelfApproval:false});
      expect((await admin.query('SELECT allow_self_approval FROM org_profiles WHERE org_id=$1',[orgId])).rows[0].allow_self_approval).toBe(false);

      // B09: READY + scan timestamp alone is not a pinned verified storage identity.
      const logo=uuidv7();
      await admin.query(`INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes,status,sha256,av_scanned_at)
        VALUES($1,$2,'synthetic-branding','synthetic.png','image/png',10,'READY',$3,now())`,[logo,orgId,'a'.repeat(64)]);
      profile=await orgs.getOrganisation(ctx,'current');
      await expect(orgs.updateOrganisation(ctx,'current',{rowVersion:profile.row_version,logoObjectId:logo}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_BRANDING_OBJECT'})});
      expect((await admin.query('SELECT logo_object_id FROM org_profiles WHERE org_id=$1',[orgId])).rows[0].logo_object_id).toBeNull();
      await admin.query("UPDATE storage_objects SET observed_size_bytes=10,provider_version_id='synthetic-pinned-version' WHERE id=$1",[logo]);
      await orgs.updateOrganisation(ctx,'current',{rowVersion:profile.row_version,logoObjectId:logo});
      expect((await admin.query('SELECT logo_object_id FROM org_profiles WHERE org_id=$1',[orgId])).rows[0].logo_object_id).toBe(logo);
      const before=(await orgs.getOrganisation(ctx,'current')).row_version;
      await expect(orgs.updateOrganisation(ctx,foreignOrg,{rowVersion:before,displayName:'Must not change'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'NOT_FOUND'})});
      expect((await orgs.getOrganisation(ctx,'current')).row_version).toBe(before);
    });
  });
});
