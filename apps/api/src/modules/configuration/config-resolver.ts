import { createHash } from 'crypto';

export type ConfigLevel = 'PLATFORM' | 'TRADE' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT';
export type OverridePolicy = 'LOCKED' | 'INHERIT_ONLY' | 'REPLACE' | 'APPEND' | 'MERGE_MAP';

export interface FieldSchema {
  path: string;
  type: 'scalar' | 'keyed_array' | 'unkeyed_array' | 'map';
  overridePolicy: OverridePolicy;
  ownerLevel?: ConfigLevel;
  mergeKey?: string;
}

export const ConfigSchemaRegistry: Record<string, Record<string, FieldSchema>> = {
  'v1.0': {
    'security.max_file_size_bytes': {
      path: 'security.max_file_size_bytes',
      type: 'scalar',
      overridePolicy: 'LOCKED',
      ownerLevel: 'PLATFORM',
    },
    'security.allowed_mime_types': {
      path: 'security.allowed_mime_types',
      type: 'unkeyed_array',
      overridePolicy: 'LOCKED',
      ownerLevel: 'PLATFORM',
    },
    'security.retention_days': {
      path: 'security.retention_days',
      type: 'scalar',
      overridePolicy: 'LOCKED',
      ownerLevel: 'PLATFORM',
    },
    'branding.primary_color': {
      path: 'branding.primary_color',
      type: 'scalar',
      overridePolicy: 'INHERIT_ONLY',
      ownerLevel: 'ORG',
    },
    'naming.pattern': {
      path: 'naming.pattern',
      type: 'scalar',
      overridePolicy: 'REPLACE',
    },
    'notifications.schedule': {
      path: 'notifications.schedule',
      type: 'unkeyed_array',
      overridePolicy: 'REPLACE',
    },
    'notifications.extra_recipients': {
      path: 'notifications.extra_recipients',
      type: 'unkeyed_array',
      overridePolicy: 'APPEND',
    },
    'checklist.groups': {
      path: 'checklist.groups',
      type: 'keyed_array',
      overridePolicy: 'MERGE_MAP',
      mergeKey: 'key',
    },
    'checklist.requirements': {
      path: 'checklist.requirements',
      type: 'keyed_array',
      overridePolicy: 'MERGE_MAP',
      mergeKey: 'key',
    },
    'handover.sections': {
      path: 'handover.sections',
      type: 'keyed_array',
      overridePolicy: 'MERGE_MAP',
      mergeKey: 'key',
    },
  },
};

export interface ConfigLayerRecord {
  level: ConfigLevel;
  versionId: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
}

export interface ConfigConflict {
  path: string;
  level: ConfigLevel;
  message: string;
}

export function resolveConfigV021(
  layersByLevel: Partial<Record<ConfigLevel, ConfigLayerRecord>>,
  isPreview = false,
) {
  const result: Record<string, any> = {};
  const provenance: Record<string, { level: ConfigLevel; versionId: string }> = {};
  const conflicts: ConfigConflict[] = [];

  // RT-019: Installed orgs iterate [PLATFORM, ORG, CLIENT_CONTRACT, PROJECT]; preview iterates [PLATFORM, TRADE]
  const orderedLevels: ConfigLevel[] = isPreview
    ? ['PLATFORM', 'TRADE']
    : ['PLATFORM', 'ORG', 'CLIENT_CONTRACT', 'PROJECT'];

  for (const level of orderedLevels) {
    const cfg = layersByLevel[level];
    if (!cfg) continue;

    const registry = ConfigSchemaRegistry[cfg.schemaVersion];
    if (!registry) {
      conflicts.push({ path: '$schemaVersion', level, message: 'Unsupported configuration schema version.' });
      continue;
    }
    if (cfg.level !== level) {
      conflicts.push({ path: '$level', level, message: 'Configuration layer identity does not match its position.' });
      continue;
    }

    for (const [path, rawVal] of Object.entries(cfg.payload)) {
      if (rawVal === undefined || rawVal === null) continue;

      const schema: FieldSchema = registry[path] ?? {
        path,
        type: 'scalar',
        overridePolicy: 'REPLACE',
      };

      // 1. LOCKED fields require their authoritative owner, even when
      // the owner omitted a value. Missing platform policy is not permission
      // for an organisation or project to establish its own security limit.
      if (schema.overridePolicy === 'LOCKED' && schema.ownerLevel &&
          level !== schema.ownerLevel && !provenance[path]) {
        conflicts.push({ path, level,
          message: `Field '${path}' must originate from ${schema.ownerLevel}.` });
        continue;
      }
      if (schema.overridePolicy === 'LOCKED' && provenance[path]) {
        if (JSON.stringify(rawVal) !== JSON.stringify(result[path])) {
          conflicts.push({
            path,
            level,
            message: `Field '${path}' is LOCKED by ${provenance[path]!.level} and cannot be overridden at ${level}.`,
          });
        }
        continue;
      }

      // 2. INHERIT_ONLY policy guard
      if (schema.overridePolicy === 'INHERIT_ONLY' && schema.ownerLevel && level !== schema.ownerLevel) {
        conflicts.push({
          path,
          level,
          message: `Field '${path}' is INHERIT_ONLY at ${schema.ownerLevel} and cannot be modified at ${level}.`,
        });
        continue;
      }

      // 3. Apply merge semantics
      if (schema.overridePolicy === 'APPEND' && Array.isArray(rawVal)) {
        const existingArr = Array.isArray(result[path]) ? result[path] : [];
        result[path] = Array.from(new Set([...existingArr, ...rawVal]));
      } else if (schema.overridePolicy === 'MERGE_MAP' && Array.isArray(rawVal)) {
        const keyField = schema.mergeKey ?? 'key';
        result[path] = mergeKeyedObjects(result[path] ?? [], rawVal, keyField, level, conflicts);
      } else {
        if (typeof rawVal === 'object' && (rawVal as any).$clear === true) {
          result[path] = null;
        } else {
          result[path] = structuredClone(rawVal);
        }
      }

      provenance[path] = { level, versionId: cfg.versionId };
    }
  }

  // PH2-G06-002: checklist snapshots and their consumers use "requirements",
  // while the registered keyed configuration schema uses "checklist.requirements".
  // Keep the public snapshot contract canonical without silently allowing two
  // contradictory lists to describe different active obligations.
  const registeredRequirements = result['checklist.requirements'];
  if (registeredRequirements !== undefined) {
    if (result.requirements !== undefined &&
        JSON.stringify(sortDeepKeys(result.requirements)) !==
          JSON.stringify(sortDeepKeys(registeredRequirements))) {
      conflicts.push({
        path: 'requirements',
        level: provenance.requirements?.level ?? 'PROJECT',
        message: 'Conflicting legacy and registered checklist requirements.',
      });
    } else {
      result.requirements = structuredClone(registeredRequirements);
      provenance.requirements = provenance['checklist.requirements']!;
    }
  }

  const canonical = JSON.stringify(sortDeepKeys(result));
  const checksum = createHash('sha256').update(canonical).digest('hex');

  return { payload: result, provenance, conflicts, checksum };
}

