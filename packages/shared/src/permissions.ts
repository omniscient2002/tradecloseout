// packages/shared/src/permissions.ts
// Positive-only additive permission model (05 §3.2, D-039, RT-004, RT-018, RT-021)

export type PermissionScope = 'Y' | 'A' | 'S';

export const ORG_ROLE_PERMISSIONS: Record<string, Record<string, PermissionScope>> = {
  'R-OWNER': {
    'org.read': 'Y', 'org.manage': 'Y', 'org.manage_members': 'Y', 'org.transfer_ownership': 'Y',
    'org.delete': 'Y', 'billing.read': 'Y', 'billing.manage': 'Y', 'party.read': 'Y', 'party.manage': 'Y',
    'template.read': 'Y', 'template.manage': 'Y', 'project.create': 'Y', 'project.read': 'A',
    'project.manage': 'A', 'project.close': 'Y', 'contract.manage': 'Y', 'checklist.manage': 'Y',
    'asset.read': 'A', 'asset.manage': 'Y', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'A', 'document.metadata_edit': 'A', 'document.delete': 'A',
    'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A', 'review.decide': 'A',
    'review.record_external': 'Y', 'requirement.waive': 'Y', 'requirement.waive_second': 'Y',
    'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y', 'package.accept': 'Y',
    'warranty.manage': 'Y', 'defect.manage': 'Y', 'notification.manage': 'Y', 'audit.read': 'Y',
    'export.data': 'Y', 'apikey.manage': 'Y',
  },
  'R-ADMIN': {
    'org.read': 'Y', 'org.manage': 'Y', 'org.manage_members': 'Y', 'billing.read': 'Y',
    'party.read': 'Y', 'party.manage': 'Y', 'template.read': 'Y', 'template.manage': 'Y',
    'project.create': 'Y', 'project.read': 'A', 'project.manage': 'A', 'project.close': 'Y',
    'contract.manage': 'Y', 'checklist.manage': 'Y', 'asset.read': 'A', 'asset.manage': 'Y',
    'document.read': 'A', 'document.upload': 'A', 'document.download': 'A', 'document.metadata_edit': 'A',
    'document.delete': 'A', 'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A',
    'review.decide': 'A', 'review.record_external': 'Y', 'requirement.waive': 'Y',
    'requirement.waive_second': 'Y', 'package.generate': 'Y', 'package.download': 'Y',
    'package.submit': 'Y', 'package.accept': 'Y', 'warranty.manage': 'Y', 'defect.manage': 'Y',
    'notification.manage': 'Y', 'audit.read': 'Y', 'export.data': 'Y', 'apikey.manage': 'Y',
  },
  'R-PM': {
    'org.read': 'Y', 'party.read': 'Y', 'party.manage': 'Y', 'template.read': 'Y',
    'project.create': 'Y', 'project.read': 'A', 'project.manage': 'A', 'project.close': 'Y',
    'contract.manage': 'Y', 'checklist.manage': 'Y', 'asset.read': 'A', 'asset.manage': 'Y',
    'document.read': 'A', 'document.upload': 'A', 'document.download': 'A', 'document.metadata_edit': 'A',
    'document.delete': 'A', 'document.bulk_import': 'Y', 'review.read': 'A', 'review.submit': 'A',
    'review.decide': 'S', // Scoped to requirements where reviewer_role matches (AUD-005)
    'review.record_external': 'Y', 'requirement.waive': 'Y', 'package.generate': 'Y',
    'package.download': 'Y', 'package.submit': 'Y', 'package.accept': 'Y',
    'warranty.manage': 'Y', 'defect.manage': 'Y', 'notification.manage': 'Y', 'audit.read': 'Y',
  },
  'R-SITE': {
    'org.read': 'Y', 'party.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'asset.manage': 'S',
    'document.read': 'S', 'document.upload': 'S', 'document.download': 'S', 'document.metadata_edit': 'S',
    'review.read': 'S', 'review.submit': 'S', 'package.download': 'S', 'defect.manage': 'S',
  },
  'R-DOC': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'A', 'asset.read': 'A',
    'asset.manage': 'Y', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'S', // Widened to 'A' only if org.doc_controller_org_wide_download = true
    'document.metadata_edit': 'A', 'document.delete': 'A', 'document.bulk_import': 'Y',
    'review.read': 'A', 'review.submit': 'A', 'review.record_external': 'Y',
    'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y', 'notification.manage': 'Y',
  },
  'R-PROC': {
    'org.read': 'Y', 'party.read': 'Y', 'party.manage': 'Y', 'project.read': 'S', 'asset.read': 'S',
    'asset.manage': 'S', 'document.read': 'S', 'document.upload': 'S', 'document.download': 'S',
    'document.metadata_edit': 'S', 'review.read': 'S', 'review.submit': 'S', 'warranty.manage': 'S',
  },
  'R-QC': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'S', 'asset.read': 'S',
    'asset.manage': 'S', 'document.read': 'S', 'document.upload': 'S', 'document.download': 'S',
    'document.metadata_edit': 'S', 'review.read': 'S', 'review.submit': 'S', 'review.decide': 'S',
    'defect.manage': 'S',
  },
  'R-SAFETY': {
    'org.read': 'Y', 'party.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'document.read': 'S',
    'document.upload': 'S', 'document.download': 'S', 'review.read': 'S', 'review.submit': 'S',
  },
  'R-REVIEWER': {
    'org.read': 'Y', 'party.read': 'Y', 'project.read': 'S', 'asset.read': 'S', 'document.read': 'S',
    'document.download': 'S', 'review.read': 'S', 'review.decide': 'S', 'package.download': 'Y',
  },
  'R-AUDITOR': {
    'org.read': 'Y', 'party.read': 'Y', 'template.read': 'Y', 'project.read': 'A', 'asset.read': 'A',
    'document.read': 'A', 'document.download': 'A', 'review.read': 'A', 'package.download': 'Y',
    'audit.read': 'Y',
  },
  'R-BILLING': {
    'org.read': 'Y', 'billing.read': 'Y', 'billing.manage': 'Y',
  },
};

