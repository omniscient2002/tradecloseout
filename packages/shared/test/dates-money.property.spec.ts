import { isIndiaQuietHour, sumPaise, parseInrToPaise, quotaMonthIndia } from '../src/business-rules';
import { canonicalJson } from '../src/canonical-json';

describe('Production money totals and India quiet-hour rules', () => {
  it('SHARED-05: sums paise above Number.MAX_SAFE_INTEGER exactly', () => {
    expect(sumPaise(['9007199254740993', 7n])).toBe(9007199254741000n);
    expect(sumPaise([])).toBe(0n);
  });
  it.each(['-1', '1.5', 'NaN', '', '1e10'])('SHARED-05: rejects invalid amount %s', value => {
    expect(() => sumPaise([value])).toThrow('INVALID_PAISE');
  });
  it('SHARED-05: rejects negative bigint amounts', () => {
    expect(() => sumPaise([10n, -1n])).toThrow('INVALID_PAISE');
  });
  it.each([
    ['0', '0'], ['1', '100'], ['2.5', '250'], ['0.01', '1'],
    ['145000000.25', '14500000025'],
    ['90071992547409.91', '9007199254740991'],
  ])('PH2-G05-011: exact INR parsing %s', (input, expected) => {
    expect(parseInrToPaise(input)).toBe(expected);
  });
  it.each(['', '-1', '1.234', '1e12', 'NaN', '1,000', '0.001', 'Infinity', '01'])(
    'PH2-G05-011: refuses malformed INR %s', input => {
      expect(() => parseInrToPaise(input)).toThrow('INVALID_INR_AMOUNT');
    },
  );
  it('PH2-G05-011: rejects amounts exceeding signed BIGINT capacity', () => {
    expect(() => parseInrToPaise('92233720368547759')).toThrow('INR_AMOUNT_OUT_OF_RANGE');
  });
  it('SHARED-05: seeded property — splitting and permuting totals preserves integer paise (seed 281)', () => {
    let state = 281;
    for (let i = 0; i < 200; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const amount = BigInt(state) * 9007199254740993n;
      const first = amount / 3n;
      expect(sumPaise([first, amount - first])).toBe(amount);
      expect(sumPaise([amount - first, first])).toBe(amount);
    }
  });
  it.each([
    ['2026-11-06T16:29:59Z', false], // 21:59:59 IST
    ['2026-11-06T16:30:00Z', true],  // 22:00 IST
    ['2026-11-07T02:29:59Z', true],  // 07:59:59 IST
    ['2026-11-07T02:30:00Z', false], // 08:00 IST
    ['2028-02-29T18:30:00Z', true],  // leap-day rollover to March
  ])('SHARED-06: quiet-hour boundary %s', (instant, expected) => {
    expect(isIndiaQuietHour(new Date(instant))).toBe(expected);
  });
  it.each([
    ['2026-11-30T18:29:59Z', '2026-11'],
    ['2026-11-30T18:30:00Z', '2026-12'],
    ['2027-12-31T18:30:00Z', '2028-01'],
  ])('PH2-G18-005: IST monthly boundary %s', (iso, expected) => {
    expect(quotaMonthIndia(new Date(iso))).toBe(expected);
  });
  it('PH2-G18-005: invalid date never creates a quota period', () => {
    expect(() => quotaMonthIndia(new Date(NaN))).toThrow('INVALID_QUOTA_DATE');
  });
  it('ARC-03: canonical manifest digest input survives JSONB key reordering', () => {
    expect(canonicalJson({ b: [{ z: 2, a: 1 }], a: '<script>' }))
      .toBe(canonicalJson({ a: '<script>', b: [{ a: 1, z: 2 }] }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});
