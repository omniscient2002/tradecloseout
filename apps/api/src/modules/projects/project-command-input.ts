import { UnprocessableEntityException } from '@nestjs/common';

/** Snapshot only declared data fields; never execute request getters or retain its envelope. */
export function projectCommandRecord(value: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    throw new UnprocessableEntityException({code});
  }
  const keys=Reflect.ownKeys(value);
  if(keys.length>allowed.length)throw new UnprocessableEntityException({code});
  const result:Record<string,unknown>=Object.create(null);
  for(const key of keys){
    if(typeof key!=='string'||!allowed.includes(key))throw new UnprocessableEntityException({code});
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    if(!descriptor.enumerable||!('value' in descriptor))throw new UnprocessableEntityException({code});
    result[key]=descriptor.value;
  }
  return result;
}

export function requireProjectCommandId(value: unknown, code: string): void {
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new UnprocessableEntityException({code});
  }
}
