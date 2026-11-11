import { MODULE_METADATA, PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod, Type } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../guards/permission.guard';

export type RegisteredHttpRoute={method:string;path:string;controller:string;handler:string;guards:Type[];permission?:string};
export function registeredHttpRoutes(root:Type):RegisteredHttpRoute[] {
  const seen=new Set<unknown>(),routes:RegisteredHttpRoute[]=[];
  const array=(value:string|string[]|undefined)=>Array.isArray(value)?value:[value||''];
  function visit(input:any):void {
    const module=input?.forwardRef?.()||input?.module||input;
    if(!module || seen.has(module))return;seen.add(module);
    for(const child of Reflect.getMetadata(MODULE_METADATA.IMPORTS,module)||[])visit(child);
    for(const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS,module)||[]){
      for(const name of Object.getOwnPropertyNames(controller.prototype)){
        const handler=controller.prototype[name];
        const method=Reflect.getMetadata(METHOD_METADATA,handler);
        if(method===undefined)continue;
        for(const prefix of array(Reflect.getMetadata(PATH_METADATA,controller))){
          for(const suffix of array(Reflect.getMetadata(PATH_METADATA,handler))){
            routes.push({method:RequestMethod[method],path:('/'+prefix+'/'+suffix).replace(/\/+/g,'/').replace(/\/$/,'')||'/',
              controller:controller.name,handler:name,
              guards:[...(Reflect.getMetadata(GUARDS_METADATA,controller)||[]),...(Reflect.getMetadata(GUARDS_METADATA,handler)||[])],
              permission:Reflect.getMetadata(REQUIRE_PERMISSION_KEY,handler)||Reflect.getMetadata(REQUIRE_PERMISSION_KEY,controller)});
          }
        }
      }
    }
  }
  visit(root);return routes.sort((a,b)=>(a.method+' '+a.path).localeCompare(b.method+' '+b.path));
}
