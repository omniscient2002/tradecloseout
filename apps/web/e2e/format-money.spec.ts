import { test, expect } from '@playwright/test';
import { formatInrPaiseExact } from '../src/lib/format-money';

test('INR contract amounts are formatted from exact integer paise', () => {
  expect(formatInrPaiseExact('123456')).toBe('₹1,235');
  expect(formatInrPaiseExact('10049')).toBe('₹100');
  expect(formatInrPaiseExact('10050')).toBe('₹101');
  expect(formatInrPaiseExact('-10050')).toBe('-₹101');
  expect(formatInrPaiseExact('0')).toBe('₹0');
});

test('large integers above Number.MAX_SAFE_INTEGER retain correct rounded rupees', () => {
  expect(formatInrPaiseExact('900719925474099199')).toBe('₹9,00,71,99,25,47,40,992');
  expect(formatInrPaiseExact('900719925474099250')).toBe('₹9,00,71,99,25,47,40,993');
});

test('missing or corrupted monetary values remain unavailable, never invented as zero', () => {
  for (const value of [null, undefined, '', 'NaN', '1e10', '100.5', '₹123', '9'.repeat(100)]) {
    expect(formatInrPaiseExact(value)).toBe('Amount unavailable');
  }
});
