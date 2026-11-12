import { boundedJsonObject } from '../src/common/validation/bounded-json';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { OrganisationsController } from '../src/modules/organisations/organisations.controller';

const ctx:any={orgId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',actorType:'MEMBER',orgRole:'R-OWNER',requestId:'easy-ten'};
const forbiddenPool=()=>({connect:jest.fn().mockRejectedValue(new Error('DATABASE_REACHED'))});
const invalid=(code:string)=>({response:expect.objectContaining({code})});

describe('Phase2 easiest ten: pre-database runtime boundaries',()=>{
  it('B01 forwards the supplied project start date to the canonical validator/writer',async()=>{
    const service=new ProjectsService(forbiddenPool() as any);
    const draft=jest.spyOn(service,'createDraftProject').mockResolvedValue({projectId:'fixture'} as any);
    await service.createProject(ctx,{code:'START-DATE',name:'Start date project',startDate:'2027-02-01'} as any);
    expect(draft.mock.calls[0][1]).toMatchObject({startDate:'2027-02-01'});
  });
  it.each(['2027-02-30','2027-13-01','yesterday','',null,3])('B02 rejects invalid closure date %s before SQL',async value=>{
    const pool=forbiddenPool();
    await expect(new ProjectsService(pool as any).closeProject(ctx,ctx.orgId,undefined,{closureDate:value} as any))
      .rejects.toMatchObject(invalid('INVALID_CLOSURE_DATE'));
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('B03 rejects control characters in project renames consistently with creation',async()=>{
    const pool=forbiddenPool();
    await expect(new ProjectsService(pool as any).updateProject(ctx,ctx.orgId,{name:'Plant\nRoom'}))
      .rejects.toMatchObject(invalid('INVALID_PROJECT_NAME'));
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('B06 rejects oversized variation scope before SQL',async()=>{
    const pool=forbiddenPool();
    await expect(new ProjectsService(pool as any).createVariation(ctx,ctx.orgId,ctx.userId,
      {variationRef:'V1',title:'Scope change',costDeltaPaise:0,scopeDeltaJson:{detail:'x'.repeat(32769)}}))
      .rejects.toMatchObject(invalid('INVALID_VARIATION_SCOPE'));
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each([null,[],{channel:'PIGEON',eventKey:'TEST',dedupKey:'key',payload:{}}])('B07 rejects malformed notification envelopes',async dto=>{
    const db={withTenantContext:jest.fn()};
    await expect(new NotificationsService(db as any).createNotification({...ctx,actorType:'SYSTEM'},dto as any))
      .rejects.toMatchObject(invalid('INVALID_NOTIFICATION_INPUT'));
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
  it('B07 rejects cyclic or excessively deep notification payloads before SQL',async()=>{
    const db={withTenantContext:jest.fn()};const cycle:any={};cycle.self=cycle;
    let deep:any={};for(let i=0;i<100;i++)deep={nested:deep};
    for(const payload of [cycle,deep,{number:Infinity}]) {
      await expect(new NotificationsService(db as any).createNotification({...ctx,actorType:'USER'},
        {channel:'IN_APP',eventKey:'TEST',dedupKey:'key',payload}))
        .rejects.toMatchObject(invalid('INVALID_NOTIFICATION_INPUT'));
    }
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
  it('B06/B07 accepts bounded nested JSON without invoking getters or silently serializing non-JSON values',()=>{
    const getter=jest.fn(()=>true);const accessors=Object.defineProperty({},'secret',{enumerable:true,get:getter});
    const sparse=new Array(2);
    for(const value of [accessors,{big:1n},{date:new Date()}, {value:undefined}, {sparse}]) {
      expect(()=>boundedJsonObject(value,4096)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(boundedJsonObject({list:[1,true,null,{label:'Bounded value'}]},4096))
      .toEqual({list:[1,true,null,{label:'Bounded value'}]});
    expect(()=>boundedJsonObject({a:'x'.repeat(2500),b:'x'.repeat(2500)},4096)).toThrow();
    const detached=boundedJsonObject({value:'Original'},4096);expect(detached).toEqual({value:'Original'});
  });
  it('B08 cannot enable self-approval through a branding/profile edit',async()=>{
    const pool=forbiddenPool();
    await expect(new OrganisationsService(pool as any).updateOrgProfile(ctx,1,{allowSelfApproval:true}))
      .rejects.toMatchObject(invalid('SELF_APPROVAL_POLICY_NOT_SUPPORTED'));
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('B10 rejects a profile PATCH naming a different organisation through controller and service wrapper',async()=>{
    const pool=forbiddenPool();const service=new OrganisationsService(pool as any);
    const controller=new OrganisationsController(service);
    for(const call of [()=>service.updateOrganisation(ctx,ctx.userId,{rowVersion:1,displayName:'Valid name'}),
      ()=>controller.updateOrganisation({userContext:ctx},ctx.userId,{rowVersion:1,displayName:'Valid name'})]) {
      await expect(call()).rejects.toMatchObject(invalid('NOT_FOUND'));
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
