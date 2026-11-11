import { Pool, PoolClient } from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthDeliveryContext = {
  kind: 'LOGIN_OTP' | 'GUEST_OTP' | 'INVITATION' | 'RECOVERY_NOTICE';
  targetId: string; orgId?: string; actorUserId?: string;
};
export type AuthDeliveryReceipt = {
  eventId: string; deliveryAttemptId: string; messageId: string;
  sequence: number; status: 'SUBMITTED' | 'DELIVERED' | 'FAILED';
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateAuthDeliveryConfiguration(env:NodeJS.ProcessEnv,requireSigningKey=true):void {
  if(requireSigningKey && (env.AUTH_DELIVERY_CALLBACK_KEY||'').length<32) {
    throw new Error('BOOT_AUTH_DELIVERY_SIGNING_KEY_REQUIRED');
  }
  for(const key of ['DLT_SMS_STATUS_URL','MAIL_STATUS_URL']) {
    let url:URL;
    try{url=new URL(env[key]||'');}catch{throw new Error('BOOT_AUTH_DELIVERY_STATUS_URL_REQUIRED');}
    if(url.protocol!=='https:' || url.username || url.password || url.hash) {
      throw new Error('BOOT_AUTH_DELIVERY_STATUS_URL_UNSAFE');
    }
  }
  if(!env.DLT_SMS_API_KEY || !(env.MAIL_API_KEY||env.SENDGRID_API_KEY)) {
    throw new Error('BOOT_AUTH_DELIVERY_STATUS_CREDENTIAL_REQUIRED');
  }
}
export const validDeliveryMessageId=(value:unknown):value is string =>
  typeof value==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

export async function readBoundedDeliveryJson(response:Response):Promise<unknown> {
  if(!response.body || Number(response.headers.get('content-length')||0)>4096) {
    await response.body?.cancel();throw new Error('AUTH_DELIVERY_RESPONSE_INVALID');
  }
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){
      const result=await reader.read();if(result.done)break;
      size+=result.value.byteLength;
      if(size>4096){await reader.cancel();throw new Error('AUTH_DELIVERY_RESPONSE_TOO_LARGE');}
      chunks.push(result.value);
    }
  }finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function parseAuthDeliveryReceipt(body:unknown):AuthDeliveryReceipt {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('AUTH_DELIVERY_RECEIPT_INVALID');
  const value=body as Record<string,unknown>;
  if (Object.keys(value).sort().join(',') !== 'deliveryAttemptId,eventId,messageId,sequence,status' ||
      typeof value.eventId!=='string' || !uuid.test(value.eventId) ||
      typeof value.deliveryAttemptId!=='string' || !uuid.test(value.deliveryAttemptId) ||
      !validDeliveryMessageId(value.messageId) ||
      !Number.isSafeInteger(value.sequence) || Number(value.sequence)<1 ||
      typeof value.status!=='string' || !['SUBMITTED','DELIVERED','FAILED'].includes(value.status)) {
    throw new Error('AUTH_DELIVERY_RECEIPT_INVALID');
  }
  return value as AuthDeliveryReceipt;
}

