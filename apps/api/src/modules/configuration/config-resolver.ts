import { createHash } from 'crypto';

export type ConfigLevel = 'PLATFORM' | 'TRADE' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT';
export type OverridePolicy = 'locked' | 'inherit_only' | 'overridable' | 'additive' | 'keyed_merge';

export interface FieldSchemaRule {
  overridePolicy: OverridePolicy;
  ownerLevel?: ConfigLevel;
  mergeKey?: string;
}

export interface ConfigLayerInput {
  level: ConfigLevel;
  versionId: string;
  payload: Record<string, any>;
}

export interface ConflictRecord {
  path: string;
  attemptedAtLevel: ConfigLevel;
  lockedAtLevel: ConfigLevel;
  message: string;
}

const CONFIG_SCHEMA: Record<string, FieldSchemaRule> = {
  maxFileSizeBytes: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  allowedMimeTypes: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  requireMalwareScan: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  packageIncludeApprovalSummary: { overridePolicy: 'locked', ownerLevel: 'TRADE' },
  branding: { overridePolicy: 'inherit_only', ownerLevel: 'ORG' },
  namingPattern: { overridePolicy: 'overridable' },
  reminderSchedule: { overridePolicy: 'overridable' },
  extraAllowedFormats: { overridePolicy: 'additive' },
  groups: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
  requirements: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
  packageSections: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
};

export function resolveConfigurationHierarchy(layers: ConfigLayerInput[]) {
  const result: Record<string, any> = {};
  const provenance: Record<string, { level: ConfigLevel; versionId: string }> = {};
  const conflicts: ConflictRecord[] = [];

  for (const layer of layers) {
    for (const [key, incomingVal] of Object.entries(layer.payload)) {
      if (incomingVal === undefined || incomingVal === null) continue;

      const rule: FieldSchemaRule = CONFIG_SCHEMA[key] ?? { overridePolicy: 'overridable' };
      const existingOrigin = provenance[key];

      // 1. Locked field guard (07 §4.3 & §5)
      if (rule.overridePolicy === 'locked' && existingOrigin) {
        if (JSON.stringify(incomingVal) !== JSON.stringify(result[key])) {
          conflicts.push({
            path: key,
            attemptedAtLevel: layer.level,
            lockedAtLevel: existingOrigin.level,
            message: `Field '${key}' is locked at ${existingOrigin.level} and cannot be overridden at ${layer.level}.`,
          });
        }
        continue;
      }

      // 2. Inherit-only guard
      if (rule.overridePolicy === 'inherit_only' && rule.ownerLevel && layer.level !== rule.ownerLevel) {
        continue;
      }

      // 3. Merge semantics by policy (07 §4.4)
      if (rule.overridePolicy === 'additive' && Array.isArray(incomingVal)) {
        const currentArr = Array.isArray(result[key]) ? result[key] : [];
        result[key] = Array.from(new Set([...currentArr, ...incomingVal]));
      } else if (rule.overridePolicy === 'keyed_merge' && Array.isArray(incomingVal)) {
        const mergeKey = rule.mergeKey ?? 'key';
        result[key] = mergeKeyedArray(result[key] ?? [], incomingVal, mergeKey, layer.level, conflicts);
      } else {
        if (incomingVal && typeof incomingVal === 'object' && incomingVal.$clear === true) {
          result[key] = null;
        } else {
          result[key] = structuredClone(incomingVal);
        }
      }

      provenance[key] = { level: layer.level, versionId: layer.versionId };
    }
  }

  // Enforce complexity limits (07 §5.1)
  if (Array.isArray(result.requirements) && result.requirements.length > 1000) {
    conflicts.push({
      path: 'requirements',
      attemptedAtLevel: 'PROJECT',
      lockedAtLevel: 'PLATFORM',
      message: `Requirements count (${result.requirements.length}) exceeds limit of 1,000.`,
    });
  }

  const canonicalJson = JSON.stringify(sortObjectKeys(result));
  const checksum = createHash('sha256').update(canonicalJson).digest('hex');

  return {
    payload: result,
    provenance,
    conflicts,
    checksum,
  };
}

function mergeKeyedArray(
  baseList: Record<string, any>[],
  incomingList: Record<string, any>[],
  keyField: string,
  level: ConfigLevel,
  conflicts: ConflictRecord[],
): Record<string, any>[] {
  const map = new Map<string, Record<string, any>>();
  for (const item of baseList) {
    map.set(String(item[keyField]), structuredClone(item));
  }

  for (const patch of incomingList) {
    const k = String(patch[keyField]);
    const existing = map.get(k);

    if (patch.$remove === true) {
      if (existing?.locked === true) {
        conflicts.push({
          path: `${keyField}:${k}`,
          attemptedAtLevel: level,
          lockedAtLevel: 'PLATFORM',
          message: `Cannot remove locked item '${k}' at level ${level}.`,
        });
      } else {
        map.delete(k);
      }
      continue;
    }

    if (existing) {
      if (existing.locked === true && patch.mandatory === false && existing.mandatory === true) {
        conflicts.push({
          path: `${keyField}:${k}.mandatory`,
          attemptedAtLevel: level,
          lockedAtLevel: 'PLATFORM',
          message: `Cannot mark locked mandatory item '${k}' as optional at level ${level}.`,
        });
        continue;
      }
      map.set(k, { ...existing, ...patch, provenanceLevel: level });
    } else {
      map.set(k, { ...patch, provenanceLevel: level });
    }
  }

  return Array.from(map.values());
}

function sortObjectKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc: Record<string, any>, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}
