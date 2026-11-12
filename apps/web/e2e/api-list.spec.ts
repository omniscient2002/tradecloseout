import { test, expect } from '@playwright/test';
import { requireApiList } from '../src/lib/api-list';

test('empty API list must be explicit, not a failed response interpreted as zero work', () => {
  expect(requireApiList([], 'ASSET')).toEqual([]);
  expect(requireApiList({ data: [] }, 'REVIEW')).toEqual([]);
  expect(requireApiList({ data: [{ id: 'package-one' }] }, 'PACKAGE'))
    .toEqual([{ id: 'package-one' }]);
});

test('permission errors, malformed envelopes and wrong DTO fields fail visibly', () => {
  for (const input of [null, undefined, {}, { error: 'FORBIDDEN' }, { data: null }, { data: {} }]) {
    expect(() => requireApiList(input, 'ASSET')).toThrow('ASSET_RESPONSE_INVALID');
    expect(() => requireApiList(input, 'REVIEW')).toThrow('REVIEW_RESPONSE_INVALID');
    expect(() => requireApiList(input, 'PACKAGE')).toThrow('PACKAGE_RESPONSE_INVALID');
  }
});
