/**
 * Project checklist boundary contract. Never fabricate a status, mandatory
 * flag or optimistic-lock rowVersion after a partial/denied API response.
 * The parser also accepts the API's snake_case and camelCase representations.
 */
export const REQUIREMENT_STATUSES = [
  'NOT_STARTED', 'REQUESTED', 'UPLOADED', 'IN_REVIEW', 'UNDER_REVIEW',
  'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'APPROVED_EXTERNAL',
  'PENDING_WAIVER', 'WAIVED', 'NOT_APPLICABLE', 'EXPIRED', 'MISSING',
  'HANDED_OVER', 'SUPERSEDED',
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export interface ProjectRequirementRow {
  id: string;
  requirementKey: string;
  groupKey: string;
  title: string;
  docTypeKey: string;
  mandatory: boolean;
  milestoneKey: string;
  assetTag: string | null;
  status: RequirementStatus;
  ownerName: string | null;
  reviewerRole: string | null;
  dueAt: string | null;
  revisionCode: string | null;
  latestVersionId: string | null;
  waiverId?: string | null;
  rowVersion: number;
}

const STATUSES = new Set<string>(REQUIREMENT_STATUSES);

export function parseProjectRequirementResponse(payload: unknown): ProjectRequirementRow[] {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: unknown }).data : null;
  const list = Array.isArray(payload) ? payload : data;
  if (!Array.isArray(list)) {
    throw new Error('CHECKLIST_RESPONSE_INVALID: The server did not return a requirement list.');
  }
  return list.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('CHECKLIST_ROW_INVALID: Expected an object.');
    }
    const r = value as Record<string, unknown>;
    const pick = (camel: string, snake: string): unknown => r[camel] ?? r[snake];
    const requirementKey = pick('requirementKey', 'requirement_key');
    const groupKey = pick('groupKey', 'group_key');
    const docTypeKey = pick('docTypeKey', 'doc_type_key');
    const milestoneKey = pick('milestoneKey', 'milestone_key');
    const rowVersion = pick('rowVersion', 'row_version');
    const status = r.status;
    if (typeof r.id !== 'string' || !r.id ||
        typeof r.title !== 'string' || !r.title ||
        typeof requirementKey !== 'string' || !requirementKey ||
        typeof groupKey !== 'string' || !groupKey ||
        typeof docTypeKey !== 'string' || !docTypeKey ||
        typeof milestoneKey !== 'string' || !milestoneKey ||
        typeof r.mandatory !== 'boolean' ||
        !Number.isSafeInteger(rowVersion) || (rowVersion as number) < 1 ||
        typeof status !== 'string' || !STATUSES.has(status)) {
      throw new Error('CHECKLIST_ROW_INVALID: Required status, ownership or revision metadata is missing.');
    }
    const scopeKey = r.scope_key;
    const fromScope = typeof scopeKey === 'string' && scopeKey.startsWith('asset:')
      ? scopeKey.slice(6, 14).toUpperCase() : null;
    const optionalText = (camel: string, snake: string): string | null => {
      const text = pick(camel, snake);
      return typeof text === 'string' ? text : null;
    };
    return {
      id: r.id,
      requirementKey,
      groupKey,
      title: r.title,
      docTypeKey,
      mandatory: r.mandatory,
      milestoneKey,
      assetTag: optionalText('assetTag', 'asset_tag') || fromScope,
      status: status as RequirementStatus,
      ownerName: optionalText('ownerName', 'owner_name'),
      reviewerRole: optionalText('reviewerRole', 'reviewer_role'),
      dueAt: optionalText('dueAt', 'due_at'),
      revisionCode: optionalText('revisionCode', 'revision_code'),
      latestVersionId: optionalText('latestVersionId', 'latest_version_id'),
      waiverId: optionalText('waiverId', 'waiver_id'),
      rowVersion: rowVersion as number,
    };
  });
}
