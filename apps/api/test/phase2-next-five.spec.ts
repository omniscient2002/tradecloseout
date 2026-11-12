import {PartiesService} from '../src/modules/parties/parties.service';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';
const ctx:any={orgId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',actorType:'USER',orgRole:'R-OWNER',requestId:'five-boundaries'};
const input=()=>({name:'Explicit counterparty',types:['SUPPLIER_OEM']});
describe('Phase2 next five directory and organisation boundaries',()=>{
  it.each([undefined,[],['OWNER'],['SUPPLIER_OEM','SUPPLIER_OEM'],[3],'SUPPLIER_OEM'])('D01 requires an explicit supported unique party classification',async types=>{
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};const body:any=input();
    if(types===undefined)delete body.types;else body.types=types;
    await expect(new PartiesService(db as any).createParty(ctx,body)).rejects.toMatchObject({status:422});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
  it.each([null,[],{...input(),name:4},{...input(),name:'Bad\u0000name'},
    {...input(),gstin:'not-a-gstin'},{...input(),email:'bad@example'},
    {...input(),phone:'call me'},{...input(),status:'ACTIVE'},{...input(),name:'x'.repeat(201)}])('D02 validates bounded directory inputs before SQL',async body=>{
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};
    await expect(new PartiesService(db as any).createParty(ctx,body as any)).rejects.toMatchObject({status:422});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
  it('D03 does not let a guest create a party using a stale internal role claim',async()=>{
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};
    await expect(new PartiesService(db as any).createParty({...ctx,actorType:'GUEST',guestGrantId:ctx.userId},input()))
      .rejects.toMatchObject({status:403});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
  it('D05 resolves current for invitation writes while rejecting another tenant before SQL',async()=>{
    const pool={connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))};
    const service=new OrganisationsService(pool as any);
    const actor={...ctx,actorType:'MEMBER'};
    await expect(service.createInvitation(actor,'current',{email:'next-five@example.invalid',role:'R-SITE'}))
      .rejects.toThrow('DATABASE_REACHED');
    await expect(service.revokeInvitation(actor,'current',ctx.userId)).rejects.toThrow('DATABASE_REACHED');
    pool.connect.mockClear();
    await expect(service.createInvitation(actor,ctx.userId,{email:'next-five@example.invalid',role:'R-SITE'}))
      .rejects.toMatchObject({status:404});
    await expect(service.revokeInvitation(actor,ctx.userId,ctx.userId)).rejects.toMatchObject({status:404});
    for(const call of [
      ()=>service.updateMemberRole(actor,ctx.userId,ctx.userId,{role:'R-SITE'}),
      ()=>service.suspendMember(actor,ctx.userId,ctx.userId),
      ()=>service.removeMember(actor,ctx.userId,ctx.userId),
      ()=>service.reassignWork(actor,ctx.userId,{fromUserId:ctx.userId,toUserId:ctx.orgId}),
      ()=>service.getOffboardingGapReport(actor,ctx.userId,ctx.userId),
    ])await expect(call()).rejects.toMatchObject({status:404});
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
