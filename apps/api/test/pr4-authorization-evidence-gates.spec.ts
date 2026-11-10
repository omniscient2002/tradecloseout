import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { Reflector } from '@nestjs/core';
import { uuidv7 } from 'uuidv7';
import { hasPermission } from '@tradecloseout/shared';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { HandoverController } from '../src/modules/handover/handover.controller';
import { CommissioningController } from '../src/modules/commissioning/commissioning.controller';
import { REQUIRE_PERMISSION_KEY, PermissionGuard } from '../src/common/guards/permission.guard';
import { CommissioningService } from '../src/modules/commissioning/commissioning.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { BillingController } from '../src/modules/billing/billing.controller';

jest.setTimeout(180_000);

const permissions = (fn: Function) => Reflect.getMetadata(REQUIRE_PERMISSION_KEY, fn);

async function seed(admin: Pool) {
  const orgId = uuidv7(), projectId = uuidv7(), userId = uuidv7();
  const partyId = uuidv7(), otherPartyId = uuidv7();
  await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'PM','ACTIVE')`, [userId]);
  await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
    VALUES($1,'Witness HVAC Ltd','Witness HVAC','KA')`, [orgId]);
  await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
    VALUES($1,$2,'WITNESS-01','Witness scope','HANDOVER',$3)`, [projectId, orgId, userId]);
  await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
    VALUES($1,$3,'Client A',ARRAY['CLIENT']::text[],'ACTIVE'),
          ($2,$3,'Consultant B',ARRAY['CONSULTANT']::text[],'ACTIVE')`,
  [partyId, otherPartyId, orgId]);
  const ctx = { orgId, userId, requestId: uuidv7(), ip: '127.0.0.1',
    userAgent: 'independent-p0-test', actorType: 'USER' as const };
  return { orgId, projectId, userId, partyId, otherPartyId, ctx };
}

async function grant(admin: Pool, scope: Awaited<ReturnType<typeof seed>>,
  partyId: string, capability: string) {
  const grantId = uuidv7();
  await admin.query(`INSERT INTO guest_grants
    (id,org_id,project_id,party_id,grant_type,role,capabilities,
     target_email,token_hash,status,expires_at,created_by)
    VALUES($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',$5,'recipient@example.com',$6,'ACTIVE',now()+interval '1 day',$7)`,
    [grantId, scope.orgId, scope.projectId, partyId, [capability], uuidv7().replace(/-/g, ''), scope.userId]);
  return { ...scope.ctx, actorType: 'GUEST' as const, guestGrantId: grantId, guestCapabilities: [capability] };
}