export const PROJECT_ROLE_PERMISSIONS: Record<string, Record<string, PermissionScope>> = {
  'R-PM': {
    'project.read': 'A', 'project.manage': 'A', 'contract.manage': 'Y', 'checklist.manage': 'Y',
    'asset.read': 'A', 'asset.manage': 'Y', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'A', 'document.metadata_edit': 'A', 'document.delete': 'A',
    'review.read': 'A', 'review.submit': 'A', 'review.decide': 'S', 'requirement.waive': 'Y',
    'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y', 'package.accept': 'Y',
    'warranty.manage': 'Y', 'defect.manage': 'Y',
  },
  'R-SITE': {
    'project.read': 'S', 'asset.read': 'S', 'asset.manage': 'S', 'document.read': 'S',
    'document.upload': 'S', 'document.download': 'S', 'document.metadata_edit': 'S',
    'review.read': 'S', 'review.submit': 'S', 'package.download': 'S', 'defect.manage': 'S',
  },
  'R-DOC': {
    'project.read': 'A', 'asset.read': 'A', 'document.read': 'A', 'document.upload': 'A',
    'document.download': 'S', 'document.metadata_edit': 'A', 'review.read': 'A',
    'review.submit': 'A', 'package.generate': 'Y', 'package.download': 'Y', 'package.submit': 'Y',
  },
  'R-CONSULTANT': {
    'project.read': 'S', 'asset.read': 'S', 'document.read': 'S', 'document.download': 'S',
    'review.read': 'S', 'review.decide': 'S', 'package.download': 'S',
  },
  'R-CLIENT': {
    'project.read': 'S', 'document.read': 'S', 'document.download': 'S', 'package.download': 'S',
    'package.accept': 'S',
  },
  'R-SUBCONTRACTOR': {
    'project.read': 'S', 'asset.read': 'S', 'document.read': 'S', 'document.upload': 'S',
    'document.download': 'S', 'review.read': 'S', 'defect.manage': 'S',
  },
};

