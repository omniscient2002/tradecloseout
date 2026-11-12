import { resolveConfigV021, resolveConfigurationHierarchy } from '../src/modules/configuration/config-resolver';

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

  it('keeps authoritative provenance when a child restates a locked requirement identically', () => {
    const protectedRequirement = {
      key: 'SAFE-DOC', locked: true, mandatory: true,
      docTypeKey: 'DT-001', scopeType: 'PROJECT',
    };
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', { 'checklist.requirements': [protectedRequirement] }),
      ORG: layer('ORG', { 'checklist.requirements': [{ ...protectedRequirement }] }),
      PROJECT: layer('PROJECT', { 'checklist.requirements': [{ ...protectedRequirement }] }),
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.provenance['checklist.requirements']).toMatchObject({
      level: 'PLATFORM',
      versionId: 'phase2-platform',
    });
    expect(result.payload['checklist.requirements']).toEqual([
      expect.objectContaining({ key: 'SAFE-DOC', provenanceLevel: 'PLATFORM' }),
    ]);
  });

  it('materializes registered checklist requirements for snapshot consumers', () => {
    const requirements = [{ key: 'DOC-01', mandatory: true, title: 'Manual', docTypeKey: 'O_AND_M', scopeType: 'PROJECT' }];
    const result = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'checklist.requirements': requirements }),
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.payload.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'DOC-01', mandatory: true }),
    ]));
    expect(result.provenance.requirements).toEqual(result.provenance['checklist.requirements']);
  });

  it('rejects contradictory legacy and registered checklist requirements', () => {
    const result = resolveConfigV021({
      PROJECT: layer('PROJECT', {
        requirements: [{ key: 'DOC-01', mandatory: false }],
        'checklist.requirements': [{ key: 'DOC-01', mandatory: true }],
      }),
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'requirements' }),
    ]));
  });

  it('refuses unregistered policy, malformed type, forged registry prototypes and explicit null', () => {
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', {
        'security.retention_days': 730,
        'security.max_file_size_bytes': 'not-a-number',
      }),
      ORG: layer('ORG', {
        'policy.allowSelfApproval': true,
        'security.retention_days': null,
        'notifications.schedule': { hour: 9 },
        'naming.pattern': 'APPROVED-*',
      }),
    });
    expect(result.payload['security.retention_days']).toBe(730);
    expect(result.payload['security.max_file_size_bytes']).toBeUndefined();
    expect(result.payload['policy.allowSelfApproval']).toBeUndefined();
    expect(result.payload['notifications.schedule']).toBeUndefined();
    expect(result.payload['naming.pattern']).toBe('APPROVED-*');
    expect(result.conflicts.map(c => c.path)).toEqual(expect.arrayContaining([
      'security.max_file_size_bytes','policy.allowSelfApproval',
      'security.retention_days','notifications.schedule',
    ]));
    const forged = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'naming.pattern': 'UNSAFE' }, '__proto__'),
    });
    expect(forged.payload['naming.pattern']).toBeUndefined();
    expect(forged.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$schemaVersion' }),
    ]));
  });

  it('rejects dangerous nested object keys without mutating any prototypes', () => {
    const untrusted = JSON.parse('{"checklist.requirements":[{"key":"A-1","metadata":{"__proto__":{"admin":true}}}]}');
    const result = resolveConfigV021({ PROJECT: layer('PROJECT', untrusted) });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'checklist.requirements' }),
    ]));
    expect(result.payload['checklist.requirements']).toBeUndefined();
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('rejects duplicate keyed entries in one layer rather than letting the last silently win', () => {
    const result = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'checklist.requirements': [
        { key: 'DOC-1', mandatory: true },
        { key: 'DOC-1', mandatory: false },
      ] }),
    });
    expect(result.payload['checklist.requirements']).toHaveLength(1);
    expect(result.payload['checklist.requirements'][0].mandatory).toBe(true);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'key:DOC-1' }),
    ]));
  });

  it('deduplicates email recipients by normalized identity across layers', () => {
    const result = resolveConfigV021({
      ORG: layer('ORG', { 'notifications.extra_recipients': ['Ops@Example.com'] }),
      PROJECT: layer('PROJECT', { 'notifications.extra_recipients': [
        'ops@example.com', 'Owner@Example.org',
      ] }),
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.payload['notifications.extra_recipients']).toEqual([
      'ops@example.com', 'owner@example.org',
    ]);
  });

  it('rejects duplicated legacy configuration layers instead of silently dropping one', () => {
    const result = resolveConfigurationHierarchy([
      { level: 'PROJECT', versionId: 'v1', payload: { requirements: [{ key: 'FIRST' }] } },
      { level: 'PROJECT', versionId: 'v2', payload: { requirements: [{ key: 'SECOND' }] } },
    ]);
    expect(result.payload.requirements).toEqual([{ key: 'FIRST' }]);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$level', attemptedAtLevel: 'PROJECT' }),
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
