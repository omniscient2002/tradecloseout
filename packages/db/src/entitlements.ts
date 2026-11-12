import type { PoolClient } from 'pg';

export const PLAN_LIMIT_KEYS = ['maxActiveProjects', 'maxSeats', 'maxStorageBytes', 'maxPackageGenerationsPerMonth'] as const;
export type PlanLimits = Record<typeof PLAN_LIMIT_KEYS[number], number>;
export const ZERO_PLAN_LIMITS: PlanLimits = Object.freeze({maxActiveProjects:0,maxSeats:0,maxStorageBytes:0,maxPackageGenerationsPerMonth:0});

export class PlanEntitlementError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/** No coercion, implicit defaults, unlimited sentinels or unsafe JSON integers. */
export function parsePlanLimits(value: unknown): PlanLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new PlanEntitlementError('PLAN_CONFIGURATION_INVALID');
  const v=value as Record<string,unknown>;
  if (Object.keys(v).some(k=>!PLAN_LIMIT_KEYS.includes(k as typeof PLAN_LIMIT_KEYS[number])) ||
      PLAN_LIMIT_KEYS.some(k=>!Object.prototype.hasOwnProperty.call(v,k)||typeof v[k]!=='number' || !Number.isSafeInteger(v[k]) || (v[k] as number)<0)) {
    throw new PlanEntitlementError('PLAN_CONFIGURATION_INVALID');
  }
  return Object.fromEntries(PLAN_LIMIT_KEYS.map(k=>[k,v[k]])) as PlanLimits;
}

export type EntitlementRecord = {
  org_status:string; id:string|null; status:string|null; plan_id:string|null;
  plan_status?:string|null; policy_version?:string|null; policy_status?:string|null;
  policy_approved_at?:Date|string|null; policy_grace_seconds?:number|null;
  current_period_start:Date|string|null; current_period_end:Date|string|null;
  cancel_at:Date|string|null; grace_until:Date|string|null;
  limits_snapshot_json:unknown; price_snapshot_paise:string|null;
  interval_snapshot:string|null; plan_code_snapshot:string|null;
  plan_name:string|null; snapshot_version:number|null; row_version:number|null;
};

/** PAST_DUE never creates grace implicitly. Reads remain available at zero allowance. */
export function evaluateEntitlements(row: EntitlementRecord, now:Date=new Date()) {
  let reason='ACTIVE'; let limits:PlanLimits={...ZERO_PLAN_LIMITS};
  const start=row.current_period_start?new Date(row.current_period_start).getTime():NaN;
  const end=row.current_period_end?new Date(row.current_period_end).getTime():NaN;
  const cancel=row.cancel_at?new Date(row.cancel_at).getTime():Infinity;
  const grace=row.grace_until?new Date(row.grace_until).getTime():NaN;
  if(row.org_status!=='ACTIVE')reason='ORGANISATION_INACTIVE';
  else if(!row.id)reason='NO_SUBSCRIPTION';
  else if(row.plan_status!=='ACTIVE')reason='PLAN_INACTIVE';
  else if(!row.policy_version||row.policy_status!=='APPROVED'||!row.policy_approved_at||!Number.isFinite(new Date(row.policy_approved_at).getTime())||new Date(row.policy_approved_at).getTime()>now.getTime())reason='BILLING_POLICY_UNAPPROVED';
  else if(row.interval_snapshot==='ONE_TIME_PROJECT')reason='PROJECT_OFFER_SCOPE_NOT_CONFIGURED';
  else if(!['MONTH','YEAR','MONTHLY','ANNUAL'].includes(row.interval_snapshot||''))reason='PLAN_CONFIGURATION_INVALID';
  else if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)reason='PERIOD_INVALID';
  else if(start>now.getTime())reason='PERIOD_NOT_STARTED';
  else if(cancel<=now.getTime())reason='CANCELLED';
  else if(['TRIAL','ACTIVE'].includes(row.status||'')&&end>now.getTime())reason=row.status!;
  else if(row.status==='PAST_DUE'&&Number.isSafeInteger(row.policy_grace_seconds)&&Number(row.policy_grace_seconds)>0&&Number.isFinite(grace)&&grace>now.getTime()&&grace>=end&&grace<=end+Number(row.policy_grace_seconds)*1000)reason='PAST_DUE_GRACE';
  else reason=['CANCELLED','SUSPENDED','PAST_DUE'].includes(row.status||'')?row.status!:'EXPIRED';
  let configurationValid=true;
  try {const parsed=parsePlanLimits(row.limits_snapshot_json);if(['TRIAL','ACTIVE','PAST_DUE_GRACE'].includes(reason))limits=parsed;}
  catch {configurationValid=false;if(row.id)reason='PLAN_CONFIGURATION_INVALID';}
  return {subscriptionId:row.id,planId:row.plan_id,planName:row.plan_name,planCode:row.plan_code_snapshot,
    subscriptionStatus:row.status,effectiveState:reason,canConsume:['TRIAL','ACTIVE','PAST_DUE_GRACE'].includes(reason),
    limits,configurationValid,policySchemaVersion:1,policyVersion:row.policy_version||null,snapshotVersion:row.snapshot_version,
    pricePaise:row.price_snapshot_paise,interval:row.interval_snapshot,currentPeriodStart:row.current_period_start,
    currentPeriodEnd:row.current_period_end,graceUntil:row.grace_until,cancelAt:row.cancel_at,rowVersion:row.row_version};
}

