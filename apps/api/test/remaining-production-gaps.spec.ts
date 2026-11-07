import { createHash, createHmac } from 'crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(180_000);

async function seed(admin: Pool) {
  const orgId = uuidv7(), projectId = uuidv7(), userId = uuidv7();
  await admin.query(`INSERT INTO users(id, name, status) VALUES ($1, 'Template Reviewer', 'ACTIVE')`, [userId]);
  await admin.query(
    `INSERT INTO organisations(id, legal_name, display_name, state)
       VALUES($1, 'HVAC Template Verification Pvt Ltd', 'HVAC Template Verification', 'KA')`,
    [orgId],
  );
  await admin.query(
    `INSERT INTO projects(id, org_id, code, name, status, created_by)
       VALUES($1, $2, 'HVAC-APPROVED-PACK', 'Template Validation', 'ACTIVE', $3)`,
    [projectId, orgId, userId],
  );
  return { orgId, projectId, userId, ctx: {
    orgId, userId, actorType: 'MEMBER' as const,
    requestId: uuidv7(), ip: '127.0.0.1', userAgent: 'template-test',
  } };
}

describe('Remaining production gap: approved HVAC templates', () => {
  it('lists published packs and applies the selected version through the real snapshot writer', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { orgId, projectId, ctx } = await seed(admin);
      const packId = uuidv7(), draftId = uuidv7();
      const payload = { requirements: [{
        key: 'CHILLER-COMMISSIONING', groupKey: 'COMMISSIONING',
        title: 'Chiller commissioning report', docTypeKey: 'DT-042',
        mandatory: true, reviewerRole: 'R-QC', scopeType: 'PROJECT',
      }] };
      for (const [id, version, status] of [[packId, 7, 'ACTIVE'], [draftId, 8, 'DRAFT']] as const) {
        await admin.query(
          `INSERT INTO template_packs(id, trade, code, name, version, payload_json, status)
           VALUES($1, 'HVAC', 'CONSULTANT-CONTRACT', 'HVAC contractual pack', $2, $3::jsonb, $4)`,
          [id, version, JSON.stringify(payload), status],
        );
      }
      const service = new ChecklistsService(app);
      const packs = await service.listApprovedHvacTemplates(ctx, projectId);
      expect(packs).toHaveLength(1);
      expect(packs[0].id).toBe(packId);
      expect(Number(packs[0].requirement_count)).toBe(1);
      await expect(service.applyApprovedHvacTemplate(ctx, projectId, draftId))
        .rejects.toThrow(NotFoundException);
      const applied = await service.applyApprovedHvacTemplate(ctx, projectId, packId);
      expect(applied.template).toEqual({ id: packId, code: 'CONSULTANT-CONTRACT', version: 7 });
      expect(applied.instantiatedRequirements).toBe(1);
      const { rows } = await admin.query(
        `SELECT r.requirement_key, r.doc_type_key, r.reviewer_role
           FROM requirements r
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL`,
        [orgId, projectId],
      );
      expect(rows).toEqual([expect.objectContaining({
        requirement_key: 'CHILLER-COMMISSIONING',
        doc_type_key: 'DT-042',
        reviewer_role: 'R-QC',
      })]);
    });
  });

  it('fails closed on a published but empty/invalid template without creating a snapshot', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { orgId, projectId, ctx } = await seed(admin);
      const packId = uuidv7();
      await admin.query(
        `INSERT INTO template_packs(id, trade, code, name, version, payload_json, status)
         VALUES($1, 'HVAC', 'EMPTY-PACK', 'Empty sample', 1, '{"requirements":[]}'::jsonb, 'ACTIVE')`,
        [packId],
      );
      await expect(new ChecklistsService(app).applyApprovedHvacTemplate(ctx, projectId, packId))
        .rejects.toThrow();
      const { rows } = await admin.query(
        `SELECT id FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2`,
        [orgId, projectId],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe('Remaining production gap: verified Razorpay webhook inbox', () => {
  const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  beforeEach(() => { process.env.RAZORPAY_WEBHOOK_SECRET = 'offline-test-secret'; });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
  });

  const makeEvent = (event: string, id: string, amount = 11800) => {
    const raw = Buffer.from(JSON.stringify({
      entity: 'event', event, payload: { payment: { entity: { id, amount, currency: 'INR' } } },
    }));
    const signature = createHmac('sha256', 'offline-test-secret').update(raw).digest('hex');
    return { raw, signature };
  };

  it('stores signed event once, reports duplicates, and never marks a payment processed', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const svc = new BillingService(new TenantDbService(app));
      const eventId = 'evt_unique_signed_001', { raw, signature } = makeEvent('payment.captured', 'pay_one');
      expect(await svc.handleRazorpayWebhook(raw, signature, eventId)).toEqual({
        status: 'RECEIVED_FOR_RECONCILIATION', eventId, duplicate: false, processed: false,
      });
      expect((await svc.handleRazorpayWebhook(raw, signature, eventId)).duplicate).toBe(true);
      const { rows } = await admin.query(
        `SELECT event_id, event_type, body_sha256, processing_status
           FROM razorpay_webhook_inbox WHERE event_id = $1`,
        [eventId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({
        event_id: eventId, event_type: 'payment.captured',
        body_sha256: createHash('sha256').update(raw).digest('hex'),
        processing_status: 'PENDING_RECONCILIATION',
      }));
      // The ordinary application role cannot query the global webhook ledger.
      await expect(app.query('SELECT event_id FROM razorpay_webhook_inbox')).rejects.toThrow();
      const { raw: tampered, signature: newSig } = makeEvent('payment.captured', 'pay_other');
      await expect(svc.handleRazorpayWebhook(tampered, newSig, eventId))
        .rejects.toThrow(ConflictException);
    });
  });

  it('rejects invalid signatures, missing event IDs and malformed signed bodies before writing', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const svc = new BillingService(new TenantDbService(app));
      const { raw, signature } = makeEvent('payment.captured', 'pay_one');
      await expect(svc.handleRazorpayWebhook(raw, '0'.repeat(64), 'evt_blocked_1'))
        .rejects.toThrow(BadRequestException);
      await expect(svc.handleRazorpayWebhook(raw, signature, ''))
        .rejects.toThrow(BadRequestException);
      const broken = Buffer.from('{invalid');
      const brokenSig = createHmac('sha256', 'offline-test-secret').update(broken).digest('hex');
      await expect(svc.handleRazorpayWebhook(broken, brokenSig, 'evt_broken_1'))
        .rejects.toThrow(BadRequestException);
      expect((await admin.query('SELECT count(*)::int AS count FROM razorpay_webhook_inbox')).rows[0].count).toBe(0);
    });
  });
});
