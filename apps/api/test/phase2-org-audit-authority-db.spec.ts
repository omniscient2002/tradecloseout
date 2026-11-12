import 'reflect-metadata';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import { OrganisationsController } from '../src/modules/organisations/organisations.controller';
import { REQUIRE_PERMISSION_KEY } from '../src/common/guards/permission.guard';

jest.setTimeout(180_000);

describe('PH2-G03: organisation audit history requires live audit authority', () => {
  it('does not mistake org.read or project-scoped audit for org-wide audit access', async () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY,
      OrganisationsController.prototype.getAuditLog)).toBe('audit.read');
    await withDisposableDatabase(async ({admin,app}) => {
      const orgId=uuidv7(), owner=uuidv7(), site=uuidv7(), pm=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status)
        VALUES($1,'Audit owner','ACTIVE'),($2,'Site worker','ACTIVE'),($3,'Project manager','ACTIVE')`,
        [owner,site,pm]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Audit Isolation Tenant','Audit Isolation Tenant','AP')`,[orgId]);
      const membershipId=uuidv7();
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE'),
              ($4,$2,$5,'R-SITE','ACTIVE'),
              ($6,$2,$7,'R-PM','ACTIVE')`,
        [membershipId,orgId,owner,uuidv7(),site,uuidv7(),pm]);
      await admin.query(`INSERT INTO audit_events(
        id,org_id,actor_type,actor_user_id,action,entity_type,request_id,created_at)
        VALUES($1,$2,'USER',$3,'ORG_PROFILE_UPDATED','ORGANISATION',$4,now())`,
        [uuidv7(),orgId,owner,uuidv7()]);
      const service=new OrganisationsService(app);
      const actor=(userId:string,orgRole:string):TenantActorContext=>({
        orgId,userId,orgRole,actorType:'MEMBER',requestId:uuidv7(),
        ip:'127.0.0.1',userAgent:'phase2-audit',
      });
      const ownerResult=await service.getAuditLog(actor(owner,'R-OWNER'),'current');
      expect(ownerResult).toEqual(expect.arrayContaining([
        expect.objectContaining({action:'ORG_PROFILE_UPDATED'}),
      ]));
      await expect(service.getAuditLog(actor(site,'R-SITE'),orgId)).rejects.toMatchObject({
        response:expect.objectContaining({code:'AUDIT_READ_RESTRICTED'}),
      });
      await expect(service.getAuditLog(actor(site,'R-SITE'),'current')).rejects.toMatchObject({
        response:expect.objectContaining({code:'AUDIT_READ_RESTRICTED'}),
      });
      const pmResult=await service.getAuditLog(actor(pm,'R-PM'),orgId);
      expect(pmResult.length).toBeGreaterThan(0);
      await admin.query(`UPDATE memberships SET role='R-SITE' WHERE id=$1`,[membershipId]);
      await expect(service.getAuditLog(actor(owner,'R-OWNER'),orgId)).rejects.toMatchObject({
        response:expect.objectContaining({code:'AUDIT_READ_RESTRICTED'}),
      });
      await expect(service.getAuditLog(actor(pm,'R-PM'),uuidv7())).rejects.toThrow();
    });
  });
});
