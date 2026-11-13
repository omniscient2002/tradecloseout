'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiFetch} from '../../../lib/api-client';
type Setup={progress:{step:number;row_version:number;terms_accepted_at?:string;selected_template_pack_id?:string;completed_at?:string};termsVersion:string|null;termsUrl:string|null;templates:{id:string;name:string;code:string;version:number}[]};
export default function OnboardingPage(){
 const [data,setData]=useState<Setup|null>(null),[pack,setPack]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){try{const value=await apiFetch<Setup>('/api/v1/organisation-administration/onboarding');setData(value);setPack(value.progress.selected_template_pack_id??'');setConsent(!!value.progress.terms_accepted_at);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 async function save(complete=false){if(!data)return;setBusy(true);setError('');try{
  await apiFetch('/api/v1/organisation-administration/onboarding',{method:'POST',body:JSON.stringify({step:complete?4:Math.min(3,data.progress.step+1),rowVersion:data.progress.row_version,templatePackId:pack||null,...(!data.progress.terms_accepted_at&&consent?{acceptTerms:true,termsVersion:data.termsVersion}:{})})});await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 let termsUrl:string|null=null;try{const url=new URL(data?.termsUrl??'');if(url.protocol==='https:')termsUrl=url.toString();}catch{}
 return <div className="mx-auto max-w-2xl p-6 space-y-5"><h1 className="text-2xl font-semibold">Organisation setup</h1>{error&&<p role="alert" className="text-red-800">{error}</p>}
 {!data?<button onClick={()=>void load()}>Reload setup</button>:<><p role="status">{data.progress.completed_at?'Setup completed':`Saved step ${data.progress.step} of 4. You can return and resume.`}</p>
 <p><Link className="underline" href="/projects">Review projects and project teams</Link></p>
 {termsUrl&&data.termsVersion?<label className="block"><input type="checkbox" checked={consent} disabled={busy||!!data.progress.terms_accepted_at} onChange={e=>setConsent(e.target.checked)}/> I accept the <a href={termsUrl} target="_blank" rel="noreferrer" className="underline">organisation terms ({data.termsVersion})</a>.</label>:<p>Terms are awaiting configuration. Completion is unavailable.</p>}
 <label className="block">Reviewed HVAC template<select value={pack} disabled={busy||!!data.progress.completed_at} onChange={e=>setPack(e.target.value)} className="block w-full rounded border p-2"><option value="">Select a reviewed template</option>{data.templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.code} · version {t.version}</option>)}</select></label>
 {!data.templates.length&&<p>No reviewed template is published. Setup can be saved while engineering review is pending.</p>}
 <p>Template selection records your choice. Install and independently publish its configuration before creating a project baseline.</p><Link href="/configuration" className="underline">Manage configuration versions</Link>
 {!data.progress.completed_at&&<div className="flex gap-3"><button disabled={busy} onClick={()=>void save()} className="rounded border p-2">Save progress</button><button disabled={busy||!pack||!consent||!termsUrl} onClick={()=>void save(true)} className="rounded border p-2">Complete setup</button></div>}</>}
 </div>;
}