export interface PermissionEvaluationContext {
  orgRole?: string;
  projectRole?: string;
  guestCapabilities?: string[];
  docControllerOrgWideDownload?: boolean;
}

export function hasPermission(
  ctx: PermissionEvaluationContext,
  permission: string,
): { allowed: boolean; scope: PermissionScope } {
  if (permission === 'document.download' && ctx.orgRole === 'R-DOC' && ctx.docControllerOrgWideDownload) {
    return { allowed: true, scope: 'A' };
  }

  const orgGrant = ctx.orgRole ? ORG_ROLE_PERMISSIONS[ctx.orgRole]?.[permission] : undefined;
  const projGrant = ctx.projectRole ? PROJECT_ROLE_PERMISSIONS[ctx.projectRole]?.[permission] : undefined;
  const isGuestGranted = ctx.guestCapabilities?.includes(permission);

  if (!orgGrant && !projGrant && !isGuestGranted) {
    return { allowed: false, scope: 'S' };
  }

  // Owner and Admin retain full org-wide capabilities
  if (ctx.orgRole === 'R-OWNER' || ctx.orgRole === 'R-ADMIN') {
    return { allowed: true, scope: orgGrant || 'Y' };
  }

  // If user has a project role on this project, use project grant or org grant
  if (projGrant) {
    return { allowed: true, scope: projGrant };
  }

  if (orgGrant) {
    return { allowed: true, scope: orgGrant };
  }

  if (isGuestGranted) {
    return { allowed: true, scope: 'Y' };
  }

  return { allowed: false, scope: 'S' };
}

/* ========================================================================== */
/* NEW SPECIFICATION ENGINE (05-ACTORS-AND-PERMISSIONS.md §3.2, §4, §6.4)     */
/* ========================================================================== */

export type OrgRole =
  | 'R-OWNER'
  | 'R-ADMIN'
  | 'R-BILLING'
  | 'R-PM'
  | 'R-SITE'
  | 'R-DOC'
  | 'R-PROC'
  | 'R-QC'
  | 'R-SAFETY'
  | 'R-REVIEWER'
  | 'R-AUDITOR';

export type GuestRole =
  | 'R-CONSULT'
  | 'R-CLIENT'
  | 'R-MC'
  | 'R-SUPPLIER-OEM'
  | 'R-SUBCONTRACTOR'
  | 'R-SUPPLIER-UP'
  | 'R-LAB'
  | 'R-OEM-SERVICE'
  | 'R-MC-DOC'
  | 'R-EXT-REVIEW';

export type Permission =
  | 'org.read'
  | 'org.manage'
  | 'org.manage_members'
  | 'org.transfer_ownership'
  | 'org.delete'
  | 'billing.read'
  | 'billing.manage'
  | 'party.read'
  | 'party.manage'
  | 'template.read'
  | 'template.manage'
  | 'project.create'
  | 'project.read'
  | 'project.manage'
  | 'project.close'
  | 'contract.manage'
  | 'checklist.manage'
  | 'asset.read'
  | 'asset.manage'
  | 'document.read'
  | 'document.upload'
  | 'document.download'
  | 'document.metadata_edit'
  | 'document.delete'
  | 'document.reuse'
  | 'document.bulk_import'
  | 'review.read'
  | 'review.submit'
  | 'review.decide'
  | 'review.record_external'
  | 'requirement.waive'
  | 'requirement.waive_second'
  | 'package.generate'
  | 'package.download'
  | 'package.submit'
  | 'package.accept'
  | 'submission.recipients_manage'
  | 'warranty.manage'
  | 'defect.manage'
  | 'notification.manage'
  | 'audit.read'
  | 'export.data'
  | 'apikey.manage';

export type GrantScopeMode = 'ALL' | 'SCOPED';

/**
 * Authoritative Role Matrix from 05-ACTORS-AND-PERMISSIONS.md §4.
 * 'ALL' = org-wide across all projects; 'SCOPED' = only assigned projects/resources.
 */
