export function isIndiaQuietHour(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
  }).format(date));
  return hour >= 22 || hour < 8;
}

/** Exact totals for nonnegative monetary observations represented as integer paise. */
export function sumPaise(values: readonly (string | bigint)[]): bigint {
  return values.reduce<bigint>((total, value) => {
    if (typeof value === 'string' && !/^\d+$/.test(value)) throw new Error('INVALID_PAISE');
    const amount = BigInt(value);
    if (amount < 0n) throw new Error('INVALID_PAISE');
    return total + amount;
  }, 0n);
}

/**
 * PH2-G05-011: parse an INR user entry into integer paise without Number,
 * floating-point rounding, exponent notation or silent precision loss.
 * Return a string suitable for JSON transport and PostgreSQL BIGINT.
 */
export function parseInrToPaise(input: string): string {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) {
    throw new Error('INVALID_INR_AMOUNT');
  }
  const [whole, decimal = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (amount > 9223372036854775807n) throw new Error('INR_AMOUNT_OUT_OF_RANGE');
  return amount.toString();
}
