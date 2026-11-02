import { resolveConfigV021 } from '../src/modules/configuration/config-resolver';
import { loadAndValidateEnv } from '@tradecloseout/shared/env';

describe('TradeCloseout v0.2.1 Red-Team & Edge-Case Verification Suite', () => {
  it('TC-ENV-01 (15 §6): Boot fails fast when required environment variables are missing (zero hardcoded fallbacks)', () => {
    expect(() => loadAndValidateEnv({ NODE_ENV: 'production' } as any)).toThrow(
      /BOOT_CONFIG_INVALID/,
    );
  });

  it('TC-CFG-01 (RT-019): Resolver does NOT double-apply TRADE (L1) layer for installed organisations', () => {
    const res = resolveConfigV021(
      {
        PLATFORM: {
          level: 'PLATFORM',
          versionId: 'v-plat',
          schemaVersion: 'v1.0',
          payload: { 'security.retention_days': 365 },
        },
        TRADE: {
          level: 'TRADE',
          versionId: 'v-trade',
          schemaVersion: 'v1.0',
          payload: {
            'checklist.requirements': [{ key: 'REQ-1', mandatory: true }],
          },
        },
        ORG: {
          level: 'ORG',
          versionId: 'v-org',
          schemaVersion: 'v1.0',
          payload: {
            'checklist.requirements': [{ key: 'REQ-1', mandatory: false }],
          },
        },
      },
      false, // isPreview = false => installed org
    );

    expect(res.conflicts).toHaveLength(0);
    expect(res.payload['checklist.requirements'][0].mandatory).toBe(false);
    expect(res.provenance['checklist.requirements']?.level).toBe('ORG');
  });

  it('TC-CFG-02 (RT-020): LOCKED platform field cannot be overridden by ORG or PROJECT', () => {
    const res = resolveConfigV021(
      {
        PLATFORM: {
          level: 'PLATFORM',
          versionId: 'v-plat',
          schemaVersion: 'v1.0',
          payload: { 'security.retention_days': 365 },
        },
        ORG: {
          level: 'ORG',
          versionId: 'v-org',
          schemaVersion: 'v1.0',
          payload: { 'security.retention_days': 30 },
        },
      },
      false,
    );

    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]?.path).toBe('security.retention_days');
    expect(res.payload['security.retention_days']).toBe(365);
  });

  it('TC-CFG-03 (RT-020): INHERIT_ONLY field (branding.primary_color) is rejected if overridden at PROJECT level', () => {
    const res = resolveConfigV021(
      {
        ORG: {
          level: 'ORG',
          versionId: 'v-org',
          schemaVersion: 'v1.0',
          payload: { 'branding.primary_color': '#0F2942' },
        },
        PROJECT: {
          level: 'PROJECT',
          versionId: 'v-proj',
          schemaVersion: 'v1.0',
          payload: { 'branding.primary_color': '#FF0000' },
        },
      },
      false,
    );

    expect(res.conflicts).toHaveLength(1);
    expect(res.payload['branding.primary_color']).toBe('#0F2942');
  });
});
