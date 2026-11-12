import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { Test } from '@nestjs/testing';
import { ChecklistsController } from '../src/modules/checklists/checklists.controller';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../src/common/guards/permission.guard';

jest.setTimeout(180_000);

async function setup(admin: Pool, status = 'ACTIVE') {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const userId = uuidv7();
  const approverId = uuidv7();
  await admin.query(
    `INSERT INTO users(id, name, status) VALUES
       ($1, 'Closeout project manager', 'ACTIVE'),
       ($2, 'Independent reviewer', 'ACTIVE')`,
    [userId, approverId],
  );
  await admin.query(
    `INSERT INTO organisations(id, legal_name, display_name, state)
       VALUES ($1, 'Independent Review HVAC Private Limited', 'Independent Review HVAC', 'KA')`,
    [orgId],
  );
  await admin.query(
    `INSERT INTO projects(id, org_id, code, name, status, created_by)
       VALUES($1, $2, 'REVIEW-001', 'Commissioning Closeout', $3, $4)`,
    [projectId, orgId, status, userId],
  );
  await admin.query(
    `INSERT INTO memberships(id, org_id, user_id, role, status) VALUES
       ($1, $2, $3, 'R-OWNER', 'ACTIVE'),
       ($4, $2, $5, 'R-ADMIN', 'ACTIVE')`,
    [uuidv7(), orgId, userId, uuidv7(), approverId],
  );
  const ctx: any = {
    orgId, userId, actorType: 'MEMBER',
    ip: '127.0.0.1', userAgent: 'pr1-db-review', requestId: uuidv7(),
  };
  return { orgId, projectId, userId, approverId, ctx };
}

const requirement = (key: string, docTypeKey = 'DT-001') => ({
  key, title: `Required ${key} technical record`, docTypeKey,
  groupKey: 'COMMISSIONING', mandatory: true,
  scopeType: 'PROJECT' as const,
});

/**
 * Tests must obtain a qualified exception through the same state machine as
 * production. A legacy hand-inserted ACTIVE row has no obligation revision and
 * may no longer satisfy readiness or the package receipt.
 */
async function recordQualifiedWaiver(
  app: Pool, ctx: any, approverId: string, requirementId: string,
) {
  const service = new ChecklistsService(app);
  const requested = await service.requestWaiver(
    ctx, requirementId, 'Reviewed baseline exception approved', 'WAIVE',
  );
  const approved = await service.countersignWaiver(
    { ...ctx, userId: approverId, requestId: uuidv7() },
    requested.waiverId,
  );
  if (approved.requirementStatus !== 'WAIVED') throw new Error('qualified waiver missing');
  return requested.waiverId;
}

async function acceptedProject(admin: Pool, app: Pool) {
  const seeded = await setup(admin, 'HANDOVER');
  const { orgId, projectId, userId, approverId, ctx } = seeded;
  const first = await new ChecklistsService(app).importL3Checklist(ctx, projectId, {
    requirements: [requirement('ACCEPTED-BASELINE')],
  });
  const { rows: reqs } = await admin.query('SELECT id FROM requirements WHERE project_id = $1', [projectId]);
  await recordQualifiedWaiver(app, ctx, approverId, reqs[0].id);
  const packageId = uuidv7(), submissionId = uuidv7();
  await admin.query(`INSERT INTO handover_packages
    (id,org_id,project_id,version_no,status,snapshot_id,snapshot_checksum,requested_by)
    VALUES($1,$2,$3,1,'ACCEPTED',$4,$5,$6)`,
  [packageId, orgId, projectId, first.snapshotId, first.checksum, userId]);
  await admin.query(`INSERT INTO submissions
    (id,org_id,project_id,package_id,status,submitted_at,submitted_by)
    VALUES($1,$2,$3,$4,'ACCEPTED',now(),$5)`, [submissionId, orgId, projectId, packageId, userId]);
  await admin.query(`INSERT INTO submission_recipients
    (id,org_id,project_id,submission_id,name,email,status,is_required_approver,decided_at)
    VALUES($1,$2,$3,$4,'Client','client@example.com','ACCEPTED',true,now())`,
  [uuidv7(), orgId, projectId, submissionId]);
  return { ...seeded, first };
}

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function observeProjectLock(pool: Pool, before: () => void, after: () => Promise<void>): Pool {
  return { connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, params?: any[]) => {
        const projectLock = sql.includes('FROM projects') && sql.includes('FOR UPDATE');
        if (projectLock) before();
        const result = await client.query(sql, params);
        if (projectLock) await after();
        return result;
      },
      release: () => client.release(),
    };
  } } as Pool;
}

