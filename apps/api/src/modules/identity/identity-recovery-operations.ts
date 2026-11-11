import { canonicalAuthenticationEmail, canonicalAuthenticationPhone } from '@tradecloseout/shared';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=new Set(['--action','--id','--user','--sha256','--case','--new-contact-type','--new-contact',
  '--attest-independent-identity','--attest-no-self-review','--attest-destination',
  '--attest-reviewed-policy','--attest-notifications-checked']);
export function identityRecoveryCommand(args:string[]):{sql:string;values:unknown[]} {
  const fields=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i];if(!allowed.has(key)||fields.has(key))throw new Error('RECOVERY_ARGUMENT_INVALID');
    if(key.startsWith('--attest-'))fields.set(key,'true');
    else{const value=args[++i];if(!value||value.startsWith('--'))throw new Error('RECOVERY_ARGUMENT_INVALID');fields.set(key,value);}
  }
  const action=fields.get('--action');
  if(action==='cancel'||action==='execute'||action==='inspect') {
    if(!uuid.test(fields.get('--id')||''))throw new Error('RECOVERY_ARGUMENT_INVALID');
    if(action==='execute' && (!fields.has('--attest-reviewed-policy')||!fields.has('--attest-notifications-checked'))) {
      throw new Error('RECOVERY_ATTESTATION_REQUIRED');
    }
    if([...fields.keys()].some(key=>!['--action','--id','--attest-reviewed-policy','--attest-notifications-checked'].includes(key)))throw new Error('RECOVERY_ARGUMENT_INVALID');
    const sql=action==='inspect'?'SELECT * FROM inspect_identity_recovery_case($1)':
      action==='cancel'?'SELECT cancel_identity_recovery_case($1)':'SELECT execute_identity_recovery_case($1)';
    return {sql,values:[fields.get('--id')]};
  }
  if(!['open','attest'].includes(action||'') ||
     !fields.has('--attest-independent-identity') || !fields.has('--attest-no-self-review') ||
     !fields.has('--attest-destination'))throw new Error('RECOVERY_ATTESTATION_REQUIRED');
  const digest=fields.get('--sha256'),ref=fields.get('--case');
  if(!/^[0-9a-f]{64}$/.test(digest||'')||!/^[A-Za-z0-9._:-]{8,128}$/.test(ref||''))throw new Error('RECOVERY_ARGUMENT_INVALID');
  if(!uuid.test(fields.get('--user')||''))throw new Error('RECOVERY_ARGUMENT_INVALID');
  const type=fields.get('--new-contact-type'),contact=fields.get('--new-contact');
  if(Boolean(type)!==Boolean(contact)|| (contact &&
      (!fields.has('--attest-destination') || !['EMAIL','PHONE'].includes(type||''))))throw new Error('RECOVERY_ATTESTATION_REQUIRED');
  const canonical=contact?(type==='EMAIL'?canonicalAuthenticationEmail(contact):canonicalAuthenticationPhone(contact)):null;
  if(contact && !canonical)throw new Error('RECOVERY_ARGUMENT_INVALID');
  if(action==='attest'){
    if(!uuid.test(fields.get('--id')||''))throw new Error('RECOVERY_ARGUMENT_INVALID');
    return {sql:'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6) AS reviewer_count',
      values:[fields.get('--id'),digest,ref,fields.get('--user'),type??null,canonical]};
  }
  if(fields.has('--id'))throw new Error('RECOVERY_ARGUMENT_INVALID');
  return {sql:'SELECT open_identity_recovery_case($1,$2,$3,$4,$5) AS case_id',values:[fields.get('--user'),digest,ref,type??null,canonical]};
}
