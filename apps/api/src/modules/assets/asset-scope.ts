import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** Scope is stored on the live project_members row; never accept scope from request JSON. */
export type AssetScopeTarget = {
  id: string;
  categoryKey: string | null;
  createdAt: Date | string | null;
};

const allowedKeys = new Set([
  'assetIds', 'requirementIds', 'documentIds',
  'assetCategories', 'requirementGroups', 'documentTypes',
  'readOnly', 'mode', 'startDate', 'endDate',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function invalidScope(): never {
  throw new ForbiddenException('PROJECT_RESOURCE_SCOPE_INVALID');
}

/**
 * Shared, fail-closed schema for member resource restrictions. Unknown stored
 * keys must be reconciled by an administrator; they cannot mean unrestricted.
 */
export function validateAssetProjectScope(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return invalidScope();
  const scope = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(scope)) {
    if (!allowedKeys.has(key)) return invalidScope();
    if (['assetIds', 'requirementIds', 'documentIds'].includes(key)) {
      if (!Array.isArray(entry) || entry.length > 1000 ||
          entry.some((id) => typeof id !== 'string' || !uuidPattern.test(id)) ||
          new Set(entry).size !== entry.length) return invalidScope();
    } else if (['assetCategories', 'requirementGroups', 'documentTypes'].includes(key)) {
      if (!Array.isArray(entry) || entry.length > 100 ||
          entry.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(item))) {
        return invalidScope();
      }
    } else if (key === 'readOnly') {
      if (typeof entry !== 'boolean') return invalidScope();
    } else if (key === 'mode') {
      if (entry !== 'READ_ONLY' && entry !== 'READ_WRITE') return invalidScope();
    } else if (!validDate(entry)) {
      return invalidScope();
    }
  }
  if (typeof scope.startDate === 'string' && typeof scope.endDate === 'string' &&
      scope.startDate > scope.endDate) return invalidScope();
  return scope;
}

/** Check read or mutation authority for the actual asset, or a new asset (null). */
export function assertAssetInScope(
  scopeInput: unknown,
  target: AssetScopeTarget | null,
  write: boolean,
  newCategoryKey?: string,
): void {
  const scope = validateAssetProjectScope(scopeInput);
  if (write && (scope.readOnly === true || scope.mode === 'READ_ONLY')) {
    throw new ForbiddenException('PROJECT_SCOPE_READ_ONLY');
  }
  if (scope.assetIds !== undefined &&
      (!target || !(scope.assetIds as string[]).includes(target.id))) {
    throw new NotFoundException('ASSET_NOT_FOUND');
  }
  const category = target ? target.categoryKey : newCategoryKey;
  if (scope.assetCategories !== undefined &&
      (!category || !(scope.assetCategories as string[]).includes(category))) {
    throw new NotFoundException('ASSET_NOT_FOUND');
  }
  if (scope.startDate !== undefined || scope.endDate !== undefined) {
    const stamp = target ? target.createdAt : new Date();
    const time = stamp instanceof Date ? stamp : new Date(stamp ?? '');
    if (!Number.isFinite(time.valueOf())) throw new NotFoundException('ASSET_NOT_FOUND');
    const day = time.toISOString().slice(0, 10);
    if ((typeof scope.startDate === 'string' && day < scope.startDate) ||
        (typeof scope.endDate === 'string' && day > scope.endDate)) {
      throw new NotFoundException('ASSET_NOT_FOUND');
    }
  }
}

/**
 * Apply the same resource predicate in PostgreSQL before sorting, counting or
 * paginating rows. Keep assertAssetInScope as a second guard against callers
 * accidentally projecting rows from other queries.
 *
 * The asset table is intentionally fixed: callers cannot supply SQL identifiers.
 * Dynamic values are only passed as PostgreSQL query parameters.
 */
export function assetScopeSqlPredicate(
  scopeInput: unknown,
  firstParameter: number,
): { sql: string; values: unknown[] } {
  const scope = validateAssetProjectScope(scopeInput);
  if (!Number.isInteger(firstParameter) || firstParameter < 1) {
    throw new Error('INVALID_ASSET_SCOPE_PARAMETER_OFFSET');
  }
  const clauses: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${firstParameter + values.length - 1}`;
  };

  if (scope.assetIds !== undefined) {
    clauses.push(`assets.id = ANY(${bind(scope.assetIds)}::uuid[])`);
  }
  if (scope.assetCategories !== undefined) {
    clauses.push(`assets.category_key = ANY(${bind(scope.assetCategories)}::text[])`);
  }
  if (typeof scope.startDate === 'string') {
    clauses.push(`assets.created_at >= ${bind(scope.startDate + 'T00:00:00.000Z')}::timestamptz`);
  }
  if (typeof scope.endDate === 'string') {
    const endExclusive = new Date(Date.parse(scope.endDate + 'T00:00:00.000Z') + 86_400_000);
    clauses.push(`assets.created_at < ${bind(endExclusive.toISOString())}::timestamptz`);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
}
