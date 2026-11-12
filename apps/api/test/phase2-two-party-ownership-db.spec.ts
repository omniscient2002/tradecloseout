import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {OwnershipTransfersService} from '../src/modules/organisations/ownership-transfers.service';
import {uuidv7} from 'uuidv7';
import {createHash} from 'crypto';
jest.setTimeout(120000);
describe('PH2-G03-007 real two-party ownership transaction',()=>{
 test('requires independent fresh MFA, rejects wrong recipients, expiry, stale scope and replay, serializes competing requests',async()=>{
  const before={ttl:process.env.OWNERSHIP_INTENT_TTL_SECONDS,mfa:process.env.OWNERSHIP_MFA_MAX_AGE_SECONDS};
  process.env.OWNERSHIP_INTENT_TTL_SECONDS='600';process.env.OWNERSHIP_MFA_MAX_AGE_SECONDS='300';
  try{await withDisposableDatabase(async({admin,app})=>{
   const org=uuidv7(),owner=uuidv7(),recipient=uuidv7(),other=uuidv7();
   await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic ownership','Synthetic ownership','MH')",[org]);
   const contexts:any[]=[];
   for(const [u,role]of [[owner,'R-OWNER'],[recipient,'R-ADMIN'],[other,'R-SITE']]){
    const session=uuidv7(),gen=uuidv7();await admin.query("INSERT INTO users(id,name) VALUES($1,'Synthetic ownership mechanics')",[u]);
    await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[uuidv7(),org,u,role]);
    await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,auth_generation,token_hash,csrf_token_hash,expires_at,absolute_expires_at,mfa_verified,mfa_verified_at)
     VALUES($1,$2,$3,$4,$5,$5,now()+interval '1 day',now()+interval '1 day',true,now())`,[session,u,org,gen,createHash('sha256').update(session).digest('hex')]);
    contexts.push({orgId:org,userId:u,orgRole:role,actorType:'MEMBER',sessionId:session,authGeneration:gen,requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-ownership'});
   }
   const [a,b,c]=contexts,s=new OwnershipTransfersService(app),input={targetUserId:recipient,rowVersion:1,requestKey:uuidv7()};
   await expect(s.request({...a,sessionId:undefined,authGeneration:undefined},input)).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_FRESH_MFA_REQUIRED'})});
   const first=await s.request(a,input);expect((await s.request(a,input)).intentId).toBe(first.intentId);
   await expect(s.decide(c,first.intentId,'ACCEPT')).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_RECIPIENT_REQUIRED'})});
   await admin.query("UPDATE sessions SET mfa_verified_at=now()-interval '1 hour' WHERE id=$1",[b.sessionId]);
   await expect(s.decide(b,first.intentId,'ACCEPT')).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_FRESH_MFA_REQUIRED'})});
   await admin.query('UPDATE sessions SET mfa_verified_at=now() WHERE id=$1',[b.sessionId]);
   await s.decide(a,first.intentId,'CANCEL');await expect(s.decide(b,first.intentId,'ACCEPT')).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_INTENT_ALREADY_DECIDED'})});
   const second=await s.request(a,{...input,requestKey:uuidv7()});await admin.query("UPDATE ownership_transfer_intents SET expires_at=now()-interval '1 second' WHERE id=$1",[second.intentId]);
   await expect(s.decide(b,second.intentId,'ACCEPT')).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_INTENT_EXPIRED'})});
   const stale=await s.request(a,{...input,requestKey:uuidv7()});
   await admin.query('UPDATE organisations SET row_version=row_version+1 WHERE id=$1',[org]);
   await expect(s.decide(b,stale.intentId,'ACCEPT')).rejects.toMatchObject({response:expect.objectContaining({code:'OWNERSHIP_INTENT_STALE'})});
   await s.decide(a,stale.intentId,'CANCEL');
   const competing=await Promise.allSettled([s.request(a,{...input,rowVersion:2,requestKey:uuidv7()}),s.request(a,{...input,rowVersion:2,targetUserId:other,requestKey:uuidv7()})]);
   expect(competing.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(competing.filter(x=>x.status==='rejected')).toHaveLength(1);
   const intent=(competing.find(x=>x.status==='fulfilled')as PromiseFulfilledResult<any>).value;
   const target=(await admin.query('SELECT recipient_user_id FROM ownership_transfer_intents WHERE id=$1',[intent.intentId])).rows[0].recipient_user_id;
   const acceptor=contexts.find(x=>x.userId===target);
   const decided=await s.decide(acceptor,intent.intentId,'ACCEPT');expect(decided.status).toBe('ACCEPTED');
   expect((await admin.query("SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='R-OWNER' AND status='ACTIVE'",[org])).rows[0].n).toBe(1);
   expect((await admin.query('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2',[org,target])).rows[0].role).toBe('R-OWNER');
   await expect(s.decide(acceptor,intent.intentId,'ACCEPT')).rejects.toThrow();
   const revoked=(await admin.query('SELECT user_id FROM sessions WHERE active_org_id=$1 AND revoked_at IS NOT NULL',[org])).rows.map(x=>x.user_id);expect(revoked).toEqual(expect.arrayContaining([owner,target]));
   expect((await admin.query("SELECT count(*)::int n FROM audit_events WHERE org_id=$1 AND action='OWNERSHIP_TRANSFER_ACCEPTED'",[org])).rows[0].n).toBe(1);
  });}finally{
   if(before.ttl===undefined)delete process.env.OWNERSHIP_INTENT_TTL_SECONDS;else process.env.OWNERSHIP_INTENT_TTL_SECONDS=before.ttl;
   if(before.mfa===undefined)delete process.env.OWNERSHIP_MFA_MAX_AGE_SECONDS;else process.env.OWNERSHIP_MFA_MAX_AGE_SECONDS=before.mfa;
  }
 });
});
