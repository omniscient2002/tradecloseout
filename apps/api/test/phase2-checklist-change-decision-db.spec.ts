import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';

jest.setTimeout(180_000);

describe('PH2-G06-006: reviewed checklist change decisions do not mutate active obligations', () => {
  it('requires a distinct live owner/admin and keeps removal pending snapshot application', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId=uuidv7(), projectId=uuidv7(), owner=uuidv7(), approver=uuidv7();
      const site=uuidv7(), snapshotId=uuidv7(), requirementId=uuidv7(), changeId=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status) VALUES
         ($1,'Originating owner','ACTIVE'),
         ($2,'Independent administrator','ACTIVE'),
         ($3,'Restricted site member','ACTIVE')`,[owner,approver,site]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
        VALUES($1,'Phase 2 Approval Tenant','Phase 2 Approval Tenant','AP','ACTIVE')`,[orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES
        ($1,$2,$3,'R-OWNER','ACTIVE'),
        ($4,$2,$5,'R-ADMIN','ACTIVE'),
        ($6,$2,$7,'R-SITE','ACTIVE')`,
        [uuidv7(),orgId,owner,uuidv7(),approver,uuidv7(),site]);
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,'PH2-CHANGE','Reviewed change control','ACTIVE',$3)`,
        [projectId,orgId,owner]);
      await admin.query(`INSERT INTO checklist_snapshots(
          id,org_id,project_id,version_no,status,resolved_payload_json,
          provenance_json,source_json,checksum,created_by)
        VALUES($1,$2,$3,1,'ACTIVE',$4::jsonb,'{}'::jsonb,'[]'::jsonb,$5,$6)`,
        [snapshotId,orgId,projectId,JSON.stringify({requirements:[{
          key:'LOCKED-001',title:'Safety evidence',locked:true,mandatory:true,
          scopeType:'PROJECT',docTypeKey:'DT-001',
        }]}),'a'.repeat(64),owner]);
      await admin.query(`INSERT INTO requirements(
        id,org_id,project_id,current_snapshot_id,requirement_key,group_key,
        title,doc_type_key,mandatory,reviewer_role)
        VALUES($1,$2,$3,$4,'LOCKED-001','SAFETY','Safety evidence','DT-001',true,'R-QC')`,
        [requirementId,orgId,projectId,snapshotId]);
      await admin.query(`INSERT INTO requirement_change_requests(
        id,org_id,project_id,requirement_id,change_type,reason,requested_by,status)
        VALUES($1,$2,$3,$4,'REMOVE','Request removal of current safety obligation',$5,'PENDING')`,
        [changeId,orgId,projectId,requirementId,owner]);

      const svc=new ChecklistsService(app);
      const ctx=(userId:string,orgRole:string):TenantActorContext=>({
        orgId,userId,orgRole,actorType:'MEMBER',
        requestId:uuidv7(),ip:'127.0.0.1',userAgent:'phase2-review-db',
      });

      await expect(svc.decideChangeRequest(ctx(site,'R-SITE'),changeId,{
        decision:'APPROVED',
      })).rejects.toMatchObject({response:expect.objectContaining({
        code:'CHANGE_REVIEW_AUTHORITY_REQUIRED',
      })});
      await expect(svc.decideChangeRequest(ctx(owner,'R-OWNER'),changeId,{
        decision:'APPROVED',
      })).rejects.toMatchObject({response:expect.objectContaining({
        code:'CHANGE_REQUEST_SELF_APPROVAL_FORBIDDEN',
      })});
      const accepted=await svc.decideChangeRequest(ctx(approver,'R-ADMIN'),changeId,{
        decision:'APPROVED',comment:'Reviewed; still requires baseline impact and application',
      });
      expect(accepted.status).toBe('APPROVED');
      expect(accepted.applied_snapshot_id).toBeNull();
      const {rows:[stillCurrent]}=await admin.query(
        `SELECT superseded_at,current_snapshot_id FROM requirements
          WHERE org_id=$1 AND id=$2`,[orgId,requirementId],
      );
      expect(stillCurrent.superseded_at).toBeNull();
      expect(stillCurrent.current_snapshot_id).toBe(snapshotId);
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM audit_events
          WHERE org_id=$1 AND project_id=$2
            AND action='REQUIREMENT_CHANGE_DECIDED'`,
        [orgId,projectId],
      )).rows[0].n).toBe(1);

      await expect(svc.decideChangeRequest(ctx(approver,'R-ADMIN'),changeId,{
        decision:'APPROVED',
      })).rejects.toThrow();
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM audit_events
          WHERE org_id=$1 AND project_id=$2
            AND action='REQUIREMENT_CHANGE_DECIDED'`,
        [orgId,projectId],
      )).rows[0].n).toBe(1);
    });
  });
});
