import { ProjectsService } from '../src/modules/projects/projects.service';
const project='00000000-0000-4000-8000-000000000001';
const doc='00000000-0000-4000-8000-000000000002';
const ctx:any={orgId:project,userId:doc,actorType:'MEMBER',orgRole:'R-OWNER',requestId:'spec-input',ip:'127.0.0.1',userAgent:'synthetic'};
const valid={specNumber:'SPEC-1',title:'Synthetic reference'};
describe('PH2-NEW-015: specification reference admission',()=>{
  it.each([null,[],3,{...valid,objectId:doc},{...valid,contractId:doc},{...valid,issuer:'Unsupported'},
    {...valid,orgId:doc},{...valid,specNumber:'SPEC\n1'},{...valid,title:'Reference\u0000title'},
    {...valid,division:'23\n00'},{...valid,division:null},{...valid,division:'x'.repeat(121)},
    {...valid,documentId:'bad-id'},{...valid,documentId:null}])('rejects malformed or unsupported reference %j',async dto=>{
      const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
      await expect(new ProjectsService(pool as any).createSpecification(ctx,project,dto as any)).rejects.toMatchObject({status:422});
      expect(pool.connect).not.toHaveBeenCalled();
    });
  it.each([null,'not-a-uuid',''])('rejects malformed project target %j',async id=>{
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createSpecification(ctx,id as any,valid)).rejects.toMatchObject({status:422});
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('never invokes a specification field getter',async()=>{
    const getter=jest.fn(()=>valid.title);
    const dto=Object.defineProperty({...valid},'title',{enumerable:true,get:getter});
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createSpecification(ctx,project,dto)).rejects.toMatchObject({status:422});
    expect(getter).not.toHaveBeenCalled();expect(pool.connect).not.toHaveBeenCalled();
  });
});
