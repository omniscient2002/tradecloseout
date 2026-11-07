import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { ProjectsService } from '../src/modules/projects/projects.service';

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
       ($4, $2, $5, 'R-QC', 'ACTIVE')`,
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

describe('PR1 independent review — PostgreSQL acceptance', () => {
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
      await admin.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason,
           requested_by, approved_by, second_approved_by, status)
         VALUES($1, $2, $3, $4, 'WAIVE', 'Accepted for prior contract requirement',
                $5, $5, $6, 'ACTIVE')`,
        [uuidv7(), orgId, projectId, reqId, userId, approverId],
      );
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
      await admin.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason,
           requested_by, approved_by, second_approved_by, status)
         VALUES($1, $2, $3, $4, 'WAIVE', 'Reviewed baseline exception approved',
                $5, $5, $6, 'ACTIVE')`,
        [uuidv7(), orgId, projectId, initialReqs[0].id, userId, approverId],
      );
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
