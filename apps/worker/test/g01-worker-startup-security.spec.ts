import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkerStartupConfig,assertWorkerRuntimeDatabasePrivileges,
} from '../src/worker-startup-security';

const valid={
  NODE_ENV:'production',
  APP_DATABASE_URL:'postgres://tc_app:strong-restricted-secret@db.internal/tradecloseout',
  REDIS_URL:'rediss://cache.internal:6379',
  DLT_SMS_STATUS_URL:'https://sms.example.test/status',
  MAIL_STATUS_URL:'https://mail.example.test/status',
  DLT_SMS_API_KEY:'fixture-only-sms-key',
  MAIL_API_KEY:'fixture-only-mail-key',
};
void test('G01-R4: worker mode/configuration fails closed before background jobs',()=>{
  assert.doesNotThrow(()=>validateWorkerStartupConfig(valid));
  for(const env of [
    {...valid,NODE_ENV:undefined},
    {...valid,NODE_ENV:'other'},
    {...valid,APP_DATABASE_URL:undefined},
    {...valid,REDIS_URL:undefined},
    {...valid,APP_DATABASE_URL:'postgres://postgres:strong-restricted-secret@db/tradecloseout'},
    {...valid,APP_DATABASE_URL:'postgres://tc_app:short@db/tradecloseout'},
    {...valid,APP_DATABASE_URL:'postgres://tc_migrator:strong-restricted-secret@db/tradecloseout'},
    {...valid,APP_DATABASE_URL:'postgres://tc_app:strong-restricted-secret@db/tradecloseout?sslmode=disable'},
    {...valid,REDIS_URL:'redis://external.example:6379'},
    {...valid,REDIS_URL:'http://cache.internal:6379'},
    {...valid,ENABLE_DEBUG_OTP:'true'},
    {...valid,ENABLE_OUTBOX_DELIVERY:'true'},
    {...valid,DLT_SMS_STATUS_URL:undefined},
    {...valid,MAIL_STATUS_URL:'http://mail.example.test/status'},
  ]){
    assert.throws(()=>validateWorkerStartupConfig(env),/BOOT_WORKER_/);
  }
  assert.doesNotThrow(()=>validateWorkerStartupConfig({NODE_ENV:'test'}));
});
void test('G01-R4: worker checks connected PostgreSQL session and rejects role escalation',async()=>{
  const db=(role:any)=>({query:async()=>({rows:[role]})}) as any;
  const good={login:'tc_app',role_name:'tc_app',rolsuper:false,
    rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,
    can_migrate:false,can_review:false};
  await assert.doesNotReject(assertWorkerRuntimeDatabasePrivileges(db(good)));
  for(const unsafe of [
    {...good,login:'postgres'},
    {...good,role_name:'tc_migrator'},
    {...good,rolsuper:true},
    {...good,rolbypassrls:true},
    {...good,rolcreatedb:true},
    {...good,rolcreaterole:true},
    {...good,can_migrate:true},
    {...good,can_review:true},
    {...good,can_recover_identity:true},
  ]){
    await assert.rejects(assertWorkerRuntimeDatabasePrivileges(db(unsafe)),
      /BOOT_WORKER_RUNTIME_ROLE_UNSAFE/);
  }
});
