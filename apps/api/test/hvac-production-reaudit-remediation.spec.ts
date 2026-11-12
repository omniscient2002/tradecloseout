import { withAssetAuthorityFixture } from './helpers/asset-authority-fixture';
import { createHash, createHmac, randomBytes } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { HttpStatus, ServiceUnavailableException, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { BillingService } from '../src/modules/billing/billing.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { AssetsService } from '../src/modules/assets/assets.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { TenantActorContext } from '@tradecloseout/db/tenant-tx';
import Redis from 'ioredis';

describe('HVAC Production Re-Audit Remediation Suite (Findings N02..N23)', () => {
  let redis: Redis;
  const previousOtpKey = process.env.AUTH_OTP_HMAC_KEY;

  beforeAll(() => {
    process.env.AUTH_OTP_HMAC_KEY = 'test-only-otp-hmac-key-for-hvac-regressions-000000000';
    redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  });

  afterAll(async () => {
    if (previousOtpKey === undefined) delete process.env.AUTH_OTP_HMAC_KEY;
    else process.env.AUTH_OTP_HMAC_KEY = previousOtpKey;
    await redis.quit();
  });

  // --------------------------------------------------------------------------
  // Finding N02, N03, N06: OTP Identity, Replay Prevention & Delivery Assurance
  // --------------------------------------------------------------------------
  describe('N02 & N06: OTP Anti-Replay and HTTP 429 Status', () => {
    let identityController: IdentityController;
    const testIdentifier = `eng-${randomBytes(6).toString('hex')}@metrohvac.in`;

    beforeEach(() => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockResolvedValue({ rows: [{ id: uuidv7(), active_org_id: uuidv7() }] }),
          release: jest.fn(),
        }),
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      const mockSmsGateway: any = { sendOtpSms: jest.fn().mockResolvedValue({ delivered: true }) };
      const mockMailGateway: any = {
        sendOtpEmail: jest.fn().mockResolvedValue(undefined),
        sendMagicLinkEmail: jest.fn().mockResolvedValue(undefined),
      };

      identityController = new IdentityController(mockPool, redis, mockSmsGateway, mockMailGateway);
    });

    afterEach(async () => {
      const keys = await redis.keys(`*${testIdentifier}*`);
      if (keys.length > 0) await redis.del(...keys);
    });

    it('N02: Consuming OTP via challengeId revokes both challengeId and identifier alias (anti-replay)', async () => {
      process.env.ENABLE_DEBUG_OTP = 'true';
      try {
        const reqResult = await identityController.requestOtp({ identifier: testIdentifier }, {} as any);
        expect(reqResult.challengeId).toBeDefined();
        const { challengeId, debugOtp } = reqResult;

        const mockRes: any = { cookie: jest.fn() };

        // 1. First verification with challengeId succeeds
        const firstVerify = await identityController.verifyOtp(
          { challengeId, otp: debugOtp },
          {} as any,
          mockRes,
        );
        expect(firstVerify).toBeDefined();

        // 2. Immediate mixed-alias replay with identifier MUST fail with OTP_EXPIRED
        await expect(
          identityController.verifyOtp(
            { identifier: testIdentifier, otp: debugOtp },
            {} as any,
            mockRes,
          ),
        ).rejects.toThrow(/OTP_EXPIRED/);

        // 3. Immediate replay with the original challengeId MUST ALSO fail with OTP_EXPIRED
        await expect(
          identityController.verifyOtp(
            { challengeId, otp: debugOtp },
            {} as any,
            mockRes,
          ),
        ).rejects.toThrow(/OTP_EXPIRED/);
      } finally {
        delete process.env.ENABLE_DEBUG_OTP;
      }
    });

    it('N02: Reissue supersedes prior challenge generation', async () => {
      process.env.ENABLE_DEBUG_OTP = 'true';
      try {
        const firstReq = await identityController.requestOtp({ identifier: testIdentifier }, {} as any);
        const secondReq = await identityController.requestOtp({ identifier: testIdentifier }, {} as any);

        expect(firstReq.challengeId).not.toBe(secondReq.challengeId);

        const mockRes: any = { cookie: jest.fn() };

        // Attempting to verify the first (superseded) challenge MUST fail
        await expect(
          identityController.verifyOtp(
            { challengeId: firstReq.challengeId, otp: firstReq.debugOtp },
            {} as any,
            mockRes,
          ),
        ).rejects.toThrow(/OTP_EXPIRED/);

        // Verifying the second (latest) challenge succeeds
        const secondVerify = await identityController.verifyOtp(
          { challengeId: secondReq.challengeId, otp: secondReq.debugOtp },
          {} as any,
          mockRes,
        );
        expect(secondVerify).toBeDefined();
      } finally {
        delete process.env.ENABLE_DEBUG_OTP;
      }
    });

    it('V01: Generation binding rejects obsolete challenge IDs even if record was directly retained', async () => {
      process.env.ENABLE_DEBUG_OTP = 'true';
      try {
        const req1 = await identityController.requestOtp({ identifier: testIdentifier }, {} as any);
        const req2 = await identityController.requestOtp({ identifier: testIdentifier }, {} as any);

        const mockRes: any = { cookie: jest.fn() };

        // Attempting to consume the older generation MUST return OTP_EXPIRED
        await expect(
          identityController.verifyOtp({ challengeId: req1.challengeId, otp: req1.debugOtp }, {} as any, mockRes),
        ).rejects.toThrow(/OTP_EXPIRED/);

        // Attempting to consume the newer generation succeeds
        const verify2 = await identityController.verifyOtp({ challengeId: req2.challengeId, otp: req2.debugOtp }, {} as any, mockRes);
        expect(verify2).toBeDefined();

        // After consumption, replaying the newer generation also returns OTP_EXPIRED
        await expect(
          identityController.verifyOtp({ challengeId: req2.challengeId, otp: req2.debugOtp }, {} as any, mockRes),
        ).rejects.toThrow(/OTP_EXPIRED/);
      } finally {
        delete process.env.ENABLE_DEBUG_OTP;
      }
    });

    it('N06: Rate limit exhaustion throws HttpException with status 429', async () => {
      const rateLimitId = `ratelimit-${randomBytes(6).toString('hex')}@hvac.com`;
      const rateKey = `rl:otp:req:${rateLimitId}`;

      // Simulate 5 requests already consumed
      await redis.set(rateKey, '5', 'EX', 3600);

      // The 6th request triggers rate limiting
      try {
        await identityController.requestOtp({ identifier: rateLimitId }, {} as any);
        fail('Should have thrown rate limit exception');
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.getResponse()).toMatchObject({
          code: 'RATE_LIMITED',
          retryable: true,
          retryAfterSeconds: 300,
        });
      } finally {
        await redis.del(rateKey);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Finding N04 & N31: Archive Export Signed URL & Download Path Integrity
  // --------------------------------------------------------------------------
  describe('N04 & N31: Archive Download Signs Actual Versioned Object Artifact', () => {
    it('signs recorded artifact objectKey and providerVersionId instead of guessed unversioned path', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const exportId = uuidv7();
      const artifactObjectId = uuidv7();
      const actualObjectKey = `archives/${orgId}/${projectId}/${exportId}/${uuidv7()}.zip`;
      const providerVersionId = 'v1-archive-test';

      const mockSignedParams: any[] = [];
      const mockStorage: any = {
        createSignedDownloadUrl: jest.fn().mockImplementation(async (params) => {
          mockSignedParams.push(params);
          return `https://s3.example.com/${params.objectKey}?versionId=${params.versionId}&signed=true`;
        }),
      };

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT * FROM archive_exports')) {
              return {
                rows: [
                  {
                    id: exportId,
                    project_id: projectId,
                    schema_version: '1.0',
                    status: 'COMPLETED',
                    archive_sha256: 'a'.repeat(64),
                    total_objects: 5,
                    total_bytes: '102400',
                    verification_receipt_json: {
                      artifact: {
                        objectId: artifactObjectId,
                        bucket: 'tradecloseout-vault',
                        objectKey: actualObjectKey,
                        providerVersionId,
                        sizeBytes: 102400,
                        sha256: 'a'.repeat(64),
                      },
                    },
                    created_at: new Date(),
                    completed_at: new Date(),
                  },
                ],
              };
            }
            if (sql.includes('FROM storage_objects')) {
              return {
                rows: [
                  {
                    id: artifactObjectId,
                    status: 'READY',
                    bucket: 'tradecloseout-vault',
                    object_key: actualObjectKey,
                    provider_version_id: providerVersionId,
                    sha256: 'a'.repeat(64),
                    size_bytes: 102400,
                    observed_size_bytes: 102400,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const handoverService = new HandoverService(mockPool, mockStorage);
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-arch-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      const res = await handoverService.getArchiveExport(ctx, projectId, exportId);
      expect(res.downloadUrl).toBeDefined();
      expect(mockSignedParams).toHaveLength(1);
      expect(mockSignedParams[0].objectKey).toBe(actualObjectKey);
      expect(mockSignedParams[0].versionId).toBe(providerVersionId);
      expect(mockSignedParams[0].bucket).toBe('tradecloseout-vault');
    });
  });

  // --------------------------------------------------------------------------
  // Finding N05: Razorpay Payment Webhook Containment
  // --------------------------------------------------------------------------
  describe('N05: Razorpay Payment Webhook Containment', () => {
    it('throws ServiceUnavailableException when webhook processing is unconfigured (safe containment)', async () => {
      const billingService = new BillingService({} as any);
      delete process.env.RAZORPAY_WEBHOOK_SECRET;

      await expect(
        billingService.handleRazorpayWebhook(Buffer.from('{"id":"evt_123"}'), 'fake_sig'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects invalid HMAC signatures when secret is configured', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_123';
      try {
        const billingService = new BillingService({} as any);
        await expect(
          billingService.handleRazorpayWebhook(Buffer.from('{"id":"evt_123"}'), 'invalid_hmac_sig'),
        ).rejects.toThrow(/INVALID_PAYMENT_WEBHOOK_SIGNATURE/);
      } finally {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
      }
    });

    it('V03: throws ServiceUnavailableException even with valid signature until durable inbox exists', async () => {
      const secret = 'test_webhook_secret_123';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;
      try {
        const billingService = new BillingService({} as any);
        const payload = Buffer.from(JSON.stringify({ id: 'evt_valid_123', event: 'payment.captured' }));
        const validSig = createHmac('sha256', secret).update(payload).digest('hex');

        await expect(
          billingService.handleRazorpayWebhook(payload, validSig),
        ).rejects.toThrow(ServiceUnavailableException);
      } finally {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
      }
    });
  });

  // --------------------------------------------------------------------------
  // Finding N20: Defect Closure Validation & Row Count Check
  // --------------------------------------------------------------------------
  describe('N20: Defect Closure Verification', () => {
    it('rejects nonexistent defect or unverified closure evidence', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const defectId = uuidv7();
      const closureEvidenceId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT id, status FROM storage_objects')) {
              // Evidence is not READY
              return { rows: [{ id: closureEvidenceId, status: 'QUARANTINED' }] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-defect-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        warrantyService.closeDefect(ctx, projectId, defectId, closureEvidenceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('V07: Defect Closure rejects evidence associated with another project', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const otherProjectId = uuidv7();
      const defectId = uuidv7();
      const closureEvidenceId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM defects d')) {
              return {
                rows: [
                  {
                    id: defectId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'RECTIFIED',
                    row_version: 1,
                    assigned_user_id: uuidv7(),
                  },
                ],
              };
            }
            if (sql.includes('FROM storage_objects so')) {
              return {
                rows: [
                  {
                    id: closureEvidenceId,
                    status: 'READY',
                    object_key: `orgs/${orgId}/projects/${otherProjectId}/${closureEvidenceId}/source`,
                    linked_in_project: false,
                    linked_in_other_project: true,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-defect-proj-mismatch',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        warrantyService.closeDefect(ctx, projectId, defectId, closureEvidenceId, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('V07: Defect Closure enforces concurrency version check', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const defectId = uuidv7();
      const closureEvidenceId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM defects d')) {
              return {
                rows: [
                  {
                    id: defectId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'RECTIFIED',
                    row_version: 3,
                    assigned_user_id: uuidv7(),
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-defect-version',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        warrantyService.closeDefect(ctx, projectId, defectId, closureEvidenceId, 2),
      ).rejects.toThrow(ConflictException);
    });

    it('V07: Defect Closure enforces verifier independence (assignee cannot self-verify)', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const defectId = uuidv7();
      const closureEvidenceId = uuidv7();
      const assigneeUserId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM defects d')) {
              return {
                rows: [
                  {
                    id: defectId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'RECTIFIED',
                    row_version: 2,
                    assigned_user_id: assigneeUserId,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const ctx: TenantActorContext = {
        orgId,
        userId: assigneeUserId,
        actorType: 'MEMBER',
        requestId: 'req-defect-self-close',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        warrantyService.closeDefect(ctx, projectId, defectId, closureEvidenceId, 2),
      ).rejects.toThrow(ForbiddenException);
    });

    it('V07: Distinct remedy submission transitions to RECTIFIED, and independent close transitions to CLOSED', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const defectId = uuidv7();
      const remedyEvidenceId = uuidv7();
      const assigneeUserId = uuidv7();
      const independentVerifierId = uuidv7();

      let currentDefect = {
        id: defectId,
        org_id: orgId,
        project_id: projectId,
        status: 'OPEN',
        row_version: 1,
        assigned_user_id: assigneeUserId,
        closure_evidence_object_id: null as string | null,
      };

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM defects d')) {
              return { rows: [{ ...currentDefect }] };
            }
            if (sql.includes('FROM storage_objects so')) {
              return {
                rows: [
                  {
                    id: remedyEvidenceId,
                    status: 'READY',
                    object_key: `orgs/${orgId}/projects/${projectId}/${remedyEvidenceId}/source`,
                    linked_in_project: true,
                    linked_in_other_project: false,
                  },
                ],
              };
            }
            if (sql.includes('UPDATE defects')) {
              if (sql.includes("status = 'RECTIFIED'")) {
                currentDefect = {
                  ...currentDefect,
                  status: 'RECTIFIED',
                  row_version: 2,
                  closure_evidence_object_id: remedyEvidenceId,
                };
                return { rowCount: 1 };
              }
              if (sql.includes("status = 'CLOSED'")) {
                currentDefect = {
                  ...currentDefect,
                  status: 'CLOSED',
                  row_version: 3,
                };
                return { rowCount: 1 };
              }
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);

      const remedyCtx: TenantActorContext = {
        orgId,
        userId: assigneeUserId,
        actorType: 'MEMBER',
        requestId: 'req-remedy-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };
      const remedyRes = await warrantyService.submitDefectRemedy(
        remedyCtx,
        projectId,
        defectId,
        remedyEvidenceId,
        1,
      );
      expect(remedyRes.status).toBe('RECTIFIED');
      expect(remedyRes.rowVersion).toBe(2);

      const verifierCtx: TenantActorContext = {
        orgId,
        userId: independentVerifierId,
        actorType: 'MEMBER',
        requestId: 'req-close-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };
      const closeRes = await warrantyService.closeDefect(
        verifierCtx,
        projectId,
        defectId,
        remedyEvidenceId,
        2,
      );
      expect(closeRes.status).toBe('CLOSED');
      expect(closeRes.rowVersion).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Finding N11: Submission Recipient Decision Project Mismatch Check
  // --------------------------------------------------------------------------
  describe('N11: Recipient Decision rejects contradictory project IDs', () => {
    it('rejects submission decision when target projectId does not match submission project', async () => {
      const orgId = uuidv7();
      const realProjectId = uuidv7();
      const wrongProjectId = uuidv7();
      const submissionId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM submissions WHERE')) {
              return {
                rows: [{ id: submissionId, project_id: realProjectId, status: 'SENT' }],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const handoverService = new HandoverService(mockPool, {} as any);
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-sub-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        handoverService.recordRecipientSubmissionDecision(
          ctx,
          wrongProjectId,
          submissionId,
          { recipientPartyId: uuidv7(), decision: 'ACCEPT', remarks: 'Good' },
        ),
      ).rejects.toThrow(/SUBMISSION_PROJECT_MISMATCH/);
    });
  });

  // --------------------------------------------------------------------------
  // Finding N13: Revalidation Asset URL Binding
  // --------------------------------------------------------------------------
  describe('N13: Evidence Revalidation binds strictly to asset ID', () => {
    it('rejects revalidation when asset ID does not match the URL asset', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();
      const revalidationId = uuidv7();
      const urlAssetId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('UPDATE evidence_revalidations')) {
              // Asset ID in WHERE clause does not match, rowCount = 0
              return { rowCount: 0 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const assetsService = new AssetsService(withAssetAuthorityFixture(mockPool));
      const ctx: TenantActorContext = {
        orgId,
        userId: uuidv7(),
        actorType: 'MEMBER',
        requestId: 'req-reval-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
      };

      await expect(
        assetsService.revalidateEvidence(ctx, projectId, urlAssetId, revalidationId, {
          status: 'CONFIRMED',
          notes: 'Serial verified on site',
          expectedRowVersion: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // Finding N21: Multi-Contract Pre-Aggregation & Rupee-at-Risk Precision
  // --------------------------------------------------------------------------
  describe('N21: Owner Digest & Multi-Contract Dashboard Calculation', () => {
    it('calculates owner digest with exact paise integer math and supports 0% retention', async () => {
      const orgId = uuidv7();
      const projectId = uuidv7();

      const mockDb: any = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client: any = {
            query: jest.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('FROM projects WHERE')) {
                return {
                  rows: [
                    {
                      id: projectId,
                      code: 'PRJ-CHILLER',
                      name: 'Data Center HVAC Expansion',
                      contract_value_paise: '50000000', // 500,000 INR
                      retention_bps: '500', // 5%
                      site_json: { retention_percent: 0 },
                    },
                  ],
                };
              }
              if (sql.includes('FROM requirements')) {
                return { rows: [{ milestone_key: 'CHILLER_COMMISSIONING', count: 2 }] };
              }
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      };

      const notificationsService = new NotificationsService(mockDb);
      const digest = await notificationsService.getOwnerDigest(
        { orgId, userId: uuidv7(), actorType: 'USER', requestId: 'r1' },
        projectId,
      );

      expect(digest.contractValuePaise).toBe('50000000');
      expect(digest.contractValueInr).toBe(500000);
      expect(digest.retentionMoneyGatedPaise).toBe('2500000'); // 25,000 INR
      expect(digest.retentionMoneyGatedInr).toBe(25000);
    });

    it('V08: Dashboard contract summary includes only ACTIVE contracts and excludes SUPERSEDED ones', async () => {
      const orgId = uuidv7();
      const userId = uuidv7();
      const executedQueries: string[] = [];

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            executedQueries.push(sql);
            if (sql.includes('FROM organisations')) {
              return { rows: [{ id: orgId, name: 'Metro HVAC EPC Ltd', pan: 'AAACM1234F', gstin: '27AAACM1234F1Z5', tier: 'ENTERPRISE' }] };
            }
            if (sql.includes('FROM users u')) {
              return { rows: [{ id: userId, name: 'Lead HVAC Engineer', role: 'R-SITE' }] };
            }
            if (sql.includes('WITH contract_summary AS')) {
              return {
                rows: [
                  {
                    id: uuidv7(),
                    code: 'PRJ-HVAC-ACTIVE',
                    name: 'Terminal 3 Chiller Plant',
                    status: 'ACTIVE',
                    target_handover_date: '2026-12-31',
                    contract_value_paise: '100000000', // 1,000,000 INR
                    retention_at_risk_paise: '5000000', // 50,000 INR
                    applicable_count: 10,
                    approved_count: 8,
                    missing_count: 1,
                    in_review_count: 1,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const orgsService = new OrganisationsService(mockPool);
      const res = await orgsService.getDashboard(
        { orgId, userId, actorType: 'MEMBER', orgRole: 'R-OWNER', requestId: 'req-org-dash', ip: '127.0.0.1', userAgent: 'jest' },
        orgId,
      );

      const contractSummarySql = executedQueries.find((s) => s.includes('WITH contract_summary AS'));
      expect(contractSummarySql).toBeDefined();
      expect(contractSummarySql).toContain("WHERE status = 'ACTIVE'");
      expect(res.projects).toHaveLength(1);
      expect(res.projects[0].contractValuePaise).toBe('100000000');
    });
  });
});
