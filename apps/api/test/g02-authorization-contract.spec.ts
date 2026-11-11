import { ForbiddenException,UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { uuidv7 } from 'uuidv7';
import { hasPermission,PROJECT_ROLE_PERMISSIONS,ORG_ROLE_PERMISSIONS } from '@tradecloseout/shared';
import { PermissionGuard,REQUIRE_PERMISSION_KEY,assertAuthorizationInputShape } from '../src/common/guards/permission.guard';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { SupplierGuestService } from '../src/modules/parties/supplier-guest.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { ReviewsController } from '../src/modules/reviews/reviews.controller';
import { HandoverController } from '../src/modules/handover/handover.controller';
import { PartiesController } from '../src/modules/parties/parties.controller';
import { assertMemberResourceScope, assertValidMemberProjectScope } from '@tradecloseout/db/tenant-tx';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('G02 executable negative authorization contracts',()=>{
  const tag=(handler:Function)=>Reflect.getMetadata(REQUIRE_PERMISSION_KEY,handler);
  it('G02-005/006/012/014: correct read/write annotations are on actual route handlers',()=>{
    for(const h of [
      ReviewsController.prototype.listReviews,
      ReviewsController.prototype.getReview,
    ])expect(tag(h)).toBe('review.read');
    for(const h of [
      PartiesController.prototype.createSupplierLink,
      PartiesController.prototype.createSupplierUploadLink,
      PartiesController.prototype.intakeSupplierObligation,
    ])expect(tag(h)).toBe('party.manage');
    expect(tag(HandoverController.prototype.exportProjectArchive)).toBe('export.data');
    expect(tag(HandoverController.prototype.listArchiveExports)).toBe('export.data');
    expect(tag(HandoverController.prototype.getArchiveExport)).toBe('export.data');
    expect(tag(ReviewsController.prototype.decideVersionReview)).toBe('review.decide');
    expect(tag(HandoverController.prototype.getProjectPackage)).toBe('package.download');
  });

  it('G02-001/010: R-REVIEWER can only download scoped project packages, QC can decide only scoped reviews',()=>{
    expect(hasPermission({orgRole:'R-REVIEWER'},'package.download')).toEqual({
      allowed:true,scope:'S',
    });
    expect(hasPermission({orgRole:'R-REVIEWER'},'export.data').allowed).toBe(false);
    expect(hasPermission({projectRole:'R-QC'},'review.decide')).toMatchObject({
      allowed:true,scope:'S',
    });
    expect(PROJECT_ROLE_PERMISSIONS['R-QC']['review.decide']).toBe('S');
    expect(PROJECT_ROLE_PERMISSIONS['R-PROC']['review.decide']).toBeUndefined();
    expect(hasPermission({orgRole:'R-AUDITOR'},'review.read').allowed).toBe(true);
    expect(hasPermission({orgRole:'R-AUDITOR'},'review.decide').allowed).toBe(false);
    expect(ORG_ROLE_PERMISSIONS['R-OWNER']['document.reuse']).toBe('A');
  });

  it('G02-016: no coercible UUID or array reaches a database lookup',()=>{
    const id=uuidv7();
    for(const v of [null,123,true,[],[id],{toString:()=>id},'',id+'z']){
      expect(()=>assertAuthorizationInputShape({projectId:v},{})).toThrow(UnprocessableEntityException);
    }
    for(const value of [[id,id],[id,'no-uuid'],[id,42],Array(101).fill(id),{},null]){
      expect(()=>assertAuthorizationInputShape({}, {requirementIds:value}))
        .toThrow(UnprocessableEntityException);
    }
    expect(()=>assertAuthorizationInputShape({projectId:id},{requirementIds:[uuidv7()]}))
      .not.toThrow();
  });

  it('G02-002: restrictive member scoping is an intersection, never a blanket capability',()=>{
    const id=uuidv7(),other=uuidv7();
    const ctx:any={orgId:uuidv7(),userId:uuidv7(),actorType:'USER',
      orgRole:'R-SITE',projectScope:{
        assetIds:[id],assetCategories:['HVAC'],readOnly:true,
        requirementIds:[id],requirementGroups:['HVAC'],
      },
    };
    expect(()=>assertMemberResourceScope(ctx,'asset',{id,categoryKey:'HVAC'},false))
      .not.toThrow();
    expect(()=>assertMemberResourceScope(ctx,'asset',{id:other,categoryKey:'HVAC'},false))
      .toThrow('G02_MEMBER_RESOURCE_SCOPE_DENIED');
    expect(()=>assertMemberResourceScope(ctx,'asset',{id,categoryKey:'ELECTRICAL'},false))
      .toThrow('G02_MEMBER_ASSET_CATEGORY_DENIED');
    expect(()=>assertMemberResourceScope(ctx,'asset',{id,categoryKey:'HVAC'},true))
      .toThrow('G02_MEMBER_SCOPE_READ_ONLY');
    expect(()=>assertMemberResourceScope(ctx,'requirement',{id,groupKey:'HVAC'},false))
      .not.toThrow();
    expect(()=>assertMemberResourceScope(ctx,'requirement',{id:other,groupKey:'HVAC'},false))
      .toThrow('G02_MEMBER_RESOURCE_SCOPE_DENIED');
  });

  it('PH1-G02-003: invalid restrictive scope never becomes unrestricted', () => {
    const id=uuidv7();
    const valid={documentIds:[id],mode:'READ_ONLY',startDate:'2026-11-01'};
    expect(()=>assertValidMemberProjectScope(valid)).not.toThrow();
    for(const invalid of [
      {readOnly:'true'}, {mode:'READ_WRITE_ALL'}, {unknownScope:'hidden'},
      {documentIds:'all'}, {assetIds:['not-a-uuid']}, {startDate:'2026-02-30'},
      {requirementIds:[id,id]}, {endDate:{today:true}},
    ]) {
      expect(()=>assertValidMemberProjectScope(invalid)).toThrow('G02_MEMBER_SCOPE_INVALID');
      expect(()=>assertMemberResourceScope({
        orgId:uuidv7(),userId:uuidv7(),actorType:'USER',
        orgRole:'R-SITE',projectScope:invalid,
      }, 'document',{id},false)).toThrow('G02_MEMBER_SCOPE_INVALID');
    }
    expect(()=>assertMemberResourceScope({
      orgId:uuidv7(),userId:uuidv7(),actorType:'USER',
      orgRole:'R-SITE',projectScope:valid,
    },'document',{id},true)).toThrow('G02_MEMBER_SCOPE_READ_ONLY');
  });

  it('G02-001/015: upload-only guest never gets package metadata or exports before DB reads',async()=>{
    const pool:any={connect:jest.fn(()=>{throw new Error('DB_ACQUIRED');})};
    const guard=new PermissionGuard(new Reflector(),pool);
    const project=uuidv7(),grant=uuidv7();
    const user={userId:uuidv7(),orgId:uuidv7(),guestGrantId:grant,
      guestProjectId:project,actorType:'GUEST',guestCapabilities:['document.upload']};
    for(const h of [
      HandoverController.prototype.getPackage,
      HandoverController.prototype.getProjectPackage,
      HandoverController.prototype.exportProjectArchive,
    ]){
      const req:any={user,params:{projectId:project,id:uuidv7()},
        method:'GET',path:`/api/v1/projects/${project}/packages/${uuidv7()}`,ip:'192.0.2.10'};
      await expect(guard.canActivate({
        getHandler:()=>h,getClass:()=>HandoverController,
        switchToHttp:()=>({getRequest:()=>req}),
      } as any)).rejects.toThrow(ForbiddenException);
    }
    // Business resource access was denied before any business query. The
    // separate bounded denial-audit writer may acquire its own DB connection.
    expect(pool.connect).toHaveBeenCalledTimes(3);
  });

  it('G02-005: direct supplier grant issuance cannot proceed for guest even with upload scope',async()=>{
    const pool:any={connect:jest.fn()};
    const ctx:any={orgId:uuidv7(),userId:uuidv7(),actorType:'GUEST',
      guestGrantId:uuidv7(),orgRole:'GUEST'};
    const svc=new SupplierGuestService(pool);
    await expect(svc.createScopedSupplierUploadLink(ctx,uuidv7(),{
      supplierPartyId:uuidv7(),requirementIds:[uuidv7()],
    })).rejects.toThrow(ForbiddenException);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('G02-006: direct guest intake is denied before client acquisition',async()=>{
    const pool:any={connect:jest.fn()};
    const service=new PartiesService(new TenantDbService(pool));
    const ctx:any={orgId:uuidv7(),userId:uuidv7(),actorType:'GUEST',
      guestGrantId:uuidv7()};
    await expect(service.intakeSupplierObligation(ctx,uuidv7(),uuidv7(),
      {decision:'ACCEPT'})).rejects.toThrow(ForbiddenException);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('G02-007: guest internal roster is unavailable even when project.read was delegated',async()=>{
    const pool:any={connect:jest.fn()};
    const ctx:any={orgId:uuidv7(),userId:uuidv7(),actorType:'GUEST',
      guestGrantId:uuidv7()};
    await expect(new ProjectsService(pool).listProjectMembers(ctx,uuidv7()))
      .rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('G02-014: direct service caller without export authority is denied before DB',async()=>{
    const pool:any={connect:jest.fn()};
    const svc=new HandoverService(pool,{} as any);
    for(const role of ['R-DOC','R-PM','R-REVIEWER']){
      await expect(svc.exportProjectArchive({
        orgId:uuidv7(),userId:uuidv7(),orgRole:role,actorType:'MEMBER',
        requestId:uuidv7(),ip:'127.0.0.1',userAgent:'test',
      },uuidv7(),{purpose:'Unauthorized project archive export'}))
        .rejects.toThrow(ForbiddenException);
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
