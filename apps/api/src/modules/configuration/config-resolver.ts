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

    const registry = ConfigSchemaRegistry[cfg.schemaVersion] ?? ConfigSchemaRegistry['v1.0']!;

    for (const [path, rawVal] of Object.entries(cfg.payload)) {
      if (rawVal === undefined || rawVal === null) continue;

      const schema: FieldSchema = registry[path] ?? {
        path,
        type: 'scalar',
        overridePolicy: 'REPLACE',
      };

      // 1. LOCKED policy guard
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
    const k = String(patch[keyField]);
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
      if (current.locked === true && patch.mandatory === false && current.mandatory === true) {
        conflicts.push({
          path: `${keyField}:${k}.mandatory`,
          level,
          message: `Locked mandatory item '${k}' cannot be made optional at ${level}.`,
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
