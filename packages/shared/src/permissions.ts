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
