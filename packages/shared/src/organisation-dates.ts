export const ORGANISATION_LOCALES=['en-IN','en-GB','en-US'] as const;
export const ORGANISATION_DATE_FORMATS=['DD MMM YYYY','DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'] as const;
export interface OrganisationDatePreferences{
 locale:typeof ORGANISATION_LOCALES[number];
 dateFormat:typeof ORGANISATION_DATE_FORMATS[number];
 timeZone:string;
}
export const DEFAULT_ORGANISATION_DATES:OrganisationDatePreferences={locale:'en-IN',dateFormat:'DD MMM YYYY',timeZone:'Asia/Kolkata'};
/** Presentation only. Calendar-only dates retain their day; legal deadline rules are separate. */
export function formatOrganisationDate(value:string|Date|null|undefined,preferences:OrganisationDatePreferences=DEFAULT_ORGANISATION_DATES,includeTime=false):string{
 if(value===null||value===undefined||value==='')return '—';
 const calendar=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
 const date=value instanceof Date?value:new Date(calendar?value+'T12:00:00Z':value);
 if(!Number.isFinite(date.getTime())||calendar&&date.toISOString().slice(0,10)!==value)return '—';
 const timeZone=calendar?'UTC':preferences.timeZone;
 const parts=new Intl.DateTimeFormat(preferences.locale,{year:'numeric',month:preferences.dateFormat==='DD MMM YYYY'?'short':'2-digit',day:'2-digit',timeZone}).formatToParts(date);
 const part=(name:string)=>parts.find(p=>p.type===name)?.value??'';
 const day=part('day'),month=part('month'),year=part('year');
 const result=preferences.dateFormat==='YYYY-MM-DD'?`${year}-${month}-${day}`:preferences.dateFormat==='MM/DD/YYYY'?`${month}/${day}/${year}`:
  preferences.dateFormat==='DD/MM/YYYY'?`${day}/${month}/${year}`:`${day} ${month} ${year}`;
 return includeTime&&!calendar?`${result} ${new Intl.DateTimeFormat(preferences.locale,{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:preferences.timeZone,timeZoneName:'short'}).format(date)}`:result;
}