describe('PR1 independent review — PostgreSQL acceptance', () => {
  it('rejects contractual baseline writes in archived, cancelled, suspended and purged states', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { ctx, projectId } = await setup(admin);
      const checklists = new ChecklistsService(app);
      const baseline = await checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('BASELINE')] });
      for (const status of ['ARCHIVED', 'CANCELLED', 'SUSPENDED', 'PURGED']) {
        await admin.query('UPDATE projects SET status=$2, purged_at=$3 WHERE id=$1',
          [projectId, status === 'PURGED' ? 'ARCHIVED' : status, status === 'PURGED' ? new Date() : null]);
        await expect(checklists.createAndApplySnapshot(ctx, projectId, [{
          level: 'PROJECT', versionId: uuidv7(), payload: { requirements: [requirement('REPLACEMENT')] },
        }])).rejects.toMatchObject({ response: expect.objectContaining({
          code: status === 'PURGED' ? 'PROJECT_PURGED' : 'PROJECT_CHECKLIST_NOT_EDITABLE',
        }) });
      }
      const snapshots = (await admin.query('SELECT id,status FROM checklist_snapshots WHERE project_id=$1', [projectId])).rows;
      expect(snapshots).toEqual([{ id: baseline.snapshotId, status: 'ACTIVE' }]);
    });
  });

  it('blocks every baseline writer after actual closure, including HTTP import/reapply; permits formal reopen', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { ctx, orgId, projectId, first } = await acceptedProject(admin, app);
      const checklists = new ChecklistsService(app), projects = new ProjectsService(app);
      const closed = await projects.closeProject(ctx, projectId);
      expect(closed.status).toBe('CLOSED');
      const state = async () => (await admin.query(`SELECT
        (SELECT count(*) FROM checklist_snapshots WHERE project_id=$1)::int AS snapshots,
        (SELECT count(*) FROM requirements WHERE project_id=$1)::int AS requirements,
        (SELECT count(*) FROM audit_events WHERE project_id=$1)::int AS audit,
        (SELECT count(*) FROM outbox_events WHERE project_id=$1)::int AS outbox`, [projectId])).rows[0];
      const before = await state();
      const writes = [
        () => checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('AFTER-CLOSE')] }),
        () => checklists.createSnapshot(ctx, projectId),
        () => checklists.createAndApplySnapshot(ctx, projectId, [{ level: 'PROJECT', versionId: uuidv7(),
          payload: { requirements: [requirement('REPLACEMENT')] } }]),
        () => checklists.createRequirement(ctx, projectId, { key: 'MANUAL', title: 'Late work', docTypeCode: 'DT-042' }),
      ];
      for (const write of writes) await expect(write()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN' }),
      });

      // Auth is a fixture; HTTP routing and the real permission/domain/DB guards are exercised.
      const module = await Test.createTestingModule({
        controllers: [ChecklistsController],
        providers: [ChecklistsService, PermissionGuard, { provide: Pool, useValue: app }],
      }).overrideGuard(SessionCsrfGuard).useValue({ canActivate(context: any) {
        const request = context.switchToHttp().getRequest();
        const actor = { ...ctx, orgRole: request.headers['x-test-role'] || 'R-OWNER' };
        request.user = actor; request.userContext = actor; return true;
      } }).compile();
      const http = module.createNestApplication({ logger: false });
      try {
        await http.listen(0, '127.0.0.1');
        const origin = await http.getUrl();
        for (const path of ['checklists/import-l3', 'snapshots']) {
          const url = `${origin}/api/v1/projects/${projectId}/${path}`;
          const body = JSON.stringify({ requirements: [requirement('HTTP-LATE')] });
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
          expect(response.status).toBe(409);
          const problem = await response.json() as { code: string };
          expect(problem.code).toBe('CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN');
          const denied = await fetch(url, { method: 'POST', headers: {
            'Content-Type': 'application/json', 'x-test-role': 'R-SITE',
          }, body });
          expect(denied.status).toBe(403);
        }
      } finally { await http.close(); }
      expect(await state()).toEqual(before);
      expect((await admin.query('SELECT status FROM checklist_snapshots WHERE id=$1', [first.snapshotId])).rows[0].status).toBe('ACTIVE');
      await projects.reopenProject(ctx, projectId, closed.row_version, 'Authorized additional closeout scope');
      const imported = await checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('REOPENED-WORK')] });
      expect(imported.snapshotId).not.toBe(first.snapshotId);
      expect((await admin.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0].status).toBe('ACTIVE');
      expect((await admin.query("SELECT count(*)::int AS count FROM audit_events WHERE org_id=$1 AND project_id=$2 AND action='PROJECT_REOPENED'", [orgId, projectId])).rows[0].count).toBe(1);
    });
  });

  it.each(['close', 'import'])('serializes %s winning a close/import race without an unaccepted closed baseline', async winner => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { ctx, projectId, first } = await acceptedProject(admin, app);
      const held = latch(), attempted = latch();
      const firstPool = observeProjectLock(app, () => {}, async () => { held.resolve(); await attempted.promise; });
      const secondPool = observeProjectLock(app, attempted.resolve, async () => {});
      const importUsing = (pool: Pool) => new ChecklistsService(pool).importL3Checklist(ctx, projectId, {
        requirements: [requirement('CONCURRENT-WORK')],
      });
      const closeUsing = (pool: Pool) => new ProjectsService(pool).closeProject(ctx, projectId);
      const firstResult = (winner === 'close' ? closeUsing(firstPool) : importUsing(firstPool))
        .then(value => ({ value, error: null }), error => ({ value: null, error }));
      await held.promise;
      const secondResult = (winner === 'close' ? importUsing(secondPool) : closeUsing(secondPool))
        .then(value => ({ value, error: null }), error => ({ value: null, error }));
      const [successful, rejected] = await Promise.all([firstResult, secondResult]);
      expect(successful.error).toBeNull();
      expect(rejected.error).toBeInstanceOf(ConflictException);
      expect(rejected.error.getResponse().code).toBe(winner === 'close'
        ? 'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN' : 'PROJECT_CLOSEOUT_NOT_READY');
      const project = (await admin.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0];
      expect(project.status).toBe(winner === 'close' ? 'CLOSED' : 'HANDOVER');
      const snapshots = (await admin.query("SELECT id FROM checklist_snapshots WHERE project_id=$1 AND status='ACTIVE'", [projectId])).rows;
      expect(snapshots).toHaveLength(1);
      if (winner === 'close') expect(snapshots[0].id).toBe(first.snapshotId);
    });
  });

  it('imports through the real writer; protects previous waivers; serializes competing imports', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { orgId, projectId, userId, approverId, ctx } = await setup(admin);
      const checklists = new ChecklistsService(app);
      const readiness = new HandoverService(app, {} as any);

      // R1: Do not spy on createAndApplySnapshot: execute real inserts via tc_app.
      await checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('CHILLER-OM')] });
      let { rows: requirements } = await admin.query(
        `SELECT id, doc_type_key, reviewer_role FROM requirements
           WHERE org_id = $1 AND project_id = $2 AND requirement_key = 'CHILLER-OM'
             AND superseded_at IS NULL`,
        [orgId, projectId],
      );
      expect(requirements).toHaveLength(1);
      expect(requirements[0].reviewer_role).toBe('R-QC');

      // A reimport preserves the same legitimate server-assigned reviewer.
      await checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('CHILLER-OM')] });
      const reqId = requirements[0].id;
      await recordQualifiedWaiver(app, ctx, approverId, reqId);
      expect((await readiness.evaluateProjectReadiness(ctx, projectId)).readyWithoutOverride).toBe(true);

      // R3: Switching a document obligation must not inherit the earlier waiver.
      await checklists.importL3Checklist(ctx, projectId, {
        requirements: [requirement('CHILLER-OM', 'DT-099')],
      });
      const { rows: oldWaivers } = await admin.query(
        `SELECT status FROM waivers WHERE org_id = $1 AND requirement_id = $2`,
        [orgId, reqId],
      );
      expect(oldWaivers).toHaveLength(1);
      expect(oldWaivers[0].status).toBe('SUPERSEDED');
      expect((await readiness.evaluateProjectReadiness(ctx, projectId)).readyWithoutOverride).toBe(false);

      // R4: Both successful parallel imports preserve the other's additions.
      await Promise.all([
        checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('AHU-TAB', 'DT-041')] }),
        checklists.importL3Checklist(ctx, projectId, { requirements: [requirement('PUMP-TAB', 'DT-042')] }),
      ]);
      const { rows: active } = await admin.query(
        `SELECT requirement_key FROM requirements
           WHERE org_id = $1 AND project_id = $2 AND superseded_at IS NULL`,
        [orgId, projectId],
      );
      expect(active.map((r: any) => r.requirement_key).sort()).toEqual([
        'AHU-TAB', 'CHILLER-OM', 'PUMP-TAB',
      ]);

      // Invalid trusted policy must not change the snapshot/requirement rows.
      const prior = await admin.query(
        `SELECT COUNT(*)::int AS count FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2`,
        [orgId, projectId],
      );
      await expect(checklists.createAndApplySnapshot(ctx, projectId, [{
        level: 'PROJECT', versionId: uuidv7(),
        payload: { requirements: [{ ...requirement('BAD-REVIEW'), reviewerRole: 'R-UNKNOWN' }] },
      }])).rejects.toThrow(UnprocessableEntityException);
      const after = await admin.query(
        `SELECT COUNT(*)::int AS count FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2`,
        [orgId, projectId],
      );
      expect(after.rows[0].count).toBe(prior.rows[0].count);
    });
  });

  it('never closes an accepted project after a new mandatory requirement becomes missing', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { orgId, projectId, userId, approverId, ctx } = await setup(admin, 'HANDOVER');
      const checklists = new ChecklistsService(app);
      const readiness = new HandoverService(app, {} as any);
      const projects = new ProjectsService(app);
      const first = await checklists.importL3Checklist(ctx, projectId, {
        requirements: [requirement('BASELINE')],
      });
      const { rows: initialReqs } = await admin.query(
        `SELECT id FROM requirements WHERE org_id = $1 AND project_id = $2
           AND superseded_at IS NULL`,
        [orgId, projectId],
      );
      await recordQualifiedWaiver(app, ctx, approverId, initialReqs[0].id);
      expect((await readiness.evaluateProjectReadiness(ctx, projectId)).readyWithoutOverride).toBe(true);

      // Seed an already accepted historic handover to isolate the closure rule.
      const packageId = uuidv7(), submissionId = uuidv7();
      await admin.query(
        `INSERT INTO handover_packages
          (id, org_id, project_id, version_no, status, snapshot_id,
           snapshot_checksum, requested_by)
         VALUES ($1, $2, $3, 1, 'ACCEPTED', $4, $5, $6)`,
        [packageId, orgId, projectId, first.snapshotId, first.checksum, userId],
      );
      await admin.query(
        `INSERT INTO submissions
          (id, org_id, project_id, package_id, status, submitted_at, submitted_by)
         VALUES ($1, $2, $3, $4, 'ACCEPTED', now(), $5)`,
        [submissionId, orgId, projectId, packageId, userId],
      );
      await admin.query(
        `INSERT INTO submission_recipients
          (id, org_id, project_id, submission_id, name, email,
           status, is_required_approver, decided_at)
         VALUES ($1, $2, $3, $4, 'Client approver', 'client@example.com',
                 'ACCEPTED', true, now())`,
        [uuidv7(), orgId, projectId, submissionId],
      );

      // R2: The normal createRequirement command must make a new versioned
      // baseline and the live readiness gate must reject closure.
      await checklists.createRequirement(ctx, projectId, {
        key: 'LATE-COMMISSIONING', title: 'Missing final TAB',
        groupKey: 'COMMISSIONING', docTypeCode: 'DT-042', mandatory: true,
      });
      const result = await readiness.evaluateProjectReadiness(ctx, projectId);
      expect(result.readyWithoutOverride).toBe(false);
      expect(result.blockers.missingMandatoryCount).toBeGreaterThan(0);
      let closureError: any;
      try { await projects.closeProject(ctx, projectId); } catch (error) { closureError = error; }
      expect(closureError).toBeInstanceOf(ConflictException);
      expect(closureError.getResponse().code).toBe('PROJECT_CLOSEOUT_NOT_READY');
      const { rows: projRows } = await admin.query(
        `SELECT status FROM projects WHERE id = $1`, [projectId],
      );
      expect(projRows[0].status).toBe('HANDOVER');
    });
  });
});
