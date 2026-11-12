import {parseOrgProfilePatch, requireOrganisationUuid} from '../src/modules/organisations/organisation-validation';

describe('G03 organisation input boundaries',()=>{
  it('rejects malformed path identifiers before PostgreSQL UUID casts',()=>{
    expect(()=>requireOrganisationUuid('not-a-uuid','userId')).toThrow();
    expect(()=>requireOrganisationUuid({},'userId')).toThrow();
    expect(requireOrganisationUuid('123e4567-e89b-12d3-a456-426614174000','userId'))
      .toBe('123e4567-e89b-12d3-a456-426614174000');
  });
  it('requires a real optimistic concurrency version and explicit allowlist',()=>{
    for(const payload of [{displayName:'New name'}, {rowVersion:1,logoUrl:'data:image/svg+xml,<svg/>'},
      {rowVersion:1,displayName:'New name',unknownField:'saved'}, {rowVersion:1}]) {
      expect(()=>parseOrgProfilePatch(payload)).toThrow();
    }
    expect(parseOrgProfilePatch({rowVersion:2,displayName:'New name'})).toEqual({
      rowVersion:2,input:{displayName:'New name'},
    });
  });
  it('distinguishes omission from explicit clearing of nullable profile fields',()=>{
    const patch=parseOrgProfilePatch({
      rowVersion:4,pan:null,contactEmail:null,footerText:null,
    });
    expect(Object.prototype.hasOwnProperty.call(patch.input,'gstin')).toBe(false);
    expect(patch.input.pan).toBeNull();
    expect(patch.input.contactEmail).toBeNull();
    expect(patch.input.footerText).toBeNull();
  });
  it('rejects unsafe branding, states and retention',()=>{
    for(const input of [
      {state:'ZZ'},{brandColor:'not-a-color'},{defaultRetentionMonths:-1},
      {defaultRetentionMonths:60},{contactPhone:'not-phone'},
      {logoObjectId:'https://private.example/logo'},{addressJson:{x:{nested:true}}},
    ]) expect(()=>parseOrgProfilePatch({rowVersion:1,...input})).toThrow();
    expect(parseOrgProfilePatch({rowVersion:1,state:'KA',brandColor:'#0f172a'}).input)
      .toEqual({state:'KA',brandColor:'#0F172A'});
  });
  it('rejects numeric and object profile values',()=>{
    for(const value of [null,0,[],{},true]) {
      expect(()=>parseOrgProfilePatch({rowVersion:1,displayName:value})).toThrow();
    }
  });
});
