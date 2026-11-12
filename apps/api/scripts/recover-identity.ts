import { Pool } from 'pg';
import { reviewerConnectionConfig } from '../src/modules/identity/external-review-operations';
import { identityRecoveryCommand } from '../src/modules/identity/identity-recovery-operations';

async function main(){
  const command=identityRecoveryCommand(process.argv.slice(2).filter(arg=>arg!=='--'));
  const pool=new Pool({...reviewerConnectionConfig(process.env.G01_RECOVERY_DATABASE_URL,
    process.env.G01_RECOVERY_CA_PATH,[process.env.APP_DATABASE_URL,process.env.MIGRATOR_DATABASE_URL]),
    application_name:'tradecloseout-g01-identity-recovery-operator'});
  try {
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const {rows}=await client.query(command.sql,command.values);
      if(!rows.length)throw new Error('RECOVERY_CASE_UNAVAILABLE');
      await client.query('COMMIT');
      process.stdout.write(JSON.stringify({status:'RECOVERY_OPERATION_RECORDED',
        caseId:rows[0]?.case_id,reviewerCount:rows[0]?.reviewer_count,
        caseStatus:rows[0]?.status,notBefore:rows[0]?.not_before,expiresAt:rows[0]?.expires_at,
        notificationWindowComplete:rows[0]?.notification_window_complete,
        contactConfirmationComplete:rows[0]?.contact_confirmation_complete})+'\n');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }finally{await pool.end();}
}
main().catch(()=>{process.stderr.write('RECOVERY_OPERATION_DENIED_CHECK_RESTRICTED_CASE_AUDIT\n');process.exitCode=1;});
