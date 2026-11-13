import {resolveEffectiveEntitlements} from './entitlements';
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
  const effective=await resolveEffectiveEntitlements(client,orgId,{operation:'ORG_TEAM'});
  if(!effective.canConsume)return 'SEAT_ENTITLEMENT_UNAVAILABLE';
  const cap=BigInt(effective.limits.maxSeats);
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
