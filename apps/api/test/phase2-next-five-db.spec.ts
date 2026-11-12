import {uuidv7} from 'uuidv7';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {PartiesService} from '../src/modules/parties/parties.service';
import {TenantDbService} from '../src/database/tenant-db.service';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';
jest.setTimeout(180_000);
// Synthetic directory/admin mechanics; no invitation provider or engineering acceptance.
it('D01-D05: exact directory input, live authority, atomic history and current-org mutation aliases',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const org=uuidv7(),foreign=uuidv7(),owner=uuidv7(),target=uuidv7();
    await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic directory owner','ACTIVE'),($2,'Synthetic team member','ACTIVE')",[owner,target]);
    for(const id of [org,foreign])await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
      VALUES($1,'Synthetic directory tenant','Synthetic directory tenant','KA')`,[id]);
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES
      ($1,$2,$3,'R-OWNER','ACTIVE'),($4,$2,$5,'R-SITE','ACTIVE')`,[uuidv7(),org,owner,uuidv7(),target]);
    const ctx:any={orgId:org,userId:owner,actorType:'USER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-directory'};
    const service=new PartiesService(new TenantDbService(app));
    const entry=await service.createParty(ctx,{name:'  Synthetic multi-role company  ',types:['CLIENT','SUPPLIER_OEM'],
      gstin:'29aabcu9603r1zj',email:'  CONTACT@EXAMPLE.INVALID  ',phone:'+914012345678'});
    expect(entry).toMatchObject({org_id:org,name:'Synthetic multi-role company',types:['CLIENT','SUPPLIER_OEM'],
      gstin:'29AABCU9603R1ZJ',email:'contact@example.invalid',phone:'+914012345678',status:'ACTIVE'});
    expect((await admin.query('SELECT gstin,email,phone FROM parties WHERE id=$1',[entry.id])).rows[0])
      .toEqual({gstin:'29AABCU9603R1ZJ',email:'contact@example.invalid',phone:'+914012345678'});
    const noContacts=await service.createParty(ctx,{name:'Synthetic insurer',types:['INSURER']});
    expect(noContacts).toMatchObject({gstin:null,email:null,phone:null,types:['INSURER']});
    const audit=(await admin.query("SELECT actor_user_id,after_json FROM audit_events WHERE org_id=$1 AND action='PARTY_CREATED' AND entity_id=$2",[org,entry.id])).rows[0];
    expect(audit).toMatchObject({actor_user_id:owner,after_json:{types:['CLIENT','SUPPLIER_OEM'],status:'ACTIVE'}});
    expect(JSON.stringify(audit)).not.toContain('contact@example.invalid');
    const event=(await admin.query("SELECT payload_json FROM outbox_events WHERE org_id=$1 AND event_type='PARTY_CREATED' AND payload_json->>'entityId'=$2",[org,entry.id])).rows[0];
    expect(event.payload_json).toMatchObject({orgId:org,entityId:entry.id,entityType:'PARTY',actorUserId:owner});
    const counts=async()=>{
      const result=[];for(const table of ['parties','audit_events','outbox_events']) {
        result.push((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1`,[org])).rows[0].n);
      }return result;
    };
    const baseline=await counts();
    await admin.query("UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",[org,owner]);
    await expect(service.createParty({...ctx,projectRole:'R-PM'},{name:'Must not escalate',types:['SUPPLIER_OEM']})).rejects.toMatchObject({status:403});
    await admin.query("UPDATE memberships SET role='R-OWNER' WHERE org_id=$1 AND user_id=$2",[org,owner]);
    await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[owner]);
    await expect(service.createParty(ctx,{name:'Inactive actor',types:['CLIENT']})).rejects.toMatchObject({status:403});
    await admin.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[owner]);
    expect(await counts()).toEqual(baseline);
    await admin.query(`CREATE FUNCTION synthetic_fail_directory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='PARTY_CREATED' THEN RAISE EXCEPTION 'SYNTHETIC_DIRECTORY_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_directory_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_fail_directory_audit()`);
    await expect(service.createParty(ctx,{name:'Atomic failure fixture',types:['OTHER']})).rejects.toThrow('SYNTHETIC_DIRECTORY_AUDIT_FAILURE');
    expect(await counts()).toEqual(baseline);
    await admin.query('DROP TRIGGER synthetic_directory_failure ON audit_events');

    const organisations=new OrganisationsService(app);const actor={...ctx,actorType:'MEMBER'};
    const invitation=await organisations.createInvitation(actor,'current',{email:'synthetic-invite@example.invalid',role:'R-SITE'});
    expect(invitation.status).toBe('PENDING');
    expect((await admin.query('SELECT org_id FROM invitations WHERE id=$1',[invitation.id])).rows[0].org_id).toBe(org);
    expect((await organisations.revokeInvitation(actor,'current',invitation.id)).status).toBe('REVOKED');
    await organisations.updateMemberRole(actor,'current',target,{role:'R-DOC'});
    expect((await admin.query('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2',[org,target])).rows[0].role).toBe('R-DOC');
    const gaps=await organisations.getOffboardingGapReport(actor,'current',target);expect(gaps).toBeDefined();
    await expect(organisations.createInvitation(actor,foreign,{email:'must-not-invite@example.invalid',role:'R-SITE'})).rejects.toMatchObject({status:404});
    await expect(organisations.updateMemberRole(actor,foreign,target,{role:'R-PM'})).rejects.toMatchObject({status:404});
    expect((await admin.query('SELECT count(*)::int AS n FROM invitations WHERE org_id=$1',[foreign])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT count(*)::int AS n FROM parties WHERE org_id=$1',[foreign])).rows[0].n).toBe(0);
  });
});
