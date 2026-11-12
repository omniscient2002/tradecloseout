import { resolveConfigV021 } from '../src/modules/configuration/config-resolver';

const layer = (level: 'PLATFORM' | 'ORG' | 'PROJECT', payload: Record<string, unknown>, schemaVersion = 'v1.0') => ({
  level,
  versionId: `phase2-${level.toLowerCase()}`,
  schemaVersion,
  payload,
});

describe('Phase 2 configuration fail-closed boundaries', () => {
  it('rejects unsupported schemas instead of treating their values as permissive overrides', () => {
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', { 'security.max_file_size_bytes': 1024 }),
      ORG: layer('ORG', { 'security.max_file_size_bytes': 99999 }, 'v99'),
    });
    expect(result.payload['security.max_file_size_bytes']).toBe(1024);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'ORG', path: '$schemaVersion' }),
    ]));
  });

  it('rejects a forged layer identity', () => {
    const forged = { ...layer('ORG', { 'naming.pattern': 'unsafe' }), level: 'PROJECT' as const };
    const result = resolveConfigV021({ ORG: forged });
    expect(result.payload['naming.pattern']).toBeUndefined();
    expect(result.conflicts[0]).toEqual(expect.objectContaining({ path: '$level' }));
  });

  it('does not allow a project patch to unlock or make a locked requirement optional', () => {
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', { 'checklist.requirements': [
        { key: 'air-test', locked: true, mandatory: true, title: 'Air test' },
      ] }),
      PROJECT: layer('PROJECT', { 'checklist.requirements': [
        { key: 'air-test', locked: false, mandatory: false, title: 'Bypass' },
      ] }),
    });
    expect(result.payload['checklist.requirements'][0]).toMatchObject({
      key: 'air-test', locked: true, mandatory: true, title: 'Air test',
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'PROJECT', path: 'key:air-test' }),
    ]));
  });

  it('does not permit an organisation to establish platform-owned security settings when the platform layer is missing', () => {
    const result = resolveConfigV021({
      ORG: layer('ORG', { 'security.retention_days': 0 }),
    });
    expect(result.payload['security.retention_days']).toBeUndefined();
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'security.retention_days', level: 'ORG' }),
    ]));
  });

  it('protects locked reviewer, scope and document type even when mandatory stays true', () => {
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', { 'checklist.requirements': [
        { key: 'air-test', locked: true, mandatory: true, reviewerRole: 'R-QA', docTypeKey: 'DT-001' },
      ] }),
      PROJECT: layer('PROJECT', { 'checklist.requirements': [
        { key: 'air-test', locked: true, mandatory: true, reviewerRole: 'R-PM', docTypeKey: 'DT-002' },
      ] }),
    });
    expect(result.payload['checklist.requirements'][0]).toMatchObject({
      reviewerRole: 'R-QA', docTypeKey: 'DT-001',
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'key:air-test', level: 'PROJECT' }),
    ]));
  });

  it('refuses prototype keys and missing merge keys', () => {
    const result = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'checklist.groups': [
        { key: '__proto__', title: 'unsafe' },
        { title: 'missing-key' },
        { key: 'accepted', title: 'safe' },
      ] }),
    });
    expect(result.payload['checklist.groups']).toEqual([
      expect.objectContaining({ key: 'accepted', title: 'safe' }),
    ]);
    expect(result.conflicts).toHaveLength(2);
  });
});
