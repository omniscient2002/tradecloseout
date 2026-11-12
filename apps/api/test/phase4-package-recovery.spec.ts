import { uuidv7 } from 'uuidv7';
import { HandoverService } from '../src/modules/handover/handover.service';

describe('PH4-G14-001/003: explicit package recovery commands', () => {
  const orgId = uuidv7(), projectId = uuidv7(), packageId = uuidv7(), snapshotId = uuidv7();
  const ctx: any = { orgId, userId: uuidv7(), actorType: 'SYSTEM',
    requestId: 'phase4-recovery', ip: '127.0.0.1', userAgent: 'jest' };
  const input = { expectedRowVersion: 4, reason: 'Authorized manual recovery after verified incident' };

  function setup(status: string, opts: { projectStatus?: string; snapshotActive?: boolean; submitted?: boolean; rowVersion?: number } = {}) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT id, status FROM projects')) return {
          rows: [{ id: projectId, status: opts.projectStatus ?? 'HANDOVER' }],
        };
        if (sql.includes('FROM handover_packages') && sql.includes('FOR UPDATE')) return {
          rows: [{ id: packageId, status, row_version: opts.rowVersion ?? 4,
            pdf_object_id: null, package_purpose: 'FULL_HANDOVER', manifest_format_version: 2,
            snapshot_id: snapshotId, snapshot_checksum: 'a'.repeat(64), version_no: 2 }],
        };
        if (sql.includes('SELECT id FROM submissions')) return { rows: opts.submitted ? [{ id: uuidv7() }] : [] };
        if (sql.includes('SELECT id FROM checklist_snapshots')) {
          return { rows: opts.snapshotActive === false ? [] : [{ id: snapshotId }] };
        }
        if (sql.includes('SELECT r.id, r.requirement_key, r.title, r.mandatory')) {
          return { rows: [{ id: uuidv7(), mandatory: true, status: 'APPROVED',
            has_approved_evidence: true, has_expired_approved_evidence: false,
            has_expiring_approved_evidence: false, has_valid_waiver: false }] };
        }
        if (sql.includes('SELECT id, resolved_payload_json FROM checklist_snapshots')) return {
          rows: [{ id: snapshotId, resolved_payload_json: { requirements: [{ key: 'AHU-ITR' }] } }],
        };
        if (sql.includes("SET status = 'CANCELLED'")) {
          return { rows: [{ id: packageId, status: 'CANCELLED', row_version: 5 }], rowCount: 1 };
        }
        if (sql.includes("SET status = 'QUEUED'")) {
          return { rows: [{ id: packageId, status: 'QUEUED', row_version: 5 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    return { pool: { connect: jest.fn(async () => client) } as any, queries };
  }

  it('cancels a GENERATING attempt and records an audit-only event, not a poison outbox event', async () => {
    const { pool, queries } = setup('GENERATING');
    const result = await new HandoverService(pool, {} as any)
      .cancelHandoverPackage(ctx, projectId, packageId, input);
    expect(result.status).toBe('CANCELLED');
    const sqls = queries.map(q => q.sql);
    expect(sqls.some(q => q.includes("SET status = 'CANCELLED'") &&
      q.includes("status IN ('QUEUED', 'GENERATING', 'FAILED')"))).toBe(true);
    expect(sqls.filter(q => q.includes('INSERT INTO audit_events'))).toHaveLength(1);
    expect(sqls.some(q => q.includes('INSERT INTO outbox_events'))).toBe(false);
    expect(sqls).toContain('COMMIT');
  });

  it('refuses cancelling a READY or stale package without modifying it', async () => {
    for (const [status, version] of [['READY', 4], ['QUEUED', 3]] as const) {
      const { pool, queries } = setup(status, { rowVersion: version });
      await expect(new HandoverService(pool, {} as any)
        .cancelHandoverPackage(ctx, projectId, packageId, input)).rejects.toBeDefined();
      expect(queries.some(q => q.sql.includes("SET status = 'CANCELLED'"))).toBe(false);
      expect(queries.map(q => q.sql)).toContain('ROLLBACK');
    }
  });

  it('retries a FAILED v2 manifest once through the normal durable queue outbox', async () => {
    const { pool, queries } = setup('FAILED');
    const result = await new HandoverService(pool, {} as any)
      .retryHandoverPackage(ctx, projectId, packageId, input);
    expect(result.retried).toBe(true);
    expect(result.status).toBe('QUEUED');
    const queued = queries.filter(q => q.sql.includes('INSERT INTO outbox_events'));
    expect(queued).toHaveLength(1);
    expect(queued[0].params[3]).toBe('HANDOVER_PACKAGE_QUEUED');
    expect(queries.some(q => q.sql.includes("SET status = 'QUEUED'"))).toBe(true);
    expect(queries.some(q => q.sql.includes('INSERT INTO usage_counters'))).toBe(false);
  });

  it('rejects cancelled packages and stale checklists before retry outbox publication', async () => {
    for (const [status, active] of [['CANCELLED', true], ['FAILED', false]] as const) {
      const { pool, queries } = setup(status, { snapshotActive: active });
      await expect(new HandoverService(pool, {} as any)
        .retryHandoverPackage(ctx, projectId, packageId, input)).rejects.toBeDefined();
      expect(queries.some(q => q.sql.includes('INSERT INTO outbox_events'))).toBe(false);
      expect(queries.some(q => q.sql.includes("SET status = 'QUEUED'"))).toBe(false);
    }
  });

  it('validates revision and reason before beginning a database transaction', async () => {
    const { pool } = setup('FAILED');
    for (const bad of [{ expectedRowVersion: 0, reason: input.reason },
      { expectedRowVersion: 4, reason: 'short' }]) {
      await expect(new HandoverService(pool, {} as any)
        .cancelHandoverPackage(ctx, projectId, packageId, bad)).rejects.toBeDefined();
      await expect(new HandoverService(pool, {} as any)
        .retryHandoverPackage(ctx, projectId, packageId, bad)).rejects.toBeDefined();
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
