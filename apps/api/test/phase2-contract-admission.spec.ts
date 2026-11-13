import { ProjectsService } from '../src/modules/projects/projects.service';

const project='00000000-0000-4000-8000-000000000001';
const party='00000000-0000-4000-8000-000000000002';
const ctx:any={orgId:project,userId:party,actorType:'MEMBER',orgRole:'R-OWNER',requestId:'contract-input',ip:'127.0.0.1',userAgent:'synthetic'};
const valid={contractRef:'C1',title:'Synthetic contract'};

describe('PH2-NEW-014: contract admission before SQL',()=>{
  it.each([null,[],12,{...valid,status:'ACTIVE'},{...valid,warrantyTerms:'Unsupported terms'},
    {...valid,orgId:party},{...valid,value_paise:100},{...valid,contractRef:'C\n1'},
    {...valid,title:'Contract\u007ftitle'},{...valid,retentionBps:null},{...valid,retentionBps:'500'},
    {...valid,retentionBps:10001},{...valid,valuePaise:null},{...valid,valuePaise:1.1},
    {...valid,valuePaise:Number.MAX_SAFE_INTEGER+1},{...valid,valuePaise:'9223372036854775808'},
    {...valid,partyId:'not-a-uuid'},{...valid,commencementDate:'2027-02-30'},
    {...valid,commencementDate:'2027-03-01',completionDate:'2027-02-01'}])(
    'rejects malformed or unsupported contract %j',async dto=>{
      const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
      await expect(new ProjectsService(pool as any).createContract(ctx,project,dto as any)).rejects.toMatchObject({status:422});
      expect(pool.connect).not.toHaveBeenCalled();
    });
  it.each([null,'not-a-uuid',''])('rejects malformed project target %j',async id=>{
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createContract(ctx,id as any,valid)).rejects.toMatchObject({status:422});
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('does not invoke an accessor to validate a contract',async()=>{
    const getter=jest.fn(()=>valid.title);
    const dto=Object.defineProperty({...valid},'title',{enumerable:true,get:getter});
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    await expect(new ProjectsService(pool as any).createContract(ctx,project,dto)).rejects.toMatchObject({status:422});
    expect(getter).not.toHaveBeenCalled();expect(pool.connect).not.toHaveBeenCalled();
  });
});