function mergeKeyedObjects(
  baseArr: Record<string, any>[],
  patchArr: Record<string, any>[],
  keyField: string,
  level: ConfigLevel,
  conflicts: ConfigConflict[],
): Record<string, any>[] {
  const map = new Map<string, Record<string, any>>();
  for (const item of baseArr) {
    map.set(String(item[keyField]), structuredClone(item));
  }

  for (const patch of patchArr) {
    if (!patch || typeof patch !== 'object' || typeof patch[keyField] !== 'string' ||
        !patch[keyField].trim() || ['__proto__', 'constructor', 'prototype'].includes(patch[keyField])) {
      conflicts.push({ path: keyField, level, message: 'Invalid keyed configuration item.' });
      continue;
    }
    const k = patch[keyField];
    const current = map.get(k);

    if (patch.$remove === true) {
      if (current?.locked === true) {
        conflicts.push({
          path: `${keyField}:${k}`,
          level,
          message: `Locked item '${k}' cannot be removed at ${level}.`,
        });
      } else {
        map.delete(k);
      }
      continue;
    }

    if (current) {
      // A locked record protects its *whole* obligation, including reviewer,
      // document type, scope and mandatory status. A child may only restate
      // identical values; it cannot replace semantics while retaining locked.
      if (current.locked === true && Object.entries(patch).some(
        ([field, value]) => field !== 'provenanceLevel' &&
          JSON.stringify(sortDeepKeys(value)) !== JSON.stringify(sortDeepKeys(current[field])),
      )) {
        conflicts.push({
          path: `${keyField}:${k}`,
          level,
          message: `Locked item '${k}' cannot be weakened at ${level}.`,
        });
        continue;
      }
      map.set(k, { ...current, ...patch, provenanceLevel: level });
    } else {
      map.set(k, { ...patch, provenanceLevel: level });
    }
  }

  return Array.from(map.values());
}

function sortDeepKeys(val: any): any {
  if (Array.isArray(val)) return val.map(sortDeepKeys);
  if (val !== null && typeof val === 'object') {
    return Object.keys(val)
      .sort()
      .reduce((acc: Record<string, any>, k) => {
        acc[k] = sortDeepKeys(val[k]);
        return acc;
      }, {});
  }
  return val;
}

// Backward compatibility layer for checklists.service.ts
export interface ConfigLayerInput {
  level: ConfigLevel;
  versionId: string;
  payload: Record<string, any>;
}

export function resolveConfigurationHierarchy(layers: ConfigLayerInput[]) {
  const byLevel: Partial<Record<ConfigLevel, ConfigLayerRecord>> = {};
  for (const layer of layers) {
    byLevel[layer.level] = {
      level: layer.level,
      versionId: layer.versionId,
      schemaVersion: 'v1.0',
      payload: layer.payload,
    };
  }
  const res = resolveConfigV021(byLevel, false);
  return {
    payload: res.payload,
    provenance: res.provenance,
    conflicts: res.conflicts.map((c) => ({
      path: c.path,
      attemptedAtLevel: c.level,
      lockedAtLevel: 'PLATFORM' as ConfigLevel,
      message: c.message,
    })),
    checksum: res.checksum,
  };
}
