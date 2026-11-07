import {
  evaluateEffectivePermission,
  projectGuestVisiblePayload,
  ORG_ROLE_PERMISSIONS,
} from '../src/permissions';

describe('SHARED-02 & AUTHZ-01: Permission Model & Visibility Projections', () => {
  describe('Organization Role Permissions Matrix', () => {
    it('grants R-OWNER and R-ADMIN complete administrative rights', () => {
      expect(ORG_ROLE_PERMISSIONS['R-OWNER']['org.manage']).toBe('Y');
      expect(ORG_ROLE_PERMISSIONS['R-OWNER']['org.transfer_ownership']).toBe('Y');
      expect(ORG_ROLE_PERMISSIONS['R-OWNER']['billing.manage']).toBe('Y');

      expect(ORG_ROLE_PERMISSIONS['R-ADMIN']['org.manage']).toBe('Y');
      expect(ORG_ROLE_PERMISSIONS['R-ADMIN']['org.transfer_ownership']).toBeUndefined(); // Only owner transfers ownership
    });

    it('denies billing.manage to R-PM, R-SITE, and external roles', () => {
      expect(ORG_ROLE_PERMISSIONS['R-PM']['billing.manage']).toBeUndefined();
      expect(ORG_ROLE_PERMISSIONS['R-SITE']['billing.manage']).toBeUndefined();
    });

    it('limits R-SITE to scoped operations within assigned projects', () => {
      expect(ORG_ROLE_PERMISSIONS['R-SITE']['document.read']).toBe('S');
      expect(ORG_ROLE_PERMISSIONS['R-SITE']['document.upload']).toBe('S');
      expect(ORG_ROLE_PERMISSIONS['R-SITE']['document.delete']).toBeUndefined();
    });
  });

  describe('evaluateEffectivePermission with Core Invariant Gates', () => {
    it('Gate 1: denies write permissions when project is SUSPENDED, CLOSED, or ARCHIVED', () => {
      const res = evaluateEffectivePermission('document.upload', {
        orgRole: 'R-OWNER',
        isProjectMember: true,
        projectStatus: 'CLOSED',
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('CLOSED');
    });

    it('Gate 2: denies project-scoped permissions when actor is not assigned to project', () => {
      const res = evaluateEffectivePermission('document.upload', {
        orgRole: 'R-SITE',
        isProjectMember: false,
        projectStatus: 'ACTIVE',
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('NOT_PROJECT_MEMBER');
    });

    it('Gate 3 (FR-REV-009): strictly blocks uploader self-approval', () => {
      const res = evaluateEffectivePermission('review.decide', {
        orgRole: 'R-OWNER',
        isProjectMember: true,
        projectStatus: 'ACTIVE',
        isSelfApprovalAttempt: true,
        orgAllowsSelfApproval: false,
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('SELF_APPROVAL_DENIED');
    });

    it('Gate 3: allows distinct actor to approve upload', () => {
      const res = evaluateEffectivePermission('review.decide', {
        orgRole: 'R-OWNER',
        isProjectMember: true,
        projectStatus: 'ACTIVE',
        isSelfApprovalAttempt: false,
      });
      expect(res.allowed).toBe(true);
    });

    it('Gate 4 (AUD-005): enforces requirement-specific reviewer_role matching', () => {
      const mismatched = evaluateEffectivePermission('review.decide', {
        orgRole: 'R-PM',
        projectRole: 'R-PM',
        isProjectMember: true,
        projectStatus: 'ACTIVE',
        requirementReviewerRole: 'R-QA',
      });
      expect(mismatched.allowed).toBe(false);
      expect(mismatched.reason).toContain('Requirement requires reviewer role R-QA');

      // But R-OWNER can decide regardless of requirementReviewerRole
      const ownerDecision = evaluateEffectivePermission('review.decide', {
        orgRole: 'R-OWNER',
        isProjectMember: true,
        projectStatus: 'ACTIVE',
        requirementReviewerRole: 'R-QA',
      });
      expect(ownerDecision.allowed).toBe(true);
    });
  });

  describe('projectGuestVisiblePayload (Field-level visibility projection 05 §6.4)', () => {
    const internalPayload = {
      id: 'doc-1',
      title: 'MEP As-Built Drawings',
      contractValuePaise: 500000000n,
      valuePaise: 500000000n,
      retentionBps: 500,
      internalNote: 'Review margin before sharing',
      reviewerName: 'John Doe',
      status: 'APPROVED',
    };

    it('redacts all commercial figures and internal notes for guest/external roles', () => {
      const projected = projectGuestVisiblePayload(internalPayload, 'R-CLIENT');
      expect(projected.contractValuePaise).toBeUndefined();
      expect(projected.valuePaise).toBeUndefined();
      expect(projected.retentionBps).toBeUndefined();
      expect(projected.internalNote).toBeUndefined();
      expect(projected.title).toBe('MEP As-Built Drawings');
    });

    it('converts reviewer full name to initials for R-CLIENT to protect internal identity', () => {
      const projected = projectGuestVisiblePayload(internalPayload, 'R-CLIENT');
      expect(projected.reviewerName).toBe('J.D.');
    });

    it('preserves complete payload for internal members (R-OWNER, R-PM)', () => {
      const internalResult = projectGuestVisiblePayload(internalPayload, 'R-OWNER');
      expect(internalResult.contractValuePaise).toBe(500000000n);
      expect(internalResult.internalNote).toBe('Review margin before sharing');
      expect(internalResult.reviewerName).toBe('John Doe');
    });
  });
});
