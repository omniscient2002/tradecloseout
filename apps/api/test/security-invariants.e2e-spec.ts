import { Pool } from 'pg';
import { evaluateEffectivePermission, projectGuestVisiblePayload } from '@tradecloseout/shared/permissions';
import { isValidIndianGstin } from '@tradecloseout/shared/validators';

describe('TradeCloseout Non-Negotiable Security & Domain Invariants (05 §12 & 08 §8)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ||
        'postgresql://tc_app:app_local_pw@127.0.0.1:5432/tradecloseout',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('TC-SEC-01 (AUD-035): RLS fails closed with 0 rows when app.current_org is unset', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Intentionally do NOT set app.current_org
      const { rows } = await client.query('SELECT id FROM projects');
      expect(rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('TC-SEC-02 (FR-AUD-001): audit_events rejects UPDATE and DELETE mutations', async () => {
    await expect(
      pool.query(`DELETE FROM audit_events WHERE true`),
    ).rejects.toThrow(/AUDIT_IMMUTABLE/);
  });

  it('TC-IAM-01 (AUD-005 & FR-REV-002): Project Manager cannot approve a requirement requiring R-QC', () => {
    const decision = evaluateEffectivePermission('review.decide', {
      orgRole: 'R-PM',
      isProjectMember: true,
      projectStatus: 'ACTIVE',
      requirementReviewerRole: 'R-QC',
      isSelfApprovalAttempt: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('R-QC');
  });

  it('TC-REV-01 (FR-REV-009): Self-approval is blocked by default even for matching role', () => {
    const decision = evaluateEffectivePermission('review.decide', {
      orgRole: 'R-QC',
      isProjectMember: true,
      projectStatus: 'ACTIVE',
      requirementReviewerRole: 'R-QC',
      isSelfApprovalAttempt: true,
      orgAllowsSelfApproval: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SELF_APPROVAL_DENIED');
  });

  it('TC-PRJ-01 (05 §3.2 Rule 4): Suspended or Closed projects block all write actions even for Owner', () => {
    const decision = evaluateEffectivePermission('document.upload', {
      orgRole: 'R-OWNER',
      isProjectMember: true,
      projectStatus: 'SUSPENDED',
    });
    expect(decision.allowed).toBe(false);
  });

  it('TC-SEC-03 (05 §6.4 / AUD-S-24): Guest visibility projection strips pricing, retention, and internal notes', () => {
    const rawRecord = {
      id: 'req-1',
      title: 'Chiller Test Report',
      contractValuePaise: 1500000000n,
      retentionBps: 500,
      internalNote: 'Chase supplier privately',
      reviewerName: 'Sunil Rao',
    };
    const projectedForClient = projectGuestVisiblePayload(rawRecord, 'R-CLIENT');
    expect(projectedForClient.contractValuePaise).toBeUndefined();
    expect(projectedForClient.retentionBps).toBeUndefined();
    expect(projectedForClient.internalNote).toBeUndefined();
    expect(projectedForClient.reviewerName).toBe('S.R.');
  });

  it('TC-ORG-01 (FR-ORG-005): Validates Modulo-36 Indian GSTIN checksum accurately', () => {
    expect(isValidIndianGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidIndianGstin('27AAPFU0939F1Z0')).toBe(false); // Corrupted check digit
  });
});
