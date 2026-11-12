import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';

/**
 * PH2-G18-002. Must run in the *same active transaction* as a new ACTIVE
 * membership. The caller has already bound app.current_org/current_user.
 *
 * Only the database is authoritative. The SEATS counter is a serialization
 * mutex and repairable cache of the live ACTIVE membership count, not a second
 * source of entitlement truth. Existing members do not consume a second seat.
 */
export async function reserveActiveSeatForMembership(
  client: PoolClient, orgId: string,
): Promise<'RESERVED' | 'SEAT_ENTITLEMENT_UNAVAILABLE' | 'SEAT_LIMIT_EXCEEDED'> {
  const { rows: plans } = await client.query(
    `SELECT p.limits_json ->> 'maxSeats' AS seat_limit
       FROM subscriptions s
       JOIN plans p ON p.id=s.plan_id
      WHERE s.org_id=$1 AND s.status IN ('TRIAL','ACTIVE')
        AND s.current_period_start<=now() AND s.current_period_end>now()
        AND (s.cancel_at IS NULL OR s.cancel_at>now())
        AND p.status='ACTIVE'
      FOR SHARE OF s,p`,
    [orgId],
  );
  const ceiling = plans[0]?.seat_limit;
  if (plans.length!==1 || typeof ceiling!=='string' || !/^\d+$/.test(ceiling) ||
      BigInt(ceiling)>9223372036854775807n) {
    return 'SEAT_ENTITLEMENT_UNAVAILABLE';
  }
  const cap=BigInt(ceiling);
  await client.query(
    `INSERT INTO usage_counters(id,org_id,metric,period,value)
     VALUES($1,$2,'SEATS','ALL_TIME',0)
     ON CONFLICT(org_id,metric,period) DO NOTHING`,
    [uuidv7(),orgId],
  );
  await client.query(
    `SELECT value FROM usage_counters
       WHERE org_id=$1 AND metric='SEATS' AND period='ALL_TIME' FOR UPDATE`,[orgId],
  );
  const { rows: actual }=await client.query(
    `SELECT COUNT(*)::text AS seats FROM memberships
      WHERE org_id=$1 AND status='ACTIVE'`,[orgId],
  );
  const proposed=BigInt(actual[0]?.seats ?? '0')+1n;
  if (proposed>cap) return 'SEAT_LIMIT_EXCEEDED';
  await client.query(
    `UPDATE usage_counters SET value=$2::bigint,updated_at=now()
      WHERE org_id=$1 AND metric='SEATS' AND period='ALL_TIME'`,
    [orgId,proposed.toString()],
  );
  return 'RESERVED';
}
