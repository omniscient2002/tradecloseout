import { DocumentsService } from '../src/modules/documents/documents.service';

function makeService(rows: unknown[]) {
  const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows }));
  const service = Object.create(DocumentsService.prototype) as DocumentsService;
  (service as any).db = {
    withTenantContext: async (_ctx: unknown, action: (client: unknown) => Promise<unknown>) =>
      action({ query }),
  };
  return { service, query };
}

describe('PH5-G22-004 current upload authority for deliberate local draft recovery', () => {
  it('accepts a live member scope without creating an upload or reading evidence', async () => {
    const { service, query } = makeService([
      { project_id: 'project-1', requirement_id: 'requirement-1' },
    ]);
    const result = await service.validateDraftRecoveryAuthority(
      { orgId: 'org-1', actorType: 'MEMBER', guestGrantId: null } as any,
      'project-1', 'requirement-1',
    );
    expect(result).toEqual({
      projectId: 'project-1', requirementId: 'requirement-1', allowed: true,
    });
    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("p.status IN ('DRAFT', 'ACTIVE', 'HANDOVER')");
    expect(statement).toContain('r.superseded_at IS NULL');
    expect(statement).toContain("r.status NOT IN ('SUPERSEDED', 'NOT_APPLICABLE', 'HANDED_OVER')");
  });

  it('fails closed on revoked, superseded or missing resource scope', async () => {
    const { service } = makeService([]);
    await expect(service.validateDraftRecoveryAuthority(
      { orgId: 'org-1', actorType: 'MEMBER', guestGrantId: null } as any,
      'project-1', 'requirement-1',
    )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');
  });

  it('never authorizes a guest grant through the member recovery path', async () => {
    const { service, query } = makeService([
      { project_id: 'project-1', requirement_id: 'requirement-1' },
    ]);
    await expect(service.validateDraftRecoveryAuthority(
      { orgId: 'org-1', actorType: 'GUEST', guestGrantId: 'grant-1' } as any,
      'project-1', 'requirement-1',
    )).rejects.toThrow('GUEST_DRAFT_RECOVERY_NOT_SUPPORTED');
    expect(query).not.toHaveBeenCalled();
  });
});
