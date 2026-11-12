import {UnprocessableEntityException} from '@nestjs/common';
import {boundedJsonObject} from '../../common/validation/bounded-json';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STAGES=new Set(['MANUFACTURING','FAT','DISPATCH','DELIVERY','INSTALLATION','HANDOVER','WARRANTY']);
export interface ProcurementInput {
  poNumber:string;supplierPartyId:string;orderedAt?:string;promisedDeliveryAt?:string;
  totalAmountPaise?:number|string|null;notes?:string|null;
  lines:Array<{lineNo:number;assetCategoryKey:string;description:string;quantity?:number;assetId?:string;
    make?:string;model?:string;obligations?:Array<{docTypeKey:string;stageKey:string;title:string;dueDate?:string}>}>;
}
function bad():never{throw new UnprocessableEntityException({code:'INVALID_PROCUREMENT_INPUT'});}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);}
function date(v:unknown):v is string {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000-'))return false;
  const d=new Date(v+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function fields(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(k=>!keys.includes(k)))bad();}
export function parseProcurementInput(input:unknown,projectId:unknown):ProcurementInput {
  let raw:any;try{raw=boundedJsonObject(input,131072);}catch{bad();}
  fields(raw,['poNumber','supplierPartyId','orderedAt','promisedDeliveryAt','totalAmountPaise','notes','lines']);
  if(typeof projectId!=='string'||!UUID.test(projectId)||!text(raw.poNumber,120)||(typeof raw.supplierPartyId!=='string'||!UUID.test(raw.supplierPartyId))||
    !Array.isArray(raw.lines)||raw.lines.length<1||raw.lines.length>100)bad();
  for(const key of ['orderedAt','promisedDeliveryAt'])if(raw[key]!==undefined&&!date(raw[key]))bad();
  if(raw.orderedAt&&raw.promisedDeliveryAt&&raw.promisedDeliveryAt<raw.orderedAt)bad();
  if(raw.notes!==undefined&&raw.notes!==null&&(typeof raw.notes!=='string'||raw.notes.length>4000||raw.notes.includes('\0')))bad();
  if(raw.totalAmountPaise!==undefined&&raw.totalAmountPaise!==null){
    const v=raw.totalAmountPaise;
    if(!(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)&&!(typeof v==='string'&&/^\d{1,19}$/.test(v)))bad();
    if(BigInt(v)>9223372036854775807n)bad();raw.totalAmountPaise=BigInt(v).toString();
  }
  const lineNumbers=new Set<number>();let obligations=0;
  for(const line of raw.lines){
    if(!line||typeof line!=='object'||Array.isArray(line))bad();
    fields(line,['lineNo','assetCategoryKey','description','quantity','assetId','make','model','obligations']);
    if(!Number.isInteger(line.lineNo)||line.lineNo<1||line.lineNo>2147483647||lineNumbers.has(line.lineNo)||
      !text(line.assetCategoryKey,80)||!text(line.description,1000)||
      (line.quantity!==undefined&&(!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>2147483647))||
      (line.assetId!==undefined&&(typeof line.assetId!=='string'||!UUID.test(line.assetId))))bad();
    lineNumbers.add(line.lineNo);
    for(const key of ['make','model'])if(line[key]!==undefined&&!text(line[key],160))bad();
    if(line.obligations!==undefined&&(!Array.isArray(line.obligations)||line.obligations.length>100))bad();
    const schedule=new Set<string>();
    for(const obligation of line.obligations||[]){
      if(!obligation||typeof obligation!=='object'||Array.isArray(obligation))bad();
      fields(obligation,['docTypeKey','stageKey','title','dueDate']);
      if(typeof obligation.docTypeKey!=='string'||!/^DT-\d{3}$/.test(obligation.docTypeKey)||!STAGES.has(obligation.stageKey)||
        !text(obligation.title,200)||(obligation.dueDate!==undefined&&!date(obligation.dueDate)))bad();
      const identity=obligation.docTypeKey+':'+obligation.stageKey;
      if(schedule.has(identity)||++obligations>500)bad();schedule.add(identity);
    }
  }
  raw.poNumber=raw.poNumber.trim();return raw;
}
