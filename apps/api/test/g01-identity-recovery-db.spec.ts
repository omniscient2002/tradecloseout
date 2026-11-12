import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AuthDeliveryLedger } from '@tradecloseout/db';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { identityRecoveryCommand } from '../src/modules/identity/identity-recovery-operations';

jest.setTimeout(180_000);
describe('G01-014/019/020 separated human identity recovery',()=>{
  it('requires two named reviewers, a distinct executor, real notice state and cooldown; resets no factor early',async()=>{
    const previousFetch=global.fetch;
    const names=['reviewA','reviewB','executor'].map(x=>'tc_recovery_'+x+'_'+uuidv7().replace(/-/g,'').slice(0,8));
    const oldEnv={MAIL_GATEWAY_URL:process.env.MAIL_GATEWAY_URL,MAIL_API_KEY:process.env.MAIL_API_KEY,MAIL_FROM_ADDRESS:process.env.MAIL_FROM_ADDRESS};
    process.env.MAIL_GATEWAY_URL='https://fixture.example.test/send';process.env.MAIL_API_KEY='fixture-only-key';process.env.MAIL_FROM_ADDRESS='security@example.test';
    try {
      await withDisposableDatabase(async({admin,app})=>{
        async function asRole(role:string,sql:string,params:unknown[]=[]){
          const client=await admin.connect();
          try{await client.query(`SET SESSION AUTHORIZATION "${role}"`);return await client.query(sql,params);}
          finally{await client.query('RESET SESSION AUTHORIZATION');client.release();}
        }
        const created:string[]=[];
        try {
          for(let i=0;i<names.length;i++){
            await admin.query(`CREATE ROLE "${names[i]}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
            created.push(names[i]);
            await admin.query(`GRANT ${i===2?'tc_identity_recovery_executor':'tc_identity_recovery_reviewer'} TO "${names[i]}"`);
          }
          const user=uuidv7(),session=uuidv7();
          await admin.query("INSERT INTO users(id,name,status,mfa_totp_secret,mfa_enabled_at) VALUES($1,'Recovery User','ACTIVE','existing-encrypted-factor',now())",[user]);
          await admin.query("INSERT INTO user_identities(id,user_id,type,value) VALUES($1,$2,'EMAIL','original@example.test')",[uuidv7(),user]);
          await admin.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,expires_at,mfa_verified) VALUES($1,$2,$3,$4,now()+interval '1 day',true)",[session,user,'a'.repeat(64),'b'.repeat(64)]);
          await admin.query("INSERT INTO mfa_recovery_codes(id,user_id,code_hash) VALUES($1,$2,$3)",[uuidv7(),user,'c'.repeat(64)]);
          await expect(app.query('SELECT * FROM identity_recovery_cases')).rejects.toMatchObject({code:'42501'});
          await expect(app.query('SELECT open_identity_recovery_case($1,$2,$3)',[user,'a'.repeat(64),'CASE-RECOVERY-0001'])).rejects.toMatchObject({code:'42501'});
          const id=(await asRole(names[0],'SELECT open_identity_recovery_case($1,$2,$3) AS id',[user,'a'.repeat(64),'CASE-RECOVERY-0001'])).rows[0].id;
          expect((await admin.query('SELECT revoked_at FROM sessions WHERE id=$1',[session])).rows[0].revoked_at).toBeInstanceOf(Date);
          expect((await admin.query('SELECT mfa_totp_secret FROM users WHERE id=$1',[user])).rows[0].mfa_totp_secret).toBe('existing-encrypted-factor');
          await expect(asRole(names[0],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[id,'a'.repeat(64),'CASE-RECOVERY-0001',user,null,null])).rejects.toMatchObject({code:'23505'});
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toMatchObject({code:'42501'});
          await expect(asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[id,'b'.repeat(64),'CASE-RECOVERY-0001',user,null,null])).rejects.toMatchObject({code:'22023'});
          await expect(asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[id,'a'.repeat(64),'CASE-RECOVERY-0001',uuidv7(),null,null])).rejects.toMatchObject({code:'22023'});
          await asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[id,'a'.repeat(64),'CASE-RECOVERY-0001',user,null,null]);
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toThrow('COOLDOWN');
          // Advance only disposable stored timestamps; no production cooldown
          // setting or bypass exists. Prove each remaining server gate in turn.
          await admin.query("UPDATE identity_recovery_cases SET not_before=now()-interval '1 minute' WHERE id=$1",[id]);
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toThrow('NOTIFICATION_WINDOW');
          global.fetch=jest.fn(async(_url:any,options:any)=>{
            const body=JSON.parse(options.body);
            return new Response(JSON.stringify({accepted:true,deliveryAttemptId:body.deliveryAttemptId,messageId:'notice-'+body.deliveryAttemptId}));
          }) as any;
          const ledger=new AuthDeliveryLedger(app);await ledger.sendRecoveryNotices();
          expect(global.fetch).toHaveBeenCalledTimes(1);
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toThrow('NOTIFICATION_WINDOW');
          await admin.query("UPDATE identity_recovery_notices SET attempted_at=now()-interval '25 hours' WHERE case_id=$1",[id]);
          await admin.query(`GRANT tc_identity_recovery_executor TO "${names[0]}"`);
          await expect(asRole(names[0],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toMatchObject({code:'42501'});
          await expect(app.query('SELECT execute_identity_recovery_case($1)',[id])).rejects.toMatchObject({code:'42501'});
          await asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id]);
          const account=(await admin.query('SELECT mfa_totp_secret,mfa_enabled_at,auth_proof_valid_after FROM users WHERE id=$1',[user])).rows[0];
          expect(account.mfa_totp_secret).toBeNull();expect(account.mfa_enabled_at).toBeNull();
          expect(account.auth_proof_valid_after).toBeInstanceOf(Date);
          expect(Number((await admin.query('SELECT count(*) FROM mfa_recovery_codes WHERE user_id=$1',[user])).rows[0].count)).toBe(0);
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[id])).rejects.toMatchObject({code:'42501'});

          const replacement=(await asRole(names[0],'SELECT open_identity_recovery_case($1,$2,$3,$4,$5) AS id',
            [user,'d'.repeat(64),'CASE-RECOVERY-0002','EMAIL','replacement@example.test'])).rows[0].id;
          await expect(asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',
            [replacement,'d'.repeat(64),'CASE-RECOVERY-0002',user,'EMAIL','substituted@example.test'])).rejects.toMatchObject({code:'22023'});
          await asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[replacement,'d'.repeat(64),'CASE-RECOVERY-0002',user,'EMAIL','replacement@example.test']);
          await ledger.sendRecoveryNotices();
          await admin.query("UPDATE identity_recovery_cases SET not_before=now()-interval '1 minute' WHERE id=$1",[replacement]);
          await admin.query("UPDATE identity_recovery_notices SET attempted_at=now()-interval '25 hours' WHERE case_id=$1 AND NOT is_new_contact",[replacement]);
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[replacement])).rejects.toThrow('NOTIFICATION_WINDOW');
          const notice=(await admin.query('SELECT id FROM identity_recovery_notices WHERE case_id=$1 AND is_new_contact',[replacement])).rows[0].id;
          await ledger.receipt({eventId:uuidv7(),deliveryAttemptId:notice,messageId:'notice-'+notice,sequence:1,status:'DELIVERED'});
          await asRole(names[2],'SELECT execute_identity_recovery_case($1)',[replacement]);
          expect((await admin.query('SELECT value FROM user_identities WHERE user_id=$1',[user])).rows.map(x=>x.value)).toEqual(['replacement@example.test']);
          const cancelled=(await asRole(names[0],'SELECT open_identity_recovery_case($1,$2,$3) AS id',[user,'e'.repeat(64),'CASE-RECOVERY-0003'])).rows[0].id;
          await asRole(names[1],'SELECT cancel_identity_recovery_case($1)',[cancelled]);
          await expect(asRole(names[1],'SELECT attest_identity_recovery_case($1,$2,$3,$4,$5,$6)',[cancelled,'e'.repeat(64),'CASE-RECOVERY-0003',user,null,null])).rejects.toMatchObject({code:'42501'});
          await expect(asRole(names[2],'SELECT execute_identity_recovery_case($1)',[cancelled])).rejects.toMatchObject({code:'42501'});
        }finally{for(const name of created.reverse())await admin.query(`DROP ROLE "${name}"`);}
      });
    }finally{
      global.fetch=previousFetch;
      for(const [key,value] of Object.entries(oldEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    }
  });

  it('operator CLI requires explicit independent evidence and execution attestations',()=>{
    const user=uuidv7();
    expect(()=>identityRecoveryCommand(['--action','open','--user',user,'--sha256','a'.repeat(64),'--case','CASE-0001'])).toThrow('ATTESTATION');
    expect(()=>identityRecoveryCommand(['--action','execute','--id',uuidv7()])).toThrow('ATTESTATION');
    expect(identityRecoveryCommand(['--action','open','--user',user,'--sha256','a'.repeat(64),'--case','CASE-0001',
      '--attest-independent-identity','--attest-no-self-review','--attest-destination']).sql).toContain('open_identity_recovery_case');
  });
});
