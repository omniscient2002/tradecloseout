import { evaluateEffectivePermission } from '../src/permissions';

describe('Production permission checks for project states', () => {
  it.each(['SUSPENDED', 'CLOSED', 'ARCHIVED'])('SHARED-03: blocks upload into %s project', projectStatus => {
    const result = evaluateEffectivePermission('document.upload', {
      orgRole: 'R-OWNER', isProjectMember: true, projectStatus: projectStatus as any,
    });
    expect(result.allowed).toBe(false);
  });
  it('SHARED-03: permits authorized upload into ACTIVE project', () => {
    expect(evaluateEffectivePermission('document.upload', {
      orgRole: 'R-OWNER', isProjectMember: true, projectStatus: 'ACTIVE',
    }).allowed).toBe(true);
  });
  it('SHARED-03: blocks self approval even in an active project', () => {
    expect(evaluateEffectivePermission('review.decide', {
      orgRole: 'R-OWNER', isProjectMember: true, projectStatus: 'ACTIVE',
      isSelfApprovalAttempt: true, orgAllowsSelfApproval: false,
    }).allowed).toBe(false);
  });
});
