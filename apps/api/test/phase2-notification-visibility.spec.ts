import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('PH2-G20-002: notification recipient and project visibility', () => {
  it('never returns nullable-recipient broadcasts and gates project rows by live membership', async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
    const db = { withTenantContext: jest.fn(async (_ctx: unknown, handler: (client: { query: typeof query }) => Promise<unknown>) => handler({ query })) };
    const service = new NotificationsService(db as any);
    await service.listNotifications({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      actorType: 'USER',
      requestId: 'phase2-notification-list',
      orgRole: 'R-PM',
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('recipient_user_id = $2');
    expect(sql).not.toContain('recipient_user_id IS NULL');
    expect(sql).toContain("pm.status = 'ACTIVE'");
    expect(sql).toContain('p.purged_at IS NULL');
    expect(params[2]).toBe(false);
  });

  it('permits organisation administrators to see only addressed project notifications', async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
    const db = { withTenantContext: jest.fn(async (_ctx: unknown, handler: (client: { query: typeof query }) => Promise<unknown>) => handler({ query })) };
    await new NotificationsService(db as any).listNotifications({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      actorType: 'USER',
      requestId: 'phase2-notification-admin',
      orgRole: 'R-ADMIN',
    });
    expect(query.mock.calls[0][1][2]).toBe(true);
  });
});
