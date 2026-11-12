/**
 * Version IDs from unversioned S3-compatible buckets may be the literal string "null".
 * That sentinel is truthy in JavaScript but does NOT identify immutable bytes.
 * This guard is shared by upload, package, archive and download boundaries.
 */
export function isImmutableStorageVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  return !/^(?:null|undefined|none|unversioned)$/i.test(value);
}
