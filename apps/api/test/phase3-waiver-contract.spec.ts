import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { HandoverService } from '../src/modules/handover/handover.service';

jest.setTimeout(180_000);

const spec = (key: string, mandatory: boolean) => ({
  key, title: 'HVAC evidence ' + key, docTypeKey: 'DT-001',
  groupKey: 'COMMISSIONING', mandatory,
  scopeType: 'PROJECT' as const,
});

async function setup(admin: any, app: any) {
  const seeded = await seedTenants(admin);
  const { orgId, projectIds } = seeded.tenants[0];
  const projectId = projectIds[0], userId = seeded.userId;
  const secondUserId = uuidv7();
  await admin.query(
    `INSERT INTO users (id,name,status) VALUES ($1,'Independent waiver reviewer','ACTIVE')`,
    [secondUserId],
  );
  await admin.query(
    `INSERT INTO memberships (id,org_id,user_id,role,status) VALUES
       ($1,$2,$3,'R-OWNER','ACTIVE'), ($4,$2,$5,'R-ADMIN','ACTIVE')`,
    [uuidv7(),orgId,userId,uuidv7(),secondUserId],
  );
  const primary: any = {
    orgId, userId, actorType:'MEMBER', orgRole:'R-OWNER',
    requestId:'phase3-waiver-requester',
  };
  const second: any = {
    ...primary, userId: secondUserId, orgRole:'R-ADMIN', requestId:'phase3-waiver-reviewer',
  };
  const service = new ChecklistsService(app);
  await service.importL3Checklist(primary,projectId,{
    requirements:[
      spec('OPTIONAL-WAIVE',false),spec('OPTIONAL-NA',false),
      spec('MANDATORY-NA',true),spec('MANDATORY-WAIVE',true),
    ],
  });
  const { rows } = await admin.query(
    `SELECT id, requirement_key, row_version FROM requirements
      WHERE org_id=$1 AND project_id=$2 AND superseded_at IS NULL`,
    [orgId, projectId],
  );
  const byKey = Object.fromEntries(rows.map((row: any)=>[row.requirement_key,row])) as Record<
    string,{id:string;row_version:number}
  >;
  return { service, admin, orgId, projectId, primary, second, byKey };
}

