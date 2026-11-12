import { NotificationsService } from '../src/modules/notifications/notifications.service';

const ctx: any = {orgId:'00000000-0000-4000-8000-000000000001',
  userId:'00000000-0000-4000-8000-000000000002',actorType:'USER',requestId:'issuer-boundary'};
const dto = {channel:'IN_APP' as const,eventKey:'TEST',dedupKey:'test',payload:{title:'Test'}};

describe('notification issuer boundary', () => {
  it.each([{actorType:'GUEST'},{actorType:'USER',guestGrantId:'grant'},
    {actorType:'SYSTEM',guestGrantId:'grant'},{actorType:'UNKNOWN'}])(
    'rejects unsupported or guest principals before database use: %j', async principal => {
      const db={withTenantContext:jest.fn()};
      await expect(new NotificationsService(db as any).createNotification({...ctx,...principal},dto))
        .rejects.toMatchObject({status:403,response:{code:'NOTIFICATION_ISSUER_REQUIRED'}});
      expect(db.withTenantContext).not.toHaveBeenCalled();
    });
  it('retains the explicit trusted SYSTEM path without interactive membership claims', async () => {
    const query=jest.fn().mockResolvedValue({rows:[{id:'system-event'}]});
    const db={withTenantContext:jest.fn(async (_ctx:any,fn:any)=>fn({query}))};
    const result=await new NotificationsService(db as any).createNotification({...ctx,actorType:'SYSTEM'},dto);
    expect(result.notification.id).toBe('system-event');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO notifications');
  });
});
