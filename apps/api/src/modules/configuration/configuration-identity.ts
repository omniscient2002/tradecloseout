import {createHash} from 'crypto';
function canonical(value:any):any{
 return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
}
export function configPayloadChecksum(value:unknown):string{
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
