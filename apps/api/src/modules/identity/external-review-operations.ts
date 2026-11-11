import { readFileSync } from 'node:fs';
import { Pool, PoolConfig } from 'pg';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CASE = /^[A-Za-z0-9._:-]{8,128}$/;
const OPTIONS = new Set([
  '--org', '--grant', '--sha256', '--case', '--attest-independent-source',
  '--attest-legal-delegation', '--attest-destination',
]);

export type IndependentReviewInput = {
  org: string;
  grant: string;
  digest: string;
  caseRef: string;
};

export function parseIndependentReviewArgs(args: string[]): IndependentReviewInput {
  const fields = new Map<string,string>();
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (!OPTIONS.has(key) || fields.has(key)) throw new Error('G01_REVIEW_ARGUMENT_INVALID');
    if (key.startsWith('--attest-')) {
      fields.set(key, 'true');
    } else {
      const value=args[++i];
      if (!value || value.startsWith('--')) throw new Error('G01_REVIEW_ARGUMENT_INVALID');
      fields.set(key, value);
    }
  }
  for (const flag of ['--attest-independent-source','--attest-legal-delegation','--attest-destination']) {
    if (fields.get(flag)!=='true') throw new Error('G01_REVIEW_ATTESTATION_REQUIRED');
  }
  const org=fields.get('--org') || '';
  const grant=fields.get('--grant') || '';
  const digest=fields.get('--sha256') || '';
  const caseRef=fields.get('--case') || '';
  if (!UUID.test(org) || !UUID.test(grant) || !DIGEST.test(digest) || !CASE.test(caseRef)) {
    throw new Error('G01_REVIEW_ARGUMENT_INVALID');
  }
  return {org,grant,digest,caseRef};
}

/**
 * No application runtime or migrator URL may ever be reused for approvals.
 * Explicit TLS certificate verification prevents impersonation of the
 * restricted PostgreSQL reviewer endpoint. Credential URLs are never logged.
 */
export function reviewerConnectionConfig(
  rawUrl: string | undefined, caPath: string | undefined,
  forbiddenUrls: Array<string | undefined> = [],
): PoolConfig {
  if (!rawUrl || !caPath || forbiddenUrls.some(v=>v && v===rawUrl)) {
    throw new Error('G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED');
  }
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error('G01_REVIEWER_DATABASE_URL_INVALID'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password || !url.pathname.slice(1) ||
      url.search || url.hash || !Number.isInteger(Number(url.port || '5432')) ||
      Number(url.port || '5432')<1 || Number(url.port || '5432')>65535) {
    throw new Error('G01_REVIEWER_DATABASE_URL_INVALID');
  }
  const user=decodeURIComponent(url.username);
  if (['postgres','tc_app','tc_migrator','tc_external_authority_reviewer',
    'tc_identity_recovery_reviewer','tc_identity_recovery_executor'].includes(user)) {
    throw new Error('G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED');
  }
  let ca: string;
  try { ca=readFileSync(caPath, 'utf8'); }
  catch { throw new Error('G01_REVIEWER_CA_UNAVAILABLE'); }
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('G01_REVIEWER_CA_INVALID');
  }
  return {
    host:url.hostname,port:Number(url.port || '5432'),
    user,password:decodeURIComponent(url.password),
    database:decodeURIComponent(url.pathname.slice(1)),
    ssl:{ca,rejectUnauthorized:true,servername:url.hostname},
    application_name:'tradecloseout-g01-independent-human-reviewer',
    max:1,connectionTimeoutMillis:8000,idleTimeoutMillis:1000,
  };
}

/**
 * Only the authenticated PostgreSQL session_user counts as reviewer;
 * no caller-supplied identity reaches SQL. Two independent sessions under two
 * different named IAM logins are required to complete an approval.
 */
export async function executeIndependentAuthorityReview(
  db: Pick<Pool,'query'>,
  input: IndependentReviewInput,
): Promise<{reviewCount:number; independentlyVerified:boolean}> {
  const {rows: identity} = await db.query(
    `SELECT session_user::text AS login, current_user::text AS effective_login,
            r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            pg_has_role(session_user,'tc_external_authority_reviewer','MEMBER') AS eligible
       FROM pg_roles r WHERE r.rolname=session_user`,
  );
  const reviewer=identity[0];
  if (!reviewer || !reviewer.eligible || reviewer.login!==reviewer.effective_login ||
      reviewer.rolsuper || reviewer.rolbypassrls || reviewer.rolcreaterole || reviewer.rolcreatedb) {
    throw new Error('G01_REVIEWER_ROLE_DENIED');
  }
  // The stored procedure locks grant+party, handles RLS, and guarantees
  // matching two-reviewer attestation and one-time immutable approval.
  const {rows} = await db.query(
    'SELECT review_count,independently_verified FROM approve_external_guest_authority($1,$2,$3,$4)',
    [input.org,input.grant,input.digest,input.caseRef],
  );
  if (rows.length!==1 || ![1,2].includes(Number(rows[0].review_count))) {
    throw new Error('G01_REVIEW_RESULT_INVALID');
  }
  return {
    reviewCount:Number(rows[0].review_count),
    independentlyVerified:rows[0].independently_verified===true,
  };
}
