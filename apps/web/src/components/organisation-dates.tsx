'use client';
import {createContext,useCallback,useContext,useEffect,useState,ReactNode} from 'react';
import {DEFAULT_ORGANISATION_DATES,formatOrganisationDate,OrganisationDatePreferences} from '@tradecloseout/shared';
import {apiFetch} from '../lib/api-client';
const Context=createContext(DEFAULT_ORGANISATION_DATES);
export function OrganisationDatesProvider({children}:{children:ReactNode}){
 const [preferences,setPreferences]=useState(DEFAULT_ORGANISATION_DATES),[error,setError]=useState(false);
 useEffect(()=>{
  let current=true;
  const refresh=()=>{void apiFetch<OrganisationDatePreferences>('/api/v1/orgs/current/date-preferences').then(data=>{if(current){setPreferences(data);setError(false);}}).catch(()=>{if(current)setError(true);});};
  refresh();window.addEventListener('organisation-dates-changed',refresh);
  return()=>{current=false;window.removeEventListener('organisation-dates-changed',refresh);};
 },[]);
 return <Context.Provider value={preferences}>{error&&<p role="alert" className="p-3 text-amber-900">Organisation date preferences could not be loaded. Dates currently use the default India format. <button className="underline" onClick={()=>window.dispatchEvent(new Event('organisation-dates-changed'))}>Retry</button></p>}{children}</Context.Provider>;
}
export function useOrganisationDate(){
 const preferences=useContext(Context);
 return useCallback((value:string|Date|null|undefined,includeTime=false)=>formatOrganisationDate(value,preferences,includeTime),[preferences]);
}