describe('PH3-G07-001/002/003 — canonical waiver lifecycle and retries', () => {
  it('preserves optional WAIVE/NA outcomes, mandatory NA countersign and append-only business events', async () => {
    await withDisposableDatabase(async ({admin,app})=>{
      const f=await setup(admin,app);
      const optional=f.byKey['OPTIONAL-WAIVE'];
      const optionalNa=f.byKey['OPTIONAL-NA'];
      const mandatory=f.byKey['MANDATORY-NA'];
      const commandId=uuidv7();
      const one=await f.service.requestWaiver(f.primary,optional.id,'Optional document is not required','WAIVE',{
        commandId,expectedRowVersion:optional.row_version,
      });
      expect(one).toMatchObject({status:'ACTIVE',requirementStatus:'WAIVED',idempotentReplay:false});
      const replay=await f.service.requestWaiver(f.primary,optional.id,'Optional document is not required','WAIVE',{
        commandId,expectedRowVersion:optional.row_version,
      });
      expect(replay).toMatchObject({waiverId:one.waiverId,idempotentReplay:true});
      const two=await f.service.requestWaiver(f.primary,optionalNa.id,'This optional record is not applicable','NOT_APPLICABLE');
      expect(two).toMatchObject({status:'ACTIVE',requirementStatus:'NOT_APPLICABLE'});
      const pending=await f.service.requestWaiver(f.primary,mandatory.id,
        'The required test is demonstrably not applicable','NOT_APPLICABLE');
      expect(pending).toMatchObject({status:'PENDING_SECOND_APPROVAL',requirementStatus:'PENDING_WAIVER'});
      await expect(f.service.countersignWaiver(f.primary,pending.waiverId))
        .rejects.toThrow(ForbiddenException);
      await expect(f.service.countersignWaiver(f.second,mandatory.id))
        .rejects.toThrow(NotFoundException);
      const accepted=await f.service.countersignWaiver(f.second,pending.waiverId);
      expect(accepted).toMatchObject({status:'ACTIVE',requirementStatus:'NOT_APPLICABLE'});
      const acceptedReplay=await f.service.countersignWaiver(f.second,pending.waiverId);
      expect(acceptedReplay).toMatchObject({idempotentReplay:true,requirementStatus:'NOT_APPLICABLE'});
      const readiness = new HandoverService(app, {} as any);
      const afterApproval = await readiness.evaluateProjectReadiness(f.primary, f.projectId);
      expect(afterApproval.blockers.missingMandatoryCount).toBe(1);
      // A material requirement revision must immediately invalidate an older
      // waiver for BOTH readiness and handover package qualification.
      await admin.query(
        'UPDATE requirements SET row_version=row_version+1 WHERE id=$1',
        [mandatory.id],
      );
      const afterRevision = await readiness.evaluateProjectReadiness(f.primary, f.projectId);
      expect(afterRevision.blockers.missingMandatoryCount).toBe(2);
      const rows=await admin.query(
        `SELECT w.type,w.status,w.is_mandatory_item,w.obligation_row_version,r.status AS requirement_status
          FROM waivers w JOIN requirements r ON r.id=w.requirement_id
         WHERE w.org_id=$1 AND w.id = ANY($2::uuid[])`,
        [f.orgId,[one.waiverId,two.waiverId,pending.waiverId]],
      );
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows.filter((r: any)=>r.is_mandatory_item)).toHaveLength(1);
      expect(rows.rows.filter((r: any)=>r.type==='NOT_APPLICABLE').every(
        (r: any)=>r.requirement_status==='NOT_APPLICABLE',
      )).toBe(true);
      const events=await admin.query(
        `SELECT event_type FROM outbox_events WHERE org_id=$1 AND project_id=$2
           AND event_type LIKE 'WAIVER_%' ORDER BY created_at`,
        [f.orgId,f.projectId],
      );
      expect(events.rows).toHaveLength(4); // optional WAIVE, optional NA, mandatory intent, second sign
      const waivers=await admin.query(
        'SELECT count(*)::int AS n FROM waivers WHERE org_id=$1 AND project_id=$2',
        [f.orgId,f.projectId],
      );
      expect(waivers.rows[0].n).toBe(3);
    });
  });

  it('serializes duplicate mandatory requests and rejects conflicting retries without another active waiver', async () => {
    await withDisposableDatabase(async ({admin,app})=>{
      const f=await setup(admin,app);
      const id=f.byKey['MANDATORY-WAIVE'].id;
      const input=()=>f.service.requestWaiver(f.primary,id,'A documented exception for factory tests','WAIVE');
      const [first,second]=await Promise.all([input(),input()]);
      expect(new Set([first.waiverId,second.waiverId]).size).toBe(1);
      expect([first.idempotentReplay,second.idempotentReplay].sort()).toEqual([false,true]);
      await expect(f.service.requestWaiver(f.primary,id,'Different waiver reason for same test','WAIVE'))
        .rejects.toThrow(ConflictException);
      await expect(f.service.requestWaiver(f.primary,id,'A documented exception for factory tests','NOT_APPLICABLE'))
        .rejects.toThrow(ConflictException);
      const result=await admin.query(
        'SELECT count(*)::int AS n FROM waivers WHERE org_id=$1 AND requirement_id=$2',
        [f.orgId,id],
      );
      expect(result.rows[0].n).toBe(1);
      expect((await f.service.countersignWaiver(f.second,first.waiverId)).requirementStatus).toBe('WAIVED');
    });
  });

  it('rejects closure, superseded baseline, mutation after approval and stale row versions', async () => {
    await withDisposableDatabase(async ({admin,app})=>{
      const f=await setup(admin,app);
      const id=f.byKey['MANDATORY-NA'].id;
      await expect(f.service.requestWaiver(f.primary,id,'Not applicable to this equipment','NOT_APPLICABLE',{
        expectedRowVersion:999,
      })).rejects.toThrow('WAIVER_ROW_VERSION_CONFLICT');
      await admin.query('UPDATE projects SET status=$2, closed_at=now() WHERE id=$1',[f.projectId,'CLOSED']);
      await expect(f.service.requestWaiver(f.primary,id,'Not applicable to this equipment','NOT_APPLICABLE'))
        .rejects.toThrow(ConflictException);
      await admin.query('UPDATE projects SET status=$2, closed_at=NULL WHERE id=$1',[f.projectId,'ACTIVE']);
      const pending=await f.service.requestWaiver(f.primary,id,'Not applicable to this equipment','NOT_APPLICABLE');
      await admin.query('UPDATE projects SET status=$2, closed_at=now() WHERE id=$1',[f.projectId,'CLOSED']);
      await expect(f.service.countersignWaiver(f.second,pending.waiverId)).rejects.toThrow(ConflictException);
      await admin.query('UPDATE projects SET status=$2, closed_at=NULL WHERE id=$1',[f.projectId,'ACTIVE']);
      await admin.query('UPDATE requirements SET row_version = row_version + 1 WHERE id=$1',[id]);
      await expect(f.service.countersignWaiver(f.second,pending.waiverId))
        .rejects.toThrow('WAIVER_OBLIGATION_REVISION_CONFLICT');
      const waiver=await admin.query('SELECT status FROM waivers WHERE id=$1',[pending.waiverId]);
      expect(waiver.rows[0].status).toBe('PENDING_SECOND_APPROVAL');
    });
  });

  it('denies stale HTTP ownership and suspended second approvers', async () => {
    await withDisposableDatabase(async ({admin,app})=>{
      const f=await setup(admin,app);
      const id=f.byKey['MANDATORY-WAIVE'].id;
      await admin.query('UPDATE memberships SET status=$3 WHERE org_id=$1 AND user_id=$2',
        [f.orgId,f.primary.userId,'REMOVED']);
      await expect(f.service.requestWaiver(f.primary,id,'Approval bypass is forbidden','WAIVE'))
        .rejects.toThrow(ForbiddenException);
      await admin.query('UPDATE memberships SET status=$3 WHERE org_id=$1 AND user_id=$2',
        [f.orgId,f.primary.userId,'ACTIVE']);
      const pending=await f.service.requestWaiver(f.primary,id,'Approval bypass is forbidden','WAIVE');
      await admin.query('UPDATE users SET status=$2 WHERE id=$1',[f.second.userId,'SUSPENDED']);
      await expect(f.service.countersignWaiver(f.second,pending.waiverId)).rejects.toThrow(ForbiddenException);
    });
  });
});
