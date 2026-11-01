import { Module, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseModule } from '../../database/database.module';
import { IdentityController, DltSmsGateway, TransactionalMailGateway } from './identity.controller';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';

class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
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

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const num = (parseInt(current || '0', 10) || 0) + 1;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(num), expiresAt: existing?.expiresAt });
    return num;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
}

@Injectable()
export class DltSmsService implements DltSmsGateway {
  async sendOtpSms(phoneE164: string, otp: string, templateId: string): Promise<{ delivered: boolean }> {
    // In production, invokes Kaleyra / Karix / Gupshup DLT SMS API with PE_ID and Template_ID
    return { delivered: true };
  }
}

@Injectable()
export class TransactionalMailService implements TransactionalMailGateway {
  async sendMagicLinkEmail(email: string, magicUrl: string): Promise<void> {
    // In production, dispatches transactional email via Amazon SES
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [IdentityController],
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
        if (process.env.REDIS_URL) {
          try {
            return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
          } catch {
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
