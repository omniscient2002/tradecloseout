import { parseIncidentRunbookArgs } from '../../../scripts/incident-runbook-args';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REASON = 'Malicious evidence identified during independent review';

describe('PH5-G28-001 incident runbook command preconditions', () => {
  it('requires an explicit dry-run or execution flag', () => {
    expect(() => parseIncidentRunbookArgs(['RB-09', ORG, TARGET, REASON])).toThrow('--dry-run');
    expect(() => parseIncidentRunbookArgs(['RB-09', ORG, TARGET, REASON, '--dry-run', '--execute']))
      .toThrow('exactly one');
  });

  it('rejects unknown operations, missing/other-tenant-shaped targets and weak incident reasons', () => {
    expect(() => parseIncidentRunbookArgs(['RB-99', ORG, TARGET, REASON, '--execute']))
      .toThrow('Unsupported');
    expect(() => parseIncidentRunbookArgs(['RB-09', 'not-a-uuid', TARGET, REASON, '--execute']))
      .toThrow('organisation');
    expect(() => parseIncidentRunbookArgs(['RB-09', ORG, '-', REASON, '--execute']))
      .toThrow('target');
    expect(() => parseIncidentRunbookArgs(['RB-09', ORG, TARGET, 'test', '--execute']))
      .toThrow('reason');
    expect(() => parseIncidentRunbookArgs(['RB-09', ORG, TARGET, REASON + '\nlogin secret', '--execute']))
      .toThrow('reason');
  });

  it('permits scoped dry-run and execution only for allowed codes and explicit targets', () => {
    expect(parseIncidentRunbookArgs(['RB-08', ORG, '-', REASON, '--dry-run'])).toEqual({
      code: 'RB-08', orgId: ORG, entityId: null, reason: REASON, execute: false,
    });
    expect(parseIncidentRunbookArgs(['RB-09', ORG, TARGET, REASON, '--execute'])).toEqual({
      code: 'RB-09', orgId: ORG, entityId: TARGET, reason: REASON, execute: true,
    });
    expect(parseIncidentRunbookArgs(['RB-12', ORG, TARGET, REASON, '--dry-run']).execute).toBe(false);
    expect(() => parseIncidentRunbookArgs(['RB-08', ORG, TARGET, REASON, '--execute'])).toThrow('target');
  });
});
