/**
 * Exact project-dashboard DTO, backed by projects.status/row_version and
 * canonical PostgreSQL count aggregation. A missing or stale summary must not
 * render arbitrary project information, fabricated zero counts or money.
 */
export const PROJECT_STATUSES = [
  'DRAFT', 'ACTIVE', 'SUSPENDED', 'HANDOVER', 'CLOSED', 'CANCELLED', 'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectSummaryDto {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  clientName: string | null;
  targetHandoverDate: string | null;
  retentionAtRiskPaise: string;
  contractValuePaise?: string;
  counts: {
    applicableTotal: number;
    approvedCount: number;
    approvedExternalCount: number;
    waivedCount: number;
    inReviewCount: number;
    missingOrExpiredCount: number;
    expiringSoonCount: number;
  };
  rowVersion: number;
}

const statusSet = new Set<string>(PROJECT_STATUSES);
const countKeys = [
  'applicableTotal', 'approvedCount', 'approvedExternalCount', 'waivedCount',
  'inReviewCount', 'missingOrExpiredCount', 'expiringSoonCount',
] as const;

export function parseProjectSummaryResponse(value: unknown, requestedProjectId: string): ProjectSummaryDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROJECT_SUMMARY_INVALID: Missing current project data.');
  }
  const p = value as Record<string, unknown>;
  if (!requestedProjectId || p.id !== requestedProjectId ||
      typeof p.code !== 'string' || !p.code ||
      typeof p.name !== 'string' || !p.name ||
      typeof p.status !== 'string' || !statusSet.has(p.status) ||
      !Number.isSafeInteger(p.rowVersion) || (p.rowVersion as number) < 1 ||
      typeof p.retentionAtRiskPaise !== 'string' ||
      !/^-?[0-9]+$/.test(p.retentionAtRiskPaise) ||
      typeof p.counts !== 'object' || p.counts === null ||
      Array.isArray(p.counts) ||
      (p.clientName != null && typeof p.clientName !== 'string') ||
      (p.targetHandoverDate != null && typeof p.targetHandoverDate !== 'string')) {
    throw new Error('PROJECT_SUMMARY_INVALID: Missing, stale or malformed project metadata.');
  }

  const counts = p.counts as Record<string, unknown>;
  if (countKeys.some((key) =>
    !Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0)) {
    throw new Error('PROJECT_SUMMARY_INVALID: Required counts are missing or invalid.');
  }

  if (p.contractValuePaise != null &&
      (typeof p.contractValuePaise !== 'string' || !/^-?[0-9]+$/.test(p.contractValuePaise))) {
    throw new Error('PROJECT_SUMMARY_INVALID: Contract value is not a valid paise integer.');
  }

  return p as unknown as ProjectSummaryDto;
}