export const ORG_ROLE_MATRIX: Record<OrgRole, Partial<Record<Permission, GrantScopeMode>>> = {
  'R-OWNER': {
    'org.read': 'ALL', 'org.manage': 'ALL', 'org.manage_members': 'ALL',
    'org.transfer_ownership': 'ALL', 'org.delete': 'ALL',
    'billing.read': 'ALL', 'billing.manage': 'ALL',
    'party.read': 'ALL', 'party.manage': 'ALL',
    'template.read': 'ALL', 'template.manage': 'ALL',
    'project.create': 'ALL', 'project.read': 'ALL', 'project.manage': 'ALL', 'project.close': 'ALL',
    'contract.manage': 'ALL', 'checklist.manage': 'ALL',
    'asset.read': 'ALL', 'asset.manage': 'ALL',
    'document.read': 'ALL', 'document.upload': 'ALL', 'document.download': 'ALL',
    'document.metadata_edit': 'ALL', 'document.delete': 'ALL', 'document.reuse': 'ALL',
    'document.bulk_import': 'ALL',
    'review.read': 'ALL', 'review.submit': 'ALL', 'review.decide': 'ALL',
    'review.record_external': 'ALL',
    'requirement.waive': 'ALL', 'requirement.waive_second': 'ALL',
    'package.generate': 'ALL', 'package.download': 'ALL', 'package.submit': 'ALL', 'package.accept': 'ALL',
    'submission.recipients_manage': 'ALL', 'warranty.manage': 'ALL', 'defect.manage': 'ALL',
    'notification.manage': 'ALL', 'audit.read': 'ALL', 'export.data': 'ALL', 'apikey.manage': 'ALL',
  },
  'R-ADMIN': {
    'org.read': 'ALL', 'org.manage': 'ALL', 'org.manage_members': 'ALL',
    'billing.read': 'ALL',
    'party.read': 'ALL', 'party.manage': 'ALL',
    'template.read': 'ALL', 'template.manage': 'ALL',
    'project.create': 'ALL', 'project.read': 'ALL', 'project.manage': 'ALL', 'project.close': 'ALL',
    'contract.manage': 'ALL', 'checklist.manage': 'ALL',
    'asset.read': 'ALL', 'asset.manage': 'ALL',
    'document.read': 'ALL', 'document.upload': 'ALL', 'document.download': 'ALL',
    'document.metadata_edit': 'ALL', 'document.delete': 'ALL', 'document.reuse': 'ALL',
    'document.bulk_import': 'ALL',
    'review.read': 'ALL', 'review.submit': 'ALL', 'review.decide': 'ALL',
    'review.record_external': 'ALL',
    'requirement.waive': 'ALL', 'requirement.waive_second': 'ALL',
    'package.generate': 'ALL', 'package.download': 'ALL', 'package.submit': 'ALL', 'package.accept': 'ALL',
    'submission.recipients_manage': 'ALL', 'warranty.manage': 'ALL', 'defect.manage': 'ALL',
    'notification.manage': 'ALL', 'audit.read': 'ALL', 'export.data': 'ALL', 'apikey.manage': 'ALL',
  },
  'R-BILLING': {
    'org.read': 'ALL', 'billing.read': 'ALL', 'billing.manage': 'ALL',
  },
  'R-PM': {
    'org.read': 'ALL', 'party.read': 'ALL', 'party.manage': 'ALL', 'template.read': 'ALL',
    'project.create': 'ALL', 'project.read': 'ALL', 'project.manage': 'ALL', 'project.close': 'SCOPED',
    'contract.manage': 'SCOPED', 'checklist.manage': 'SCOPED',
    'asset.read': 'ALL', 'asset.manage': 'SCOPED',
    'document.read': 'ALL', 'document.upload': 'ALL', 'document.download': 'ALL',
    'document.metadata_edit': 'ALL', 'document.delete': 'ALL', 'document.reuse': 'ALL',
    'document.bulk_import': 'SCOPED',
    'review.read': 'ALL', 'review.submit': 'ALL',
    'review.decide': 'SCOPED', // AUD-005: Scoped to requirements where reviewer_role matches
    'review.record_external': 'SCOPED',
    'requirement.waive': 'SCOPED',
    'package.generate': 'SCOPED', 'package.download': 'SCOPED', 'package.submit': 'SCOPED',
    'package.accept': 'SCOPED', 'submission.recipients_manage': 'SCOPED',
    'warranty.manage': 'SCOPED', 'defect.manage': 'SCOPED',
    'notification.manage': 'SCOPED', 'audit.read': 'SCOPED',
  },
  'R-SITE': {
    'org.read': 'ALL', 'party.read': 'ALL',
    'project.read': 'SCOPED', 'asset.read': 'SCOPED', 'asset.manage': 'SCOPED',
    'document.read': 'SCOPED', 'document.upload': 'SCOPED', 'document.download': 'SCOPED',
    'document.metadata_edit': 'SCOPED', 'review.read': 'SCOPED', 'review.submit': 'SCOPED',
    'package.download': 'SCOPED', 'defect.manage': 'SCOPED',
  },
  'R-DOC': {
    'org.read': 'ALL', 'party.read': 'ALL', 'template.read': 'ALL',
    'project.read': 'ALL', 'asset.read': 'ALL', 'asset.manage': 'SCOPED',
    'document.read': 'ALL', 'document.upload': 'ALL',
    'document.download': 'SCOPED', // AUD-005: Scoped by default unless org setting widens
    'document.metadata_edit': 'ALL', 'document.delete': 'ALL', 'document.reuse': 'ALL',
    'document.bulk_import': 'SCOPED',
    'review.read': 'ALL', 'review.submit': 'ALL', 'review.record_external': 'SCOPED',
    'package.generate': 'SCOPED', 'package.download': 'SCOPED', 'package.submit': 'SCOPED',
    'notification.manage': 'SCOPED',
  },
  'R-PROC': {
    'org.read': 'ALL', 'party.read': 'ALL', 'party.manage': 'ALL',
    'project.read': 'SCOPED', 'asset.read': 'SCOPED', 'asset.manage': 'SCOPED',
    'document.read': 'SCOPED', 'document.upload': 'SCOPED', 'document.download': 'SCOPED',
    'document.metadata_edit': 'SCOPED', 'review.read': 'SCOPED', 'review.submit': 'SCOPED',
    'warranty.manage': 'SCOPED',
  },
  'R-QC': {
    'org.read': 'ALL', 'party.read': 'ALL', 'template.read': 'ALL',
    'project.read': 'SCOPED', 'asset.read': 'SCOPED', 'asset.manage': 'SCOPED',
    'document.read': 'SCOPED', 'document.upload': 'SCOPED', 'document.download': 'SCOPED',
    'document.metadata_edit': 'SCOPED',
    'review.read': 'SCOPED', 'review.submit': 'SCOPED', 'review.decide': 'SCOPED',
    'defect.manage': 'SCOPED',
  },
  'R-SAFETY': {
    'org.read': 'ALL',
    'project.read': 'SCOPED', 'document.read': 'SCOPED',
    'document.upload': 'SCOPED', 'document.download': 'SCOPED', 'review.read': 'SCOPED',
  },
  'R-REVIEWER': {
    'org.read': 'ALL', 'party.read': 'ALL',
    'project.read': 'SCOPED', 'asset.read': 'SCOPED',
    'document.read': 'SCOPED', 'document.download': 'SCOPED',
    'review.read': 'SCOPED', 'review.decide': 'SCOPED', 'package.download': 'SCOPED',
  },
  'R-AUDITOR': {
    'org.read': 'ALL', 'party.read': 'ALL', 'template.read': 'ALL',
    'project.read': 'ALL', 'asset.read': 'ALL',
    'document.read': 'ALL', 'document.download': 'ALL',
    'review.read': 'ALL', 'package.download': 'ALL', 'audit.read': 'ALL',
  },
};

