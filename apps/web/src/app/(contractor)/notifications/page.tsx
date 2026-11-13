'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiFetch} from '../../../lib/api-client';
type Notice={id:string;title:string;channel:string;status:string;gatewayState:string;createdAt:string;readAt:string|null;link:string};
type Inbox={items:Notice[];nextCursor:string|null;unreadCount:number};
type Preference={category:string;channel:string;enabled:boolean;digest:string;row_version:number};
type Preferences={categories:string[];channels:string[];items:Preference[]};
export default function NotificationsPage(){
 const [inbox,setInbox]=useState<Inbox|null>(null),[preferences,setPreferences]=useState<Preferences|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(cursor?:string){setBusy(true);setError('');try{
  const [next,prefs]=await Promise.all([apiFetch<Inbox>('/api/v1/notifications/inbox?limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),apiFetch<Preferences>('/api/v1/notification-preferences')]);
  setInbox(previous=>cursor&&previous?{...next,items:[...previous.items,...next.items]}:next);setPreferences(prefs);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 async function read(id:string){setBusy(true);setError('');try{const next=await apiFetch<Notice>('/api/v1/notifications/'+id+'/read',{method:'POST'});
  setInbox(previous=>previous?{...previous,unreadCount:Math.max(0,previous.unreadCount-(previous.items.find(n=>n.id===id)?.readAt?0:1)),items:previous.items.map(n=>n.id===id?next:n)}:previous);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(category:string,channel:string,enabled:boolean){setBusy(true);setError('');try{
  const previous=preferences?.items.find(p=>p.category===category&&p.channel===channel);
  await apiFetch('/api/v1/notification-preferences',{method:'POST',body:JSON.stringify({category,channel,enabled,digest:previous?.digest??'IMMEDIATE',rowVersion:previous?.row_version??0})});
  await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="mx-auto max-w-4xl p-6 space-y-6"><h1 className="text-2xl font-semibold">Notifications</h1>
  {error&&<p role="alert" className="text-red-800">{error} <button onClick={()=>void load()} className="underline">Reload</button></p>}
  <p aria-live="polite">{inbox?`${inbox.unreadCount} unread`:'Loading inbox…'}</p>
  <ul className="space-y-3">{inbox?.items.map(n=><li key={n.id} className="rounded border bg-white p-4 flex justify-between gap-4"><div><Link href={n.link} className="font-medium underline">{n.title}</Link><p className="text-sm text-slate-600">{new Date(n.createdAt).toLocaleString()} · {n.channel} · {n.gatewayState}</p></div>{!n.readAt&&<button disabled={busy} onClick={()=>void read(n.id)} className="underline disabled:opacity-50">Mark read</button>}</li>)}</ul>
  {inbox?.items.length===0&&<p>No notifications are currently visible.</p>}
  {inbox?.nextCursor&&<button disabled={busy} className="rounded border p-2" onClick={()=>void load(inbox.nextCursor!)}>Load more</button>}
  <section className="space-y-3"><h2 className="text-xl font-semibold">Delivery preferences</h2><p>Account security notices remain enabled. Changes apply to future delivery attempts.</p>
   {preferences?.categories.map(category=><fieldset key={category} disabled={busy} className="rounded border bg-white p-3"><legend className="px-1">{category.replaceAll('_',' ')}</legend><div className="flex flex-wrap gap-5">{preferences.channels.map(channel=>{
    const preference=preferences.items.find(p=>p.category===category&&p.channel===channel);
    return <label key={channel} className="flex gap-2"><input type="checkbox" checked={preference?.enabled??true} onChange={e=>void save(category,channel,e.target.checked)}/>{channel.replaceAll('_',' ')}</label>;
   })}</div></fieldset>)}
  </section></div>;
}
