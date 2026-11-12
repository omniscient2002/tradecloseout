import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Post,
  Req, Res, UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Response } from 'express';
import { TenantDbService } from '../../database/tenant-db.service';
import { SessionCsrfGuard, AuthenticatedRequest } from '../../common/guards/session-csrf.guard';
import { NoGenericIdempotencyReceipt } from '../../common/decorators/no-generic-idempotency-receipt.decorator';
import { MfaAttemptBudget } from './mfa-attempt-budget';
import { MfaEnrollmentStore, MfaEnrollmentSession, isMfaProposalId } from './mfa-enrollment-store';

type MfaRequest = AuthenticatedRequest & {
  userContext?: { actorType?: string };
};

@Controller('api/v1/auth/mfa')
@UseGuards(SessionCsrfGuard)
@NoGenericIdempotencyReceipt()
export class MfaController {
  private readonly store: MfaEnrollmentStore;
  private readonly budget: MfaAttemptBudget;

  constructor(private readonly db: TenantDbService) {
    this.store = new MfaEnrollmentStore(db);
    this.budget = new MfaAttemptBudget(db);
  }

  private session(req: MfaRequest): MfaEnrollmentSession {
    if (req.userContext?.actorType === 'GUEST') {
      throw new ForbiddenException({ code: 'MFA_MEMBER_ONLY' });
    }
    // Factor and recovery endpoints must use cookie-based sessions, never an
    // arbitrary bearer string, client-supplied userId or DTO sessionId.
    const token = req.cookies?.tc_session;
    if (typeof token !== 'string' || token.length < 32) {
      throw new ForbiddenException({ code: 'SESSION_COOKIE_REQUIRED' });
    }
    return {
      userId: req.auth.userId,
      activeOrgId: req.auth.activeOrgId,
      sessionId: req.auth.sessionId,
      sessionTokenHash: createHash('sha256').update(token).digest('hex'),
    };
  }

  private noCache(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }

  private complete(
    res: Response,
    result: { newSessionToken: string; csrfToken: string },
  ): { csrfToken: string; mfaVerified: true } {
    this.noCache(res);
    res.cookie('tc_session', result.newSessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { csrfToken: result.csrfToken, mfaVerified: true };
  }

  @Get('status')
  async status(@Req() req: MfaRequest, @Res({ passthrough: true }) res: Response) {
    const ctx = this.session(req);
    this.noCache(res);
    const users = await this.db.queryGlobal<{ enrolled: boolean }>(
      `SELECT (mfa_enabled_at IS NOT NULL) AS enrolled
         FROM users WHERE id=$1 AND status='ACTIVE'`,
      [ctx.userId],
    );
    if (users.length !== 1) throw new ForbiddenException({ code: 'ACCOUNT_UNAVAILABLE' });
    return { enrolled: Boolean(users[0].enrolled), mfaVerified: Boolean(req.auth.mfaVerified) };
  }

  @Post('enroll/start')
  async begin(
    @Req() req: MfaRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.session(req);
    await this.budget.reserve(ctx.userId, 'ENROLL_START');
    const proposal = await this.store.begin(ctx);
    this.noCache(res);
    return {
      proposalId: proposal.proposalId,
      manualSetupKey: proposal.manualSetupKey,
      expiresAt: proposal.expiresAt,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
    };
  }

  @Post('enroll/confirm')
  async confirm(
    @Req() req: MfaRequest,
    @Body() body: { proposalId?: string; code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.session(req);
    if (!isMfaProposalId(body?.proposalId) || typeof body?.code !== 'string' ||
        !/^[0-9]{6}$/.test(body.code)) {
      throw new BadRequestException({ code: 'MFA_ENROLLMENT_INPUT_INVALID' });
    }
    await this.budget.reserve(ctx.userId, 'ENROLL_CONFIRM');
    const verified = await this.store.confirm(ctx, body.proposalId, body.code);
    return { ...this.complete(res, verified), recoveryCodes: verified.recoveryCodes, enrolled: true };
  }

  @Post('enroll/cancel')
  async cancel(@Req() req: MfaRequest, @Body() body: { proposalId?: string }) {
    const ctx = this.session(req);
    if (!isMfaProposalId(body?.proposalId)) {
      throw new BadRequestException({ code: 'MFA_ENROLLMENT_INPUT_INVALID' });
    }
    await this.budget.reserve(ctx.userId, 'CANCEL');
    await this.store.cancel(ctx, body.proposalId);
    return { cancelled: true };
  }

  @Post('verify')
  async verify(
    @Req() req: MfaRequest,
    @Body() body: { code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.session(req);
    if (typeof body?.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) throw new BadRequestException({ code: 'MFA_CODE_INVALID' });
    await this.budget.reserve(ctx.userId, 'VERIFY');
    const verified = await this.store.verifyFactor(ctx, body.code);
    return this.complete(res, verified);
  }

  @Post('recovery')
  async recover(
    @Req() req: MfaRequest,
    @Body() body: { recoveryCode?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.session(req);
    if (typeof body?.recoveryCode !== 'string' || !/^[0-9a-f]{24}$/i.test(body.recoveryCode)) throw new BadRequestException({ code: 'RECOVERY_CODE_INVALID' });
    await this.budget.reserve(ctx.userId, 'RECOVERY');
    const verified = await this.store.useRecoveryCode(ctx, body.recoveryCode);
    return this.complete(res, verified);
  }
}