const WRITE_PERMISSIONS = new Set<Permission>([
  'project.manage', 'project.close', 'contract.manage', 'checklist.manage',
  'asset.manage', 'document.upload', 'document.metadata_edit', 'document.delete',
  'document.reuse', 'document.bulk_import', 'review.submit', 'review.decide',
  'review.record_external', 'requirement.waive', 'requirement.waive_second',
  'package.generate', 'package.submit', 'package.accept', 'warranty.manage', 'defect.manage',
]);

export interface PermissionCheckContext {
  orgRole?: OrgRole;
  projectRole?: OrgRole;
  isProjectMember: boolean;
  projectStatus: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'HANDOVER' | 'CLOSED' | 'CANCELLED' | 'ARCHIVED';
  requirementReviewerRole?: string | null;
  isSelfApprovalAttempt?: boolean;
  orgAllowsSelfApproval?: boolean;
}

/**
 * Positive-only permission evaluator with narrowing scopes (05 §3.2 AUD-012).
 */
export function evaluateEffectivePermission(
  permission: Permission,
  ctx: PermissionCheckContext,
): { allowed: boolean; reason?: string } {
  // 1. Project status write gate (05 §3.2 Rule 4)
  if (
    WRITE_PERMISSIONS.has(permission) &&
    ['SUSPENDED', 'CLOSED', 'CANCELLED', 'ARCHIVED'].includes(ctx.projectStatus)
  ) {
    return { allowed: false, reason: `Project status ${ctx.projectStatus} blocks write actions.` };
  }

  // 2. Self-approval guard (FR-REV-009)
  if (permission === 'review.decide' && ctx.isSelfApprovalAttempt && !ctx.orgAllowsSelfApproval) {
    return { allowed: false, reason: 'SELF_APPROVAL_DENIED' };
  }

  const orgGrant = ctx.orgRole ? ORG_ROLE_MATRIX[ctx.orgRole]?.[permission] : undefined;
  const projGrant = ctx.projectRole ? ORG_ROLE_MATRIX[ctx.projectRole]?.[permission] : undefined;

  if (!orgGrant && !projGrant) {
    return { allowed: false, reason: 'PERMISSION_NOT_GRANTED' };
  }

  // 3. Narrower scope check: SCOPED requires active project membership
  if (orgGrant !== 'ALL' && projGrant !== 'ALL' && !ctx.isProjectMember) {
    return { allowed: false, reason: 'NOT_PROJECT_MEMBER' };
  }

  // 4. Per-requirement reviewer_role check (FR-REV-002 / AUD-005)
  if (permission === 'review.decide' && ctx.requirementReviewerRole) {
    const isOwnerOrAdmin = ctx.orgRole === 'R-OWNER' || ctx.orgRole === 'R-ADMIN';
    const matchesReviewerRole =
      ctx.orgRole === ctx.requirementReviewerRole || ctx.projectRole === ctx.requirementReviewerRole;
    if (!isOwnerOrAdmin && !matchesReviewerRole) {
      return {
        allowed: false,
        reason: `Requirement requires reviewer role ${ctx.requirementReviewerRole}.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Field-level visibility projection applied before serialising API responses
 * for Guest roles (05 §6.4 / AUD-S-24).
 */
export function projectGuestVisiblePayload<T extends Record<string, any>>(
  payload: T,
  actorRole: OrgRole | GuestRole,
): Partial<T> {
  const isGuest =
    actorRole === 'R-CLIENT' ||
    actorRole === 'R-MC' ||
    actorRole === 'R-CONSULT' ||
    actorRole === 'R-SUPPLIER-OEM' ||
    actorRole === 'R-SUBCONTRACTOR' ||
    actorRole === 'R-SUPPLIER-UP' ||
    actorRole === 'R-LAB';

  if (!isGuest) return payload;

  const clone: Record<string, any> = { ...payload };

  // Strip commercial, pricing, and internal notes from all guests (05 §6.4)
  delete clone.contractValuePaise;
  delete clone.valuePaise;
  delete clone.retentionBps;
  delete clone.internalNote;
  delete clone.auditEvents;

  // Convert internal reviewer names to initials for Client / Main Contractor (05 §6.4)
  if ((actorRole === 'R-CLIENT' || actorRole === 'R-MC') && typeof clone.reviewerName === 'string') {
    clone.reviewerName = clone.reviewerName
      .split(' ')
      .map((part: string) => `${part[0]?.toUpperCase() ?? ''}.`)
      .join('');
  }

  return clone as Partial<T>;
}
