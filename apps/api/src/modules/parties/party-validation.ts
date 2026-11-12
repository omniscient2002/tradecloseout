import {UnprocessableEntityException} from '@nestjs/common';
import {canonicalAuthenticationEmail,isSafeIdentityName,isValidIndianGstin} from '@tradecloseout/shared';
import {boundedJsonObject} from '../../common/validation/bounded-json';

// 08-DATA-MODEL-AND-ERD directory vocabulary, plus the existing SUPPLIER
// alias consumed by procurement. Directory labels confer no principal authority.
const PARTY_TYPES=new Set(['CLIENT','MC','CONSULTANT','SUPPLIER_OEM','SUB_SUBCONTRACTOR','LAB','INSURER','OTHER','SUPPLIER']);
export interface PartyInput {name:string;types:string[];gstin?:string|null;email?:string|null;phone?:string|null;}
export interface ParsedPartyInput {name:string;types:string[];gstin:string|null;email:string|null;phone:string|null;}
function bad(field:string):never {
  throw new UnprocessableEntityException({code:'INVALID_PARTY_INPUT',fieldErrors:[{field,message:'Unsupported or invalid value'}]});
}
export function parsePartyInput(input:unknown):ParsedPartyInput {
  let raw:Record<string,unknown>;
  try {raw=boundedJsonObject(input,8192);} catch {bad('body');}
  for(const key of Object.keys(raw))if(!['name','types','gstin','email','phone'].includes(key))bad(key);
  if(!isSafeIdentityName(raw.name,200))bad('name');
  if(!Array.isArray(raw.types)||raw.types.length<1||raw.types.length>PARTY_TYPES.size||
      raw.types.some(v=>typeof v!=='string'||!PARTY_TYPES.has(v))||new Set(raw.types).size!==raw.types.length)bad('types');
  const optional=(field:string):string|null=>{
    const value=raw[field];
    if(value===null||value===undefined)return null;
    if(typeof value!=='string')bad(field);
    return value.trim()||null;
  };
  const gstin=optional('gstin');if(gstin!==null&&!isValidIndianGstin(gstin))bad('gstin');
  const email=optional('email');const canonicalEmail=email===null?null:canonicalAuthenticationEmail(raw.email);
  if(email!==null&&!canonicalEmail)bad('email');
  const phone=optional('phone');
  // Directory syntax accepts international mobile and landline E.164 values.
  // Allocation, identity verification and provider eligibility are separate.
  if(phone!==null&&(!/^\+[1-9]\d{1,14}$/.test(phone)||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(raw.phone as string)))bad('phone');
  return {name:raw.name.trim(),types:raw.types as string[],gstin:gstin?.toUpperCase()??null,email:canonicalEmail,phone};
}
