/** SQL-unit-test fixture, not approved terms/provider evidence. Actual policy
 * absence, ACL, pinning and capacity races are tested against PostgreSQL. */
export function syntheticEntitlementQuery(sql:string,options:{storageBytes?:number;subscriptionId?:string;noSubscription?:boolean;zero?:boolean}={}){
 if(sql.includes('FROM organisations')&&sql.includes("current_setting('app.current_org'"))return {rows:[{status:'ACTIVE'}]};
 if(sql.includes('FROM subscriptions s JOIN plans p'))return {rows:options.noSubscription?[]:[{
  id:options.subscriptionId||'0192e3a0-0000-7000-8000-000000000050',status:'ACTIVE',plan_id:'0192e3a0-0000-7000-8000-000000000051',
  current_period_start:new Date(Date.now()-86400000),current_period_end:new Date(Date.now()+86400000),cancel_at:null,grace_until:null,
  limits_snapshot_json:options.zero?{maxSeats:0,maxActiveProjects:0,maxStorageBytes:0,maxPackageGenerationsPerMonth:0}:
   {maxSeats:2,maxActiveProjects:2,maxStorageBytes:options.storageBytes??1048576,maxPackageGenerationsPerMonth:2},
  price_snapshot_paise:'0',interval_snapshot:'MONTH',plan_code_snapshot:'SYNTHETIC',snapshot_version:1,row_version:1,
  plan_name:'Synthetic unit fixture',plan_status:'ACTIVE',policy_version_id:'0192e3a0-0000-7000-8000-000000000052',
 }]};
 if(sql.includes('lock_current_billing_policy'))return {rows:[{policy_version:'SYNTHETIC-NOT-APPROVAL',policy_status:'APPROVED',policy_approved_at:new Date(Date.now()-1000),policy_grace_seconds:0}]};
 return undefined;
}
