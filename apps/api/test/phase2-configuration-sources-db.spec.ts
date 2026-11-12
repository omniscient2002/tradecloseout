import {uuidv7} from 'uuidv7';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {withTenantTransaction} from '@tradecloseout/db';
import {storeScopedConfiguration,loadConfigurationSources} from '../src/modules/configuration/configuration-store';
import {resolveConfigurationHierarchy} from '../src/modules/configuration/config-resolver';
import {ChecklistsService} from '../src/modules/checklists/checklists.service';

jest.setTimeout(180_000);

// Exact-source/tenant/concurrency mechanics only. Synthetic definitions do not
// certify an engineering mapping or independently approved production baseline.
describe('Phase2 persisted configuration identity and immutable lineage',()=>{
  it('reconstructs exact stored hierarchy, rejects forged/cross-scope versions and preserves archived definitions',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),org=uuidv7(),otherOrg=uuidv7(),project=uuidv7(),otherProject=uuidv7(),party=uuidv7(),contract=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic configuration author','ACTIVE')",[user]);
      for(const id of [org,otherOrg]) {
        await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic sources','Synthetic sources','KA')",[id]);
        await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[uuidv7(),id,user]);
      }
      for(const [id,tenant]of [[project,org],[otherProject,otherOrg]])await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,'SOURCE-FIXTURE','Synthetic source project','DRAFT',$3)`,[id,tenant,user]);
      await admin.query("INSERT INTO parties(id,org_id,name,types,status) VALUES($1,$2,'Synthetic contract party',ARRAY['CLIENT']::text[],'ACTIVE')",[party,org]);
      await admin.query(`INSERT INTO contracts(id,org_id,project_id,party_id,reference,status)
        VALUES($1,$2,$3,$4,'Synthetic contract','ACTIVE')`,[contract,org,project,party]);
      const context:any={orgId:org,userId:user,projectId:project,projectWrite:true,actorType:'MEMBER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-sources'};
      const tx=<T>(work:(c:any)=>Promise<T>,ctx=context)=>withTenantTransaction(app,ctx,c=>work(c));
      const platform=uuidv7();
      const base={key:'SYNTHETIC-BASE',groupKey:'SYNTHETIC',title:'Synthetic source definition',docTypeKey:'DT-018',mandatory:true,locked:true,scopeType:'PROJECT'};
      await admin.query(`INSERT INTO config_versions(id,level,scope_type,scope_id,version_no,schema_version,payload_json,checksum,status,format_version,source_manifest_json)
        VALUES($1,'PLATFORM','GLOBAL','00000000-0000-0000-0000-000000000000',1,1,$2,'computed','ACTIVE',1,'{"kind":"SYNTHETIC_PLATFORM_MECHANICS"}')`,[platform,JSON.stringify({requirements:[base]})]);
      const company=await tx(c=>storeScopedConfiguration(c,context,project,{level:'ORG',payload:{'branding.primary_color':'#123456'},sourceManifest:{kind:'SYNTHETIC_COMPANY'}}));
      const client=await tx(c=>storeScopedConfiguration(c,context,project,{level:'CLIENT_CONTRACT',scopeId:contract,payload:{requirements:[{
        key:'SYNTHETIC-CLIENT',groupKey:'SYNTHETIC',title:'Synthetic contract definition',docTypeKey:'DT-025',mandatory:false,scopeType:'PROJECT',
      }]},sourceManifest:{kind:'SYNTHETIC_CONTRACT'}}));
      const local=await tx(c=>storeScopedConfiguration(c,context,project,{level:'PROJECT',payload:{'naming.pattern':'SYNTHETIC-{project}'},sourceManifest:{kind:'SYNTHETIC_PROJECT'}}));
      const refs=[{level:'PLATFORM' as const,versionId:platform},{level:'ORG' as const,versionId:company.id},
        {level:'CLIENT_CONTRACT' as const,versionId:client.id},{level:'PROJECT' as const,versionId:local.id}];
      const loaded=await tx(c=>loadConfigurationSources(c,context,project,refs));
      const resolved=resolveConfigurationHierarchy(loaded);expect(resolved.conflicts).toHaveLength(0);
      const applied=await new ChecklistsService(app).createAndApplySnapshot(context,project,loaded);
      expect(applied.instantiatedRequirements).toBe(2);expect(applied.checksum).toBe(resolved.checksum);
      const snapshot=(await admin.query('SELECT source_json,provenance_json FROM checklist_snapshots WHERE id=$1',[applied.snapshotId])).rows[0];
      expect(snapshot.source_json.map((x:any)=>x.versionId)).toEqual(refs.map(x=>x.versionId));
      expect(snapshot.source_json.every((x:any)=>/^[a-f0-9]{64}$/.test(x.definitionChecksum))).toBe(true);
      expect(snapshot.provenance_json).toMatchObject({version:2,fields:{requirements:{level:'CLIENT_CONTRACT',versionId:client.id}}});
      expect(snapshot.provenance_json.items['checklist.requirements']['SYNTHETIC-BASE'].mandatory).toMatchObject({level:'PLATFORM',versionId:platform});
      await expect(tx(c=>c.query("UPDATE config_versions SET payload_json='{}' WHERE id=$1",[local.id]))).rejects.toMatchObject({code:'42501'});
      await expect(admin.query("UPDATE config_versions SET payload_json='{}' WHERE id=$1",[local.id])).rejects.toThrow('CONFIGURATION_VERSION_IMMUTABLE');
      await expect(tx(c=>c.query("UPDATE config_versions SET checksum='forged' WHERE id=$1",[local.id]))).rejects.toMatchObject({code:'42501'});
      await expect(tx(c=>c.query("INSERT INTO config_versions(id,level,scope_type,scope_id,version_no,schema_version,payload_json,checksum,format_version,status) VALUES($1,'PLATFORM','GLOBAL','00000000-0000-0000-0000-000000000000',2,1,'{}','forged',1,'ACTIVE')",[uuidv7()]))).rejects.toMatchObject({code:'42501'});
      const wrong={...context,orgId:otherOrg,projectId:otherProject};
      await expect(tx(c=>loadConfigurationSources(c,wrong,otherProject,[{level:'PROJECT',versionId:local.id}]),wrong)).rejects.toThrow('CONFIGURATION_SOURCE_NOT_FOUND');
      await expect(tx(c=>loadConfigurationSources(c,context,project,[{level:'ORG',versionId:local.id}]))).rejects.toMatchObject({response:{code:'CONFIGURATION_SOURCE_UNVERIFIED_OR_STALE'}});
      await tx(c=>c.query("UPDATE config_versions SET status='ARCHIVED' WHERE id=$1",[local.id]));
      expect(resolveConfigurationHierarchy(await tx(c=>loadConfigurationSources(c,context,project,refs))).checksum).toBe(applied.checksum);
      const historical=await tx(c=>loadConfigurationSources(c,context,project,refs,true));
      expect(resolveConfigurationHierarchy(historical).checksum).toBe(applied.checksum);
      await expect(tx(c=>c.query("UPDATE config_versions SET status='ACTIVE' WHERE id=$1",[local.id]))).rejects.toThrow('CONFIGURATION_VERSION_RETIRED');
      await expect(tx(c=>c.query('DELETE FROM config_versions WHERE id=$1',[local.id]))).rejects.toMatchObject({code:'42501'});
      expect((await admin.query('SELECT id FROM config_versions WHERE id=$1',[local.id])).rowCount).toBe(1);
      const projects=[uuidv7(),uuidv7()];
      for(const [index,id] of projects.entries())await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,$3,'Concurrent source publication','DRAFT',$4)`,[id,org,'CONCURRENT-'+index,user]);
      const sharedPayload={requirements:[{key:'SYNTHETIC-SHARED',groupKey:'SYNTHETIC',title:'Synthetic shared source',docTypeKey:'DT-025',mandatory:false,scopeType:'PROJECT'}]};
      const shared=await tx(c=>storeScopedConfiguration(c,context,project,{level:'ORG',payload:sharedPayload,sourceManifest:{kind:'SYNTHETIC_SHARED_DRAFT'}}));
      expect(shared.status).toBe('DRAFT');
      const concurrent=await Promise.allSettled(projects.map(id=>new ChecklistsService(app).createAndApplySnapshot(
        {...context,projectId:id,requestId:uuidv7()},id,[{level:'PLATFORM',versionId:platform,payload:{requirements:[base]}},
          {level:'ORG',versionId:shared.id,payload:sharedPayload}])));
      expect(concurrent.map(x=>x.status)).toEqual(['fulfilled','fulfilled']);
      expect((await admin.query('SELECT status,published_at FROM config_versions WHERE id=$1',[shared.id])).rows[0]).toMatchObject({status:'ACTIVE',published_at:expect.any(Date)});
      const wrongProject={...context,projectId:projects[0]};
      await expect(tx(c=>loadConfigurationSources(c,wrongProject,projects[0],[{level:'PROJECT',versionId:local.id}]),wrongProject)).rejects.toThrow('CONFIGURATION_SOURCE_NOT_FOUND');
      const checklists=new ChecklistsService(app);
      const {locked,...identical}=base;
      const replay=await checklists.importL3Checklist(context,project,{requirements:[identical as any]});
      expect(replay).toMatchObject({snapshotId:applied.snapshotId,replayed:true});
      const extra={key:'SYNTHETIC-EXTRA',groupKey:'SYNTHETIC',title:'Synthetic additive source',docTypeKey:'DT-025',mandatory:false,scopeType:'PROJECT' as const};
      const extended=await checklists.importL3Checklist(context,project,{requirements:[extra]});
      const next=(await admin.query('SELECT source_json,provenance_json,resolved_payload_json FROM checklist_snapshots WHERE id=$1',[extended.snapshotId])).rows[0];
      expect(next.source_json.filter((s:any)=>s.level!=='PROJECT').map((s:any)=>s.versionId)).toEqual([platform,company.id,client.id]);
      expect(next.provenance_json.items['checklist.requirements']['SYNTHETIC-BASE'].mandatory).toMatchObject({level:'PLATFORM',versionId:platform});
      expect(next.resolved_payload_json['naming.pattern']).toBe('SYNTHETIC-{project}');
      expect((await checklists.importL3Checklist(context,project,{requirements:[extra]})).snapshotId).toBe(extended.snapshotId);
      expect((await checklists.createSnapshot(context,project)).snapshotId).toBe(extended.snapshotId);
      expect((await admin.query('SELECT count(*)::int AS n FROM checklist_snapshots WHERE project_id=$1',[project])).rows[0].n).toBe(2);


    });
  });
  it('rejects malformed authoring scalars before SQL or trimming',async()=>{
    const service=new ChecklistsService({} as any),ctx:any={};
    for(const requirements of [[null],[{title:{},docTypeKey:'DT-018'}],[{title:'Synthetic',docTypeKey:'DT-018',mandatory:'false'}]]) {
      await expect(service.importL3Checklist(ctx,'invalid-not-used',{requirements} as any)).rejects.toMatchObject({status:422});
    }
    await expect(service.createRequirement(ctx,'invalid-not-used',{key:123,title:'Synthetic',docTypeCode:'DT-018'} as any)).rejects.toMatchObject({status:422});
  });

});
