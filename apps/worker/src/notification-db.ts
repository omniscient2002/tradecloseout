import type {Pool,PoolClient} from 'pg';
export async function notificationTransaction<T>(pool:Pool,orgId:string,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();let destroy=false;try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",[orgId]);
  const result=await fn(client);await client.query('COMMIT');return result;
 }catch(error){try{await client.query('ROLLBACK');}catch{destroy=true;}throw error;}finally{client.release(destroy);}
}
