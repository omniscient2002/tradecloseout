import { test, expect } from '@playwright/test';
import { parseProjectSummaryResponse } from '../src/lib/project-summary';

const projectId = '0192e000-0000-7000-8000-000000000010';
const valid = {
  id: projectId,
  code: 'HVAC-001',
  name: 'Building Handover',
  status: 'ACTIVE',
  clientName: null,
  targetHandoverDate: null,
  retentionAtRiskPaise: '900719925474099199',
  rowVersion: 11,
  counts: {
    applicableTotal: 8,
    approvedCount: 4,
    approvedExternalCount: 1,
    waivedCount: 0,
    inReviewCount: 2,
    missingOrExpiredCount: 1,
    expiringSoonCount: 1,
  },
};

test('valid dashboard preserves exact string paise, true counts and optimistic lock revision', () => {
  expect(parseProjectSummaryResponse(valid, projectId)).toEqual(valid);
});

test('dashboard rejects another project, invalid status or missing row version', () => {
  for (const input of [
    { ...valid, id: '0192e000-0000-7000-8000-000000000011' },
    { ...valid, status: 'ACTIVE_ADMIN_OVERRIDE' },
    { ...valid, rowVersion: null },
    { ...valid, rowVersion: 0 },
    { ...valid, rowVersion: '1' },
    null,
  ]) {
    expect(() => parseProjectSummaryResponse(input, projectId)).toThrow('PROJECT_SUMMARY_INVALID');
  }
});

test('unavailable counts and money never turn into invented zero', () => {
  for (const input of [
    { ...valid, retentionAtRiskPaise: undefined },
    { ...valid, retentionAtRiskPaise: 'NaN' },
    { ...valid, retentionAtRiskPaise: 0 },
    { ...valid, counts: {} },
    { ...valid, counts: { ...valid.counts, missingOrExpiredCount: undefined } },
    { ...valid, counts: { ...valid.counts, approvedCount: -1 } },
    { ...valid, counts: { ...valid.counts, waivedCount: '2' } },
  ]) {
    expect(() => parseProjectSummaryResponse(input, projectId)).toThrow('PROJECT_SUMMARY_INVALID');
  }
});
