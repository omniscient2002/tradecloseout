import {Pool} from 'pg';
import {uuidv7} from 'uuidv7';

/** Disposable test mechanics only. This never certifies an HVAC mapping,
 * qualified reviewer, approved real pack or release acceptance. */
export async function publishSyntheticHvacPack(admin:Pool,input:{id:string;code:string;name:string;version:number;payload:unknown}) {
  const suffix=uuidv7().replaceAll('-',''),author='syn_hvac_a_'+suffix,reviewer='syn_hvac_r_'+suffix;
  await admin.query(`CREATE ROLE "${author}" NOLOGIN;CREATE ROLE "${reviewer}" NOLOGIN`);
  const invoke=async(who:string,sql:string,values:unknown[])=>{
    const client=await admin.connect();let destroy=false;
    try {await client.query(`SET SESSION AUTHORIZATION "${who}"`);return await client.query(sql,values);}
    finally{try{await client.query('RESET SESSION AUTHORIZATION');}catch{destroy=true;}client.release(destroy);}
  };
  try {
    await admin.query(`GRANT tc_hvac_template_author TO "${author}";GRANT tc_hvac_template_reviewer TO "${reviewer}"`);
    await invoke(author,'SELECT stage_hvac_template_pack($1,$2,$3,$4,$5)',[input.id,input.code,input.name,input.version,JSON.stringify(input.payload)]);
    const record={candidateSha:'0'.repeat(40),qualifiedReviewerEvidence:'https://example.invalid/synthetic-qualification',catalogueRef:'https://example.invalid/synthetic-catalogue',
      mappingEvidence:'https://example.invalid/synthetic-mapping',applicabilityEvidence:'https://example.invalid/synthetic-applicability',scenarioEvidence:'https://example.invalid/synthetic-scenarios',exceptions:[]};
    await invoke(reviewer,'SELECT review_hvac_template_pack($1,$2)',[input.id,JSON.stringify(record)]);
  }finally{await admin.query(`DROP ROLE "${author}";DROP ROLE "${reviewer}"`);}
}
