import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';

jest.setTimeout(180_000);

describe('PH2-G03-003: live offboarding authority and project closure fence', () => {
  it('rejects stale actor authority, self-replacement and reassignment of closed-project work', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId=uuidv7(), projectId=uuidv7();
      const owner=uuidv7(), target=uuidv7(), replacement=uuidv7(), siteActor=uuidv7();
      await admin.query(
        `INSERT INTO users(id,name,status) VALUES
          ($1,'Org owner','ACTIVE'),($2,'Departing member','ACTIVE'),
          ($3,'Replacement member','ACTIVE'),($4,'Unprivileged actor','ACTIVE')`,
        [owner,target,replacement,siteActor],
      );
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state)
         VALUES($1,'Offboarding Race Fixture','Offboarding Fixture','AP')`,[orgId],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status) VALUES
         ($1,$2,$3,'R-OWNER','ACTIVE'),
         ($4,$2,$5,'R-SITE','ACTIVE'),
         ($6,$2,$7,'R-SITE','ACTIVE'),
         ($8,$2,$9,'R-SITE','ACTIVE')`,
        [uuidv7(),orgId,owner,uuidv7(),target,uuidv7(),replacement,uuidv7(),siteActor],
      );
      await admin.query(
        `INSERT INTO projects(id,org_id,code,name,status,created_by)
         VALUES($1,$2,'PH2-OFFBOARD','Closed audit project','CLOSED',$3)`,
        [projectId,orgId,owner],
      );
      await admin.query(
        `INSERT INTO defects(id,org_id,project_id,title,description,assigned_user_id,raised_by,status)
         VALUES($1,$2,$3,'Pending remediation','Awaiting accountability',$4,$5,'OPEN')`,
        [uuidv7(),orgId,projectId,target,owner],
      );
      const makeCtx=(userId:string):TenantActorContext=>({
        orgId,userId,actorType:'MEMBER',ip:'127.0.0.1',userAgent:'phase2',requestId:uuidv7(),
      });
      const service=new OrganisationsService(app);
      await expect(service.offboardOrReassignMember(makeCtx(siteActor),{
        targetUserId:target,action:'REASSIGN_ONLY',replacementUserId:replacement,
      })).rejects.toMatchObject({response:expect.objectContaining({code:'OFFBOARDING_NOT_AUTHORIZED'})});
      await expect(service.offboardOrReassignMember(makeCtx(owner),{
        targetUserId:target,action:'REASSIGN_ONLY',replacementUserId:target,
      })).rejects.toMatchObject({response:expect.objectContaining({code:'SELF_REPLACEMENT_NOT_ALLOWED'})});
      await expect(service.offboardOrReassignMember(makeCtx(owner),{
        targetUserId:target,action:'REASSIGN_ONLY',replacementUserId:replacement,
      })).rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_LIFECYCLE_BLOCKS_REASSIGNMENT'})});
      const result=await admin.query(
        `SELECT assigned_user_id FROM defects WHERE org_id=$1 AND project_id=$2`,[orgId,projectId],
      );
      expect(result.rows[0].assigned_user_id).toBe(target);
    });
  });
});
