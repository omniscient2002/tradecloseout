/** Validate bounded JSON without invoking accessors or unbounded recursion.
 * Returns a detached value so validation and persistence use the same snapshot. */
export function boundedJsonObject(input: unknown, maxBytes: number): Record<string, unknown> {
  let nodes = 0;
  let rawTextBytes = 0;
  const countText = (value: string) => {
    rawTextBytes += Buffer.byteLength(value, 'utf8');
    if (rawTextBytes > maxBytes) throw new Error('JSON_TOO_LARGE');
  };
  const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 2000 || depth > 20) throw new Error('INVALID_JSON');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      countText(value);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('INVALID_JSON');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('INVALID_JSON');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 2001) throw new Error('INVALID_JSON');
    ancestors.add(value);
    const result: any = array ? [] : Object.create(null);
    if (array && (value as unknown[]).length > 2000) throw new Error('INVALID_JSON');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new Error('INVALID_JSON');
      countText(key);
      if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error('INVALID_JSON');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('INVALID_JSON');
      result[key] = copy(descriptor.value, depth + 1);
    }
    if (array && Object.keys(result).length !== (value as unknown[]).length) throw new Error('INVALID_JSON');
    ancestors.delete(value);
    return result;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_JSON');
  const result = copy(input, 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('JSON_TOO_LARGE');
  return result;
}
