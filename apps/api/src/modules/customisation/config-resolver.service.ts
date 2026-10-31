// apps/api/src/modules/customisation/config-resolver.service.ts
// L0-L4 Configuration Hierarchy Resolver (07 §4, RT-019, RT-020)

import { Injectable } from '@nestjs/common';

export type OverridePolicy = 'locked' | 'inherit_only' | 'overridable' | 'additive' | 'keyed_merge';

export interface FieldSchemaPolicy {
  policy: OverridePolicy;
  ownerLevel?: 'PLATFORM' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT';
}

export const StaticConfigSchemaRegistry: Record<string, Record<string, FieldSchemaPolicy>> = {
  'v1.0': {
    'security.retention_days': { policy: 'locked', ownerLevel: 'PLATFORM' },
    'branding.primary_color': { policy: 'overridable' },
    'handover.ordering': { policy: 'keyed_merge' },
    'compliance.required_rules': { policy: 'additive' },
  },
};

@Injectable()
export class ConfigResolverService {
  /**
   * Resolves configuration hierarchy across layers without double-applying L1 TRADE for installed orgs (RT-019).
   */
  resolveConfigHierarchy(
    layers: Array<{ level: 'PLATFORM' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT'; payload: Record<string, any> }>,
    schemaPolicies: Record<string, FieldSchemaPolicy> = StaticConfigSchemaRegistry['v1.0'],
  ): { payload: Record<string, any>; provenance: Record<string, string>; conflicts: Array<{ path: string; level: string; reason: string }> } {
    const result: Record<string, any> = {};
    const provenance: Record<string, string> = {};
    const conflicts: Array<{ path: string; level: string; reason: string }> = [];

    for (const layer of layers) {
      for (const [path, val] of Object.entries(layer.payload)) {
        const rule = schemaPolicies[path] ?? { policy: 'overridable' };

        if (rule.policy === 'locked' && provenance[path] !== undefined) {
          if (JSON.stringify(result[path]) !== JSON.stringify(val)) {
            conflicts.push({ path, level: layer.level, reason: 'LOCKED_FIELD_OVERRIDE_ATTEMPT' });
          }
          continue;
        }

        if (rule.policy === 'inherit_only' && rule.ownerLevel && layer.level !== rule.ownerLevel) {
          continue;
        }

        if (rule.policy === 'additive') {
          const existing = Array.isArray(result[path]) ? result[path] : [];
          result[path] = Array.from(new Set([...existing, ...(Array.isArray(val) ? val : [])]));
        } else if (rule.policy === 'keyed_merge') {
          const existingArr: Array<Record<string, any>> = Array.isArray(result[path]) ? [...result[path]] : [];
          const byKey = new Map(existingArr.map((item) => [item.key, item]));
          for (const incoming of Array.isArray(val) ? val : []) {
            if (incoming.$remove === true) {
              byKey.delete(incoming.key);
            } else {
              const prev = byKey.get(incoming.key) ?? {};
              byKey.set(incoming.key, { ...prev, ...incoming });
            }
          }
          result[path] = Array.from(byKey.values());
        } else {
          // overridable / replace
          if (val && typeof val === 'object' && val.$clear === true) {
            result[path] = null;
          } else if (val !== undefined && val !== null) {
            result[path] = val;
          }
        }
        provenance[path] = layer.level;
      }
    }

    return { payload: result, provenance, conflicts };
  }
}
