import { Pool } from 'pg';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { dispatchDueNotifications } from './notification-dispatch';
import { isIndiaQuietHour } from '@tradecloseout/shared';
import { AuthDeliveryLedger } from '@tradecloseout/db';

export class TradeCloseoutScheduler {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  async reconcileAuthenticationDeliveries():Promise<void> {
    await this.runWithLeaderLock('g01-delivery-receipts',90,async()=>{
      const ledger=new AuthDeliveryLedger(this.pool);
      await ledger.reconcileDue(20);
      await ledger.sendRecoveryNotices();
    });
  }

  /**
   * Acquires a distributed Redis leader lock before executing any scheduled job (15 §2, TC2-026).
   * Uses unique owner token and atomic compare-and-delete via Lua to prevent lock stealing.
   */
  async runWithLeaderLock(lockKey: string, ttlSeconds: number, fn: () => Promise<void>) {
    const fullKey = `lock:sched:${lockKey}`;
    const ownerToken = uuidv7();
    const acquired = await this.redis.set(fullKey, ownerToken, 'EX', ttlSeconds, 'NX');
    if (!acquired) return;
    try {
      await fn();
    } finally {
      const releaseLua = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.eval(releaseLua, 1, fullKey, ownerToken);
      } catch (err) {
        console.error(`[Scheduler Lock Release Error] Key ${fullKey}:`, err);
      }
    }
  }

  /** Suppresses duplicate schedule slots after successful completion; jobs remain safe to repeat after Redis loss. */
  async runWithPeriodLock(
    lockKey: string,
    completedKey: string,
    lockTtlSeconds: number,
    completedTtlSeconds: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (await this.redis.exists(completedKey)) return;
    const fullKey = `lock:sched:${lockKey}`;
    const ownerToken = uuidv7();
    const acquired = await this.redis.set(fullKey, ownerToken, 'EX', lockTtlSeconds, 'NX');
    if (!acquired) return;
    try {
      if (await this.redis.exists(completedKey)) return;
      await fn();
      // PH1-G24-001: an expired/replaced lease must NEVER be allowed to
      // manufacture a durable period-complete receipt. Check owner and write
      // the completion marker atomically, before releasing the lease.
      const commitLua = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          redis.call("set", KEYS[2], "1", "EX", ARGV[2])
          redis.call("del", KEYS[1])
          return 1
        end
        return 0
      `;
      const committed = await this.redis.eval(
        commitLua, 2, fullKey, completedKey, ownerToken, String(completedTtlSeconds),
      );
      if (committed !== 1) throw new Error('SCHEDULER_LEASE_LOST');
    } finally {
      const releaseLua = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.eval(releaseLua, 1, fullKey, ownerToken);
      } catch (err) {
        console.error(`[Scheduler Lock Release Error] Key ${fullKey}:`, err);
      }
    }
  }

  /** Returns the current India-local schedule period without relying on host timezone. */
  getIndiaSchedulePeriods(now = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now).map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const localUtcDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    const weekday = (localUtcDate.getUTCDay() + 6) % 7;
    localUtcDate.setUTCDate(localUtcDate.getUTCDate() - weekday + 3);
    const isoYear = localUtcDate.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
    const week = 1 + Math.round((localUtcDate.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return {
      day,
      hour: Number(parts.hour),
      weekday: parts.weekday,
      week: `${isoYear}-W${String(week).padStart(2, '0')}`,
      hourSlot: `${day}-${parts.hour}`,
    };
  }

  /**
   * G01: Hourly bounded authentication-ephemeral cleanup. Preserve auth
   * security events for the configured retention period and never remove
   * unexpired OTPs or live sessions.
   */
  async cleanupAuthenticationEphemera(): Promise<{ budgets: number; challenges: number; sessions: number }> {
    const [{ rowCount: budgets }, { rowCount: challenges }, { rowCount: sessions }] = await Promise.all([
      this.pool.query(
        `DELETE FROM auth_request_budgets
          WHERE ctid IN (
            SELECT ctid FROM auth_request_budgets
            WHERE expires_at < now() - interval '1 day'
            LIMIT 2000
          )`,
      ),
      this.pool.query(
        `DELETE FROM otp_challenges
          WHERE ctid IN (
            SELECT ctid FROM otp_challenges
            WHERE expires_at < now() - interval '30 days'
              AND (consumed_at IS NOT NULL OR expires_at < now())
            LIMIT 2000
          )`,
      ),
      this.pool.query(
        `DELETE FROM sessions
          WHERE ctid IN (
            SELECT ctid FROM sessions
            WHERE (revoked_at < now() - interval '365 days'
               OR absolute_expires_at < now() - interval '365 days')
            LIMIT 2000
          )`,
      ),
    ]);
    return { budgets: budgets || 0, challenges: challenges || 0, sessions: sessions || 0 };
  }

  /**
   * G01-020: stale invitation delivery records remain nonredeemable until
   * explicitly reclaimed, and completed invitation tokens cannot survive
   * their expiry. Bounded tenant-RLS updates are safe across worker replicas.
   * This never promotes a delivery to a usable invitation.
   */
  async cleanupStaleInvitations(): Promise<{staleDelivery:number; expired:number}> {
    const {rows:orgs}=await this.pool.query(
      `SELECT id FROM organisations WHERE status='ACTIVE'`,
    );
    let staleDelivery=0,expired=0;
    for(const org of orgs){
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",
          [org.id],
        );
        const {rowCount:stale}=await client.query(
          `UPDATE invitations SET status='REVOKED'
             WHERE id IN (
               SELECT id FROM invitations
                WHERE org_id=$1 AND status='DELIVERY_PENDING'
                  AND created_at<now()-interval '15 minutes'
                ORDER BY created_at LIMIT 250 FOR UPDATE SKIP LOCKED
             )`,
          [org.id],
        );
        const {rowCount:outdated}=await client.query(
          `UPDATE invitations SET status='EXPIRED'
             WHERE id IN (
               SELECT id FROM invitations
                WHERE org_id=$1 AND status IN ('DELIVERY_PENDING','PENDING')
                  AND expires_at<=now()
                ORDER BY expires_at LIMIT 250 FOR UPDATE SKIP LOCKED
             )`,
          [org.id],
        );
        staleDelivery+=stale||0;
        expired+=outdated||0;
        await client.query('COMMIT');
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    }
    return {staleDelivery,expired};
  }

  /**
   * WF-22 (RT-009, RT-024): Daily Document & Warranty Validity Job
   * Transitions APPROVED and HANDED_OVER requirements whose approved evidence has expired
   * in Asia/Kolkata time to EXPIRED.
   */
  async runDailyExpiryJob(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const { rows: orgs } = await client.query(
        `SELECT id FROM organisations WHERE status = 'ACTIVE'`,
      );
      let totalExpired = 0;

      for (const org of orgs) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
          [org.id],
        );

        const { rowCount } = await client.query(
          `UPDATE requirements r
              SET status = 'EXPIRED',
                  row_version = r.row_version + 1,
                  updated_at = now()
             FROM document_requirements dr
             JOIN documents d
               ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
             JOIN document_versions dv
               ON dv.org_id = d.org_id AND dv.project_id = d.project_id
              AND dv.id = d.current_approved_version_id
            WHERE r.org_id = $1
              AND dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
              AND r.status IN ('APPROVED', 'HANDED_OVER')
              AND dv.expiry_date IS NOT NULL
              AND dv.expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date`,
          [org.id],
        );

        totalExpired += rowCount ?? 0;
        await client.query('COMMIT');
      }
      return totalExpired;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * BR-GTM-07 & RT-029: Weekly Owner Digest Summarising Missing Docs, Expiring Items,
   * and Exact Contract Retention Rupee Value at Risk.
   * Respects FR-NOT-013 (requirement titles truncated to 60 chars, zero internal notes in body).
   */
  async runWeeklyOwnerRetentionAtRiskDigest(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // PH1-G24-002: membership is tenant-RLS-protected. Cross-tenant
      // ownership discovery with no app.current_org silently returned zero.
      // Global organisations is the reviewed discovery surface only.
      const { rows: activeOrgs } = await client.query(
        `SELECT id AS org_id, display_name FROM organisations
          WHERE status='ACTIVE' ORDER BY id`,
      );

      const weekKey = this.getIndiaSchedulePeriods().week;
      let tenantFailures = 0;
      for (const org of activeOrgs) {
        try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
          [org.org_id],
        );
        const { rows: owners } = await client.query(
          `SELECT m.user_id FROM memberships m
            JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
            WHERE m.org_id=$1 AND m.role='R-OWNER' AND m.status='ACTIVE'
            ORDER BY m.user_id`,
          [org.org_id],
        );
        // Do not silently accept missing owners or pick an arbitrary owner
        // when the exactly-one-eligible-owner invariant is violated.
        if (owners.length !== 1) throw new Error('OWNER_DIGEST_OWNER_INVARIANT');
        const ownerUserId: string = owners[0].user_id;

        // Calculate missing/expired counts and retention money gated per active project (RT-029)
        const { rows: projectRisks } = await client.query(
          `SELECT p.id AS project_id,
                  p.code AS project_code,
                  p.name AS project_name,
                  COALESCE(c.retention_at_risk_paise, 0)::bigint AS retention_at_risk_paise,
                  COALESCE(r.missing_or_expired_count, 0)::int AS missing_or_expired_count
             FROM projects p
             LEFT JOIN LATERAL (
               SELECT SUM(value_paise * retention_bps / 10000) AS retention_at_risk_paise
                 FROM contracts
                WHERE org_id = p.org_id AND project_id = p.id AND status = 'ACTIVE'
             ) c ON true
             LEFT JOIN LATERAL (
               SELECT COUNT(*) AS missing_or_expired_count
                 FROM requirements
                WHERE org_id = p.org_id AND project_id = p.id AND superseded_at IS NULL
                  AND (status = 'EXPIRED' OR (due_at IS NOT NULL AND due_at < now()
                       AND status NOT IN ('APPROVED','WAIVED','NOT_APPLICABLE','HANDED_OVER')))
             ) r ON true
            WHERE p.org_id = $1 AND p.status IN ('ACTIVE', 'HANDOVER')
            `,
          [org.org_id],
        );

        await client.query(
          `INSERT INTO notifications
            (id, org_id, recipient_user_id, channel, event_key, payload_json, status, dedup_key)
           VALUES ($1, $2, $3, 'EMAIL', 'WEEKLY_OWNER_DIGEST', $4, 'QUEUED', $5)
           ON CONFLICT (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id))
           DO NOTHING`,
          [
            uuidv7(),
            org.org_id,
            ownerUserId,
            JSON.stringify({
              orgDisplayName: org.display_name,
              // PH2-G20-001: external email digest contains no financial totals,
              // project names or raw requirements. Detailed commercial data
              // stays behind the authenticated owner dashboard.
              projects: projectRisks.map((pr) => ({
                projectCode: pr.project_code,
                missingOrExpiredCount: pr.missing_or_expired_count,
              })),
            }),
            `weekly-owner-digest:${weekKey}`,
          ],
        );

        await client.query('COMMIT');
        } catch {
          await client.query('ROLLBACK').catch(() => {});
          tenantFailures += 1;
          // No recipient identity, provider detail, SQL or tenant metadata.
          console.error('OWNER_DIGEST_TENANT_FAILED');
        }
      }
      if (tenantFailures) throw new Error('OWNER_DIGEST_INCOMPLETE');
    } finally {
      client.release();
    }
  }

  /**
   * 08 §5.6 & AUD-S-29: Cryptographic Audit Hash-Chain Integrity Verifier
   * Validates that the tamper-evident hash chain (prev_hash -> hash) is contiguous
   * and unbroken across all organisations.
   */
  async verifyAuditHashChainIntegrity(): Promise<{ orgCount: number; verifiedEvents: number }> {
    const client = await this.pool.connect();
    try {
      const { rows: orgs } = await client.query(`SELECT id FROM organisations`);
      let verifiedEvents = 0;

      for (const org of orgs) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
          [org.id],
        );

        const { rows: events } = await client.query(
          `SELECT id, chain_seq, prev_hash, hash,
                  encode(digest(prev_hash || '||' || jsonb_build_object(
                    'id', id,
                    'org_id', org_id,
                    'project_id', project_id,
                    'actor_type', actor_type,
                    'actor_user_id', actor_user_id,
                    'action', action,
                    'entity_type', entity_type,
                    'entity_id', entity_id,
                    'before_json', before_json,
                    'after_json', after_json,
                    'request_id', request_id,
                    'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                  )::text, 'sha256'), 'hex') AS computed_hash
             FROM audit_events
            WHERE org_id = $1
            ORDER BY chain_seq ASC, id ASC`,
          [org.id],
        );

        // PH1-G27-002: verify genesis as well as every link and never skip
        // a NULL computed digest. Sequence must advance strictly even where
        // an attacker attempted to insert a duplicate or forged ordering key.
        let prevHash = 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
        let prevSeq = -1n;
        for (const ev of events) {
          const seq = BigInt(ev.chain_seq);
          if (seq <= prevSeq) throw new Error('AUDIT_CHAIN_ORDER_INVALID');
          if (ev.prev_hash !== prevHash) throw new Error('AUDIT_HASH_CHAIN_CORRUPT');
          if (typeof ev.hash !== 'string' || !/^[a-f0-9]{64}$/.test(ev.hash) ||
              ev.hash !== ev.computed_hash) {
            throw new Error('AUDIT_CONTENT_TAMPERED');
          }
          prevSeq = seq;
          prevHash = ev.hash;
          verifiedEvents++;
        }

        await client.query('COMMIT');
      }
      return { orgCount: orgs.length, verifiedEvents };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Maintained for backward compatibility; executes verifyAuditHashChainIntegrity.
   */
  async computeAuditHashChainBatch(): Promise<number> {
    const res = await this.verifyAuditHashChainIntegrity();
    return res.verifiedEvents;
  }

  /**
   * Top 25 Item 25: Storage & Temporary Artifacts Lifecycle Cleanup
   * Safely purges abandoned upload intents (file_status = 'PENDING_UPLOAD' older than 24h)
   * and unattached storage objects in status 'PENDING' older than 24h, preventing storage quota leaks
   * without ever modifying or deleting verified original evidence objects.
   */
  async runStorageLifecycleCleanup(): Promise<{ purgedPendingVersions: number; purgedPendingObjects: number }> {
    const client = await this.pool.connect();
    try {
      const { rows: orgs } = await client.query(`SELECT id FROM organisations WHERE status = 'ACTIVE'`);
      let purgedPendingVersions = 0;
      let purgedPendingObjects = 0;

      for (const org of orgs) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
          [org.id],
        );

        // 1. Purge stale uncompleted upload intents older than 24 hours
        const { rowCount: vCount } = await client.query(
          `DELETE FROM document_versions
           WHERE org_id = $1
             AND file_status = 'PENDING_UPLOAD'
             AND created_at < now() - interval '24 hours'`,
          [org.id],
        );
        purgedPendingVersions += vCount ?? 0;

        // 2. Purge unattached storage objects in PENDING status older than 24 hours
        const { rowCount: oCount } = await client.query(
          `DELETE FROM storage_objects so
           WHERE so.org_id = $1
             AND so.status = 'PENDING'
             AND so.created_at < now() - interval '24 hours'
             AND NOT EXISTS (
               SELECT 1 FROM document_versions dv WHERE dv.object_id = so.id
             )`,
          [org.id],
        );
        purgedPendingObjects += oCount ?? 0;

        await client.query('COMMIT');
      }

      return { purgedPendingVersions, purgedPendingObjects };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Purges expired completed receipts only. Unresolved claims require outcome
   * reconciliation; age alone cannot prove that their commands did not commit.
   */
  async reconcileIdempotencyClaims(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const { rows: orgs } = await client.query(`SELECT id FROM organisations WHERE status = 'ACTIVE'`);
      let reconciled = 0;

      for (const org of orgs) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
          [org.id],
        );

        const { rowCount } = await client.query(
          `DELETE FROM idempotency_keys
            WHERE org_id = $1
              AND expires_at <= now() AND response_status <> 0`,
          [org.id],
        );
        reconciled += rowCount ?? 0;
        await client.query('COMMIT');
      }
      return reconciled;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Claim/ack outside network I/O; quiet hours are applied before claiming. */
  async dispatchQueuedNotifications(): Promise<number> {
    const result=await dispatchDueNotifications(this.pool,isIndiaQuietHour());
    if (result.failed) console.error('NOTIFICATION_DELIVERY_RETRY_OR_FAILURE', { count:result.failed });
    return result.accepted;
  }

}
