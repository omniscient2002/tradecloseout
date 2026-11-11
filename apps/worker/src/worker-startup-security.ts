import type { Pool } from 'pg';
import { validateAuthDeliveryConfiguration } from '@tradecloseout/db';

const PROD_MODES=new Set(['production','staging']);
const KNOWN_MODES=new Set(['production','staging','development','test']);
const LOOPBACK=new Set(['localhost','127.0.0.1','::1','[::1]']);

/**
 * G01-R4. A background worker is a privileged data processor: authentication
 * cleanup, invitation expiry and event polling must not run against guessed
 * credentials or an untrusted PostgreSQL identity.
 */
export function validateWorkerStartupConfig(env:NodeJS.ProcessEnv=process.env):void {
  const mode=env.NODE_ENV||'';
  if(!KNOWN_MODES.has(mode))throw new Error('BOOT_WORKER_ENV_INVALID');
  if(!PROD_MODES.has(mode))return;

  if(!env.APP_DATABASE_URL||!env.REDIS_URL){
    throw new Error('BOOT_WORKER_DEPENDENCY_MISSING');
  }
  let db:URL,redis:URL;
  try{
    db=new URL(env.APP_DATABASE_URL);
    redis=new URL(env.REDIS_URL);
  }catch{
    throw new Error('BOOT_WORKER_DEPENDENCY_URL_INVALID');
  }
  if(!['postgres:','postgresql:'].includes(db.protocol)||
    !db.hostname||!db.username||!db.password||
    !db.pathname.slice(1)||db.password.length<12||
    ['postgres','tc_migrator','tc_external_authority_reviewer'].includes(decodeURIComponent(db.username))||
    db.hash||!['','?sslmode=verify-full'].includes(db.search)){
    throw new Error('BOOT_WORKER_DATABASE_URL_UNSAFE');
  }
  if(!['redis:','rediss:'].includes(redis.protocol)||!redis.hostname||
     redis.hash||!['','/','/0'].includes(redis.pathname)||
     (redis.protocol==='redis:'&&!LOOPBACK.has(redis.hostname))){
    throw new Error('BOOT_WORKER_REDIS_URL_UNSAFE');
  }
  // A production TLS database may use the server's trusted private network
  // and driver-managed CA. Explicit sslmode=verify-full is supported; never
  // silently downgrade an explicitly requested strict verification policy.
  if(env.ENABLE_DEBUG_OTP==='true'||env.ENABLE_OUTBOX_DELIVERY==='true'){
    throw new Error('BOOT_WORKER_DEBUG_DISABLED');
  }
  try{validateAuthDeliveryConfiguration(env,false);}
  catch{throw new Error('BOOT_WORKER_AUTH_DELIVERY_CONFIG_INVALID');}
}

export async function assertWorkerRuntimeDatabasePrivileges(
  pool: Pick<Pool,'query'>,
):Promise<void> {
  const {rows}=await pool.query(
    `SELECT session_user::text AS login,current_user::text AS role_name,
            r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
            pg_has_role(current_user,'tc_migrator','MEMBER') AS can_migrate,
            pg_has_role(current_user,'tc_external_authority_reviewer','MEMBER') AS can_review,
            EXISTS(SELECT 1 FROM pg_roles m WHERE m.rolname IN
              ('tc_identity_recovery_reviewer','tc_identity_recovery_executor')
              AND pg_has_role(current_user,m.oid,'MEMBER')) AS can_recover_identity
       FROM pg_roles r WHERE r.rolname=current_user`,
  );
  const r=rows[0];
  if(!r||r.login!=='tc_app'||r.role_name!=='tc_app'||r.rolsuper||
     r.rolbypassrls||r.rolcreatedb||r.rolcreaterole||
     r.can_migrate||r.can_review||r.can_recover_identity){
    throw new Error('BOOT_WORKER_RUNTIME_ROLE_UNSAFE');
  }
}
