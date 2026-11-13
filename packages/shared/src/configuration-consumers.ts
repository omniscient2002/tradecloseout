/** Supported naming tokens never allow a directory or extension injection. */
export function isSupportedPackageNamingPattern(value:unknown):value is string{
 return typeof value==='string'&&value.length>0&&value.length<=100&&
  /^(?:[A-Za-z0-9_.-]|\{projectCode\}|\{version\})+$/.test(value)&&!value.includes('..');
}
export function packageOutputFilename(pattern:unknown,projectCode:string,version:number):string{
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(projectCode)||!Number.isSafeInteger(version)||version<1)throw new Error('PACKAGE_OUTPUT_IDENTITY_INVALID');
 if(pattern==null)return `handover-${projectCode}-v${version}.pdf`;
 if(!isSupportedPackageNamingPattern(pattern))throw new Error('PACKAGE_NAMING_PATTERN_UNSUPPORTED');
 const name=pattern.replaceAll('{projectCode}',projectCode).replaceAll('{version}',String(version));
 return name.replace(/\.pdf$/i,'')+'.pdf';
}
/** Platform ceilings continue to apply even when an approved layer is present. */
export function assertConfiguredUploadPolicy(payload:unknown,sizeBytes:number,mimeType:string):void{
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return;
 const config=payload as Record<string,unknown>,max=config['security.max_file_size_bytes'],mimes=config['security.allowed_mime_types'];
 if(max!==undefined&&(!Number.isSafeInteger(max)||Number(max)<0||sizeBytes>Number(max)))throw new Error('CONFIGURED_FILE_SIZE_LIMIT');
 if(mimes!==undefined&&(!Array.isArray(mimes)||mimes.some(m=>typeof m!=='string')||!mimes.includes(mimeType)))throw new Error('CONFIGURED_FILE_TYPE_RESTRICTION');
}
export const SUPPORTED_REMINDER_EVENTS=['REQUIREMENT_DUE','WARRANTY_EXPIRING'] as const;
export function isSupportedReminderSchedule(value:unknown):value is {event:string;daysBefore:number}[]{
 if(!Array.isArray(value)||value.length>20)return false;
 const seen=new Set<string>();return value.every(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['event','daysBefore'].includes(k))||
   !SUPPORTED_REMINDER_EVENTS.includes(row.event)||!Number.isSafeInteger(row.daysBefore)||row.daysBefore<0||row.daysBefore>365)return false;
  const key=row.event+':'+row.daysBefore;if(seen.has(key))return false;seen.add(key);return true;
 });
}
