import { ProjectsService } from '../src/modules/projects/projects.service';

const ctx:any={orgId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',
  actorType:'MEMBER',orgRole:'R-OWNER',requestId:'project-input',ip:'127.0.0.1',userAgent:'synthetic'};
const valid={code:'ADMISSION',name:'Synthetic project'};
const pool=()=>({connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))});

describe('PH2-NEW-013: project creation admits a bounded detached contract',()=>{
  it.each([null,[],12,'project',{...valid,status:'ACTIVE'},{...valid,orgId:ctx.userId},
    {...valid,createdBy:ctx.userId},{...valid,unexpected:true},{...valid,siteJson:{}},{...valid,settingsJson:{}}])(
    'public create rejects malformed or unsupported input %j',async input=>{
      const db=pool();
      await expect(new ProjectsService(db as any).createProject(ctx,input as any)).rejects.toMatchObject({status:422});
      expect(db.connect).not.toHaveBeenCalled();
    });
  it.each([null,[],12,'project',{...valid,status:'ACTIVE'},{...valid,unexpected:true}])(
    'direct draft create rejects malformed or unsupported input %j',async input=>{
      const db=pool();
      await expect(new ProjectsService(db as any).createDraftProject(ctx,input as any)).rejects.toMatchObject({status:422});
      expect(db.connect).not.toHaveBeenCalled();
    });
  it.each(['createProject','createDraftProject'] as const)('rejects explicit null project type through %s',async method=>{
    const db=pool();await expect(new ProjectsService(db as any)[method](ctx,{...valid,projectType:null} as any))
      .rejects.toMatchObject({status:422});
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each(['siteJson','settingsJson'])('validates %s as bounded JSON before connecting',async field=>{
    const cyclic:any={};cyclic.self=cyclic;let deep:any={};for(let i=0;i<25;i++)deep={nested:deep};
    const accessor=Object.defineProperty({},'value',{enumerable:true,get:()=>{throw new Error('GETTER_INVOKED');}});
    for(const value of [null,[],false,'text',{description:'x'.repeat(32769)},cyclic,deep,accessor,{number:Infinity},new Date()]){
      const db=pool();
      await expect(new ProjectsService(db as any).createDraftProject(ctx,{...valid,[field]:value} as any))
        .rejects.toMatchObject({status:422});
      expect(db.connect).not.toHaveBeenCalled();
    }
  });
  it.each(['createProject','createDraftProject'] as const)('rejects envelope getters before invocation through %s',async method=>{
    const getter=jest.fn(()=> 'Synthetic project');
    const input=Object.defineProperty({...valid},'name',{enumerable:true,get:getter});const db=pool();
    await expect(new ProjectsService(db as any)[method](ctx,input)).rejects.toMatchObject({status:422});
    expect(getter).not.toHaveBeenCalled();expect(db.connect).not.toHaveBeenCalled();
  });
  it.each(['createProject','createDraftProject'] as const)('rejects inherited, symbolic and hidden fields through %s',async method=>{
    for(const input of [Object.assign(Object.create({status:'ACTIVE'}),valid),{...valid,[Symbol('hidden')]:true},
      Object.defineProperty({...valid},'status',{value:'ACTIVE'})]){
      const db=pool();await expect(new ProjectsService(db as any)[method](ctx,input)).rejects.toMatchObject({status:422});
      expect(db.connect).not.toHaveBeenCalled();
    }
  });
});
