import { resolveConfigV021, resolveConfigurationHierarchy } from '../src/modules/configuration/config-resolver';
import { ChecklistsService, assertLockedChecklistBaselineInvariant } from '../src/modules/checklists/checklists.service';

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

  it('does not treat differently ordered locked JSON objects as a policy change', () => {
    const platform=layer('PLATFORM',{'checklist.requirements':[
      {key:'ORDERED',locked:true,validityRule:{reviewed:true,rule:'explicit'}},
    ]});
    const project=layer('PROJECT',{'checklist.requirements':[
      {key:'ORDERED',locked:true,validityRule:{rule:'explicit',reviewed:true}},
    ]});
    const result=resolveConfigV021({PLATFORM:platform,PROJECT:project});
    expect(result.conflicts).toHaveLength(0);
    expect(result.provenance['checklist.requirements']).toMatchObject({level:'PLATFORM'});
  });

  it('does not allow a source layer to omit or forge its immutable version identity', () => {
    const result = resolveConfigV021({
      PROJECT: { ...layer('PROJECT', { 'naming.pattern': 'unsafe' }), versionId: '' },
    });
    expect(result.payload['naming.pattern']).toBeUndefined();
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$versionId' }),
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

  it('applies locked-item inheritance to the legacy requirements path used by snapshots', () => {
    const locked = { key: 'REQUIRED-SAFETY', title: 'Safety test',
      mandatory: true, locked: true, reviewerRole: 'R-QC', scopeType: 'PROJECT' };
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', { requirements: [locked] }),
      PROJECT: layer('PROJECT', { requirements: [
        { key: 'REQUIRED-SAFETY', mandatory: false, reviewerRole: 'R-PM' },
      ] }),
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'key:REQUIRED-SAFETY', level: 'PROJECT' }),
    ]));
    expect(result.payload.requirements).toEqual([
      expect.objectContaining({ ...locked, provenanceLevel: 'PLATFORM' }),
    ]);
  });

  it('rejects switching between flat and registered requirement encodings across layers', () => {
    const result = resolveConfigV021({
      PLATFORM: layer('PLATFORM', {
        requirements: [{ key: 'MANDATORY', locked: true, mandatory: true }],
      }),
      PROJECT: layer('PROJECT', {
        'checklist.requirements': [{ key: 'MANDATORY', mandatory: false }],
      }),
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'requirements', level: 'PROJECT' }),
    ]));
    expect(result.payload.requirements[0]).toMatchObject({
      key: 'MANDATORY', mandatory: true, provenanceLevel: 'PLATFORM',
    });
  });

  it('makes equivalent legacy/registered single-layer payload checksums identical', () => {
    const reqs = [{ key: 'DOC-01', mandatory: true, docTypeKey: 'DT-001' }];
    const flat = resolveConfigV021({
      PROJECT: layer('PROJECT', { requirements: reqs }),
    });
    const registered = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'checklist.requirements': reqs }),
    });
    expect(flat.conflicts).toHaveLength(0);
    expect(registered.conflicts).toHaveLength(0);
    expect(flat.payload.requirements).toEqual(registered.payload.requirements);
    expect(flat.checksum).toBe(registered.checksum);
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

  it('rejects invalid layer records and unknown or inapplicable level keys', () => {
    const malformed = resolveConfigV021({ PROJECT: null as any });
    expect(malformed.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$layer', level: 'PROJECT' }),
    ]));
    const unknown = resolveConfigV021({
      PROJECT: layer('PROJECT', { 'naming.pattern': 'safe' }),
      UNSUPPORTED: layer('PROJECT', { 'naming.pattern': 'hidden' }),
    } as any);
    expect(unknown.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$level' }),
    ]));
    expect(unknown.payload['naming.pattern']).toBe('safe');
    const preview = resolveConfigV021({
      ORG: layer('ORG', { 'naming.pattern': 'not-in-preview' }),
    }, true);
    expect(preview.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$level' }),
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
    expect(result.payload.requirements).toEqual([
      expect.objectContaining({ key: 'FIRST', provenanceLevel: 'PROJECT' }),
    ]);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$level', attemptedAtLevel: 'PROJECT' }),
    ]));
  });

  it('rejects non-boolean obligation flags and ambiguous removal patches',()=>{
    for(const patch of [{key:'A',locked:'false'},{key:'A',mandatory:'false'},{key:'A',$remove:'true'},
      {key:'A',$remove:true,title:'also replace'}]) {
      const result=resolveConfigV021({PROJECT:layer('PROJECT',{'checklist.requirements':[patch]})});
      expect(result.conflicts).not.toHaveLength(0);
      expect(result.payload.requirements).toBeUndefined();
    }
  });

  it('preserves individual field/item provenance through partial overrides and removals',()=>{
    const result=resolveConfigV021({
      PLATFORM:layer('PLATFORM',{'checklist.requirements':[{key:'A',title:'Original',mandatory:true},{key:'B',title:'Retired'}]}),
      PROJECT:layer('PROJECT',{'checklist.requirements':[{key:'A',title:'Revised'},{key:'B',$remove:true}]}),
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.itemProvenance['checklist.requirements'].A).toMatchObject({
      title:{level:'PROJECT',versionId:'phase2-project'},mandatory:{level:'PLATFORM',versionId:'phase2-platform'},
    });
    expect(result.itemProvenance['checklist.requirements'].B.$removed).toMatchObject({level:'PROJECT',removed:true});
  });

  it('keeps an explicitly supplied compatibility schema version instead of downgrading it silently',()=>{
    const result=resolveConfigurationHierarchy([{level:'PROJECT',versionId:'unknown-version',schemaVersion:'v99',payload:{'naming.pattern':'unsafe'}}]);
    expect(result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({path:'$schemaVersion'})]));
    expect(result.payload['naming.pattern']).toBeUndefined();
  });

  it('rejects malformed layer containers, sparse arrays and aggregate payload excess',()=>{
    expect(resolveConfigurationHierarchy(null as any).conflicts).not.toHaveLength(0);
    const sparse=Array(2);sparse[1]={key:'A'};
    expect(resolveConfigV021({PROJECT:layer('PROJECT',{'checklist.requirements':sparse})}).conflicts).not.toHaveLength(0);
    const oversized=Array.from({length:1000},(_,n)=>({key:'A'+n,title:'a'.repeat(2048)}));
    expect(resolveConfigV021({PROJECT:layer('PROJECT',{'checklist.requirements':oversized})}).conflicts).not.toHaveLength(0);
  });

  it('protects inherited mandatory flags even when the item has no locked flag',()=>{
    for(const patch of [{key:'M',mandatory:false},{key:'M',$remove:true}]) {
      const result=resolveConfigurationHierarchy([
        {level:'PLATFORM',versionId:'mandatory-source',payload:{requirements:[{key:'M',mandatory:true}]}},
        {level:'ORG',versionId:'unrelated-source',payload:{requirements:[{key:'OTHER',mandatory:false}]}},
        {level:'PROJECT',versionId:'attempt',payload:{requirements:[patch]}},
      ]);
      expect(result.payload.requirements).toContainEqual(expect.objectContaining({key:'M',mandatory:true}));
      expect(result.conflicts).toContainEqual(expect.objectContaining({path:'key:M',lockedAtLevel:'PLATFORM'}));
    }
  });

  it('requires MIME strings instead of treating arbitrary object payloads as a security allowlist',()=>{
    const result=resolveConfigV021({PLATFORM:layer('PLATFORM',{'security.allowed_mime_types':[{mime:'application/pdf'}]})});
    expect(result.conflicts).not.toHaveLength(0);
    expect(result.payload['security.allowed_mime_types']).toBeUndefined();
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


describe('PH2-G06-006: immutable active baseline against single-layer reimports', () => {
  const locked = {
    key: 'SAFETY-001', groupKey: 'SAFETY', title: 'Approved safety manual', locked: true, mandatory: true,
    docTypeKey: 'DT-001', scopeType: 'PROJECT', reviewerRole: 'R-QC',
  };

  it('allows identical locked obligations without changing source provenance', () => {
    expect(() => assertLockedChecklistBaselineInvariant(
      { requirements: [locked] },
      { requirements: [{ ...locked, provenanceLevel: 'PROJECT' }] },
    )).not.toThrow();
  });

  const forbiddenVariants: Array<Record<string, unknown>[]> = [
    [{ key: 'SAFETY-001', mandatory: false }],
    [{ ...locked, docTypeKey: 'DT-002' }],
    [{ ...locked, locked: false }],
    [],
  ];
  for (const [caseIndex, requirements] of forbiddenVariants.entries()) {
    it(`rejects locked obligation removal/changes (case ${caseIndex + 1})`, () => {
      expect(() => assertLockedChecklistBaselineInvariant(
        { requirements: [locked] }, { requirements },
      )).toThrow('Conflict Exception');
    });
  }

  it('denies an actual checklist snapshot mutation before writing new baseline rows', async () => {
    const projectId = '0192e3a0-1111-7000-8000-000000000001';
    const orgId = '0192e3a0-1111-7000-8000-000000000002';
    const userId = '0192e3a0-1111-7000-8000-000000000003';
    const sourceId = '0192e3a0-1111-7000-8000-000000000004';
    const payload = { requirements: [{ ...locked, mandatory: false }] };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM projects WHERE org_id')) {
        return { rows: [{ id: projectId, status: 'ACTIVE', purged_at: null }] };
      }
      if (sql.includes('FROM checklist_snapshots')) {
        return { rows: [{ id: 'prior', version_no: 1, resolved_payload_json: {
          requirements: [locked],
        } }] };
      }
      if (sql.includes('FROM lock_project_configuration_sources')) return { rows: [{
        id:sourceId,level:'PROJECT',org_id:orgId,scope_type:'PROJECT',scope_id:projectId,
        format_version:1,schema_version:1,checksum:'unit-checksum',actual_checksum:'unit-checksum',
        payload_json:payload,source_manifest_json:{kind:'UNIT_FIXTURE'},status:'ACTIVE',
      }] };
      if (sql.includes('SELECT phase2_config_digest')) return { rows: [{checksum:'unit-checksum'}] };
      return { rows: [] };
    });
    const client = { query };
    const emit = jest.fn();
    const service = new ChecklistsService({} as any);
    const ctx: any = { orgId, userId, actorType:'MEMBER', requestId:'phase2-immutable' };
    await expect(service.createAndApplySnapshot(ctx, projectId, [
      { level: 'PROJECT', versionId: sourceId, payload },
    ], undefined, 'unsafe overwrite', { client: client as any, emit }))
      .rejects.toMatchObject({ response: expect.objectContaining({
        code: 'LOCKED_CHECKLIST_CHANGE_REQUIRES_REVIEW',
      }) });
    expect(query.mock.calls.some(([sql]) =>
      /UPDATE checklist_snapshots|INSERT INTO checklist_snapshots/.test(sql))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
