// apps/api/src/database/tenant-db.service.ts
// Spike 1 & RT-005: Forced RLS Transaction Context Wrapper (CB-007)

import { Injectable, Optional, ForbiddenException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export interface ExecutionContext {
  orgId: string;
  userId: string;
  actorType: 'USER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  requestId: string;
  orgRole?: string;
  projectRole?: string;
  guestGrantId?: string;
  guestScope?: Record<string, unknown>;
  guestCapabilities?: string[];
}

@Injectable()
export class TenantDbService {
  private pool: Pool;

  constructor(@Optional() existingPool?: any) {
    if (existingPool) {
      this.pool = existingPool;
    } else if (process.env.APP_DATABASE_URL) {
      this.pool = new Pool({
        connectionString: process.env.APP_DATABASE_URL,
        max: 20,
      });
    } else {
      this.pool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'tradecloseout',
        user: process.env.DB_USER || 'tc_app',
        password: process.env.DB_PASSWORD || 'app_local_pw',
        max: 20,
      });
    }
  }

  getPool(): Pool {
    return this.pool;
  }

  /**
   * Executes database operations strictly within transaction-local RLS tenant context.
   * Settings app.current_org, app.current_user, app.actor_type are cleared on COMMIT/ROLLBACK.
   */
  async withTenantContext<T>(
    ctx: ExecutionContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!ctx.orgId) {
      throw new ForbiddenException('Missing active organisation context for tenant transaction');
    }

    const client = await this.pool.connect();
    let began = false;
    let commitAttempted = false;
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      // Set transaction-local configuration parameters (is_local = true)
      await client.query("SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)", [ctx.orgId]);
      await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userId]);
      await client.query("SELECT set_config('app.actor_type', $1, true)", [ctx.actorType]);

      const result = await fn(client);
      // COMMIT can succeed even when its acknowledgement is lost.
      commitAttempted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discardConnection = !began || commitAttempted;
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Never mask the original error or reuse an uncertain tenant connection.
          discardConnection = true;
        }
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }

  /**
   * Executes database operations in user-scoped context (for memberships lookup across orgs, CB-007).
   */
  async withUserContext<T>(
    userId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let began = false;
    let commitAttempted = false;
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
      const result = await fn(client);
      // COMMIT can succeed even when its acknowledgement is lost.
      commitAttempted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discardConnection = !began || commitAttempted;
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Never mask the original error or reuse an uncertain tenant connection.
          discardConnection = true;
        }
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }

  /**
   * Executes database operations in token-scoped context (for guest grant token verification, CB-007).
   */
  async withTokenContext<T>(
    tokenHash: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let began = false;
    let commitAttempted = false;
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      await client.query("SELECT set_config('app.current_token_hash', $1, true)", [tokenHash]);
      const result = await fn(client);
      // COMMIT can succeed even when its acknowledgement is lost.
      commitAttempted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discardConnection = !began || commitAttempted;
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Never mask the original error or reuse an uncertain tenant connection.
          discardConnection = true;
        }
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }

  /**
   * Executes queries for global (non-tenant) tables or system operations.
   */
  async queryGlobal<T>(
    sql: string,
    params: any[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }
}
