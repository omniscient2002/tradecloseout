import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { deliverNotification, hasConfiguredNotificationGateway } from '../src/notification-delivery';

void test('PH1-G24-005: real gateway HTTP contract refuses redirect, oversize and unverified acceptance',async()=>{
  const prior={url:process.env.NOTIFICATION_DELIVERY_URL,token:process.env.NOTIFICATION_DELIVERY_TOKEN,
    env:process.env.NODE_ENV};
  const eventId=randomUUID();
  let observedIdempotency='';
  const server=createServer(async(req,res)=>{
    observedIdempotency=String(req.headers['idempotency-key']||'');
    for await(const _chunk of req) { /* Consume request body without logging. */ }
    if(req.url==='/redirect'){
      res.writeHead(302,{location:'/accepted'});res.end();return;
    }
    res.setHeader('content-type','application/json');
    if(req.url==='/oversize'){
      res.writeHead(200);res.end('x'.repeat(5000));return;
    }
    if(req.url==='/wrong'){
      res.end(JSON.stringify({accepted:true,notificationId:randomUUID()}));return;
    }
    res.end(JSON.stringify({accepted:true,notificationId:eventId}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const notification={id:eventId,org_id:randomUUID(),channel:'EMAIL',event_key:'SAFE_GATEWAY',payload_json:{},recipient_user_id:randomUUID()};
  try {
    process.env.NODE_ENV='test';
    process.env.NOTIFICATION_DELIVERY_TOKEN='fixture-token';
    for(const [route,accepted] of [['/redirect',false],['/oversize',false],['/wrong',false],['/accepted',true]] as const){
      process.env.NOTIFICATION_DELIVERY_URL=base+route;
      assert.equal(hasConfiguredNotificationGateway(),true);
      let actual=false;
      try { actual=await deliverNotification(notification); }
      catch { /* Intentional redirect refusal is a retryable transport rejection. */ }
      assert.equal(actual,accepted);
      assert.equal(observedIdempotency,eventId);
    }
    process.env.NODE_ENV='production';
    assert.equal(hasConfiguredNotificationGateway(),false);
    assert.equal(await deliverNotification(notification),false);
    process.env.NOTIFICATION_DELIVERY_URL='http://user:password@127.0.0.1/accepted';
    assert.equal(hasConfiguredNotificationGateway(),false);
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    for(const [key,value] of [['NOTIFICATION_DELIVERY_URL',prior.url],['NOTIFICATION_DELIVERY_TOKEN',prior.token],['NODE_ENV',prior.env]] as const){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
