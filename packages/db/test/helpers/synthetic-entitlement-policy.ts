import type {Pool} from 'pg';
import {randomUUID} from 'crypto';
/** Mechanism fixture only. These rows are NOT independent business approval,
 * real contractual terms, provider acceptance or a production entitlement. */
export async function attachSyntheticEntitlementPolicy(admin:Pool,planId:string):Promise<string>{
 const id=randomUUID();
 await admin.query(`INSERT INTO billing_policy_versions(id,version,schema_version,status,grace_seconds,
   created_by_identity,reviewer_identity,approved_at,evidence_ref)
  VALUES($1,$2,1,'APPROVED',0,'SYNTHETIC AUTHOR — NOT REAL APPROVAL','SYNTHETIC REVIEWER — NOT REAL APPROVAL',
   now(),'https://example.invalid/synthetic-policy-fixture')`,[id,'synthetic-mechanics-'+id]);
 await admin.query('UPDATE plans SET policy_version_id=$1 WHERE id=$2',[id,planId]);return id;
}
