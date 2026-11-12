/**
 * Restricted, interactive human-reviewer entry point.
 *
 * Run only from a platform-controlled reviewer workstation/gateway with
 * individual PostgreSQL credentials and mTLS/TLS verification. Not a web/API
 * endpoint; the contractor runtime role cannot call the signing function.
 *
 * Example:
 *  G01_REVIEWER_DATABASE_URL='postgres://person:...@db.example/reviews' \
 *  G01_REVIEWER_CA_PATH=/secure/ca.pem \
 *  pnpm --filter @tradecloseout/api review:external -- \
 *    --org UUID --grant UUID --sha256 LOWERCASE_HEX_DIGEST --case CASE-REFERENCE \
 *    --attest-independent-source --attest-legal-delegation --attest-destination
 */
import { Pool } from 'pg';
import {
  executeIndependentAuthorityReview, parseIndependentReviewArgs,
  reviewerConnectionConfig,
} from '../src/modules/identity/external-review-operations';

async function main(): Promise<void> {
  const input = parseIndependentReviewArgs(process.argv.slice(2).filter(arg=>arg!=='--'));
  const pool = new Pool(reviewerConnectionConfig(
    process.env.G01_REVIEWER_DATABASE_URL,
    process.env.G01_REVIEWER_CA_PATH,
    [process.env.APP_DATABASE_URL, process.env.MIGRATOR_DATABASE_URL],
  ));
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const outcome = await executeIndependentAuthorityReview(client,input);
      await client.query('COMMIT');
      // No case reference, contact, credential or evidence digest in stdout.
      process.stdout.write(JSON.stringify({
        status:'G01_REVIEW_RECORDED',
        reviewerCount:outcome.reviewCount,
        independentlyVerified:outcome.independentlyVerified,
      })+'\n');
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error:unknown)=>{
  // Do not print raw PostgreSQL/driver exceptions, which could contain a
  // secret-bearing URL, query parameters or contact/evidence metadata.
  const allowed = new Set([
    'G01_REVIEW_ARGUMENT_INVALID','G01_REVIEW_ATTESTATION_REQUIRED',
    'G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED',
    'G01_REVIEWER_DATABASE_URL_INVALID','G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED',
    'G01_REVIEWER_CA_UNAVAILABLE','G01_REVIEWER_CA_INVALID',
    'G01_REVIEWER_ROLE_DENIED','G01_REVIEW_RESULT_INVALID',
  ]);
  const code = error instanceof Error && allowed.has(error.message)
    ? error.message : 'G01_REVIEW_FAILED_CHECK_RESTRICTED_AUDIT';
  process.stderr.write(code+'\n');
  process.exitCode=1;
});
