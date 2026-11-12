import {readFile,stat} from 'fs/promises';
import {Pool} from 'pg';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function invalid():never {throw Object.assign(new Error('HVAC_GOVERNANCE_INPUT_INVALID'),{code:'HVAC_GOVERNANCE_INPUT_INVALID'});}
async function inputFile(file:string|undefined,keys:string[]) {
  if(!file)invalid();
  const info=await stat(file);if(!info.isFile()||info.size>1_100_000)invalid();
  const value:unknown=JSON.parse(await readFile(file,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))invalid();
  return value as Record<string,unknown>;
}

async function main() {
  const [action,arg,...extra]=process.argv.slice(2);
  if(action==='--help'||action==='help') {
    process.stdout.write('Usage: hvac-template-governance.ts stage|review|deprecate INPUT.json; inspect PACK_UUID\nRequires HVAC_GOVERNANCE_DATABASE_URL for a separately provisioned least-privileged human principal.\n');
    return;
  }
  if(extra.length||!['stage','review','deprecate','inspect'].includes(action))invalid();
  const url=process.env.HVAC_GOVERNANCE_DATABASE_URL;
  if(!url)throw Object.assign(new Error('HVAC_GOVERNANCE_DATABASE_URL_REQUIRED'),{code:'HVAC_GOVERNANCE_DATABASE_URL_REQUIRED'});
  const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});
  try {
    const {rows}=await pool.query(`SELECT session_user AS identity,rolsuper,rolbypassrls,
      pg_has_role(session_user,'tc_hvac_template_author','MEMBER') AS author,
      pg_has_role(session_user,'tc_hvac_template_reviewer','MEMBER') AS reviewer
      FROM pg_roles WHERE rolname=session_user`);
    const principal=rows[0];
    if(!principal||principal.rolsuper||principal.rolbypassrls||['tc_app','tc_migrator'].includes(principal.identity)||
      (action==='stage'&&!principal.author)||(['review','deprecate'].includes(action)&&!principal.reviewer)||
      (action==='inspect'&&!principal.author&&!principal.reviewer)) {
      throw Object.assign(new Error('HVAC_GOVERNANCE_PRINCIPAL_REQUIRED'),{code:'HVAC_GOVERNANCE_PRINCIPAL_REQUIRED'});
    }
    let id:string;
    if(action==='inspect') {if(!arg||!UUID.test(arg))invalid();id=arg;}
    else if(action==='stage') {
      const data=await inputFile(arg,['packId','code','name','version','payload']);
      if(typeof data.packId!=='string'||!UUID.test(data.packId))invalid();id=data.packId;
      await pool.query('SELECT stage_hvac_template_pack($1,$2,$3,$4,$5)',[id,data.code,data.name,data.version,JSON.stringify(data.payload)]);
    } else if(action==='review') {
      const data=await inputFile(arg,['packId','reviewRecord']);
      if(typeof data.packId!=='string'||!UUID.test(data.packId))invalid();id=data.packId;
      await pool.query('SELECT review_hvac_template_pack($1,$2)',[id,JSON.stringify(data.reviewRecord)]);
    } else {
      const data=await inputFile(arg,['packId','reason']);
      if(typeof data.packId!=='string'||!UUID.test(data.packId))invalid();id=data.packId;
      await pool.query('SELECT deprecate_hvac_template_pack($1,$2)',[id,data.reason]);
    }
    const result=await pool.query(`SELECT id,code,name,version,schema_version,status,payload_checksum,
      author_identity,reviewer_identity,reviewed_at,reviewed_candidate_sha,review_record_json,
      CASE WHEN $2::boolean THEN payload_json ELSE NULL END AS payload
      FROM template_packs WHERE id=$1`,[id,action==='inspect']);
    process.stdout.write(JSON.stringify({action,actorIdentity:principal.identity,pack:result.rows[0]??null},null,2)+'\n');
  } finally {await pool.end();}
}
main().catch((error:unknown)=>{
  const value=(error as {code?:unknown})?.code;
  const code=typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:'HVAC_GOVERNANCE_FAILED';
  // Never print database URLs, passwords, raw SQL/parameters or provider errors.
  process.stderr.write(code+'\n');process.exitCode=1;
});
