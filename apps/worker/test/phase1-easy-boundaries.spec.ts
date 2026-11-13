import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { deliverNotification } from '../src/notification-delivery';
import { checkWorkerPdfDependency } from '../src/pdf-dependency';
import { TradeCloseoutScheduler } from '../src/scheduler';

const notification = { id: 'fixture-notification', org_id: 'fixture-org', channel: 'EMAIL', event_key: 'FIXTURE', payload_json: {} };

test('gateway rejects unsafe configuration and unbounded/unmatched receipts without credential forwarding', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, NOTIFICATION_DELIVERY_URL: process.env.NOTIFICATION_DELIVERY_URL, NOTIFICATION_DELIVERY_TOKEN: process.env.NOTIFICATION_DELIVERY_TOKEN };
  const fetchOriginal = globalThis.fetch;
  try {
    process.env.NODE_ENV = 'production'; process.env.NOTIFICATION_DELIVERY_TOKEN = 'fixture-token';
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('must not request'); };
    for (const url of ['invalid', 'http://127.0.0.1:3000', 'ftp://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/#fragment']) {
      process.env.NOTIFICATION_DELIVERY_URL = url;
      assert.equal(await deliverNotification(notification), false);
    }
    assert.equal(requests, 0);
    process.env.NOTIFICATION_DELIVERY_URL = 'https://gateway.example.invalid';
    let cancelled = false;
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.redirect, 'error');
      assert.equal((options?.headers as Record<string,string>)['Idempotency-Key'], notification.id);
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(4097))); },
        cancel() { cancelled = true; },
      }), { headers: { 'content-type': 'application/json' } });
    };
    assert.equal(await deliverNotification(notification), false); assert.equal(cancelled, true);
    for (const payload of ['null', '[]', '{bad', JSON.stringify({accepted:true,notificationId:'wrong'})]) {
      globalThis.fetch = async () => new Response(payload, {headers:{'content-type':'application/json'}});
      assert.equal(await deliverNotification(notification), false);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({accepted:true,notificationId:notification.id}), {headers:{'content-type':'application/json'}});
    assert.equal(await deliverNotification(notification), true);
    process.env.NODE_ENV = 'test';
    let redirectHits = 0;
    const gateway = createServer((req,res) => {
      if (req.url === '/redirect') { res.writeHead(307, {Location:'/capture'}); res.end(); }
      else { redirectHits++; res.end('{}'); }
    });
    gateway.listen(0,'127.0.0.1'); await once(gateway,'listening');
    globalThis.fetch = fetchOriginal;
    process.env.NOTIFICATION_DELIVERY_URL = `http://127.0.0.1:${(gateway.address() as any).port}/redirect`;
    try { await assert.rejects(deliverNotification(notification)); assert.equal(redirectHits,0); }
    finally { gateway.closeAllConnections(); await new Promise<void>(r=>gateway.close(()=>r())); }
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [key,value] of Object.entries(saved)) { if(value===undefined) delete process.env[key];else process.env[key]=value; }
  }
});

test('missing qpdf prevents production/staging startup with secret-free diagnostics', async () => {
  const missing = async () => { throw new Error('private path and environment'); };
  for (const mode of ['production','staging',undefined]) await assert.rejects(checkWorkerPdfDependency(missing,mode), /^Error: WORKER_QPDF_REQUIRED$/);
  assert.equal(await checkWorkerPdfDependency(missing,'development'), false);
  assert.equal(await checkWorkerPdfDependency(missing,'test'), false);
  assert.equal(await checkWorkerPdfDependency(async()=>({stdout:'qpdf version'}),'production'), true);
});

const methods = ['runDailyExpiryJob','runWeeklyOwnerRetentionAtRiskDigest','verifyAuditHashChainIntegrity','runStorageLifecycleCleanup','reconcileIdempotencyClaims','dispatchQueuedNotifications'] as const;
for (const method of methods) for (const phase of ['BEGIN','STATEMENT_ROLLBACK','COMMIT']) {
  test(`${method}: destroys connection on uncertain ${phase} without masking the command failure`, async () => {
    const primary = new Error('PRIMARY_FIXTURE_FAILURE'); let released: boolean | undefined; let began = 0;
    const client = {
      query: async(sql:string) => {
        if (sql.startsWith('BEGIN')) { began++; if(phase==='BEGIN') throw primary; }
        if (sql.includes('set_config') && phase==='STATEMENT_ROLLBACK') throw primary;
        if (sql==='ROLLBACK' && phase==='STATEMENT_ROLLBACK') throw new Error('SECONDARY_ROLLBACK_FAILURE');
        if (sql==='COMMIT' && phase==='COMMIT') throw primary;
        if (sql.includes('FROM organisations')) return {rows:[{id:'fixture-org',org_id:'fixture-org'}]};
        if (sql.includes('SELECT m.user_id')) return {rows:[{user_id:'fixture-user'}]};
        if (sql.includes('phase1_audit_expected_head')) return {rows:[{event_count:'0',head_seq:null,head_hash:null}]};
        return {rows:[],rowCount:0};
      },
      release:(discard:boolean)=>{released=discard;},
    };
    const scheduler = new TradeCloseoutScheduler({connect:async()=>client} as any,{} as any);
    await assert.rejects(scheduler[method](), method==='runWeeklyOwnerRetentionAtRiskDigest' ? /OWNER_DIGEST_INCOMPLETE/ : (err:unknown)=>err===primary);
    assert.equal(released,true); assert.equal(began,1);
  });
}
