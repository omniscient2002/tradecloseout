import { createHmac } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { AuthDeliveryLedger, AuthDeliveryReceipt, verifyAuthDeliverySignature, readBoundedDeliveryJson } from '@tradecloseout/db';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { AuthDeliveryController } from '../src/modules/identity/auth-delivery.controller';

jest.setTimeout(180_000);
describe('G01-011 durable receipt and retry reconciliation',()=>{
  it('correlates immutable receipts, rejects conflicts/replays and never revives a spent proof',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const ledger=new AuthDeliveryLedger(app),id=uuidv7();
      await admin.query(`INSERT INTO otp_challenges(id,channel,identifier,purpose,code_hash,expires_at,delivery_status)
        VALUES($1,'EMAIL','fixture@example.test','LOGIN',$2,now()+interval '5 minutes','PENDING')`,[id,'a'.repeat(64)]);
      expect(await ledger.begin({kind:'LOGIN_OTP',targetId:id},'EMAIL')).toBe(id);
      expect(await new AuthDeliveryLedger(app).begin({kind:'LOGIN_OTP',targetId:id},'EMAIL')).toBe(id);
      await ledger.submitted(id,'message-1');
      const receipt:AuthDeliveryReceipt={eventId:uuidv7(),deliveryAttemptId:id,messageId:'message-1',sequence:1,status:'DELIVERED'};
      expect(await ledger.receipt(receipt)).toBe('APPLIED');
      expect(await ledger.receipt(receipt)).toBe('DUPLICATE');
      await expect(ledger.receipt({...receipt,status:'FAILED'})).rejects.toThrow('EVENT_CONFLICT');
      await expect(ledger.receipt({...receipt,eventId:uuidv7(),messageId:'foreign-message'})).rejects.toThrow('UNCORRELATED');
      expect(await ledger.receipt({...receipt,eventId:uuidv7(),status:'FAILED'})).toBe('STALE');
      expect((await admin.query('SELECT delivery_status FROM otp_challenges WHERE id=$1',[id])).rows[0].delivery_status).toBe('SENT');
      expect(await ledger.receipt({...receipt,eventId:uuidv7(),sequence:2,status:'FAILED'})).toBe('APPLIED');
      expect(await ledger.receipt({...receipt,eventId:uuidv7(),sequence:3})).toBe('STALE');
      expect((await admin.query('SELECT delivery_status FROM otp_challenges WHERE id=$1',[id])).rows[0].delivery_status).toBe('FAILED');
      await expect(app.query('DELETE FROM auth_delivery_receipts')).rejects.toMatchObject({code:'42501'});
      const second=uuidv7();
      await admin.query(`INSERT INTO otp_challenges(id,channel,identifier,purpose,code_hash,expires_at,delivery_status,consumed_at)
        VALUES($1,'EMAIL','fixture@example.test','LOGIN',$2,now()+interval '5 minutes','AMBIGUOUS',NULL)`,[second,'b'.repeat(64)]);
      await ledger.begin({kind:'LOGIN_OTP',targetId:second},'EMAIL');
      await admin.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1',[second]);
      await ledger.receipt({...receipt,eventId:uuidv7(),deliveryAttemptId:second,messageId:'message-2'});
      expect((await admin.query('SELECT delivery_status FROM otp_challenges WHERE id=$1',[second])).rows[0].delivery_status).toBe('AMBIGUOUS');
      expect(JSON.stringify((await admin.query('SELECT * FROM auth_delivery_attempts')).rows)).not.toContain('fixture@example.test');
    });
  });

  it('requires fresh exact-byte signatures before DB access and accepts duplicate signed callbacks',async()=>{
    const key='fixture-only-callback-signature-key-32-plus';
    const old=process.env.AUTH_DELIVERY_CALLBACK_KEY;process.env.AUTH_DELIVERY_CALLBACK_KEY=key;
    try {
      const timestamp=String(Math.floor(Date.now()/1000));
      const raw=Buffer.from('{}');
      const signature=createHmac('sha256',key).update(timestamp+'.').update(raw).digest('hex');
      expect(verifyAuthDeliverySignature(raw,timestamp,signature)).toBe(true);
      expect(verifyAuthDeliverySignature(Buffer.from('{ }'),timestamp,signature)).toBe(false);
      expect(verifyAuthDeliverySignature(raw,String(Number(timestamp)-301),signature)).toBe(false);
      expect(verifyAuthDeliverySignature(raw,[timestamp],signature)).toBe(false);
      const fake:any={connect:jest.fn(),query:jest.fn()};
      await expect(new AuthDeliveryController(fake).receipt({rawBody:raw,headers:{}} as any)).rejects.toMatchObject({status:403});
      expect(fake.connect).not.toHaveBeenCalled();
      for(const status of [['DELIVERED'],{value:'DELIVERED'},null,123]){
        const body=Buffer.from(JSON.stringify({eventId:uuidv7(),deliveryAttemptId:uuidv7(),messageId:'fixture',sequence:1,status}));
        const sig=createHmac('sha256',key).update(timestamp+'.').update(body).digest('hex');
        await expect(new AuthDeliveryController(fake).receipt({rawBody:body,headers:{
          'x-auth-delivery-timestamp':timestamp,'x-auth-delivery-signature':sig,
        }} as any)).rejects.toMatchObject({status:400});
      }
      expect(fake.connect).not.toHaveBeenCalled();
      await withDisposableDatabase(async({app,admin})=>{
        const id=uuidv7();
        await admin.query(`INSERT INTO otp_challenges(id,channel,identifier,purpose,code_hash,expires_at,delivery_status)
          VALUES($1,'SMS','+919999999999','LOGIN',$2,now()+interval '5 minutes','PENDING')`,[id,'e'.repeat(64)]);
        await new AuthDeliveryLedger(app).begin({kind:'LOGIN_OTP',targetId:id},'SMS');
        const body=Buffer.from(JSON.stringify({eventId:uuidv7(),deliveryAttemptId:id,messageId:'signed-message',sequence:1,status:'SUBMITTED'}));
        const sig=createHmac('sha256',key).update(timestamp+'.').update(body).digest('hex');
        const req:any={rawBody:body,headers:{'x-auth-delivery-timestamp':timestamp,'x-auth-delivery-signature':sig}};
        const controller=new AuthDeliveryController(app);
        await expect(controller.receipt(req)).resolves.toBeUndefined();
        await expect(controller.receipt(req)).resolves.toBeUndefined();
      });
    }finally{if(old===undefined)delete process.env.AUTH_DELIVERY_CALLBACK_KEY;else process.env.AUTH_DELIVERY_CALLBACK_KEY=old;}
  });

  it('reconciles a lost acknowledgement after process restart with bounded metadata-only retries',async()=>{
    const oldFetch=global.fetch,oldUrl=process.env.MAIL_STATUS_URL,oldKey=process.env.MAIL_API_KEY;
    process.env.MAIL_STATUS_URL='https://gateway.example.test/status';process.env.MAIL_API_KEY='fixture-only-key';
    try {
      await withDisposableDatabase(async({app,admin})=>{
        const id=uuidv7();
        await admin.query(`INSERT INTO otp_challenges(id,channel,identifier,purpose,code_hash,expires_at,delivery_status)
          VALUES($1,'EMAIL','lost-ack@example.test','LOGIN',$2,now()+interval '5 minutes','AMBIGUOUS')`,[id,'c'.repeat(64)]);
        const ledger=new AuthDeliveryLedger(app);await ledger.begin({kind:'LOGIN_OTP',targetId:id},'EMAIL');await ledger.ambiguous(id);
        await admin.query('UPDATE auth_delivery_attempts SET next_reconcile_at=now() WHERE id=$1',[id]);
        global.fetch=jest.fn().mockRejectedValue(new Error('fixture timeout'));
        await ledger.reconcileDue();
        expect((await admin.query('SELECT status,reconcile_count FROM auth_delivery_attempts WHERE id=$1',[id])).rows[0]).toMatchObject({status:'AMBIGUOUS',reconcile_count:1});
        await admin.query('UPDATE auth_delivery_attempts SET next_reconcile_at=now() WHERE id=$1',[id]);
        const receipt={eventId:uuidv7(),deliveryAttemptId:id,messageId:'recovered-message',sequence:1,status:'DELIVERED'};
        const fetcher=jest.fn().mockResolvedValue(new Response(JSON.stringify(receipt),{status:200}));global.fetch=fetcher;
        await new AuthDeliveryLedger(app).reconcileDue();
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({deliveryAttemptId:id,idempotencyKey:id});
        expect(JSON.stringify(fetcher.mock.calls)).not.toContain('lost-ack@example.test');
        expect((await admin.query('SELECT delivery_status FROM otp_challenges WHERE id=$1',[id])).rows[0].delivery_status).toBe('SENT');
        await new AuthDeliveryLedger(app).reconcileDue();expect(fetcher).toHaveBeenCalledTimes(1);
      });
      await expect(readBoundedDeliveryJson(new Response('x'.repeat(5000)))).rejects.toThrow('TOO_LARGE');
    }finally{
      global.fetch=oldFetch;
      if(oldUrl===undefined)delete process.env.MAIL_STATUS_URL;else process.env.MAIL_STATUS_URL=oldUrl;
      if(oldKey===undefined)delete process.env.MAIL_API_KEY;else process.env.MAIL_API_KEY=oldKey;
    }
  });

  it('late invitation receipts require original issuer authority and cannot revive revocations',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const org=uuidv7(),user=uuidv7(),id=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Receipt Issuer','ACTIVE')",[user]);
      await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Receipt Org','Receipt Org','KA')",[org]);
      await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[uuidv7(),org,user]);
      await admin.query(`INSERT INTO invitations(id,org_id,email,role,token_hash,status,expires_at,invited_by)
        VALUES($1,$2,'recipient@example.test','R-SITE',$3,'DELIVERY_PENDING',now()+interval '1 day',$4)`,[id,org,'d'.repeat(64),user]);
      const ledger=new AuthDeliveryLedger(app);
      await ledger.begin({kind:'INVITATION',targetId:id,orgId:org,actorUserId:user},'EMAIL');
      expect((await app.query('SELECT id FROM auth_delivery_attempts WHERE id=$1',[id])).rows).toEqual([]);
      expect((await app.query("UPDATE auth_delivery_attempts SET status='FAILED' WHERE id=$1",[id])).rowCount).toBe(0);
      const receipt:AuthDeliveryReceipt={eventId:uuidv7(),deliveryAttemptId:id,messageId:'invitation-1',sequence:1,status:'SUBMITTED'};
      await ledger.receipt(receipt);
      expect((await app.query('SELECT event_id FROM auth_delivery_receipts WHERE attempt_id=$1',[id])).rows).toEqual([]);
      expect((await admin.query('SELECT status FROM invitations WHERE id=$1',[id])).rows[0].status).toBe('DELIVERY_PENDING');
      await admin.query("UPDATE memberships SET status='REMOVED' WHERE user_id=$1 AND org_id=$2",[user,org]);
      await ledger.receipt({...receipt,eventId:uuidv7(),sequence:2,status:'DELIVERED'});
      expect((await admin.query('SELECT status FROM invitations WHERE id=$1',[id])).rows[0].status).toBe('DELIVERY_PENDING');
      await admin.query("UPDATE invitations SET status='REVOKED' WHERE id=$1",[id]);
      await ledger.receipt({...receipt,eventId:uuidv7(),sequence:3,status:'DELIVERED'});
      expect((await admin.query('SELECT status FROM invitations WHERE id=$1',[id])).rows[0].status).toBe('REVOKED');
    });
  });
});
