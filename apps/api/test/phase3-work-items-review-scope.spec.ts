import { uuidv7 } from 'uuidv7';
import { WorkItemsService } from '../src/modules/work-items/work-items.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

describe('PH3-G21-001: reviewer inbox must not disclose other document stages or scopes', () => {
  it('filters document IDs, actor assignment, role downgrades and duplicate review stages', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const userId = fixture.userId;
      const docA = uuidv7(), docB = uuidv7();
      const versionA = uuidv7(), versionB = uuidv7();
      const storageA = uuidv7(), storageB = uuidv7();
      const ctx: any = { orgId, userId, actorType:'MEMBER', orgRole:'R-OWNER',
        projectRole:'R-PM', requestId: 'phase3-review-inbox' };
      await admin.query(
        `INSERT INTO memberships (id,org_id,user_id,role,status)
          VALUES ($1,$2,$3,'R-REVIEWER','ACTIVE')`,
        [uuidv7(),orgId,userId],
      );
      await admin.query(
        `INSERT INTO project_members
          (id,org_id,project_id,user_id,role,scope_json,status,added_by)
          VALUES ($1,$2,$3,$4,'R-REVIEWER',$5::jsonb,'ACTIVE',$4)`,
        [uuidv7(),orgId,projectId,userId,JSON.stringify({ documentIds:[docA] })],
      );
      for (const [doc,version,storage,tag] of [
        [docA,versionA,storageA,'CHILLER'],[docB,versionB,storageB,'AHU'],
      ]) {
        await admin.query(
          `INSERT INTO storage_objects
            (id,org_id,bucket,object_key,size_bytes,observed_size_bytes,
             mime,sha256,status,provider_version_id)
           VALUES ($1,$2,'test','queue/' || $3,100,100,
             'application/pdf',$4,'READY','fixed-v1')`,
          [storage,orgId,tag,'a'.repeat(64)],
        );
        await admin.query(
          `INSERT INTO documents
            (id,org_id,project_id,title,doc_type_key,category_key,status,created_by)
           VALUES ($1,$2,$3,$4,'DT-001','HVAC','ACTIVE',$5)`,
          [doc,orgId,projectId,tag+' Test Certificate',userId],
        );
        await admin.query(
          `INSERT INTO document_versions
            (id,org_id,project_id,document_id,version_no,revision_code,
             object_id,issue_date,file_status,review_status)
           VALUES ($1,$2,$3,$4,1,'R0',$5,CURRENT_DATE,'READY','IN_REVIEW')`,
          [version,orgId,projectId,doc,storage],
        );
        await admin.query(
          `INSERT INTO reviews
            (id,org_id,project_id,document_version_id,stage_key,
             reviewer_subject_type,reviewer_subject_id,reviewer_user_id,status)
           VALUES ($1,$2,$3,$4,'TECHNICAL','USER',$5,$5,'IN_REVIEW')`,
          [uuidv7(),orgId,projectId,version,userId],
        );
      }
      // A second active stage must not duplicate the version or counts.
      await admin.query(
        `INSERT INTO reviews
          (id,org_id,project_id,document_version_id,stage_key,
           reviewer_subject_type,reviewer_subject_id,reviewer_user_id,status)
         VALUES ($1,$2,$3,$4,'FINAL','USER',$5,$5,'IN_REVIEW')`,
        [uuidv7(),orgId,projectId,versionB,userId],
      );
      const service = new WorkItemsService(app);
      const a = await service.listWorkItems(ctx, { type:'REVIEW_PENDING' });
      expect(a.counts).toMatchObject({ total:1, reviews:1 });
      expect(a.items.map((item) => item.entityId)).toEqual([versionA]);
      expect(JSON.stringify(a)).not.toContain(versionB);
      expect(a.items[0].nextCommand).toMatchObject({
        actionName:'DECIDE_REVIEW',
        precondition:{ field:'expectedRowVersion', value:1 },
        idempotency:'HEADER_KEY',
      });

      await admin.query(
        `UPDATE project_members SET scope_json=$4::jsonb
          WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
        [orgId,projectId,userId,JSON.stringify({documentIds:[docB]})],
      );
      const b = await service.listWorkItems(ctx,{ type:'REVIEW_PENDING' });
      expect(b.items.map((item) => item.entityId)).toEqual([versionB]);
      expect(b.counts.total).toBe(1);

      // Revoking current review permission must override an old OWNER JWT.
      await admin.query(
        `UPDATE memberships SET role='R-AUDITOR' WHERE org_id=$1 AND user_id=$2`,
        [orgId,userId],
      );
      const revoked = await service.listWorkItems(ctx,{});
      expect(revoked).toMatchObject({items:[],counts:{total:0,reviews:0}});
    });
  });
});
