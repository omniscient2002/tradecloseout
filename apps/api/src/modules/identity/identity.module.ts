import { Module, Injectable, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseModule } from '../../database/database.module';
import { IdentityController, DltSmsGateway, TransactionalMailGateway } from './identity.controller';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { MfaController } from './mfa.controller';

export class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  private getSync(key: string): string | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() >= item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async get(key: string): Promise<string | null> {
    return this.getSync(key);
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    let expiresAt: number | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'EX' && typeof args[i + 1] === 'number') {
        expiresAt = Date.now() + args[i + 1] * 1000;
      }
    }
    const existing = this.store.get(key);
    if (args.includes('KEEPTTL') && existing?.expiresAt) {
      expiresAt = existing.expiresAt;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async incr(key: string): Promise<number> {
    const current = this.getSync(key);
    const num = (parseInt(current || '0', 10) || 0) + 1;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(num), expiresAt: existing?.expiresAt });
    return num;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const current = this.getSync(key);
    if (current === null) return 0;
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async eval(_script: string, numberOfKeys: number, ...args: string[]): Promise<any> {
    if (
      _script.includes("redis.call('INCR', KEYS[1])") &&
      _script.includes("redis.call('EXPIRE', KEYS[1]")
    ) {
      const key = args[0];
      const ttlSec = Number(args[1]) || 3600;
      const count = await this.incr(key);
      if (count === 1) {
        await this.expire(key, ttlSec);
      }
      return count;
    }

    if (_script.includes("if redis.call('GET', KEYS[1]) == ARGV[1]")) {
      const [aliasKey, rawChallengeKey, directChallengeKey] = args.slice(0, 3);
      const targetChallengeId = args[3];
      if (this.getSync(aliasKey) === targetChallengeId) {
        this.store.delete(aliasKey);
        this.store.delete(rawChallengeKey);
      }
      this.store.delete(directChallengeKey);
      return 1;
    }

    if (_script.includes('local oldId = redis.call(\'GET\', KEYS[1])')) {
      const [aliasKey, challengeKey] = args.slice(0, 2);
      const [challengeId, challengePayload, ttlStr, rawId] = args.slice(2);
      const oldId = this.getSync(aliasKey);
      if (oldId) {
        this.store.delete(`otp:challenge:${oldId}`);
        this.store.delete(`otp:attempts:${oldId}`);
      }
      const ttlMs = (Number(ttlStr) || 300) * 1000;
      const expiresAt = Date.now() + ttlMs;
      this.store.set(challengeKey, { value: challengePayload, expiresAt });
      this.store.set(aliasKey, { value: challengeId, expiresAt });
      this.store.set(`otp:challenge:${rawId}`, { value: challengeId, expiresAt });
      return 'OK';
    }

    const [challengeKey, aliasKey] = args.slice(0, numberOfKeys);
    const candidateCode = args[numberOfKeys];

    let challengeRaw = this.getSync(challengeKey);
    let realChallengeId: string | undefined;

    if (challengeRaw) {
      if (challengeRaw.startsWith('{')) {
        // Direct challenge
      } else {
        realChallengeId = challengeRaw;
        challengeRaw = this.getSync(`otp:challenge:${realChallengeId}`);
      }
    } else if (aliasKey) {
      const aliasTarget = this.getSync(aliasKey);
      if (aliasTarget) {
        realChallengeId = aliasTarget;
        challengeRaw = this.getSync(`otp:challenge:${realChallengeId}`);
      }
    }

    if (!challengeRaw || !challengeRaw.startsWith('{')) {
      return 'EXPIRED';
    }

    let challenge: { id?: string; identifier?: string; salt?: string; otpMac?: string };
    try {
      challenge = JSON.parse(challengeRaw);
    } catch {
      return 'EXPIRED';
    }

    if (!challenge.identifier) return 'EXPIRED';

    realChallengeId = challenge.id || realChallengeId || challengeKey;

    // Generation Binding (V01)
    const currentActiveId = this.getSync(`otp:alias:${challenge.identifier}`);
    if (!currentActiveId || currentActiveId !== realChallengeId) {
      return 'EXPIRED';
    }

    const attemptsKey = `otp:attempts:${realChallengeId}`;
    const directChallengeKey = `otp:challenge:${realChallengeId}`;

    const attemptsItemValue = this.getSync(attemptsKey);
    const attempts = (Number.parseInt(attemptsItemValue || '0', 10) || 0) + 1;
    const existingAttempts = this.store.get(attemptsKey);
    this.store.set(attemptsKey, {
      value: String(attempts),
      expiresAt: existingAttempts?.expiresAt || Date.now() + 300_000,
    });

    if (attempts > 5) {
      this.store.delete(directChallengeKey);
      this.store.delete(attemptsKey);
      if (currentActiveId === realChallengeId) {
        this.store.delete(`otp:alias:${challenge.identifier}`);
        this.store.delete(`otp:challenge:${challenge.identifier}`);
      }
      return 'MAX';
    }

    // Mirrors the real Redis Lua command. Only compare an HMAC computed in
    // the API; never recover an OTP from a low-entropy stored digest here.
    if (typeof challenge.otpMac !== 'string' || challenge.otpMac.length !== 64) return 'EXPIRED';
    if (challenge.otpMac !== candidateCode) return 'INVALID';

    // Success: atomically delete challenge, attempts, and alias if current
    this.store.delete(directChallengeKey);
    this.store.delete(attemptsKey);
    if (currentActiveId === realChallengeId) {
      this.store.delete(`otp:alias:${challenge.identifier}`);
      this.store.delete(`otp:challenge:${challenge.identifier}`);
    }
    return JSON.stringify({ status: 'OK', identifier: challenge.identifier });
  }
}

