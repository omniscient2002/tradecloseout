import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { TenantDbService } from '../src/database/tenant-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

jest.setTimeout(180_000);

describe('PH1-G24-005: notification producer preserves accepted and in-flight content', () => {
  it('marks in-app delivered; external acceptance only after gateway; dedup cannot change submitted payload',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const {userId,tenants:[tenant]}=await seedTenants(admin);
      // The generic seedTenants helper creates projects, not organisation
      // membership. The private inbox now requires a real active membership;
      // do not weaken the service to accommodate a fixture without one.
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
           VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
        [uuidv7(),tenant.orgId,userId],
      );
      const service=new NotificationsService(new TenantDbService(app));
      const ctx:any={orgId:tenant.orgId,userId,actorType:'SYSTEM',requestId:'g24-notification-producer'};
      const external=await service.createNotification(ctx,{channel:'EMAIL',eventKey:'G24_TEST',
        payload:{message:'original'},dedupKey:'g24-dedup-'+uuidv7()});
      expect(external.notification.status).toBe('QUEUED');
      expect(external.notification.gateway_state).toBe('PENDING');
      expect(external.notification.sent_at).toBeNull();
      const id=external.notification.id;
      await admin.query(`UPDATE notifications SET delivery_attempts=1,
        claim_token=$2,claim_until=now()+interval '30 seconds' WHERE id=$1`,[id,uuidv7()]);
      await expect(service.createNotification(ctx,{channel:'EMAIL',eventKey:'G24_TEST',
        payload:{message:'forged after submission'},dedupKey:external.notification.dedup_key}))
        .rejects.toMatchObject({
          response: expect.objectContaining({ code: 'NOTIFICATION_DEDUP_CONFLICT' }),
        });
      const {rows:[after]}=await admin.query(`SELECT id,status,gateway_state,payload_json,
        delivery_attempts FROM notifications WHERE id=$1`,[id]);
      expect(after.id).toBe(id);
      expect(after.payload_json).toEqual({message:'original'});
      expect(after.delivery_attempts).toBe(1);
      expect(after.status).toBe('QUEUED');
      const inapp=await service.createNotification(ctx,{channel:'IN_APP',eventKey:'G24_TEST',
        payload:{message:'in-app'},dedupKey:'g24-inapp-'+uuidv7()});
      expect(inapp.notification.status).toBe('SENT');
      expect(inapp.notification.gateway_state).toBe('DELIVERED');
      expect(inapp.notification.sent_at).not.toBeNull();
      // The producer is SYSTEM-authorised for creation, whereas inbox reads
      // are user-scoped and require a live active tenant membership.
      const listed=await service.listNotifications({...ctx,actorType:'USER'});
      expect(listed.find((row:any)=>row.id===id)?.gatewayState).toBe('PENDING');
      expect(listed.find((row:any)=>row.id===inapp.notification.id)?.gatewayState).toBe('DELIVERED');
    });
  });
});
