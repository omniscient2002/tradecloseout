'use client';
import {useEffect,useState} from 'react';
export default function UnsubscribePage(){
 const [token,setToken]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 useEffect(()=>{setToken(new URLSearchParams(window.location.search).get('token')??'');},[]);
 async function confirm(){setBusy(true);setMessage('');try{
  const response=await fetch('/api/v1/public/notifications/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('This link is invalid or expired. Use notification preferences after signing in.');
  setDone(true);setMessage('Email notifications for this category are disabled. Account security notices remain enabled.');
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <main className="mx-auto max-w-lg p-8 space-y-4"><h1 className="text-2xl font-semibold">Email preferences</h1><p>Confirm to stop nonessential emails for the category in this link.</p><p role="status">{message}</p>{!done&&<button disabled={busy||!token} onClick={()=>void confirm()} className="rounded border p-3">{busy?'Saving…':'Unsubscribe'}</button>}<p><a href="/notifications" className="underline">Manage notification preferences</a></p></main>;
}
