import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';

jest.setTimeout(180_000);

describe('PH2-G18-009: subscribed prices are exact, unavailable prices stay unavailable', () => {
  it('returns no invented subscription price and preserves prices beyond JS safe integers', async () => {
    await withDisposableDatabase(async ({admin, app}) => {
      const orgId = uuidv7(), owner = uuidv7(), planId = uuidv7();
      await admin.query(`INSERT INTO users(id,name,status)
        VALUES($1,'Subscription owner','ACTIVE')`,[owner]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Exact Subscription Tenant','Exact Subscription Tenant','AP')`,[orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,owner]);
      const ctx:TenantActorContext={
        orgId,userId:owner,actorType:'MEMBER',requestId:uuidv7(),
        ip:'127.0.0.1',userAgent:'phase2-exact-subscription',
      };
      const service = new WarrantyAndBillingService(app);
      const noPlan = await service.getSubscription(ctx);
      expect(noPlan).toMatchObject({
        status:'INACTIVE',planTier:'NONE',pricePaise:null,price_paise:null,
        seatLimit:0,storageQuotaBytes:0,
      });

      const price = '9007199254740993';
      const limits = {
        maxActiveProjects:3,maxSeats:4,maxStorageBytes:1048576,
        maxPackageGenerationsPerMonth:2,
      };
      await admin.query(
        `INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status)
         VALUES($1,$2,'High value test plan',$3::jsonb,$4,'MONTH','ACTIVE')`,
        [planId,'PH2-BIG-'+planId,JSON.stringify(limits),price],
      );
      await admin.query(
        `INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end)
         VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '30 days')`,
        [uuidv7(),orgId,planId],
      );
      const active=await service.getSubscription(ctx);
      expect(active).toMatchObject({
        status:'ACTIVE',planTier:'PH2-BIG-'+planId,
        pricePaise:price,price_paise:price,
        seatLimit:4,storageQuotaBytes:1048576,maxActiveProjects:3,
      });
      expect(typeof active.pricePaise).toBe('string');
    });
  });
});
