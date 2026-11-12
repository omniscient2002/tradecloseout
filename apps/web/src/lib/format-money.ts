/**
 * Format integer paise without ever converting contract amounts through
 * IEEE-754 Number. The old Number(BigInt(...)) lost rupees for high values.
 * We round exactly to whole rupees (half away from zero), matching the
 * project overview's integer-rupee display while retaining full precision.
 */
export function formatInrPaiseExact(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 ||
      !/^-?[0-9]+$/.test(value)) {
    return 'Amount unavailable';
  }
  const paise = BigInt(value);
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const roundedRupees = (abs + 50n) / 100n;
  const signed = negative ? -roundedRupees : roundedRupees;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(signed);
}