describe('PR4: least privilege in handover and independent witness routes', () => {
  it('uses package.download on every package/dossier information and artifact route', () => {
    for (const handler of [
      HandoverController.prototype.listPackages,
      HandoverController.prototype.getPackage,
      HandoverController.prototype.getProjectPackage,
      HandoverController.prototype.getPackageDownloadUrl,
      HandoverController.prototype.getDossierPdf,
    ]) expect(permissions(handler)).toBe('package.download');
    const supplier = { guestCapabilities: ['document.read', 'document.upload'] };
    expect(hasPermission(supplier, 'document.read').allowed).toBe(true);
    expect(hasPermission(supplier, 'package.download').allowed).toBe(false);
    expect(permissions(CommissioningController.prototype.signInspectionWitness)).toBe('inspection.witness');
    expect(permissions(CommissioningController.prototype.recordInspectionWitnessAttendance)).toBe('document.upload');
  });

  it('denies HTTP dossier route authorization to a supplier-upload guest before any storage read', async () => {
    const guard = new PermissionGuard(new Reflector(), {} as any);
    for (const method of [
      HandoverController.prototype.getDossierPdf,
      HandoverController.prototype.getPackageDownloadUrl,
      HandoverController.prototype.getProjectPackage,
      HandoverController.prototype.listPackages,
    ]) {
      const req: any = {
        user: { guestGrantId: 'grant-supplier', actorType: 'GUEST', orgId: uuidv7(),
          userId: uuidv7(), guestProjectId: 'project-a',
          guestCapabilities: ['document.read','document.upload'] },
        params: { projectId: 'project-a' },
        path: '/api/v1/projects/project-a/dossier/pdf',
      };
      await expect(guard.canActivate({
        getHandler: () => method, getClass: () => HandoverController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as any)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('never marks a self-reported party ID as an independently signed witness', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const scope = await seed(admin);
      const inspectionId = uuidv7();
      await admin.query(`INSERT INTO quality_inspections
        (id,org_id,project_id,itr_number,title,stage_key,witness_parties_json,inspected_by)
        VALUES($1,$2,$3,'ITR-17','Final witness','COMMISSIONING',$4::jsonb,$5)`,
        [inspectionId,scope.orgId,scope.projectId,JSON.stringify([
          { partyId: scope.partyId, partyName: 'Client A', representativeName: 'Pending', role: 'CLIENT' },
        ]),scope.userId]);

      const service = new CommissioningService(app);
      const data = { partyId: scope.partyId, partyName: 'Client A',
        representativeName: 'A person typed into the form', role: 'CLIENT' };
      await expect(service.signInspectionWitness(scope.ctx as any,scope.projectId,inspectionId,data))
        .rejects.toThrow(ForbiddenException);
      const attendance = await service.recordInspectionWitnessAttendance(
        scope.ctx as any,scope.projectId,inspectionId,data);
      expect(attendance.lastSigned).toMatchObject({
        attestationType: 'RECORDED_ATTENDANCE', isVerified: false,
        requiresConfirmation: true, signedByUserId: null,
      });

      const otherGuest = await grant(admin,scope,scope.otherPartyId,'inspection.witness');
      await expect(service.signInspectionWitness(otherGuest as any,scope.projectId,inspectionId,data))
        .rejects.toThrow(ForbiddenException);

      const realGuest = await grant(admin,scope,scope.partyId,'inspection.witness');
      const signed = await service.signInspectionWitness(realGuest as any,scope.projectId,inspectionId,data);
      expect(signed.lastSigned).toMatchObject({
        partyId: scope.partyId, partyName: 'Client A',
        representativeName: 'recipient@example.com',
        claimedRepresentativeName: 'A person typed into the form',
        attestationType: 'AUTHENTICATED_ATTESTATION', isVerified: true,
        requiresConfirmation: false, authenticatedGrantId: realGuest.guestGrantId,
      });
      await expect(service.signInspectionWitness(realGuest as any,scope.projectId,inspectionId,data))
        .rejects.toThrow();
    });
  });

  it('rejects a project manager or unrelated guest as a legal handover recipient', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const scope = await seed(admin);
      const packageId = uuidv7(), submissionId = uuidv7(), recipientId = uuidv7();
      await admin.query(`INSERT INTO handover_packages
        (id,org_id,project_id,version_no,status,package_purpose,snapshot_checksum,requested_by)
        VALUES($1,$2,$3,1,'READY','FULL_HANDOVER',$5,$4)`,
        [packageId,scope.orgId,scope.projectId,scope.userId,'a'.repeat(64)]);
      await admin.query(`INSERT INTO submissions
        (id,org_id,project_id,package_id,status,submitted_by,submitted_at)
        VALUES($1,$2,$3,$4,'SUBMITTED',$5,now())`,
        [submissionId,scope.orgId,scope.projectId,packageId,scope.userId]);
      await admin.query(`INSERT INTO submission_recipients
        (id,org_id,project_id,submission_id,party_id,recipient_party_id,name,email,role,is_required_approver,status)
        VALUES($1,$2,$3,$4,$5,$5,'Client A','recipient@example.com','CLIENT',true,'PENDING_DELIVERY')`,
        [recipientId,scope.orgId,scope.projectId,submissionId,scope.partyId]);

      const svc = new HandoverService(app, {} as any);
      const dto = { recipientPartyId: scope.partyId, decision: 'ACCEPT' as const };
      await expect(svc.recordRecipientSubmissionDecision(scope.ctx as any,scope.projectId,submissionId,dto))
        .rejects.toThrow(ForbiddenException);
      const otherGuest = await grant(admin,scope,scope.otherPartyId,'package.accept');
      await expect(svc.recordRecipientSubmissionDecision(otherGuest as any,scope.projectId,submissionId,dto))
        .rejects.toThrow(ForbiddenException);
      expect((await admin.query(
        'SELECT status,decided_at FROM submission_recipients WHERE id=$1',[recipientId]
      )).rows[0]).toMatchObject({ status: 'PENDING_DELIVERY', decided_at: null });

      const realGuest = await grant(admin,scope,scope.partyId,'package.accept');
      const accepted = await svc.recordRecipientSubmissionDecision(realGuest as any,scope.projectId,submissionId,dto);
      expect(accepted.status).toBe('ACCEPTED');
      expect((await admin.query('SELECT status FROM handover_packages WHERE id=$1',[packageId])).rows[0].status).toBe('ACCEPTED');
    });
  });

  it('prepares an external submission without lying that its recipient was delivered a message', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const scope = await seed(admin);
      const pkgId = uuidv7();
      await admin.query(`INSERT INTO handover_packages
        (id,org_id,project_id,version_no,status,package_purpose,snapshot_checksum,requested_by)
        VALUES($1,$2,$3,1,'READY','FULL_HANDOVER',$5,$4)`,
        [pkgId,scope.orgId,scope.projectId,scope.userId,'a'.repeat(64)]);
      const output = await new HandoverService(app, {} as any).createSubmission(
        scope.ctx as any,scope.projectId,
        { packageId: pkgId, recipients: [{
          partyId: scope.partyId, name: 'Client A',
          email: 'recipient@example.com', isRequiredApprover: true,
        }] },
      );
      expect(output.status).toBe('SUBMITTED');
      const { rows } = await admin.query(
        'SELECT status,decided_at FROM submission_recipients WHERE submission_id=$1',
        [output.submissionId]);
      expect(rows).toEqual([expect.objectContaining({ status: 'PENDING_DELIVERY', decided_at: null })]);
    });
  });

  it('keeps the retired webhook from updating subscription entitlements from user-controlled notes', async () => {
    const pool = { connect: jest.fn() };
    await expect(new WarrantyAndBillingService(pool as any).processRazorpayWebhook(
      JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: {
        notes: { orgId: uuidv7() },
      } } } }), 'forged-signature',
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTOMATED_PAYMENT_FULFILLMENT_DISABLED' }),
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('disables unverified invoice issuance by default while preserving read-only plans', async () => {
    const billingService = { createInvoice: jest.fn(), listPlans: jest.fn().mockResolvedValue([]) };
    const gst = { issueRule46GstInvoice: jest.fn() };
    const controller = new BillingController(billingService as any, gst as any, {} as any);
    const originalFlag = process.env.ENABLE_TAX_INVOICE_ISSUANCE;
    try {
      delete process.env.ENABLE_TAX_INVOICE_ISSUANCE;
      await expect(controller.createInvoice({ userContext: {} }, {
        subtotalPaise: 10000, placeOfSupply: '29',
      })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TAX_INVOICE_ISSUANCE_DISABLED' }),
      });
      await expect(controller.issueRule46GstInvoice({ userContext: {} }, {
        subscriptionId: uuidv7(), description: 'Unavailable',
        subtotalPaise: '10000', buyerStateCode: '29',
      })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TAX_INVOICE_ISSUANCE_DISABLED' }),
      });
      expect(billingService.createInvoice).not.toHaveBeenCalled();
      expect(gst.issueRule46GstInvoice).not.toHaveBeenCalled();
      await expect(controller.listPlans()).resolves.toEqual([]);
    } finally {
      if (originalFlag === undefined) delete process.env.ENABLE_TAX_INVOICE_ISSUANCE;
      else process.env.ENABLE_TAX_INVOICE_ISSUANCE = originalFlag;
    }
  });

  it('rejects mismatched legacy DB_PORT before even connecting or inserting a fixture', async () => {
    const previousPort = process.env.DB_PORT;
    const oldMigrator = process.env.MIGRATOR_DATABASE_URL;
    const oldApp = process.env.APP_DATABASE_URL;
    try {
      process.env.MIGRATOR_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout';
      process.env.APP_DATABASE_URL = 'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout';
      process.env.DB_PORT = '15433';
      const callback = jest.fn();
      await expect(withDisposableDatabase(callback)).rejects.toThrow('TEST_DATABASE_TARGET_MISMATCH');
      expect(callback).not.toHaveBeenCalled();
    } finally {
      if (previousPort === undefined) delete process.env.DB_PORT;
      else process.env.DB_PORT = previousPort;
      if (oldMigrator === undefined) delete process.env.MIGRATOR_DATABASE_URL;
      else process.env.MIGRATOR_DATABASE_URL = oldMigrator;
      if (oldApp === undefined) delete process.env.APP_DATABASE_URL;
      else process.env.APP_DATABASE_URL = oldApp;
    }
  });
});
