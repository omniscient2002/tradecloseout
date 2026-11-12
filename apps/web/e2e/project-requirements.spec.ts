import { test, expect } from '@playwright/test';
import {
  parseProjectRequirementResponse,
  REQUIREMENT_STATUSES,
} from '../src/lib/project-requirements';

const base = {
  id: '0192e000-0000-7000-8000-000000000101',
  requirement_key: 'HVAC-COMMISSIONING',
  group_key: 'COMMISSIONING',
  title: 'Commissioning report',
  doc_type_key: 'TEST_REPORT',
  milestone_key: 'COMMISSIONING',
  mandatory: true,
  row_version: 7,
  status: 'UNDER_REVIEW',
  scope_key: 'project',
};

test('project checklist parser preserves true server statuses and optimistic-lock versions', () => {
  const rows = parseProjectRequirementResponse({ data: [
    base,
    { ...base, id: '0192e000-0000-7000-8000-000000000102',
      status: 'SUPERSEDED', mandatory: false, row_version: 8 },
  ] });
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    requirementKey: 'HVAC-COMMISSIONING', status: 'UNDER_REVIEW',
    mandatory: true, rowVersion: 7,
  });
  expect(rows[1]).toMatchObject({ status: 'SUPERSEDED', mandatory: false, rowVersion: 8 });
  expect(REQUIREMENT_STATUSES).toContain('SUPERSEDED');
  expect(REQUIREMENT_STATUSES).toContain('UNDER_REVIEW');
});

test('project checklist parser accepts current camelCase API properties', () => {
  const camel = {
    id: base.id, requirementKey: 'HVAC-DEFECT', groupKey: 'DEFECTS',
    title: 'Test record', docTypeKey: 'REPORT', milestoneKey: 'HANDOVER',
    mandatory: true, rowVersion: 3, status: 'NOT_STARTED',
  };
  expect(parseProjectRequirementResponse([camel])[0])
    .toMatchObject({ requirementKey: 'HVAC-DEFECT', status: 'NOT_STARTED', rowVersion: 3 });
});

test('malformed/denied checklist payload never becomes an empty checklist', () => {
  for (const payload of [null, {}, { error: 'FORBIDDEN' }, { data: {} }, 'invalid']) {
    expect(() => parseProjectRequirementResponse(payload)).toThrow('CHECKLIST_RESPONSE_INVALID');
  }
  expect(parseProjectRequirementResponse({ data: [] })).toEqual([]);
});

test('missing, falsified or unknown server values cannot become valid project state', () => {
  for (const bad of [
    { ...base, mandatory: undefined },
    { ...base, status: undefined },
    { ...base, status: 'SOMETHING_NEW' },
    { ...base, row_version: undefined },
    { ...base, row_version: 0 },
    { ...base, row_version: '1' },
    { ...base, requirement_key: undefined },
    { ...base, doc_type_key: null },
  ]) {
    expect(() => parseProjectRequirementResponse({ data: [bad] })).toThrow('CHECKLIST_ROW_INVALID');
  }
});
