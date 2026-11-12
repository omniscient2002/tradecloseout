import {PartiesService} from '../src/modules/parties/parties.service';
const ctx:any={orgId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',actorType:'USER',orgRole:'R-OWNER',requestId:'po-boundaries'};
const project='00000000-0000-4000-8000-000000000003';
const valid=()=>({poNumber:'PO-SYNTHETIC',supplierPartyId:ctx.userId,orderedAt:'2027-01-01',lines:[{lineNo:1,assetCategoryKey:'SYNTHETIC',description:'Explicit supplier item',quantity:1,obligations:[{docTypeKey:'DT-018',stageKey:'DELIVERY',title:'Explicit obligation'}]}]});
describe('Phase2 procurement command input boundaries C01-C04/C07/C09',()=>{
  it.each([null,{}, {...valid(),lines:[]},{...valid(),poNumber:' '},{...valid(),supplierPartyId:'invalid'}])('C01 rejects invalid or empty orders before a transaction',async input=>{
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};
    await expect(new PartiesService(db as any).createProcurementOrder(ctx,project,input as any)).rejects.toMatchObject({status:422});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
  it.each([0,-1,1.5,Infinity,'1',2147483648])('C02 rejects invalid quantities %s',async quantity=>{
    const input:any=valid();input.lines[0].quantity=quantity;
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};
    await expect(new PartiesService(db as any).createProcurementOrder(ctx,project,input)).rejects.toMatchObject({status:422});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
  it('C02 rejects duplicate line numbers',async()=>{
    const input=valid();input.lines.push({...input.lines[0]});
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,input)).rejects.toMatchObject({status:422});
  });
  it.each([-1,0.1,Number.MAX_SAFE_INTEGER+1,'1e3','9223372036854775808'])('C03 rejects imprecise or out-of-range amounts %s',async amount=>{
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,{...valid(),totalAmountPaise:amount} as any)).rejects.toMatchObject({status:422});
  });
  it.each([{orderedAt:'2027-02-30'},{orderedAt:'2027-02-01',promisedDeliveryAt:'2027-01-01'},{promisedDeliveryAt:'tomorrow'}])('C04 rejects invalid calendar dates/chronology',async patch=>{
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,{...valid(),...patch})).rejects.toMatchObject({status:422});
  });
  it.each(['',undefined,'MADE_UP'])('C07 does not silently classify obligations as FAT: %s',async stage=>{
    const input:any=valid();if(stage===undefined)delete input.lines[0].obligations[0].stageKey;else input.lines[0].obligations[0].stageKey=stage;
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,input)).rejects.toMatchObject({status:422});
  });
  it('C07 rejects invalid obligation dates and unbounded schedules',async()=>{
    const input:any=valid();input.lines[0].obligations[0].dueDate='2027-02-30';
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,input)).rejects.toMatchObject({status:422});
    input.lines[0].obligations=Array.from({length:101},()=>({...valid().lines[0].obligations[0]}));
    await expect(new PartiesService({} as any).createProcurementOrder(ctx,project,input)).rejects.toMatchObject({status:422});
  });
  it('C09 suppliers cannot issue purchase orders through the command service',async()=>{
    const db={withTenantContext:jest.fn(),getPool:jest.fn()};
    await expect(new PartiesService(db as any).createProcurementOrder({...ctx,actorType:'GUEST',guestGrantId:ctx.userId},project,valid()))
      .rejects.toMatchObject({status:403});
    expect(db.withTenantContext).not.toHaveBeenCalled();expect(db.getPool).not.toHaveBeenCalled();
  });
});
