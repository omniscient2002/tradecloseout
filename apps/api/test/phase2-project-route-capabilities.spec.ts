import 'reflect-metadata';
import { hasPermission } from '@tradecloseout/shared';
import { REQUIRE_PERMISSION_KEY } from '../src/common/guards/permission.guard';
import { ProjectsController } from '../src/modules/projects/projects.controller';
import { BillingController } from '../src/modules/billing/billing.controller';

function routePermission(method: keyof ProjectsController): string | undefined {
  return Reflect.getMetadata(REQUIRE_PERMISSION_KEY, ProjectsController.prototype[method]);
}

describe('PH2-G05-008: exact capabilities on project/contract write routes', () => {
  it('uses project.close for closure rather than the broader project.manage capability', () => {
    expect(routePermission('closeProject')).toBe('project.close');
    expect(routePermission('updateProject')).toBe('project.manage');
    // A member with only a project-scoped manager role may have project.manage
    // but not the independent authority to finalize contractual closeout.
    expect(hasPermission({ projectRole:'R-PM' }, 'project.manage').allowed).toBe(true);
    expect(hasPermission({ projectRole:'R-PM' }, 'project.close').allowed).toBe(false);
    expect(hasPermission({ orgRole:'R-OWNER' }, 'project.close').allowed).toBe(true);
  });

  it('uses billing.read for read-only subscription/invoice routes, but manage for tax writes', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY,
      BillingController.prototype.listInvoices)).toBe('billing.read');
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY,
      BillingController.prototype.getCurrentSubscription)).toBe('billing.read');
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY,
      BillingController.prototype.createInvoice)).toBe('billing.manage');
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY,
      BillingController.prototype.recordTds)).toBe('billing.manage');
    expect(hasPermission({orgRole:'R-ADMIN'}, 'billing.read').allowed).toBe(true);
    expect(hasPermission({orgRole:'R-ADMIN'}, 'billing.manage').allowed).toBe(false);
    expect(hasPermission({orgRole:'R-SITE'}, 'billing.read').allowed).toBe(false);
  });

  it('does not expose financial commercial readiness via document.read', () => {
    const handler = BillingController.prototype.getCommercialReadiness;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toBe('contract.manage');
    expect(hasPermission({ orgRole:'R-SITE' }, 'document.read').allowed).toBe(true);
    expect(hasPermission({ orgRole:'R-SITE' }, 'contract.manage').allowed).toBe(false);
    expect(hasPermission({ orgRole:'R-OWNER' }, 'contract.manage').allowed).toBe(true);
  });

  it('requires commercial authority to list contractual values', () => {
    expect(routePermission('listContracts')).toBe('contract.manage');
    expect(hasPermission({ orgRole:'R-SITE', projectRole:'R-SITE' }, 'project.read').allowed).toBe(true);
    expect(hasPermission({ orgRole:'R-SITE', projectRole:'R-SITE' }, 'contract.manage').allowed).toBe(false);
  });

  it('requires contract.manage for contract, variation and specification mutation', () => {
    expect(routePermission('createContract')).toBe('contract.manage');
    expect(routePermission('createVariation')).toBe('contract.manage');
    expect(routePermission('createSpecification')).toBe('contract.manage');
    expect(hasPermission({ orgRole:'R-SITE', projectRole:'R-SITE' }, 'contract.manage').allowed)
      .toBe(false);
    expect(hasPermission({ orgRole:'R-OWNER' }, 'contract.manage').allowed).toBe(true);
  });
});
