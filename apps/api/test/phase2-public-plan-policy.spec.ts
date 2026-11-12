import { BillingService, publicPlanLimits } from '../src/modules/billing/billing.service';

const valid = {
  maxActiveProjects: 4,
  maxSeats: 12,
  maxStorageBytes: 1048576,
  maxPackageGenerationsPerMonth: 0,
};

describe('PH2-G18-007: published offers are exact and fail closed', () => {
  it('preserves zero and accepts finite safe integer plan limits', () => {
    expect(publicPlanLimits(valid)).toEqual(valid);
    expect(publicPlanLimits({...valid, maxStorageBytes: Number.MAX_SAFE_INTEGER}))
      .toMatchObject({maxStorageBytes:Number.MAX_SAFE_INTEGER});
  });

  it.each([
    null, undefined, [], {}, { ...valid, maxActiveProjects: null },
    { ...valid, maxSeats: '12' }, { ...valid, maxSeats: 1.5 },
    { ...valid, maxSeats: -1 }, { ...valid, maxSeats: NaN },
    { ...valid, maxStorageBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, maxPackageGenerationsPerMonth: Infinity },
  ])('rejects missing, invalid or unsafe active offers', limits => {
    expect(() => publicPlanLimits(limits)).toThrow();
  });

  const list = async (rows: Array<Record<string, unknown>>) => {
    const query = jest.fn().mockResolvedValue({rows});
    const service = new BillingService({getPool: () => ({query})} as any);
    return service.listPlans();
  };

  it('exposes exact price paise without unsafe numeric INR conversion', async () => {
    const plans = await list([
      {id:'plan1',code:'P1',name:'Enterprise',price_paise:'9223372036854775807',
       interval:'YEAR',limits_json:valid},
      {id:'plan2',code:'P2',name:'Trial',price_paise:'0',
       interval:'MONTH',limits_json:valid},
    ]);
    expect(plans[0]).toMatchObject({
      pricePaise:'9223372036854775807',priceInr:null,
      maxProjects:4,storageGb:1048576/(1024**3),
      billingPeriod:'ANNUAL',
    });
    expect(plans[1]).toMatchObject({pricePaise:'0',priceInr:0,billingPeriod:'MONTHLY'});
    expect(plans[1]?.limits).toEqual(valid);
  });

  it('does not advertise active offers with malformed capacity', async () => {
    await expect(list([{id:'bad',code:'BAD',name:'Invalid',
      interval:'MONTH',price_paise:'50000',
      limits_json:{...valid,maxSeats:'unlimited'}}]))
      .rejects.toMatchObject({
        response:expect.objectContaining({code:'ACTIVE_PLAN_CONFIGURATION_INVALID'}),
      });
  });

  it('fails closed on a non-integer stored price', async () => {
    await expect(list([{id:'bad',code:'BAD',name:'Invalid',
      interval:'MONTH',price_paise:'1.20',limits_json:valid}]))
      .rejects.toMatchObject({
        response:expect.objectContaining({code:'ACTIVE_PLAN_CONFIGURATION_INVALID'}),
      });
  });
});
