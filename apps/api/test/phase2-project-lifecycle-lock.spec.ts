import { ProjectsService } from '../src/modules/projects/projects.service';

describe('PH2-G05-005: project commercial-write lifecycle fence', () => {
  const service = Object.create(ProjectsService.prototype) as any;
  const orgId = '00000000-0000-4000-8000-000000000001';
  const projectId = '00000000-0000-4000-8000-000000000002';

  const client = (project: Record<string, unknown> | null) => ({
    query: jest.fn().mockResolvedValue({ rows: project ? [project] : [] }),
  });

  it.each(['CLOSED', 'HANDOVER', 'SUSPENDED'])('blocks %s after acquiring the current project lock', async status => {
    const db = client({ status, purged_at: null });
    await expect(service.lockEditableCommercialProject(db, orgId, projectId))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_COMMERCIAL_WRITES_LOCKED' }) });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'), [orgId, projectId],
    );
  });

  it('blocks purged and missing projects', async () => {
    await expect(service.lockEditableCommercialProject(client({ status: 'ACTIVE', purged_at: new Date() }), orgId, projectId))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_COMMERCIAL_WRITES_LOCKED' }) });
    await expect(service.lockEditableCommercialProject(client(null), orgId, projectId)).rejects.toThrow();
  });

  it.each(['DRAFT', 'ACTIVE'])('permits %s commercial changes', async status => {
    await expect(service.lockEditableCommercialProject(client({ status, purged_at: null }), orgId, projectId))
      .resolves.toBeUndefined();
  });
});