@Injectable()
export class DltSmsService implements DltSmsGateway {
  async sendOtpSms(phoneE164: string, otp: string, templateId: string): Promise<{ delivered: boolean }> {
    const dltUrl = process.env.DLT_SMS_URL || process.env.SMS_GATEWAY_URL;
    const apiKey = process.env.DLT_SMS_API_KEY || process.env.SMS_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const isOutboxLoopback = (process.env.ENABLE_OUTBOX_DELIVERY === 'true' || process.env.NODE_ENV === 'test') && !isProduction;

    if (dltUrl && apiKey) {
      try {
        const response = await fetch(dltUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-DLT-Template-Id': templateId || process.env.DLT_OTP_TEMPLATE_ID || '',
          },
          body: JSON.stringify({
            recipient: phoneE164,
            otp,
            templateId: templateId || process.env.DLT_OTP_TEMPLATE_ID || '',
            senderId: process.env.DLT_SENDER_ID || 'TRDCLS',
            entityId: process.env.DLT_ENTITY_ID || '',
          }),
        });

        if (!response.ok) {
          throw new Error(`DLT SMS provider responded with status ${response.status}`);
        }
        return { delivered: true };
      } catch (err: any) {
        throw new ServiceUnavailableException({
          code: 'SMS_GATEWAY_ERROR',
          detail: `Configured DLT delivery provider failed: ${err.message}`,
        });
      }
    }

    if (isOutboxLoopback) {
      // Outbox/loopback delivery mode for tests and development
      return { delivered: true };
    }

    // Fail honestly when neither real credentials nor outbox loopback is configured
    throw new ServiceUnavailableException({
      code: 'SMS_GATEWAY_UNAVAILABLE',
      detail: 'No configured DLT delivery adapter is available. Configure DLT_SMS_URL and DLT_SMS_API_KEY or ENABLE_OUTBOX_DELIVERY.',
    });
  }
}

@Injectable()
export class TransactionalMailService implements TransactionalMailGateway {
  async sendOtpEmail(email: string, otp: string, purpose: string): Promise<void> {
    const mailUrl = process.env.MAIL_GATEWAY_URL || process.env.SES_API_URL;
    const apiKey = process.env.MAIL_API_KEY || process.env.SENDGRID_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const isOutboxLoopback = (process.env.ENABLE_OUTBOX_DELIVERY === 'true' || process.env.NODE_ENV === 'test') && !isProduction;

    if (mailUrl) {
      try {
        const response = await fetch(mailUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            to: email,
            subject: 'TradeCloseout Verification Code',
            text: `Your verification code is ${otp}. It expires in 5 minutes.`,
            purpose,
            from: process.env.MAIL_FROM_ADDRESS || 'security@tradecloseout.com',
          }),
        });
        if (!response.ok) {
          throw new Error(`Mail provider responded with status ${response.status}`);
        }
        return;
      } catch (err: any) {
        throw new ServiceUnavailableException({
          code: 'MAIL_GATEWAY_ERROR',
          detail: `Configured mail provider failed: ${err.message}`,
        });
      }
    }

    if (isOutboxLoopback) {
      return;
    }

    throw new ServiceUnavailableException({
      code: 'MAIL_GATEWAY_UNAVAILABLE',
      detail: 'No configured transactional mail adapter is available. Configure MAIL_GATEWAY_URL and MAIL_API_KEY or ENABLE_OUTBOX_DELIVERY.',
    });
  }

  async sendMagicLinkEmail(email: string, magicUrl: string): Promise<void> {
    const mailUrl = process.env.MAIL_GATEWAY_URL || process.env.SES_API_URL;
    const apiKey = process.env.MAIL_API_KEY || process.env.SENDGRID_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const isOutboxLoopback = (process.env.ENABLE_OUTBOX_DELIVERY === 'true' || process.env.NODE_ENV === 'test') && !isProduction;

    if (mailUrl) {
      try {
        const response = await fetch(mailUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            to: email,
            subject: 'TradeCloseout Sign In Link',
            text: `Sign in to your TradeCloseout workspace: ${magicUrl}`,
            from: process.env.MAIL_FROM_ADDRESS || 'security@tradecloseout.com',
          }),
        });
        if (!response.ok) {
          throw new Error(`Mail provider responded with status ${response.status}`);
        }
        return;
      } catch (err: any) {
        throw new ServiceUnavailableException({
          code: 'MAIL_GATEWAY_ERROR',
          detail: `Configured mail provider failed: ${err.message}`,
        });
      }
    }

    if (isOutboxLoopback) {
      return;
    }

    throw new ServiceUnavailableException({
      code: 'MAIL_GATEWAY_UNAVAILABLE',
      detail: 'No configured transactional mail adapter is available. Configure MAIL_GATEWAY_URL and MAIL_API_KEY or ENABLE_OUTBOX_DELIVERY.',
    });
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [IdentityController, MfaController],
  providers: [
    SessionCsrfGuard,
    {
      provide: DltSmsGateway,
      useClass: DltSmsService,
    },
    {
      provide: TransactionalMailGateway,
      useClass: TransactionalMailService,
    },
    {
      provide: Redis,
      useFactory: () => {
        const isProductionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
        if (isProductionLike && !process.env.REDIS_URL) {
          throw new Error('FATAL: REDIS_URL must be configured in staging/production environments (TC2-033).');
        }
        if (process.env.REDIS_URL) {
          try {
            return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
          } catch (err) {
            if (isProductionLike) throw err;
            return new InMemoryRedis() as unknown as Redis;
          }
        }
        return new InMemoryRedis() as unknown as Redis;
      },
    },
  ],
  exports: [SessionCsrfGuard, DltSmsGateway, TransactionalMailGateway, Redis],
})
export class IdentityModule {}