export async function resolveEffectiveEntitlements(client:PoolClient,orgId:string){
  const {rows:org}=await client.query<{status:string}>(`SELECT status FROM organisations
    WHERE id=$1 AND id=current_setting('app.current_org',true)::uuid`,[orgId]);
  if(!org.length)throw new PlanEntitlementError('PLAN_ORGANISATION_NOT_FOUND');
  const {rows}=await client.query<EntitlementRecord & {policy_version_id:string|null}>(
    `SELECT s.id,s.status,s.plan_id,s.current_period_start,s.current_period_end,s.cancel_at,s.grace_until,
      s.limits_snapshot_json,s.price_snapshot_paise::text,s.interval_snapshot,s.plan_code_snapshot,
      s.snapshot_version,s.row_version,s.policy_version_id,p.name AS plan_name,p.status AS plan_status
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id
     WHERE s.org_id=$1 FOR SHARE OF s,p`,[orgId]);
  const base:EntitlementRecord=rows[0]||{org_status:org[0].status,id:null,status:null,plan_id:null,
    current_period_start:null,current_period_end:null,cancel_at:null,grace_until:null,
    limits_snapshot_json:null,price_snapshot_paise:null,interval_snapshot:null,plan_code_snapshot:null,
    plan_name:null,snapshot_version:null,row_version:null};
  base.org_status=org[0].status;
  if(rows[0]?.policy_version_id){
    const {rows:policy}=await client.query('SELECT * FROM lock_current_billing_policy($1::uuid)',[rows[0].policy_version_id]);
    Object.assign(base,policy[0]||{});
  }
  return evaluateEntitlements(base);
}

export async function currentCapacityUsage(client:PoolClient,orgId:string){
  const {rows}=await client.query<{seats:string;projects:string;storage_bytes:string;reserved_storage_bytes:string}>(`SELECT
    (SELECT count(*) FROM memberships WHERE org_id=$1 AND status='ACTIVE')::text AS seats,
    (SELECT count(*) FROM projects WHERE org_id=$1 AND status IN ('ACTIVE','HANDOVER','SUSPENDED') AND purged_at IS NULL)::text AS projects,
    (SELECT COALESCE(sum(so.size_bytes),0) FROM storage_objects so
      WHERE so.org_id=$1 AND so.status IN ('PENDING','PROCESSING','READY')
        AND (NOT EXISTS(SELECT 1 FROM document_versions dv WHERE dv.org_id=so.org_id AND dv.object_id=so.id)
          OR EXISTS(SELECT 1 FROM document_versions dv JOIN documents d ON d.org_id=dv.org_id AND d.id=dv.document_id
            WHERE dv.org_id=so.org_id AND dv.object_id=so.id AND d.deleted_at IS NULL)))::text AS storage_bytes,
    (SELECT COALESCE(sum(size_bytes),0) FROM storage_objects WHERE org_id=$1 AND status IN ('PENDING','PROCESSING'))::text AS reserved_storage_bytes`,[orgId]);
  return rows[0];
}

