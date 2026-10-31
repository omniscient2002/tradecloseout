// apps/api/src/database/tenant-db.service.ts
// Spike 1 & RT-005: Forced RLS Transaction Context Wrapper (CB-007)

import { Injectable, ForbiddenException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export interface ExecutionContext {
  orgId: string;
  userId: string;
  actorType: 'USER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  requestId: string;
}

@Injectable()
export class TenantDbService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'tradecloseout',
      user: process.env.DB_USER || 'tc_app',
      password: process.env.DB_PASSWORD || 'app_local_pw',
      max: 20,
    });
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
    try {
      await client.query('BEGIN');
      // Set transaction-local configuration parameters (is_local = true)
      await client.query("SELECT set_config('app.current_org', $1, true)", [ctx.orgId]);
      await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userId]);
      await client.query("SELECT set_config('app.actor_type', $1, true)", [ctx.actorType]);

      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_token_hash', $1, true)", [tokenHash]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
