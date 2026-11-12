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

  it('exposes stable directory fields without inventing financial or progress metrics', () => {
    const dto = service.projectDirectoryDto({
      id: 'project-1', code: 'HVAC-01', name: 'HVAC plant', status: 'ACTIVE',
      client_name: 'Contracted Client', mc_name: null,
      pmc_name: 'Engineering Consultant', contract_value_paise: '9007199254740993',
      target_handover_date: '2027-03-01', row_version: 3,
    }, true); // caller has a live commercial capability
    expect(dto).toMatchObject({
      clientName: 'Contracted Client', mcName: null, pmcName: 'Engineering Consultant',
      contractValuePaise: '9007199254740993', targetHandoverDate: '2027-03-01',
      rowVersion: 3,
    });
    expect(dto.approvedCount).toBeUndefined();
    expect(dto.retentionAtRiskPaise).toBeUndefined();
    const restricted = service.projectDirectoryDto({
      id: 'project-1', code: 'HVAC-01', name: 'HVAC plant',
      status: 'ACTIVE', contract_value_paise: '9007199254740993',
      settings_json: { retention_inr: 'HIDDEN' },
    }, false);
    expect(restricted.contractValuePaise).toBeNull();
    expect(restricted.contract_value_paise).toBeNull();
    expect(JSON.stringify(restricted)).not.toContain('HIDDEN');
  });

  it.each(['DRAFT', 'ACTIVE'])('permits %s commercial changes', async status => {
    await expect(service.lockEditableCommercialProject(client({ status, purged_at: null }), orgId, projectId))
      .resolves.toBeUndefined();
  });
});
