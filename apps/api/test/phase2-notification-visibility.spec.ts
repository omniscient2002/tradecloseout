import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { REQUIRE_PERMISSION_KEY } from '../src/common/guards/permission.guard';
import { hasPermission } from '@tradecloseout/shared';

describe('PH2-G20-002: notification recipient and project visibility', () => {
  it('never returns nullable-recipient broadcasts and gates project rows by live membership', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      ({ rows: sql.includes('FROM memberships') ? [{ role: 'R-PM' }] : [] }));
    const db = { withTenantContext: jest.fn(async (_ctx: unknown, handler: (client: { query: typeof query }) => Promise<unknown>) => handler({ query })) };
    const service = new NotificationsService(db as any);
    await service.listNotifications({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      actorType: 'USER',
      requestId: 'phase2-notification-list',
      orgRole: 'R-PM',
    });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('recipient_user_id = $2');
    expect(sql).not.toContain('recipient_user_id IS NULL');
    expect(sql).toContain("pm.status = 'ACTIVE'");
    expect(sql).toContain('p.purged_at IS NULL');
    expect(params?.[2]).toBe(false);
  });

  it('permits organisation administrators to see only addressed project notifications', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      ({ rows: sql.includes('FROM memberships') ? [{ role: 'R-ADMIN' }] : [] }));
    const db = { withTenantContext: jest.fn(async (_ctx: unknown, handler: (client: { query: typeof query }) => Promise<unknown>) => handler({ query })) };
    await new NotificationsService(db as any).listNotifications({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      actorType: 'USER',
      requestId: 'phase2-notification-admin',
      orgRole: 'R-ADMIN',
    });
    expect(query.mock.calls[1]?.[1]?.[2]).toBe(true);
  });
  it('revokes stale owner inbox bypass immediately after a role demotion', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      ({ rows: sql.includes('FROM memberships') ? [{ role: 'R-SITE' }] : [] }));
    const db = { withTenantContext: jest.fn(async (_ctx: unknown,
      fn: (client: {query: typeof query}) => Promise<unknown>) => fn({query})) };
    await new NotificationsService(db as any).listNotifications({
      orgId:'00000000-0000-4000-8000-000000000001',
      userId:'00000000-0000-4000-8000-000000000002',
      actorType:'USER',requestId:'phase2-demoted-owner',orgRole:'R-OWNER',
    });
    expect(query.mock.calls[1]?.[1]?.[2]).toBe(false);
  });

  it('permits a billing user to access their private inbox without document.read', () => {
    const handler = NotificationsController.prototype.listNotifications;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toBe('notification.read');
    expect(hasPermission({ orgRole: 'R-BILLING' }, 'notification.read').allowed).toBe(true);
    expect(hasPermission({ orgRole: 'R-BILLING' }, 'document.read').allowed).toBe(false);
    expect(hasPermission({ guestCapabilities: [] }, 'notification.read').allowed).toBe(false);
  });

  it('denies a guest without querying notification rows', async () => {
    const db = { withTenantContext: jest.fn() };
    await expect(new NotificationsService(db as any).listNotifications({
      orgId:'00000000-0000-4000-8000-000000000001',
      userId:'00000000-0000-4000-8000-000000000002',
      actorType:'GUEST',requestId:'phase2-guest-inbox',
    })).rejects.toMatchObject({
      response:expect.objectContaining({code:'NOTIFICATION_INBOX_RESTRICTED'}),
    });
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
});

