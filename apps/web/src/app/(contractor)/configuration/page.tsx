'use client';
import {useEffect,useState} from 'react';
import {apiFetch} from '../../../lib/api-client';
type Version={id:string;level:string;scope_id:string;version_no:number;status:string;checksum:string;source_pack_id?:string;parent_version_id?:string;created_by:string};
type Preview={conflicts:{path:string;message:string}[];sources:{level:string;versionId:string}[];baselineSnapshotId:string|null;baselineChecksum:string|null;proposedChecksum:string;unchanged:boolean;resolvedPayload:unknown};
type Change={id:string;status:string;reason:string;impact_json:unknown;requested_by:string};
export default function ConfigurationPage(){
 const [versions,setVersions]=useState<Version[]>([]),[selected,setSelected]=useState<string[]>([]),[project,setProject]=useState(''),[reason,setReason]=useState('');
 const [level,setLevel]=useState('ORG'),[scope,setScope]=useState(''),[payload,setPayload]=useState(''),[pack,setPack]=useState(''),[parent,setParent]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[changes,setChanges]=useState<Change[]>([]),[error,setError]=useState(''),[result,setResult]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setVersions(await apiFetch<Version[]>('/api/v1/configuration/versions'));}
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setResult('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function post(path:string,body?:unknown){return apiFetch<any>(path,{method:'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});}
 useEffect(()=>{void run(load);},[]);
 async function refreshProject(){setPreview(await post(`/api/v1/projects/${encodeURIComponent(project)}/configuration/preview`,{versionIds:selected}));setChanges(await apiFetch<Change[]>(`/api/v1/projects/${encodeURIComponent(project)}/change-requests`));}
 const projectPath='/api/v1/projects/'+encodeURIComponent(project);
 return <div className="mx-auto max-w-5xl p-6 space-y-6"><h1 className="text-2xl font-semibold">Configuration versions</h1>
 <p>Versions are immutable. Another owner or administrator must publish a draft. Active projects require a version-bound change request and independent approval before application.</p>
 {error&&<p role="alert" className="text-red-800">{error}</p>}<p role="status">{busy?'Working…':result}</p>
 <section className="rounded border bg-white p-4 space-y-3"><h2 className="text-xl font-semibold">Install a reviewed template</h2><p>Use a published pack ID from organisation setup. An upgrade creates a new draft and preserves existing project baselines.</p>
 <label className="block">Reviewed pack ID<input value={pack} onChange={e=>setPack(e.target.value)} className="ml-2 border p-2"/></label>
 <label className="block">Previous installed version ID (for upgrade)<input value={parent} onChange={e=>setParent(e.target.value)} className="ml-2 border p-2"/></label>
 <button disabled={busy||!pack} className="rounded border p-2" onClick={()=>void run(async()=>{await post('/api/v1/configuration/installations',{packId:pack,...(parent?{parentVersionId:parent}:{})});await load();setResult('Installed as a draft. Independent publication is required.');})}>Install draft</button></section>
 <section className="rounded border bg-white p-4 space-y-3"><h2 className="text-xl font-semibold">Author a version</h2>
 <label className="block">Level<select value={level} onChange={e=>setLevel(e.target.value)} className="ml-2 border p-2">{['ORG','CLIENT_CONTRACT','PROJECT'].map(l=><option key={l}>{l}</option>)}</select></label>
 <label className="block">Scope ID<input value={scope} onChange={e=>setScope(e.target.value)} className="ml-2 border p-2"/></label>
 <label className="block">Configuration JSON<textarea rows={7} value={payload} onChange={e=>setPayload(e.target.value)} className="block w-full border p-2 font-mono"/></label>
 <button disabled={busy||!scope||!payload} className="rounded border p-2" onClick={()=>void run(async()=>{await post('/api/v1/configuration/versions',{level,scopeId:scope,payload:JSON.parse(payload)});await load();setResult('Draft created.');})}>Create draft</button></section>
 <section className="space-y-3"><h2 className="text-xl font-semibold">Persisted versions</h2><button disabled={busy} onClick={()=>void run(load)} className="underline">Reload versions</button>
 <ul className="space-y-3">{versions.map(v=><li key={v.id} className="rounded border bg-white p-3 space-y-1 break-all"><label><input type="checkbox" disabled={busy||v.status!=='ACTIVE'} checked={selected.includes(v.id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,v.id]:ids.filter(id=>id!==v.id));setPreview(null);}}/> {v.level} v{v.version_no} · {v.status}</label><p className="text-xs">{v.id} · scope {v.scope_id}</p><p className="text-xs">SHA-256 {v.checksum}</p>{v.source_pack_id&&<p className="text-xs">Source pack {v.source_pack_id}</p>}
 {v.status==='DRAFT'&&<button disabled={busy} className="underline" onClick={()=>void run(async()=>{await post(`/api/v1/configuration/versions/${v.id}/publish`);await load();setResult('Version published.');})}>Independently publish</button>}
 {v.status==='ACTIVE'&&<button disabled={busy} className="underline" onClick={()=>void run(async()=>{await post(`/api/v1/configuration/versions/${v.id}/archive`);setSelected(ids=>ids.filter(id=>id!==v.id));setPreview(null);await load();setResult('Version archived. Existing baselines remain pinned.');})}>Archive</button>}</li>)}</ul></section>
 <section className="rounded border bg-white p-4 space-y-3"><h2 className="text-xl font-semibold">Project preview and impact</h2>
 <label className="block">Project ID<input value={project} onChange={e=>{setProject(e.target.value);setPreview(null);setChanges([]);}} className="ml-2 border p-2"/></label>
 <label className="block">Reason<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} className="block w-full border p-2"/></label>
 <button disabled={busy||!project||!selected.length} className="rounded border p-2" onClick={()=>void run(refreshProject)}>Preview selected versions</button>
 {preview&&<><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(preview,null,2)}</pre>
 <div className="flex flex-wrap gap-3"><button disabled={busy||reason.trim().length<5||preview.conflicts.length>0} className="rounded border p-2" onClick={()=>void run(async()=>{await post(projectPath+'/configuration/apply',{versionIds:selected,reason});await refreshProject();setResult('Draft baseline applied. Independent baseline review is required before activation.');})}>Apply to draft project</button>
 <button disabled={busy||reason.trim().length<5||!preview.baselineSnapshotId||preview.unchanged||preview.conflicts.length>0} className="rounded border p-2" onClick={()=>void run(async()=>{await post(projectPath+'/configuration/change-requests',{versionIds:selected,baselineSnapshotId:preview.baselineSnapshotId,reason});await refreshProject();setResult('Change proposed for independent review.');})}>Propose baseline change</button>
 <button disabled={busy||reason.trim().length<5||!preview.baselineSnapshotId} className="rounded border p-2" onClick={()=>void run(async()=>{await post(projectPath+'/checklists/review',{snapshotId:preview.baselineSnapshotId,checksum:preview.baselineChecksum,reason});setResult('Current baseline independently reviewed.');})}>Review current baseline</button></div></>}
 <ul>{changes.map(c=><li key={c.id} className="my-3 rounded border p-3"><p>{c.id} · {c.status} · {c.reason}</p><pre className="overflow-auto text-xs">{JSON.stringify(c.impact_json,null,2)}</pre>{c.status==='PENDING'&&<div className="flex gap-3">{['APPROVED','REJECTED'].map(decision=><button key={decision} disabled={busy} className="underline" onClick={()=>void run(async()=>{await post(`/api/v1/change-requests/${c.id}/decide`,{decision,comment:reason});await refreshProject();})}>{decision==='APPROVED'?'Independently approve':'Reject'}</button>)}</div>}{c.status==='APPROVED'&&<button disabled={busy} className="underline" onClick={()=>void run(async()=>{await post(projectPath+`/change-requests/${c.id}/apply`);await refreshProject();setResult('Approved change applied.');})}>Apply approved change</button>}</li>)}</ul>
 </section></div>;
}
