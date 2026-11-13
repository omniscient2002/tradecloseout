import { UnprocessableEntityException } from '@nestjs/common';
import { projectCommandRecord } from './project-command-input';
export type LifecycleInput={expectedRowVersion:number;reason?:string;closureDate?:string};
export function parseLifecycleInput(value:unknown,reasonRequired=false,allowClosure=false):LifecycleInput{
 const v=projectCommandRecord(value,['expectedRowVersion','reason',...(allowClosure?['closureDate']:[])],'INVALID_LIFECYCLE_INPUT');
 if(!Number.isSafeInteger(v.expectedRowVersion)||Number(v.expectedRowVersion)<1)
  throw new UnprocessableEntityException({code:'CURRENT_PROJECT_VERSION_REQUIRED'});
 if((reasonRequired&&v.reason===undefined)||(v.reason!==undefined&&
   (typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.trim().length>500||/[\u0000-\u001f\u007f]/.test(v.reason))))
  throw new UnprocessableEntityException({code:'PROJECT_TRANSITION_REASON_REQUIRED'});
 if(v.closureDate!==undefined&&(typeof v.closureDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.closureDate)||
  Number.isNaN(Date.parse(v.closureDate))||new Date(v.closureDate).toISOString().slice(0,10)!==v.closureDate))
  throw new UnprocessableEntityException({code:'INVALID_CLOSURE_DATE'});
 return {expectedRowVersion:Number(v.expectedRowVersion),...(v.reason===undefined?{}:{reason:(v.reason as string).trim()}),
  ...(v.closureDate===undefined?{}:{closureDate:v.closureDate as string})};
}
