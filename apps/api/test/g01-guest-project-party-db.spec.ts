import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { PartiesService } from '../src/modules/parties/parties.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(180_000);

describe('G01 guest-grant party authority and safe invitation issuance', () => {
  it('never assigns client/consultant powers to arbitrary tenant parties', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const org=uuidv7(),userId=uuidv7(),project=uuidv7();
      const clientParty=uuidv7(),consultantParty=uuidv7(),supplierParty=uuidv7();
      await admin.query(
        `INSERT INTO users(id,name,status) VALUES($1,'Contractor Manager','ACTIVE')`,
        [userId],
      );
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state,status)
           VALUES($1,'G01 Trusted Project','G01 Trusted Project','KA','ACTIVE')`,[org],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
           VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
        [uuidv7(),org,userId],
      );
      for (const [id,name,role] of [
        [clientParty,'Actual Client','CLIENT'],
        [consultantParty,'Actual Consultant','CONSULTANT'],
        [supplierParty,'Unrelated Supplier','SUPPLIER_OEM'],
      ]) {
        await admin.query(
          `INSERT INTO parties(id,org_id,name,types,status)
             VALUES($1,$2,$3,ARRAY[$4]::text[],'ACTIVE')`,
          [id,org,name,role],
        );
      }
      await admin.query(
        `INSERT INTO projects
          (id,org_id,code,name,status,created_by,client_party_id,consultant_party_id)
          VALUES($1,$2,'G01-TRUST','Bound client and consultant','ACTIVE',$3,$4,$5)`,
        [project,org,userId,clientParty,consultantParty],
      );
      const svc=new PartiesService(new TenantDbService(app));
      const ctx:any={actorType:'USER',orgId:org,userId,
        orgRole:'R-OWNER',requestId:'g01-party-boundary',ip:'127.0.0.1'};
      const invite=(partyId:string,grantType:string,extra:Record<string,unknown>={}) =>
        svc.createGuestGrant(ctx,project,{
          partyId,grantType,email:'independent@g01.test',...extra,
        });

      await expect(invite(supplierParty,'CLIENT_VIEW')).rejects.toMatchObject({
        response:expect.objectContaining({code:'GUEST_PARTY_NOT_PROJECT_COUNTERPARTY'}),
      });
      await expect(invite(supplierParty,'CONSULTANT_REVIEW')).rejects.toThrow();
      await expect(invite(clientParty,'CONSULTANT_REVIEW')).rejects.toThrow();
      await expect(invite(clientParty,'CLIENT_VIEW',{otpRequired:false})).rejects.toThrow();
      await expect(svc.createGuestGrant(ctx,project,{
        partyId:clientParty,grantType:[] as any,email:'independent@g01.test',
      })).rejects.toMatchObject({response:expect.objectContaining({
        code:'INVALID_GUEST_GRANT_TYPE',
      })});
      await expect(invite(clientParty,'CLIENT_VIEW',{scopeJson:['all'] as any})).rejects.toThrow();
      expect((await admin.query(
        'SELECT count(*)::int AS n FROM guest_grants WHERE org_id=$1',[org],
      )).rows[0].n).toBe(0);

      const allowedClient=await invite(clientParty,'CLIENT_VIEW');
      const allowedConsultant=await invite(consultantParty,'CONSULTANT_REVIEW');
      expect(allowedClient.grantId).toBeTruthy();
      expect(allowedConsultant.grantId).toBeTruthy();
      expect((await svc.getGuestGrant(allowedClient.token)).projectId).toBe(project);

      // Reassignment after issuance invalidates old invitations and must not
      // silently transfer the privileged party relationship.
      await admin.query(
        'UPDATE projects SET client_party_id=$1 WHERE id=$2',
        [supplierParty,project],
      );
      await expect(svc.getGuestGrant(allowedClient.token)).rejects.toThrow();
      await expect(svc.requestGuestOtp(allowedClient.token)).rejects.toThrow();
      expect((await svc.getGuestGrant(allowedConsultant.token)).projectId).toBe(project);
    });
  });
});
