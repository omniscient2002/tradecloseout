import { PoolClient } from 'pg';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const CASE=/^[A-Za-z0-9._:-]{8,128}$/;
const OPTIONS=new Set([
  '--org','--version','--proof','--party','--sha256','--case',
  '--attest-independent-source','--attest-document-decision',
  '--attest-counterparty',
]);

export type ExternalDocumentReviewInput={
  org:string;version:string;proof:string;party:string;
  digest:string;caseRef:string;
};

export function parseExternalDocumentReviewArgs(args:string[]):ExternalDocumentReviewInput {
  const fields=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!OPTIONS.has(key)||fields.has(key))throw new Error('G01_DOCUMENT_REVIEW_ARGUMENT_INVALID');
    if(key.startsWith('--attest-'))fields.set(key,'true');
    else {
      const value=args[++i];
      if(!value||value.startsWith('--'))throw new Error('G01_DOCUMENT_REVIEW_ARGUMENT_INVALID');
      fields.set(key,value);
    }
  }
  for(const key of ['--attest-independent-source','--attest-document-decision','--attest-counterparty']){
    if(fields.get(key)!=='true')throw new Error('G01_DOCUMENT_REVIEW_ATTESTATION_REQUIRED');
  }
  const org=fields.get('--org')||'';
  const version=fields.get('--version')||'';
  const proof=fields.get('--proof')||'';
  const party=fields.get('--party')||'';
  const digest=fields.get('--sha256')||'';
  const caseRef=fields.get('--case')||'';
  if(!UUID.test(org)||!UUID.test(version)||!UUID.test(proof)||
     !UUID.test(party)||version===proof||!SHA.test(digest)||!CASE.test(caseRef)){
    throw new Error('G01_DOCUMENT_REVIEW_ARGUMENT_INVALID');
  }
  return {org,version,proof,party,digest,caseRef};
}

export async function executeExternalDocumentReview(
  client:Pick<PoolClient,'query'>,
  input:ExternalDocumentReviewInput,
):Promise<{reviewCount:number; independentlyVerified:boolean}> {
  const {rows:identity}=await client.query(
    `SELECT session_user::text AS login,current_user::text AS effective_login,
       r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
       pg_has_role(session_user,'tc_external_authority_reviewer','MEMBER') AS eligible
       FROM pg_roles r WHERE r.rolname=session_user`,
  );
  const actor=identity[0];
  if(!actor||!actor.eligible||actor.login!==actor.effective_login||
     actor.rolsuper||actor.rolbypassrls||actor.rolcreaterole||actor.rolcreatedb){
    throw new Error('G01_DOCUMENT_REVIEWER_ROLE_DENIED');
  }
  const {rows}=await client.query(
    'SELECT review_count,independently_verified FROM attest_external_document_approval($1,$2,$3,$4,$5,$6)',
    [input.org,input.version,input.proof,input.party,input.digest,input.caseRef],
  );
  if(rows.length!==1||![1,2].includes(Number(rows[0].review_count))){
    throw new Error('G01_DOCUMENT_REVIEW_RESULT_INVALID');
  }
  return {
    reviewCount:Number(rows[0].review_count),
    independentlyVerified:rows[0].independently_verified===true,
  };
}
