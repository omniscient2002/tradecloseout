/**
 * An isolated, individually authenticated, emergency security-reviewer CLI.
 * Both guest and document revocations are permanent/append-only decisions.
 */
import {Pool} from 'pg';
import {reviewerConnectionConfig} from '../src/modules/identity/external-review-operations';
import {parseExternalRevocationArgs,executeExternalRevocation}
  from '../src/modules/identity/external-review-revocation';

async function main():Promise<void>{
  const command=parseExternalRevocationArgs(process.argv.slice(2).filter(x=>x!=='--'));
  const pool=new Pool(reviewerConnectionConfig(
    process.env.G01_REVIEWER_DATABASE_URL,process.env.G01_REVIEWER_CA_PATH,
    [process.env.APP_DATABASE_URL,process.env.MIGRATOR_DATABASE_URL],
  ));
  try{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      await executeExternalRevocation(client,command);
      await client.query('COMMIT');
      process.stdout.write(JSON.stringify({status:'G01_EXTERNAL_AUTHORITY_REVOKED'})+'\n');
    }catch(err){
      await client.query('ROLLBACK').catch(()=>{});
      throw err;
    }finally{client.release();}
  }finally{await pool.end();}
}
main().catch((error:unknown)=>{
  const known=new Set([
    'G01_REVOKE_ARGUMENT_INVALID','G01_REVOKE_ATTESTATION_REQUIRED',
    'G01_REVOKER_ROLE_DENIED','G01_REVOKE_RESULT_INVALID',
    'G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED',
    'G01_REVIEWER_DATABASE_URL_INVALID','G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED',
    'G01_REVIEWER_CA_UNAVAILABLE','G01_REVIEWER_CA_INVALID',
  ]);
  process.stderr.write(
    error instanceof Error&&known.has(error.message)
      ?error.message+'\n':'G01_REVOKE_FAILED_CHECK_RESTRICTED_AUDIT\n',
  );
  process.exitCode=1;
});
