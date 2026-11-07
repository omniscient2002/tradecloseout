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
