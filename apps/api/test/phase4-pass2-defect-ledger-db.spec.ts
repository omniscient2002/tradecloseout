import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

jest.setTimeout(180_000);

describe('PH4-G17-005/006: actual PostgreSQL immutable defect transition ledger', () => {
  it('enforces versioned assignment and severity history, append-only grants and tenant RLS', async () => {
    await withDisposableDatabase(async ({admin, app}) => {
      const userId = uuidv7(), assigneeId = uuidv7(), orgId = uuidv7();
      const projectId = uuidv7(), defectId = uuidv7();
      for (const [id, name] of [[userId, 'Defect Supervisor'], [assigneeId, 'Field Inspector']]) {
        await admin.query(
          `INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE')`,
          [id, name],
        );
      }
      await admin.query(
        `INSERT INTO organisations (id, legal_name, display_name, state)
          VALUES ($1, 'Pass Two Field Services Private Limited', 'Pass Two Field', 'AP')`,
        [orgId],
      );
      await admin.query(
        `INSERT INTO projects (id, org_id, code, name, status, created_by)
          VALUES ($1, $2, 'P2LEDGER-01', 'Defect decision ledger', 'ACTIVE', $3)`,
        [projectId, orgId, userId],
      );
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES ($1, $2, $3, 'R-SITE', 'ACTIVE')`,
        [uuidv7(), orgId, assigneeId],
      );
      await admin.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, status, added_by)
          VALUES ($1, $2, $3, $4, 'R-SITE', 'ACTIVE', $5)`,
        [uuidv7(), orgId, projectId, assigneeId, userId],
      );
      await admin.query(
        `INSERT INTO defects
          (id, org_id, project_id, title, description, severity, mandatory,
           raised_by, status, row_version)
          VALUES ($1, $2, $3, 'Airflow balancing snag',
                  'Required TAB remedial action', 'MEDIUM', true,
                  $4, 'OPEN', 1)`,
        [defectId, orgId, projectId, userId],
      );
      const ctx: any = {
        orgId, userId, actorType: 'SYSTEM', requestId: uuidv7(),
        ip: '127.0.0.1', userAgent: 'phase4-pass2-realdb',
      };
      const service = new WarrantyAndBillingService(app);
      const assign = await service.assignDefect(ctx, projectId, defectId, {
        expectedRowVersion: 1, assignedUserId: assigneeId,
        reason: 'Assign field inspector who owns the commissioned AHU.',
      });
      expect(assign.rowVersion).toBe(2);
      expect(assign.status).toBe('IN_PROGRESS');
      const severity = await service.updateDefectSeverity(ctx, projectId, defectId, {
        expectedRowVersion: 2, severity: 'MAJOR',
        reason: 'Engineering review confirms an important balancing deviation.',
      });
      expect(severity.rowVersion).toBe(3);
      expect(severity.severity).toBe('HIGH');

      const {rows: events} = await admin.query(
        `SELECT action, previous_row_version, next_row_version,
                from_severity, to_severity, actor_user_id
           FROM defect_transition_events
          WHERE org_id = $1 AND project_id = $2 AND defect_id = $3
          ORDER BY next_row_version`,
        [orgId, projectId, defectId],
      );
      expect(events.map(e => e.action)).toEqual(['ASSIGNED', 'SEVERITY_UPDATED']);
      expect(events.map(e => [e.previous_row_version, e.next_row_version]))
        .toEqual([[1, 2], [2, 3]]);
      expect(events[1].from_severity).toBe('MEDIUM');
      expect(events[1].to_severity).toBe('HIGH');
      expect(events[1].actor_user_id).toBe(userId);

      const {rows: [dbDefect]} = await admin.query(
        `SELECT status, severity, assigned_user_id, row_version
           FROM defects WHERE id = $1`,
        [defectId],
      );
      expect(dbDefect.status).toBe('IN_PROGRESS');
      expect(dbDefect.severity).toBe('HIGH');
      expect(dbDefect.assigned_user_id).toBe(assigneeId);
      expect(dbDefect.row_version).toBe(3);

      // A second action against stale version must not commit or append.
      await expect(service.waiveDefect(ctx, projectId, defectId, {
        expectedRowVersion: 2,
        reason: 'Supervisor cannot waive a mandatory closeout requirement.',
      })).rejects.toMatchObject({response: {code: 'DEFECT_CONCURRENCY_CONFLICT'}});

      // Runtime role can read this tenant, but cannot rewrite or delete
      // append-only audit evidence even if it knows the transition ID.
      await expect(app.query(
        `DELETE FROM defect_transition_events WHERE id = $1`,
        [assign.transitionId],
      )).rejects.toMatchObject({code: '42501'});
      await expect(app.query(
        `UPDATE defect_transition_events SET action = 'REOPENED' WHERE id = $1`,
        [assign.transitionId],
      )).rejects.toMatchObject({code: '42501'});

      const limited = await app.connect();
      try {
        await limited.query('BEGIN');
        await limited.query(
          `SELECT set_config('app.current_org',$1,true)`,
          [uuidv7()],
        );
        const {rows: isolated} = await limited.query(
          `SELECT id FROM defect_transition_events WHERE defect_id = $1`, [defectId],
        );
        expect(isolated).toHaveLength(0);
        await limited.query('ROLLBACK');
      } finally {
        limited.release();
      }
      const {rows: preserved} = await admin.query(
        `SELECT id FROM defect_transition_events WHERE defect_id = $1`, [defectId],
      );
      expect(preserved).toHaveLength(2);
    });
  });
});