describe('PH2-G20-001/002/006: notification creation cannot become an arbitrary mailer', () => {
  const actor = {
    orgId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    actorType: 'USER' as const,
    requestId: 'phase2-notification-creation',
    orgRole: 'R-PM',
  };
  const create = (db: any, payload: Record<string, unknown>) =>
    new NotificationsService(db).createNotification(actor, {
      channel: 'IN_APP', eventKey: 'REQUIREMENT_CHANGED', dedupKey: 'change-1', payload,
    });

  it('rejects caller-authored external messages before acquiring a connection', async () => {
    const db = { withTenantContext: jest.fn() };
    await expect(new NotificationsService(db as any).createNotification(actor, {
      channel: 'EMAIL', eventKey: 'SEND_SECRET', dedupKey: 'bad-1',
      payload: { retention: 'do not send' },
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EXTERNAL_NOTIFICATION_TEMPLATES_REQUIRED' }),
    });
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });

  it('does not rewrite the first stored event when a dedup key is reused', async () => {
    const original = {
      id: 'existing-event', project_id: null, event_key: 'REQUIREMENT_CHANGED',
      payload_json: { title: 'Original' },
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{role:'R-OWNER'}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [original] });
    const db = { withTenantContext: jest.fn(async (_ctx: any, fn: any) => fn({ query })) };
    await expect(create(db, { title: 'Modified' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOTIFICATION_DEDUP_CONFLICT' }),
    });
    expect(query.mock.calls[1]?.[0]).toContain('DO NOTHING');
  });

  it('accepts a byte-identical logical retry without touching the first row', async () => {
    const original = {
      id: 'existing-event', project_id: null, event_key: 'REQUIREMENT_CHANGED',
      payload_json: { a: 1, z: 2 },
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{role:'R-OWNER'}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [original] });
    const db = { withTenantContext: jest.fn(async (_ctx: any, fn: any) => fn({ query })) };
    const response = await create(db, { z: 2, a: 1 });
    expect(response.notification.id).toBe('existing-event');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('denies project POST after owner demotion when there is no live project membership', async () => {
    const projectId='00000000-0000-4000-8000-000000000003';
    const query=jest.fn(async (sql:string) => {
      if(sql.includes('SELECT id FROM projects')) return {rows:[{id:projectId}]};
      if(sql.includes('SELECT m.role FROM memberships')) return {rows:[{role:'R-SITE'}]};
      if(sql.includes('SELECT role,scope_json FROM project_members')) return {rows:[]};
      throw new Error('unexpected INSERT after revocation');
    });
    const db={withTenantContext:jest.fn(async (_ctx:unknown,
      fn:(client:{query:typeof query})=>Promise<unknown>)=>fn({query}))};
    await expect(new NotificationsService(db as any).createNotification(
      {...actor,orgRole:'R-OWNER'},{
        projectId,channel:'IN_APP',eventKey:'REQUIREMENT_CHANGED',
        dedupKey:'stale-owner-1',payload:{title:'Assignment changed'},
      },
    )).rejects.toThrow('PROJECT_NOT_FOUND');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO notifications'))).toBe(false);
  });

  it('denies project POST after organisation membership suspension, even with stale owner role', async () => {
    const projectId='00000000-0000-4000-8000-000000000003';
    const query=jest.fn(async (sql:string) => {
      if(sql.includes('SELECT id FROM projects')) return {rows:[{id:projectId}]};
      if(sql.includes('SELECT m.role FROM memberships')) return {rows:[]};
      throw new Error('unexpected query after membership removal');
    });
    const db={withTenantContext:jest.fn(async (_ctx:unknown,
      fn:(client:{query:typeof query})=>Promise<unknown>)=>fn({query}))};
    await expect(new NotificationsService(db as any).createNotification(
      {...actor,orgRole:'R-OWNER'},{
        projectId,channel:'IN_APP',eventKey:'REQUIREMENT_CHANGED',
        dedupKey:'revoked-1',payload:{title:'Assignment changed'},
      },
    )).rejects.toMatchObject({status:403,response:{code:'NOTIFICATION_ISSUER_REQUIRED'}});
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('allows active owner and trusted system producer without trusting stale HTTP roles', async () => {
    const projectId='00000000-0000-4000-8000-000000000003';
    const makeDb=()=>{
      const query=jest.fn(async (sql:string) => {
        if(sql.includes('SELECT id FROM projects')) return {rows:[{id:projectId}]};
        if(sql.includes('SELECT m.role FROM memberships')) return {rows:[{role:'R-OWNER'}]};
        if(sql.includes('INSERT INTO notifications')) return {rows:[{
          id:'created-notification',status:'SENT',gateway_state:'DELIVERED',
        }]};
        throw new Error('unexpected SQL');
      });
      return {query,db:{withTenantContext:jest.fn(async (_ctx:unknown,
        fn:(client:{query:typeof query})=>Promise<unknown>)=>fn({query}))}};
    };
    const owner=makeDb();
    const input={projectId,channel:'IN_APP' as const,eventKey:'REQUIREMENT_CHANGED',
      dedupKey:'current-owner-1',payload:{title:'Assignment changed'}};
    const result=await new NotificationsService(owner.db as any).createNotification(
      {...actor,orgRole:'R-SITE'},input);
    expect(result.notification.status).toBe('SENT');
    expect(owner.query.mock.calls.some(([sql])=>sql.includes('SELECT m.role FROM memberships'))).toBe(true);

    const system=makeDb();
    const accepted=await new NotificationsService(system.db as any).createNotification(
      {...actor,actorType:'SYSTEM',orgRole:undefined},{...input,dedupKey:'system-1'});
    expect(accepted.notification.status).toBe('SENT');
    expect(system.query.mock.calls.some(([sql])=>sql.includes('SELECT m.role FROM memberships'))).toBe(false);
  });

  it('denies owner-only commercial digests for a project reader', async () => {
    const db = { withTenantContext: jest.fn() };
    await expect(new NotificationsService(db as any).getOwnerDigest(actor, 'project')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OWNER_DIGEST_RESTRICTED' }),
    });
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
});
