import { ProjectsService } from '../src/modules/projects/projects.service';

const project='00000000-0000-4000-8000-000000000001';
const contract='00000000-0000-4000-8000-000000000002';
const ctx:any={orgId:project,userId:contract,actorType:'MEMBER',orgRole:'R-OWNER',requestId:'variation-input',ip:'127.0.0.1',userAgent:'synthetic'};
const valid={variationRef:'VAR-1',title:'Synthetic proposal',costDeltaPaise:0};

describe('PH2-NEW-012: explicit variation proposals before SQL',()=>{
  const invalid=[
    null, [], 'proposal', {...valid,costDeltaPaise:undefined}, {...valid,costDeltaPaise:null},
    {...valid,status:'APPROVED'}, {...valid,approvedBy:contract}, {...valid,unexpected:true},
    {...valid,variationRef:'VAR\n1'}, {...valid,title:'Proposal\u0000title'},
    {...valid,costDeltaPaise:1.1}, {...valid,costDeltaPaise:'1e3'},
    {...valid,costDeltaPaise:Number.MAX_SAFE_INTEGER+1},
    {...valid,costDeltaPaise:'9223372036854775808'},
    {...valid,costDeltaPaise:'-9223372036854775809'},
  ];
  it.each(invalid)('rejects malformed, ambiguous or unsupported proposal %j',async input=>{
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createVariation(ctx,project,contract,input as any))
      .rejects.toMatchObject({status:422});
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each([[null,contract],[project,'not-a-uuid'],['',contract]])('rejects invalid target IDs %j %j',async(p,c)=>{
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createVariation(ctx,p as any,c as any,valid))
      .rejects.toMatchObject({status:422});
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('never invokes accessor fields during admission',async()=>{
    const getter=jest.fn(()=> 'Accessor proposal');
    const input=Object.defineProperty({...valid},'title',{enumerable:true,get:getter});
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createVariation(ctx,project,contract,input))
      .rejects.toMatchObject({status:422});
    expect(getter).not.toHaveBeenCalled();expect(pool.connect).not.toHaveBeenCalled();
  });
});
