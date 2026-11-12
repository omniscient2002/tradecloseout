/**
 * S3's "null" VersionId (including from a suspended bucket) identifies a
 * mutable current object, not an immutable version. Treat version IDs as
 * opaque and preserve them byte-for-byte; do not normalize valid identities.
 * No storage provider is contacted from this pure predicate.
 */
export function isImmutableObjectVersionId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 && value.length <= 1024 &&
    value === value.trim() &&
    value.toLowerCase() !== 'null' &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
