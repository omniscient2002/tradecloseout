// apps/api/test/rbac-matrix.spec.ts
// Automated RBAC Matrix and Positive-Only Additive Permissions Test
// @traces('FR-ORG-004', 'FR-ORG-005', 'FR-ORG-006', 'FR-ORG-007', 'FR-ORG-008', 'FR-ORG-009', 'FR-ORG-010', 'NFR-SEC-003', 'NFR-SEC-004')

import {
  ORG_ROLE_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  hasPermission,
} from '@tradecloseout/shared';

describe('RBAC Matrix: Additive Positive-Only Security Model', () => {
  describe('Org Role Capabilities', () => {
    it('R-OWNER has full organizational and billing permissions', () => {
      const perms = ORG_ROLE_PERMISSIONS['R-OWNER'];
      expect(perms['org.delete']).toBe('Y');
      expect(perms['org.transfer_ownership']).toBe('Y');
      expect(perms['billing.manage']).toBe('Y');
      expect(perms['requirement.waive_second']).toBe('Y');

      const evalResult = hasPermission({ orgRole: 'R-OWNER' }, 'billing.manage');
      expect(evalResult.allowed).toBe(true);
      expect(evalResult.scope).toBe('Y');
    });

    it('R-ADMIN can manage members and projects but cannot transfer org ownership', () => {
      const perms = ORG_ROLE_PERMISSIONS['R-ADMIN'];
      expect(perms['org.manage_members']).toBe('Y');
      expect(perms['project.create']).toBe('Y');
      expect(perms['org.transfer_ownership']).toBeUndefined();

      const transferCheck = hasPermission({ orgRole: 'R-ADMIN' }, 'org.transfer_ownership');
      expect(transferCheck.allowed).toBe(false);
    });

    it('R-AUDITOR has read-only access and cannot upload documents or alter data', () => {
      const evalRead = hasPermission({ orgRole: 'R-AUDITOR' }, 'document.read');
      expect(evalRead.allowed).toBe(true);
      expect(evalRead.scope).toBe('A');

      const evalUpload = hasPermission({ orgRole: 'R-AUDITOR' }, 'document.upload');
      expect(evalUpload.allowed).toBe(false);

      const evalWaive = hasPermission({ orgRole: 'R-AUDITOR' }, 'requirement.waive');
      expect(evalWaive.allowed).toBe(false);
    });

    it('R-SAFETY has scoped asset and party reading, but cannot alter contracts or waive', () => {
      const assetRead = hasPermission({ orgRole: 'R-SAFETY' }, 'asset.read');
      expect(assetRead.allowed).toBe(true);
      expect(assetRead.scope).toBe('S');

      const partyRead = hasPermission({ orgRole: 'R-SAFETY' }, 'party.read');
      expect(partyRead.allowed).toBe(true);
      expect(partyRead.scope).toBe('Y');

      const contractCheck = hasPermission({ orgRole: 'R-SAFETY' }, 'contract.manage');
      expect(contractCheck.allowed).toBe(false);
    });
  });

  describe('Project Role Scoping & Positive-Only Union', () => {
    it('R-PM on project grants requirement waiver within project', () => {
      const result = hasPermission({ projectRole: 'R-PM' }, 'requirement.waive');
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe('Y');
    });

    it('Additive capability: Org R-AUDITOR combined with Project R-PM gains PM permissions', () => {
      const result = hasPermission({ orgRole: 'R-AUDITOR', projectRole: 'R-PM' }, 'requirement.waive');
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe('Y');
    });

    it('R-DOC download permission widens to org-wide (A) when toggle is enabled', () => {
      const standard = hasPermission({ orgRole: 'R-DOC', docControllerOrgWideDownload: false }, 'document.download');
      expect(standard.scope).toBe('S');

      const widened = hasPermission({ orgRole: 'R-DOC', docControllerOrgWideDownload: true }, 'document.download');
      expect(widened.allowed).toBe(true);
      expect(widened.scope).toBe('A');
    });

    it('Guest token capabilities are honored additively', () => {
      const guestResult = hasPermission(
        { guestCapabilities: ['review.decide', 'package.download'] },
        'review.decide',
      );
      expect(guestResult.allowed).toBe(true);
      expect(guestResult.scope).toBe('Y');

      const denied = hasPermission(
        { guestCapabilities: ['review.decide'] },
        'billing.manage',
      );
      expect(denied.allowed).toBe(false);
    });
  });
});
