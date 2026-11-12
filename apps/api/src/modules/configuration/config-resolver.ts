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
    // Legacy checklist import/snapshot payloads use the flat requirements key.
    // It remains an explicit schema entry pending a versioned migration; any
    // mixed legacy/registered payload is an error (see below).
    requirements: {
      path: 'requirements',
      type: 'unkeyed_array',
      overridePolicy: 'REPLACE',
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

/**
 * PH2-G06-003: explicit, bounded schema validation before configuration can
 * alter any consumer-facing safety policy. Parsed JSON must be an ordinary
 * record; arbitrary objects/functions/prototype keys never enter resolution.
 */
function isConfigRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeConfigData(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 2048;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    return value.length <= 1000 && value.every(item => safeConfigData(item, depth + 1));
  }
  if (!isConfigRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= 64 && keys.every(key =>
    key.length <= 128 && !['__proto__','constructor','prototype'].includes(key) &&
    safeConfigData(value[key], depth + 1));
}

function validateConfigValue(schema: FieldSchema, value: unknown): boolean {
  if (!safeConfigData(value)) return false;
  if (schema.type === 'keyed_array') {
    return Array.isArray(value) && value.every(item => isConfigRecord(item) &&
      typeof item[schema.mergeKey ?? 'key'] === 'string' &&
      (item[schema.mergeKey ?? 'key'] as string).trim().length > 0);
  }
  if (schema.type === 'unkeyed_array') {
    if (!Array.isArray(value)) return false;
    if (schema.path === 'notifications.extra_recipients') {
      return value.every(recipient => typeof recipient === 'string' &&
        /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recipient) &&
        recipient.length <= 254);
    }
    return true;
  }
  if (schema.type === 'map') return isConfigRecord(value);
  if (schema.path === 'security.max_file_size_bytes') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }
  if (schema.path === 'security.retention_days') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }
  if (schema.path === 'branding.primary_color') {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }
  if (schema.path === 'naming.pattern') {
    return typeof value === 'string' && value.length > 0 && value.length <= 200;
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
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

    const registry = Object.hasOwn(ConfigSchemaRegistry, cfg.schemaVersion)
      ? ConfigSchemaRegistry[cfg.schemaVersion] : undefined;
    if (!registry) {
      conflicts.push({ path: '$schemaVersion', level, message: 'Unsupported configuration schema version.' });
      continue;
    }
    if (cfg.level !== level) {
      conflicts.push({ path: '$level', level, message: 'Configuration layer identity does not match its position.' });
      continue;
    }

    if (!isConfigRecord(cfg.payload) || Object.keys(cfg.payload).length > 64) {
      conflicts.push({ path: '$payload', level, message: 'Invalid or excessive configuration fields.' });
      continue;
    }

    for (const [path, rawVal] of Object.entries(cfg.payload)) {
      const schema: FieldSchema | undefined =
        Object.hasOwn(registry, path) ? registry[path] : undefined;
      if (!schema) {
        conflicts.push({ path, level, message: 'Field is not registered in this configuration schema.' });
        continue;
      }
      if (rawVal === undefined || rawVal === null) {
        // A null/absent child is NOT an authorization to clear a locked field.
        if (rawVal === null) conflicts.push({ path, level, message: 'Explicit null configuration is not supported.' });
        continue;
      }
      if (!validateConfigValue(schema, rawVal)) {
        conflicts.push({ path, level, message: 'Configuration value has invalid type, size or structure.' });
        continue;
      }
      // Flat and registered requirement arrays describe the same obligation
      // family. Never permit either form to bypass the other's item locks.
      const otherPath = path === 'requirements' ? 'checklist.requirements'
        : path === 'checklist.requirements' ? 'requirements' : null;
      if (otherPath && (
        Object.hasOwn(cfg.payload, otherPath) || Object.hasOwn(result, otherPath)
      )) {
        conflicts.push({ path: 'requirements', level, message: 'Mixed checklist requirement schemas require explicit migration.' });
        continue;
      }

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
        // PH2-G06-004: recipient identity is case-insensitive and whitespace
        // insensitive. Set<object> used reference identity and never deduped
        // semantic duplicates. Retain first-seen, normalized deterministic order.
        const values = [...existingArr, ...rawVal] as string[];
        result[path] = Array.from(new Set(values.map(recipient =>
          recipient.trim().toLowerCase())));
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

  const seenPatches = new Set<string>();
  for (const patch of patchArr) {
    if (!patch || typeof patch !== 'object' || typeof patch[keyField] !== 'string' ||
        !patch[keyField].trim() || patch[keyField].length > 128 ||
        ['__proto__', 'constructor', 'prototype'].includes(patch[keyField])) {
      conflicts.push({ path: keyField, level, message: 'Invalid keyed configuration item.' });
      continue;
    }
    const k = patch[keyField];
    if (seenPatches.has(k)) {
      conflicts.push({ path: `${keyField}:${k}`, level,
        message: 'Duplicate configuration key within one layer.' });
      continue;
    }
    seenPatches.add(k);
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
  const inputConflicts: ConfigConflict[] = [];
  for (const layer of layers) {
    if (!layer || !['PLATFORM','TRADE','ORG','CLIENT_CONTRACT','PROJECT'].includes(layer.level)) {
      inputConflicts.push({ path: '$level', level: 'PROJECT', message: 'Unknown configuration level.' });
      continue;
    }
    if (byLevel[layer.level]) {
      inputConflicts.push({ path: '$level', level: layer.level,
        message: 'Duplicate configuration layer requires an explicit version selection.' });
      continue;
    }
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
    conflicts: [...inputConflicts, ...res.conflicts].map((c) => ({
      path: c.path,
      attemptedAtLevel: c.level,
      // No invented PLATFORM attribution: the owner level is only known if
      // an actual winning layer established a value at that path.
      lockedAtLevel: res.provenance[c.path]?.level ?? null,
      message: c.message,
    })),
    checksum: res.checksum,
  };
}
