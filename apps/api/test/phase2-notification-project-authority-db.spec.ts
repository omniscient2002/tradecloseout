import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { TenantDbService } from '../src/database/tenant-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

jest.setTimeout(180_000);

describe('PH2-G20-002: project notifications verify live identity at transaction time', () => {
  it('rejects a demoted old owner, permits scoped members and revokes them on offboarding', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const orgId=uuidv7(), owner=uuidv7(), projectId=uuidv7(), userId=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status)
        VALUES($1,'Organisation owner','ACTIVE'),($2,'Notification recipient','ACTIVE')`,
        [owner,userId]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Phase 2 Notification Tenant','Phase 2 Notification Tenant','AP')`,
        [orgId]);
      const membershipId=uuidv7();
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE'),($4,$2,$5,'R-ADMIN','ACTIVE')`,
        [uuidv7(),orgId,owner,membershipId,userId]);
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,'PH2-NOT-AUTH','Notification authorization','ACTIVE',$3)`,
        [projectId,orgId,owner]);
      const service=new NotificationsService(new TenantDbService(app));
      const actor:any={
        orgId,userId,actorType:'USER',orgRole:'R-OWNER',requestId:uuidv7(),
      };
      const create=(key:string)=>service.createNotification(actor,{
        projectId,channel:'IN_APP',eventKey:'REQUIREMENT_CHANGED',
        dedupKey:key,payload:{title:'Assignment changed'},
      });
      expect((await create('live-owner-1')).notification.status).toBe('SENT');
      await admin.query(`UPDATE memberships SET role='R-SITE'
        WHERE id=$1`,[membershipId]);
      await expect(create('stale-owner-1')).rejects.toThrow('PROJECT_NOT_FOUND');
      expect((await admin.query(`SELECT count(*)::int n FROM notifications
        WHERE org_id=$1 AND dedup_key='stale-owner-1'`,[orgId])).rows[0].n).toBe(0);

      await admin.query(`INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by)
        VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$5)`,
        [uuidv7(),orgId,projectId,userId,owner]);
      expect((await create('scoped-site-1')).notification.status).toBe('SENT');
      await admin.query(`UPDATE memberships SET status='SUSPENDED'
        WHERE id=$1`,[membershipId]);
      await expect(create('removed-user-1')).rejects.toThrow('PROJECT_NOT_FOUND');
      await expect(service.listNotifications(actor)).rejects.toMatchObject({
        response:expect.objectContaining({code:'NOTIFICATION_INBOX_RESTRICTED'}),
      });
      const {rows:[counts]}=await admin.query(`SELECT
        count(*) FILTER (WHERE dedup_key IN ('live-owner-1','scoped-site-1'))::int AS created,
        count(*) FILTER (WHERE dedup_key IN ('stale-owner-1','removed-user-1'))::int AS forbidden
        FROM notifications WHERE org_id=$1`,[orgId]);
      expect(counts).toMatchObject({created:2,forbidden:0});
    });
  });
});