export function verifyAuthDeliverySignature(raw:Buffer, timestamp:unknown, signature:unknown,
  secret=process.env.AUTH_DELIVERY_CALLBACK_KEY, now=Date.now()):boolean {
  if (!Buffer.isBuffer(raw) || !secret || secret.length<32 || raw.length>4096 ||
      typeof timestamp!=='string' || !/^\d{10}$/.test(timestamp) ||
      Math.abs(now/1000-Number(timestamp))>300 ||
      typeof signature!=='string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}

/** Global pre-auth security ledger. Tenant target writes always establish scope. */
export class AuthDeliveryLedger {
  constructor(private readonly pool:Pool) {}

  private async scope(client:PoolClient,id:string):Promise<void> {
    const hint=(await client.query('SELECT * FROM auth_delivery_attempt_scope($1)',[id])).rows[0];
    if(!hint)throw new Error('AUTH_DELIVERY_RECEIPT_UNCORRELATED');
    if(hint.org_id)await client.query(`SELECT set_config('app.current_org',$1,true),
      set_config('app.current_org_id',$1,true),set_config('app.current_user',$2,true)`,
      [hint.org_id,hint.actor_user_id??'00000000-0000-0000-0000-000000000000']);
  }

  private async scoped<T>(id:string,work:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try{await client.query('BEGIN');await this.scope(client,id);const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }

  async begin(context:AuthDeliveryContext,channel:'SMS'|'EMAIL'):Promise<string> {
    if (!['LOGIN_OTP','GUEST_OTP','INVITATION','RECOVERY_NOTICE'].includes(context.kind) || !uuid.test(context.targetId) ||
        (['GUEST_OTP','INVITATION'].includes(context.kind) && (!context.orgId || !uuid.test(context.orgId)))) {
      throw new Error('AUTH_DELIVERY_CONTEXT_INVALID');
    }
    const client=await this.pool.connect();
    try {
    await client.query('BEGIN');
    if(context.orgId)await client.query(`SELECT set_config('app.current_org',$1,true),
      set_config('app.current_org_id',$1,true),set_config('app.current_user',$2,true)`,
      [context.orgId,context.actorUserId??'00000000-0000-0000-0000-000000000000']);
    const {rows}=await client.query(`INSERT INTO auth_delivery_attempts
      (id,target_kind,target_id,org_id,actor_user_id,channel,expires_at)
      VALUES($1,$2,$1,$3,$4,$5,CASE WHEN $2='RECOVERY_NOTICE'
        THEN identity_recovery_notice_expiry($1,$4)
        WHEN $2='INVITATION'
        THEN (SELECT expires_at FROM invitations WHERE id=$1 AND org_id=$3
          AND invited_by=$4 AND status='DELIVERY_PENDING' AND expires_at>now())
        ELSE (SELECT c.expires_at FROM otp_challenges c WHERE c.id=$1 AND c.channel=$5
          AND c.expires_at>now() AND c.consumed_at IS NULL
          AND (($2='LOGIN_OTP' AND c.purpose='LOGIN' AND c.guest_grant_id IS NULL)
            OR ($2='GUEST_OTP' AND c.purpose='GUEST_ACCESS' AND EXISTS(
              SELECT 1 FROM guest_grants g WHERE g.id=c.guest_grant_id AND g.org_id=$3
                AND g.status='ACTIVE' AND g.expires_at>now())))) END)
      ON CONFLICT (target_kind,target_id) DO UPDATE SET target_id=EXCLUDED.target_id
      WHERE auth_delivery_attempts.channel=EXCLUDED.channel
        AND auth_delivery_attempts.org_id IS NOT DISTINCT FROM EXCLUDED.org_id
        AND auth_delivery_attempts.actor_user_id IS NOT DISTINCT FROM EXCLUDED.actor_user_id
      RETURNING id`,[context.targetId,context.kind,context.orgId??null,context.actorUserId??null,channel])
      .catch(error=>{if(error.code==='23502' && error.column==='expires_at')throw new Error('AUTH_DELIVERY_TARGET_UNAVAILABLE');throw error;});
    if (!rows.length) throw new Error('AUTH_DELIVERY_CONTEXT_CHANGED');
    await client.query('COMMIT');return rows[0].id;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }

  async submitted(id:string,messageId:unknown):Promise<void> {
    if (!validDeliveryMessageId(messageId)) throw new Error('AUTH_DELIVERY_MESSAGE_ID_REQUIRED');
    await this.scoped(id,async client=>{
    const result=await client.query(`UPDATE auth_delivery_attempts
      SET provider_message_id=$2,status=CASE WHEN status IN ('PENDING','AMBIGUOUS') THEN 'SUBMITTED' ELSE status END,
          updated_at=now()
      WHERE id=$1 AND (provider_message_id IS NULL OR provider_message_id=$2)
      RETURNING target_kind,target_id`,[id,messageId]);
    if (!result.rowCount) throw new Error('AUTH_DELIVERY_MESSAGE_ID_CHANGED');
    if(result.rows[0].target_kind==='RECOVERY_NOTICE') {
      await client.query('SELECT record_identity_recovery_notice_receipt($1)',[result.rows[0].target_id]);
    }
    });
  }

  async ambiguous(id:string):Promise<void> {
    await this.scoped(id,client=>client.query(`UPDATE auth_delivery_attempts SET status='AMBIGUOUS',updated_at=now()
      WHERE id=$1 AND status='PENDING'`,[id]));
  }

  private async applyTarget(client:PoolClient,attempt:any,status:string):Promise<void> {
    if(attempt.target_kind==='RECOVERY_NOTICE') {
      await client.query('SELECT record_identity_recovery_notice_receipt($1)',[attempt.target_id]);return;
    }
    if (attempt.org_id) await client.query(`SELECT set_config('app.current_org',$1,true),
      set_config('app.current_org_id',$1,true),set_config('app.current_user',$2,true)`,
      [attempt.org_id,attempt.actor_user_id??'00000000-0000-0000-0000-000000000000']);
    if (attempt.target_kind==='INVITATION') {
      if(status==='FAILED') {
        await client.query(`UPDATE invitations SET status='REVOKED' WHERE id=$1 AND org_id=$2
          AND status IN ('DELIVERY_PENDING','PENDING')`,[attempt.target_id,attempt.org_id]);
      } else if(status==='DELIVERED') {
        // A signed late receipt cannot revive a superseded, expired or
        // revoked invitation or recover authority lost by its original issuer.
        await client.query(`UPDATE invitations i SET status='PENDING'
          WHERE i.id=$1 AND i.org_id=$2 AND i.status='DELIVERY_PENDING' AND i.expires_at>now()
          AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=i.invited_by
            AND m.org_id=i.org_id AND m.status='ACTIVE'
            AND (m.role='R-OWNER' OR (m.role='R-ADMIN' AND i.role<>'R-ADMIN')))`,
          [attempt.target_id,attempt.org_id]);
      }
    } else if(status==='DELIVERED' || status==='FAILED') {
      await client.query(`UPDATE otp_challenges c SET delivery_status=$2
        WHERE c.id=$1 AND c.consumed_at IS NULL AND c.expires_at>now()
          AND c.delivery_status IN ('PENDING','AMBIGUOUS','SENT')
          AND (c.guest_grant_id IS NULL OR EXISTS(SELECT 1 FROM guest_grants g
            WHERE g.id=c.guest_grant_id AND g.org_id=$3 AND g.status='ACTIVE' AND g.expires_at>now()))`,
        [attempt.target_id,status==='DELIVERED'?'SENT':'FAILED',attempt.org_id]);
    }
  }

  async receipt(input:AuthDeliveryReceipt):Promise<'APPLIED'|'DUPLICATE'|'STALE'> {
    const receipt=parseAuthDeliveryReceipt(input);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.scope(client,receipt.deliveryAttemptId);
      const {rows}=await client.query('SELECT * FROM auth_delivery_attempts WHERE id=$1 FOR UPDATE',[receipt.deliveryAttemptId]);
      const attempt=rows[0];
      if (!attempt || (attempt.provider_message_id && attempt.provider_message_id!==receipt.messageId)) {
        throw new Error('AUTH_DELIVERY_RECEIPT_UNCORRELATED');
      }
      const volume=(await client.query(`SELECT count(*)::int AS n FROM auth_delivery_receipts
        WHERE attempt_id=$1`,[attempt.id])).rows[0].n;
      if(volume>=32 && !(await client.query('SELECT 1 FROM auth_delivery_receipts WHERE event_id=$1',[receipt.eventId])).rows.length) {
        throw new Error('AUTH_DELIVERY_RECEIPT_VOLUME_EXCEEDED');
      }
      const inserted=await client.query(`INSERT INTO auth_delivery_receipts
        (event_id,attempt_id,provider_message_id,sequence,status) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
        [receipt.eventId,receipt.deliveryAttemptId,receipt.messageId,receipt.sequence,receipt.status]);
      if (!inserted.rowCount) {
        const previous=(await client.query('SELECT * FROM auth_delivery_receipts WHERE event_id=$1',[receipt.eventId])).rows[0];
        if(previous.attempt_id!==receipt.deliveryAttemptId || previous.provider_message_id!==receipt.messageId ||
           Number(previous.sequence)!==receipt.sequence || previous.status!==receipt.status) {
          throw new Error('AUTH_DELIVERY_RECEIPT_EVENT_CONFLICT');
        }
        await client.query('COMMIT');return 'DUPLICATE';
      }
      const expired=new Date(attempt.expires_at).getTime()<=Date.now();
      const terminal=['FAILED','EXPIRED'].includes(attempt.status);
      const stale=receipt.sequence<=Number(attempt.last_sequence) || terminal ||
        (attempt.status==='DELIVERED' && receipt.status==='SUBMITTED');
      if (expired || !stale) {
        const status=expired?'EXPIRED':receipt.status;
        await client.query(`UPDATE auth_delivery_attempts SET provider_message_id=$2,
          status=$3,last_sequence=GREATEST(last_sequence,$4),updated_at=now() WHERE id=$1`,
          [attempt.id,receipt.messageId,status,receipt.sequence]);
        if(!expired) await this.applyTarget(client,attempt,status);
      }
      await client.query('COMMIT');return stale||expired?'STALE':'APPLIED';
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {client.release();}
  }

  /** Status reconciliation retries metadata only; raw OTPs/links are never queued. */
  async reconcileDue(limit=20):Promise<void> {
    const started=Date.now();
    const bounded=Math.max(1,Math.min(50,Math.trunc(limit)||20));
    const {rows}=await this.pool.query('SELECT * FROM claim_auth_delivery_reconciliation($1)',[bounded]);
    for(const row of rows) {
      if(Date.now()-started>25000)break;
      const url=row.channel==='SMS'?process.env.DLT_SMS_STATUS_URL:process.env.MAIL_STATUS_URL;
      const key=row.channel==='SMS'?process.env.DLT_SMS_API_KEY:process.env.MAIL_API_KEY||process.env.SENDGRID_API_KEY;
      if(!url || !key) continue;
      try {
        const endpoint=new URL(url);
        if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password) continue;
        const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
          body:JSON.stringify({deliveryAttemptId:row.id,idempotencyKey:row.id})});
        if(!response.ok || Number(response.headers.get('content-length')||0)>4096) continue;
        const receipt=parseAuthDeliveryReceipt(await readBoundedDeliveryJson(response));
        if(receipt.deliveryAttemptId!==row.id)continue;
        await this.receipt(receipt);
      } catch { /* No payload, endpoint, destination or exception enters logs. */ }
    }
  }

  /** Operator-approved notices use the same idempotent gateway/receipt contract. */
  async sendRecoveryNotices():Promise<void> {
    const {rows}=await this.pool.query('SELECT * FROM claim_identity_recovery_notices(5)');
    let failed=false;
    for(const notice of rows) {
      let id:string|undefined;
      try {
        id=await this.begin({kind:'RECOVERY_NOTICE',targetId:notice.id,actorUserId:notice.user_id},notice.channel);
        const previous=(await this.pool.query('SELECT status,provider_message_id FROM auth_delivery_attempts WHERE id=$1',[id])).rows[0];
        if(['SUBMITTED','DELIVERED','FAILED'].includes(previous.status)) {
          await this.pool.query('SELECT record_identity_recovery_notice_receipt($1)',[id]);continue;
        }
        const sms=notice.channel==='SMS';
        const url=new URL((sms?process.env.DLT_SMS_URL:process.env.MAIL_GATEWAY_URL)||'');
        if(url.protocol!=='https:' || url.username || url.password)throw new Error('RECOVERY_GATEWAY_INVALID');
        const key=sms?process.env.DLT_SMS_API_KEY:process.env.MAIL_API_KEY||process.env.SENDGRID_API_KEY;
        const text=`A supervised TradeCloseout identity recovery case (${notice.case_id}) is pending. If you did not request recovery, contact your platform security team to cancel it. Recovery requires independent review and a minimum 24-hour notification window.`;
        const payload=sms?{recipient:notice.destination,message:text,templateId:process.env.DLT_RECOVERY_TEMPLATE_ID,
          senderId:process.env.DLT_SENDER_ID,entityId:process.env.DLT_ENTITY_ID}:
          {to:notice.destination,from:process.env.MAIL_FROM_ADDRESS,subject:'TradeCloseout account security notice',text};
        if(!key || (sms && !process.env.DLT_RECOVERY_TEMPLATE_ID))throw new Error('RECOVERY_GATEWAY_UNCONFIGURED');
        const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`,'Idempotency-Key':id,'X-Auth-Delivery-Contract':'1'},
          body:JSON.stringify({...payload,purpose:'IDENTITY_RECOVERY_NOTICE',deliveryAttemptId:id,idempotencyKey:id})});
        if(!response.ok)throw new Error('RECOVERY_GATEWAY_REJECTED');
        const ack=await readBoundedDeliveryJson(response) as Record<string,unknown>;
        if(ack.accepted!==true || ack.deliveryAttemptId!==id)throw new Error('RECOVERY_GATEWAY_UNCORRELATED');
        await this.submitted(id,ack.messageId);
      } catch {
        failed=true;if(id)await this.ambiguous(id).catch(()=>{});
      }
    }
    if(failed)console.error('AUTH_RECOVERY_NOTICE_DELIVERY_UNVERIFIED');
  }
}
