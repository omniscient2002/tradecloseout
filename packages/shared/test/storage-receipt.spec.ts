import { isImmutableStorageVersion } from '../src/storage-receipt';

describe('PH4-G14-004 provider immutability', () => {
  it('rejects non-versioned S3-compatible identities', () => {
    for (const value of [undefined, null, '', 'null', 'NULL', 'undefined', 'none',
      'unversioned', 'abc ', ' abc', 'abc\nxyz', 'abc\u0000xyz', 15, {}]) {
      expect(isImmutableStorageVersion(value)).toBe(false);
    }
  });

  it('accepts an opaque immutable provider version identifier', () => {
    expect(isImmutableStorageVersion('3HL4kqtJlcpXrof3')).toBe(true);
    expect(isImmutableStorageVersion('version-123_ABC')).toBe(true);
  });
});
