import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { TenantDbService } from '../src/database/tenant-db.service';
import { DocumentsService } from '../src/modules/documents/documents.service';

jest.setTimeout(180_000);

describe('PH2-G18-003: atomic upload reservations and zero quota', () => {
  it('denies zero capacity and serializes concurrent intents against pending storage', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const orgId=uuidv7(), projectId=uuidv7(), userId=uuidv7(), planId=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status) VALUES ($1,'Storage owner','ACTIVE')`,[userId]);
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state)
         VALUES($1,'Storage Capacity Fixture','Storage Fixture','AP')`,[orgId],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
         VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
        [uuidv7(),orgId,userId],
      );
      await admin.query(
        `INSERT INTO projects(id,org_id,code,name,status,created_by)
         VALUES($1,$2,'PH2-STORAGE','Storage quota project','ACTIVE',$3)`,
        [projectId,orgId,userId],
      );
      await admin.query(
        `INSERT INTO project_members(id,org_id,project_id,user_id,role,added_by)
         VALUES($1,$2,$3,$4,'R-PM',$4)`,
        [uuidv7(),orgId,projectId,userId],
      );
      await admin.query(
        `INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status)
         VALUES($1,'PH2_STORAGE_PLAN','Storage plan',$2::jsonb,0,'MONTH','ACTIVE')`,
        [planId,JSON.stringify({maxActiveProjects:1,maxSeats:1,maxStorageBytes:0,maxPackageGenerationsPerMonth:1})],
      );
      await admin.query(
        `INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end)
         VALUES($1,$2,$3,'TRIAL',now()-interval '1 day',now()+interval '30 days')`,
        [uuidv7(),orgId,planId],
      );
      const storage = {
        createUploadUrls: async () => ({
          uploadId: null, partSizeBytes: 4096,
          parts: [{partNumber:1,uploadUrl:'https://storage.example.test/object',requiredHeaders:{}}],
        }),
      };
      const service = new DocumentsService(new TenantDbService(app), storage as any);
      const ctx = { orgId,userId,actorType:'USER' as const,orgRole:'R-OWNER',requestId:uuidv7() };
      const upload = (sizeBytes:number) => service.createUploadIntent(ctx,projectId,{
        filename:'fixture.pdf',mimeType:'application/pdf',sizeBytes,
      });

      await expect(upload(1)).rejects.toMatchObject({
        response:expect.objectContaining({code:'STORAGE_QUOTA_EXCEEDED'}),
      });
      expect((await admin.query(`SELECT count(*)::int AS count FROM storage_objects WHERE org_id=$1`,[orgId]))
        .rows[0].count).toBe(0);

      await admin.query(
        `UPDATE plans SET limits_json=jsonb_set(limits_json,'{maxStorageBytes}','1000'::jsonb)
          WHERE id=$1`,[planId],
      );
      const first=await upload(100);
      expect(first.versionId).toBeDefined();

      const outcomes=await Promise.allSettled([upload(600),upload(600)]);
      const fulfilled=outcomes.filter(x=>x.status==='fulfilled');
      const rejected=outcomes.filter(x=>x.status==='rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const { rows: reserved }=await admin.query(
        `SELECT COALESCE(SUM(size_bytes),0)::text AS sum
         FROM storage_objects WHERE org_id=$1 AND status='PENDING'`,[orgId],
      );
      expect(reserved[0].sum).toBe('700');
    });
  });
});
