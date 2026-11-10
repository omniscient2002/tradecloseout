import type { PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Za-z0-9._:-]{8,128}$/;

export type ExternalRevocation =
  | { kind:'guest';org:string;grant:string;reason:string }
  | { kind:'document';org:string;version:string;proof:string;party:string;reason:string };

export function parseExternalRevocationArgs(args:string[]):ExternalRevocation{
  const fields=new Map<string,string>();
  const allowed=new Set(['--kind','--org','--grant','--version','--proof','--party','--reason',
    '--attest-incident-verified']);
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!allowed.has(key)||fields.has(key))throw new Error('G01_REVOKE_ARGUMENT_INVALID');
    if(key==='--attest-incident-verified')fields.set(key,'true');
    else{
      const value=args[++i];
      if(!value||value.startsWith('--'))throw new Error('G01_REVOKE_ARGUMENT_INVALID');
      fields.set(key,value);
    }
  }
  if(fields.get('--attest-incident-verified')!=='true'){
    throw new Error('G01_REVOKE_ATTESTATION_REQUIRED');
  }
  const kind=fields.get('--kind');
  const org=fields.get('--org')||'';
  const reason=fields.get('--reason')||'';
  if(!UUID.test(org)||!REFERENCE.test(reason)){
    throw new Error('G01_REVOKE_ARGUMENT_INVALID');
  }
  if(kind==='guest'){
    const grant=fields.get('--grant')||'';
    if(!UUID.test(grant)||fields.has('--version')||fields.has('--proof')||fields.has('--party')){
      throw new Error('G01_REVOKE_ARGUMENT_INVALID');
    }
    return {kind,org,grant,reason};
  }
  if(kind==='document'){
    const version=fields.get('--version')||'';
    const proof=fields.get('--proof')||'';
    const party=fields.get('--party')||'';
    if(!UUID.test(version)||!UUID.test(proof)||!UUID.test(party)||
      version===proof||fields.has('--grant')){
      throw new Error('G01_REVOKE_ARGUMENT_INVALID');
    }
    return {kind,org,version,proof,party,reason};
  }
  throw new Error('G01_REVOKE_ARGUMENT_INVALID');
}

/** Never infer reviewer identity from HTTP data, CLI input, or local OS user. */
export async function executeExternalRevocation(
  client:Pick<PoolClient,'query'>,
  command:ExternalRevocation,
):Promise<void>{
  const {rows:identities}=await client.query(
    `SELECT session_user::text AS login,current_user::text AS effective_login,
       r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
       pg_has_role(session_user,'tc_external_authority_reviewer','MEMBER') AS eligible
       FROM pg_roles r WHERE r.rolname=session_user`,
  );
  const actor=identities[0];
  if(!actor||!actor.eligible||actor.login!==actor.effective_login||
     actor.rolsuper||actor.rolbypassrls||actor.rolcreaterole||actor.rolcreatedb){
    throw new Error('G01_REVOKER_ROLE_DENIED');
  }
  if(command.kind==='guest'){
    const {rows}=await client.query(
      'SELECT revoke_independent_external_guest_grant($1,$2,$3) AS revoked',
      [command.org,command.grant,command.reason],
    );
    if(rows.length!==1||rows[0].revoked!==true){
      throw new Error('G01_REVOKE_RESULT_INVALID');
    }
  }else{
    const {rows}=await client.query(
      'SELECT revoke_external_document_approval($1,$2,$3,$4,$5) AS revoked',
      [command.org,command.version,command.proof,command.party,command.reason],
    );
    if(rows.length!==1||rows[0].revoked!==true){
      throw new Error('G01_REVOKE_RESULT_INVALID');
    }
  }
}
