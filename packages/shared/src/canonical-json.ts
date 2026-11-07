/** Stable JSON for JSON-compatible manifests, independent of PostgreSQL jsonb key order. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}
