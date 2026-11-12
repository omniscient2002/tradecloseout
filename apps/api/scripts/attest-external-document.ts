/**
 * Restricted platform-only offline external approval verifier.
 * No contractor/API/worker credentials. Human reviewer must independently
 * inspect the actual stored proof bytes and exact target document revision.
 * Two different named DB identities must attest to the same decision proof.
 */
import { Pool } from 'pg';
import { reviewerConnectionConfig } from '../src/modules/identity/external-review-operations';
import {
  parseExternalDocumentReviewArgs,executeExternalDocumentReview,
} from '../src/modules/identity/external-document-review-operations';

async function main():Promise<void>{
  const input=parseExternalDocumentReviewArgs(process.argv.slice(2).filter(v=>v!=='--'));
  const pool=new Pool(reviewerConnectionConfig(
    process.env.G01_REVIEWER_DATABASE_URL,
    process.env.G01_REVIEWER_CA_PATH,
    [process.env.APP_DATABASE_URL,process.env.MIGRATOR_DATABASE_URL],
  ));
  try{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const result=await executeExternalDocumentReview(client,input);
      await client.query('COMMIT');
      process.stdout.write(JSON.stringify({
        status:'G01_EXTERNAL_DOCUMENT_ATTESTED',
        reviewCount:result.reviewCount,
        independentlyVerified:result.independentlyVerified,
      })+'\n');
    }catch(err){
      await client.query('ROLLBACK').catch(()=>{});
      throw err;
    }finally{client.release();}
  }finally{await pool.end();}
}
main().catch((error:unknown)=>{
  const safe=new Set([
    'G01_DOCUMENT_REVIEW_ARGUMENT_INVALID','G01_DOCUMENT_REVIEW_ATTESTATION_REQUIRED',
    'G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED','G01_REVIEWER_DATABASE_URL_INVALID',
    'G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED','G01_REVIEWER_CA_UNAVAILABLE',
    'G01_REVIEWER_CA_INVALID','G01_DOCUMENT_REVIEWER_ROLE_DENIED',
    'G01_DOCUMENT_REVIEW_RESULT_INVALID',
  ]);
  const message=error instanceof Error&&safe.has(error.message)
    ?error.message:'G01_EXTERNAL_DOCUMENT_ATTESTATION_FAILED_CHECK_RESTRICTED_AUDIT';
  process.stderr.write(message+'\n');
  process.exitCode=1;
});
