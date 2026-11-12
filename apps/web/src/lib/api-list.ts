/**
 * Distinguish an authoritative empty collection from a failed/denied,
 * malformed or inadvertently narrowed response. Never manufacture [] after
 * an invalid API envelope — that can hide outstanding business obligations.
 */
export function requireApiList<T = unknown>(
  payload: unknown,
  code: 'ASSET' | 'REVIEW' | 'PACKAGE',
): T[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && !Array.isArray(payload) &&
      'data' in payload
      ? (payload as { data: unknown }).data
      : null;
  if (!Array.isArray(records)) {
    throw new Error(`${code}_RESPONSE_INVALID: The server did not return a list.`);
  }
  return records as T[];
}
